/**
 * Swap (master plan §8.6): the mini-router quotes on chain, the wallet fee
 * comes from the holder tier (§8.18), and execution is a flow of internal
 * approvals — approve Permit2 once per token, a per-swap exact PermitSingle
 * signature, then the Universal Router call with PAY_PORTION to the pinned
 * sink. The tier is re-read at sign time; a moved tier re-quotes, and the
 * firewall's FEE_SINK/FEE_TIER rules check the bytes we hand it (T10).
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import {
  DEFAULT_SLIPPAGE_BIPS,
  ERC20_ABI,
  PERMIT2_ABI,
  PERMIT_EXPIRY_S,
  bestRoute,
  detectTax,
  encodeApprovePermit2,
  encodeSwap,
  feeAmount,
  minimumOut,
  netAfterFee,
  permitCovers,
  permitSingleTypedData,
  priceImpactPct,
  taxSlippageBips,
  type BestQuote,
  type PermitInput,
  type QuoteAddresses,
  type ReadCall as EsReadCall,
  type ReadResult as EsReadResult,
} from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { formatUnits, maxUint256, parseUnits, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import { AccountIdSchema, type SwapFlow, type SwapQuote, type SwapStep, type TokenView } from '../schema'
import type { SettingsStore } from '../settingsStore'
import type { ChainsService } from './chains'
import { type FlowStepRun, type FlowStore } from './flows'
import type { HolderService } from './holder'
import type { ProviderService } from './provider'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

export interface SwapDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly tokens: TokensService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly settings: SettingsStore
  /** Signed flags (§3.7): the swap kill-switch. */
  readonly statics?: { isDisabled(feature: 'swap' | 'limit'): boolean }
  readonly holder: HolderService
  readonly flows: FlowStore
}

export interface SwapInput {
  readonly accountId: string
  readonly chainId: number
  /** 'native' or a token address. */
  readonly tokenIn: string
  readonly tokenOut: string
  /** Human amount, decimal string. */
  readonly amountIn: string
  readonly slippageBips?: number
}

const ZERO = '0x0000000000000000000000000000000000000000' as Hex
/** The UR deadline for a swap the user is looking at (§8.6: stale after 8 s, but the chain needs headroom). */
const DEADLINE_S = 20 * 60
const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const isEtn = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The engine's multicall reader in the router's shape. */
export function readerFor(chains: ChainsService, chainId: number): (calls: readonly EsReadCall[]) => Promise<EsReadResult[]> {
  return (calls) => readMany(chains, chainId, calls)
}

export function quoteAddresses(chainId: 52014 | 5201420): QuoteAddresses {
  const a = ELECTRONEUM_ADDRESSES[chainId]
  return { quoterV2: a.quoterV2 as Hex, mixedRouteQuoter: a.mixedRouteQuoter as Hex | null, v2Router02: a.v2Router02 as Hex, bases: [a.wetn, a.usdc, a.usdt, ...(a.bolt ? [a.bolt] : [])].map((x) => x as Hex) }
}

export function rateOf(amountIn: bigint, amountOut: bigint, decimalsIn: number, decimalsOut: number): number | null {
  if (amountIn === 0n) return null
  const i = Number(formatUnits(amountIn, decimalsIn))
  const o = Number(formatUnits(amountOut, decimalsOut))
  return i > 0 && Number.isFinite(o) ? o / i : null
}

export class SwapService {
  constructor(private readonly deps: SwapDeps) {}

  private async pair(chainId: number, tokenIn: string, tokenOut: string): Promise<{ inView: TokenView | null; outView: TokenView | null }> {
    const [inView, outView] = await Promise.all([this.deps.tokens.get(chainId, tokenIn), this.deps.tokens.get(chainId, tokenOut)])
    return { inView, outView }
  }

  private skeleton(input: SwapInput, inView: TokenView | null, outView: TokenView | null, problems: string[]): SwapQuote {
    return {
      chainId: input.chainId,
      tokenIn: input.tokenIn,
      tokenOut: input.tokenOut,
      symbolIn: inView?.symbol ?? '?',
      symbolOut: outView?.symbol ?? '?',
      decimalsIn: inView?.decimals ?? 18,
      decimalsOut: outView?.decimals ?? 18,
      amountInRaw: '0',
      balanceInRaw: '0',
      amountOutRaw: '0',
      receiveRaw: '0',
      minimumOutRaw: '0',
      rate: null,
      priceImpactPct: null,
      slippageBips: input.slippageBips ?? DEFAULT_SLIPPAGE_BIPS,
      taxBips: 0,
      fee: { bips: 0, tier: 0, amountRaw: '0', sink: null, source: 'fallback', nextTierAt: null, nextTierBips: null },
      route: { label: '', hops: [] },
      gasEstimate: '0',
      steps: [],
      quotedAt: this.deps.platform.now(),
      ok: false,
      problems,
    }
  }

  async quote(input: SwapInput): Promise<SwapQuote> {
    const d = this.deps
    const { chainId } = input
    const { inView, outView } = await this.pair(chainId, input.tokenIn, input.tokenOut)
    const problems: string[] = []
    // The kill-switch (§3.7) comes before every other answer, even for a pair the wallet does not know.
    if (this.deps.statics?.isDisabled('swap')) return this.skeleton(input, inView, outView, ['In-wallet swaps are switched off right now by a signed flag from ElectroSwap. Swap on app.electroswap.io meanwhile.'])
    if (!isEtn(chainId)) return this.skeleton(input, inView, outView, ['Swaps happen on Electroneum. Bridge first, then swap.'])
    if (!inView || !outView) return this.skeleton(input, inView, outView, ['Pick two tokens.'])
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const wetn = A.wetn as Hex
    const nativeIn = inView.address === 'native'
    const nativeOut = outView.address === 'native'
    const wrappedIn = nativeIn ? wetn : (inView.address as Hex)
    const wrappedOut = nativeOut ? wetn : (outView.address as Hex)
    const settings = await d.settings.get()
    const slippageBips = input.slippageBips ?? settings.slippageBips
    let amountIn = 0n
    try {
      amountIn = parseUnits(input.amountIn.trim() || '0', inView.decimals)
    } catch {
      problems.push('That amount is not a number.')
    }
    if (same(wrappedIn, wrappedOut)) problems.push('Pick two different tokens.')
    if (amountIn <= 0n) problems.push('Enter an amount above zero.')
    if (account.kind === 'watch') problems.push('Watch-only — import a key or pair a device to swap.')
    const status = await d.vault.status()
    if (!status.backupComplete && status.seeds.length > 0 && account.kind === 'hd') problems.push('Back up your recovery phrase before you swap.')

    // Balances and the network fee reserve.
    const read = readerFor(d.chains, chainId)
    const nativeBalance = BigInt(String((await d.chains.rpc(chainId, 'eth_getBalance', [owner, 'latest']).catch(() => '0x0')) ?? '0x0'))
    const gasPrice = BigInt(String((await d.chains.rpc(chainId, 'eth_gasPrice', []).catch(() => '0x3b9aca00')) ?? '0x3b9aca00'))
    const tier = await d.holder.tier(input.accountId, chainId)
    const stateCalls: EsReadCall[] = nativeIn
      ? []
      : [
          { address: wrappedIn, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] },
          { address: wrappedIn, abi: ERC20_ABI, functionName: 'allowance', args: [owner, A.permit2 as Hex] },
          { address: A.permit2 as Hex, abi: PERMIT2_ABI, functionName: 'allowance', args: [owner, wrappedIn, A.universalRouter as Hex] },
        ]
    const state = stateCalls.length ? await read(stateCalls) : []
    const balanceIn = nativeIn ? nativeBalance : state[0]?.ok && typeof state[0].value === 'bigint' ? state[0].value : 0n
    const erc20Allowance = !nativeIn && state[1]?.ok && typeof state[1].value === 'bigint' ? state[1].value : 0n
    const p2 = !nativeIn && state[2]?.ok && Array.isArray(state[2].value) ? (state[2].value as [bigint, number, number]) : null
    const nowS = Math.floor(d.platform.now() / 1000)

    const base = this.skeleton(input, inView, outView, problems)
    const withState: SwapQuote = { ...base, amountInRaw: amountIn.toString(), balanceInRaw: balanceIn.toString(), slippageBips, fee: { ...base.fee, bips: tier.bips, tier: tier.tier, sink: tier.sink, source: tier.source, nextTierAt: tier.nextTierAt, nextTierBips: tier.nextTierBips } }
    if (problems.length > 0 || amountIn <= 0n) return withState

    // Route, spot (for impact) and taxes in as few batches as the reader allows.
    const addresses = quoteAddresses(chainId)
    const probeIn = amountIn / 1000n
    const [best, probe, taxIn, taxOut] = await Promise.all([
      bestRoute(wrappedIn, wrappedOut, amountIn, addresses, read),
      probeIn > 0n ? bestRoute(wrappedIn, wrappedOut, probeIn, addresses, read) : Promise.resolve<BestQuote | null>(null),
      same(wrappedIn, wetn) ? Promise.resolve(null) : detectTax(A.feeOnTransferDetector as Hex | null, wrappedIn, wetn, read).catch(() => null),
      same(wrappedOut, wetn) ? Promise.resolve(null) : detectTax(A.feeOnTransferDetector as Hex | null, wrappedOut, wetn, read).catch(() => null),
    ])
    if (!best) {
      problems.push('No route on ElectroSwap for this pair.')
      return { ...withState, problems }
    }
    if (taxIn?.sellReverted) problems.push('This token cannot be sold on ElectroSwap right now.')
    const taxBips = taxSlippageBips(taxIn, taxOut)
    const amountOut = best.best.amountOut
    const bips = tier.bips
    const sink = tier.sink
    if (bips > 0 && !sink) problems.push('The wallet fee sink for this network is not configured. In-wallet swaps stay off until it is.')
    const effectiveSlippage = slippageBips + taxBips
    const receive = netAfterFee(amountOut, bips)
    const minOut = minimumOut(amountOut, bips, effectiveSlippage)
    const spot = probe ? rateOf(probeIn, probe.best.amountOut, inView.decimals, outView.decimals) : null
    const impact = priceImpactPct(amountIn, amountOut, spot, inView.decimals, outView.decimals)

    const steps: SwapStep[] = []
    if (!nativeIn) {
      if (erc20Allowance < amountIn) steps.push('approve')
      if (!p2 || !permitCovers({ amount: p2[0], expiration: Number(p2[1]), nonce: Number(p2[2]) }, amountIn, nowS)) steps.push('permit')
    }
    steps.push('swap')
    const gas = best.best.gasEstimate + 90_000n + (steps.includes('approve') ? 55_000n : 0n) + (steps.includes('permit') ? 35_000n : 0n)
    const feeWei = gas * gasPrice
    if (amountIn > balanceIn) problems.push(`Not enough ${inView.symbol}.`)
    if ((nativeIn ? amountIn : 0n) + feeWei > nativeBalance) problems.push('Not enough ETN for the network fee.')

    return {
      ...withState,
      amountOutRaw: amountOut.toString(),
      receiveRaw: receive.toString(),
      minimumOutRaw: minOut.toString(),
      rate: rateOf(amountIn, amountOut, inView.decimals, outView.decimals),
      priceImpactPct: impact,
      taxBips,
      fee: { ...withState.fee, amountRaw: feeAmount(amountOut, bips).toString() },
      route: { label: best.best.candidate.label, hops: best.best.candidate.route.hops.map((h) => (h.kind === 'v3' ? { kind: 'v3' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut, fee: h.fee } : { kind: 'v2' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut })) },
      gasEstimate: gas.toString(),
      steps,
      quotedAt: d.platform.now(),
      ok: problems.length === 0,
      problems,
    }
  }

  /** Start the flow: approve → permit → swap, one sheet each. Resolves once the first sheet exists. */
  async execute(input: SwapInput): Promise<{ flowId: string; requestId: string | null }> {
    const d = this.deps
    if (d.statics?.isDisabled('swap')) throw new EngineError('invalid_argument', 'In-wallet swaps are switched off right now.')
    const { chainId } = input
    if (!isEtn(chainId)) throw new EngineError('invalid_argument', 'Swaps happen on Electroneum.')
    const first = await this.quote(input)
    if (!first.ok) throw new EngineError('invalid_argument', first.problems[0] ?? 'cannot swap')
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const permit2 = A.permit2 as Hex
    const ur = A.universalRouter as Hex
    const wetn = A.wetn as Hex
    const nativeIn = input.tokenIn === 'native'
    const nativeOut = input.tokenOut === 'native'
    const tokenIn = nativeIn ? wetn : (input.tokenIn as Hex)
    const amountIn = BigInt(first.amountInRaw)
    const settings = await d.settings.get()
    const tag = d.platform.now().toString(36)
    let permit: PermitInput | undefined
    const steps: FlowStepRun[] = []

    if (first.steps.includes('approve')) {
      steps.push({
        step: 'approve',
        waitReceipt: true,
        run: () =>
          d.provider.runInternal({
            kind: 'send_transaction',
            origin: 'internal:swap:approve',
            chainId,
            accountId: input.accountId,
            tx: { from: owner, to: tokenIn, value: '0x0', data: encodeApprovePermit2(permit2, settings.exactApprovals ? amountIn : maxUint256).data },
            clientRequestId: `swap:${tag}:approve`,
          }),
      })
    }
    if (first.steps.includes('permit')) {
      steps.push({
        step: 'permit',
        run: async () => {
          const [r] = await readMany(d.chains, chainId, [{ address: permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [owner, tokenIn, ur] }])
          const nonce = r?.ok && Array.isArray(r.value) ? Number((r.value as [bigint, number, number])[2]) : 0
          const nowS = Math.floor(d.platform.now() / 1000)
          const typed = permitSingleTypedData({ chainId, permit2, token: tokenIn, amount: amountIn, nonce, spender: ur, nowSeconds: nowS })
          const { requestId, result } = await d.provider.runInternal({ kind: 'sign_typed_data', origin: 'internal:swap:permit', chainId, accountId: input.accountId, from: owner, typedData: typed, version: 'v4', clientRequestId: `swap:${tag}:permit` })
          const settled = result.then((sig) => {
            permit = { token: tokenIn, amount: amountIn, expiration: nowS + PERMIT_EXPIRY_S, nonce, spender: ur, sigDeadline: BigInt(nowS + PERMIT_EXPIRY_S), signature: sig as Hex }
            return sig
          })
          settled.catch(() => undefined)
          return { requestId, result: settled }
        },
      })
    }
    steps.push({
      step: 'swap',
      waitReceipt: true,
      run: async (flowId) => {
        // The tier is re-read at sign time; if it moved, the whole quote is redone (never a stale bips).
        const tier = await d.holder.tier(input.accountId, chainId, true)
        let quote = first
        if (tier.bips !== first.fee.bips || d.platform.now() - first.quotedAt > 8_000) {
          quote = await this.quote({ ...input, slippageBips: first.slippageBips })
          if (!quote.ok) throw new EngineError('invalid_argument', quote.problems[0] ?? 'the quote changed')
          d.flows.setQuote(flowId, quote)
        }
        const bips = quote.fee.bips
        const sink = (quote.fee.sink ?? null) as Hex | null
        if (bips > 0 && !sink) throw new EngineError('invalid_argument', 'The wallet fee sink for this network is not configured.')
        const nowS = Math.floor(d.platform.now() / 1000)
        const enc = encodeSwap({
          route: { hops: quote.route.hops.map((h) => (h.kind === 'v3' ? { kind: 'v3' as const, tokenIn: h.tokenIn as Hex, tokenOut: h.tokenOut as Hex, fee: h.fee ?? 3000 } : { kind: 'v2' as const, tokenIn: h.tokenIn as Hex, tokenOut: h.tokenOut as Hex })) },
          amountIn,
          quotedOut: BigInt(quote.amountOutRaw),
          slippageBips: quote.slippageBips + quote.taxBips,
          nativeIn,
          nativeOut,
          wrappedNative: wetn,
          recipient: owner,
          fee: bips > 0 && sink ? { sink, bips } : null,
          ...(permit ? { permit } : {}),
          deadline: BigInt(nowS + DEADLINE_S),
          universalRouter: ur,
        })
        return d.provider.runInternal({
          kind: 'send_transaction',
          origin: 'internal:swap',
          chainId,
          accountId: input.accountId,
          tx: { from: owner, to: enc.to, value: hex(enc.value), data: enc.data },
          clientRequestId: `swap:${tag}:swap`,
          expectedFee: { sink: sink ?? ZERO, bips },
        })
      },
    })
    const flow = await d.flows.start({ kind: 'swap', accountId: input.accountId, chainId, quote: first, steps })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  flow(id: string): SwapFlow | null {
    return this.deps.flows.get(id)
  }

  flows(accountId?: string): SwapFlow[] {
    return this.deps.flows.list(accountId)
  }
}

const InputSchema = z.object({
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string().max(80),
  slippageBips: z.number().int().min(1).max(5_000).optional(),
})

export function swapNamespace(swap: SwapService): NamespaceSpec {
  return {
    quote: { input: InputSchema, handler: (arg) => swap.quote(arg as SwapInput) },
    execute: { input: InputSchema, handler: (arg) => swap.execute(arg as SwapInput) },
    flow: { input: z.object({ flowId: z.string() }), handler: async (arg) => swap.flow((arg as { flowId: string }).flowId) },
    flows: { input: z.object({ accountId: AccountIdSchema.optional() }).optional(), handler: async (arg) => swap.flows((arg as { accountId?: string } | undefined)?.accountId) },
  }
}
