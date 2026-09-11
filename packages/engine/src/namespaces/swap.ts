/**
 * Swap (master plan §8.6): ElectroSwap's routing service prices the trade and
 * the mini-router quotes on chain whenever it cannot, the wallet fee comes from
 * the holder tier (§8.18), and execution is a flow of internal
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
  deliveredMinimumOut,
  netAfterFee,
  permitCovers,
  permitSingleTypedData,
  priceImpactPct,
  taxSlippageBips,
  type BestQuote,
  type Hop,
  type PermitInput,
  type QuoteAddresses,
  type ReadCall as EsReadCall,
  type Reader as EsReader,
  type ReadResult as EsReadResult,
  type RouteQuote,
} from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { formatUnits, maxUint256, parseUnits, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import type { Quoter, QuoterInput, QuoterOutcome } from '../quoterApi'
import { AccountIdSchema, type SwapFlow, type SwapHop, type SwapQuote, type SwapStep, type TokenView } from '../schema'
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
  /**
   * ElectroSwap's routing service (§8.6), asked before the mini-router. Absent
   * when the build ships no wallet key — the service answers 401 without one,
   * so there would be nothing to ask — and in tests, which quote on chain.
   */
  readonly quoter?: Quoter
  /**
   * ElectroSwap's project safety level for a token (§8.3). Optional: a build
   * with no API cannot answer, and silence must never be read as "blocked".
   */
  readonly safety?: { level(chainId: number, address: string): Promise<TokenSafetyLevel | null> }
}

/** ElectroSwap's project safety levels, as the market data reports them. */
export type TokenSafetyLevel = 'VERIFIED' | 'MEDIUM_WARNING' | 'STRONG_WARNING' | 'BLOCKED'

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
/** Combined slippage at which `minimumOut` reaches zero, i.e. no floor at all. */
const BIPS_CEILING = 10_000
/** Hard clamp, so a path that ever skips the refusal still leaves a non-zero floor. */
const MAX_EFFECTIVE_SLIPPAGE_BPS = 9_900
/** How far below the mini-router's price a served quote may sit and still be used (§8.6). */
const MAX_SERVED_SHORTFALL_BPS = 100
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

/**
 * A quoted hop as the encoder needs it.
 *
 * `SwapHopSchema` leaves `fee` optional because a V2 hop has none, so a V3 hop
 * that arrived without one used to be encoded as 0.3% — a tier that may have no
 * pool behind it at all, and on a pair where it does, simply the wrong price.
 * The quote now has two possible authors, one of them a service over the
 * network, and guessing is the one thing that must not happen on the path to
 * calldata the user signs. Refuse and let the caller re-quote instead.
 */
function encodableHop(h: SwapHop): Hop {
  if (h.kind === 'v2') return { kind: 'v2', tokenIn: h.tokenIn as Hex, tokenOut: h.tokenOut as Hex }
  if (h.fee === undefined) throw new EngineError('invalid_argument', 'That route came back without a fee tier. Start the swap again to re-price it.')
  return { kind: 'v3', tokenIn: h.tokenIn as Hex, tokenOut: h.tokenOut as Hex, fee: h.fee }
}

/**
 * Is the served price one the wallet is willing to stand behind?
 *
 * §8.6 words the rule as "> 1% divergence → on-chain wins", which is symmetric.
 * It is applied asymmetrically here, and deliberately: the two directions are
 * not the same risk. A served price *above* the mini-router's is what the
 * service is for — an AlphaRouter that walks the whole pool graph finds routes
 * sixteen fixed candidates cannot, and rejecting those would discard the entire
 * benefit. A served price *below* it is the dangerous one, because it is the
 * number `minimumOut` is derived from: accept a figure 5% light and the swap is
 * signed with 5% of room for somebody to take. So a better price is taken at
 * face value, and a worse one only inside the band that ordinary disagreement
 * between two routers at two moments can explain.
 *
 * No local price at all — the mini-router found no route — is not a failed
 * comparison, it is the headline case, and the served route stands.
 */
function servedIsFair(served: bigint, local: bigint): boolean {
  if (local <= 0n || served >= local) return true
  return (local - served) * BigInt(BIPS_CEILING) <= local * BigInt(MAX_SERVED_SHORTFALL_BPS)
}

export class SwapService {
  constructor(private readonly deps: SwapDeps) {}

  private async pair(chainId: number, tokenIn: string, tokenOut: string): Promise<{ inView: TokenView | null; outView: TokenView | null }> {
    const [inView, outView] = await Promise.all([this.deps.tokens.get(chainId, tokenIn), this.deps.tokens.get(chainId, tokenOut)])
    return { inView, outView }
  }

  /** Fail-soft: an unreachable API, a token the API does not know, or the native coin all answer "not blocked". */
  private async isBlocked(chainId: number, address: string): Promise<boolean> {
    if (address === 'native' || !this.deps.safety) return false
    try {
      return (await this.deps.safety.level(chainId, address)) === 'BLOCKED'
    } catch {
      return false
    }
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
      taxUnknown: false,
      fee: { bips: 0, tier: 0, name: '', amountRaw: '0', sink: null, source: 'fallback', nextTierAt: null, nextTierBips: null },
      route: { label: '', hops: [], source: 'onchain' },
      gasEstimate: '0',
      steps: [],
      quotedAt: this.deps.platform.now(),
      ok: false,
      problems,
    }
  }

  /**
   * The routing service first, the on-chain mini-router when it cannot answer.
   *
   * "Cannot answer" is deliberately wide: unreachable, slow, rate limited, no
   * route, a route the encoder cannot express, or a price materially worse than
   * the wallet can prove for itself. All of those land in the same place, which
   * is the behaviour that shipped before the service was asked at all — so the
   * worst it can do to a quote is cost it one bounded round trip, in parallel
   * with work the wallet was doing anyway. It is never the reason a swap is
   * refused.
   */
  private async route(input: QuoterInput, addresses: QuoteAddresses, read: EsReader): Promise<{ quote: RouteQuote; source: 'api' | 'onchain' } | null> {
    const quoter = this.deps.quoter
    /*
      Both at once, and the on-chain quote unconditionally.

      §8.6 asks for a divergence check on the served price, and a check needs
      something to check against. Asking only when the service declines would
      leave the one case that actually costs a user unguarded: a quote below the
      real price is signed with a `minOut` below the real price, which is room a
      sandwich can take. (A quote *above* it is the harmless direction — the
      minimum is then unreachable and the swap reverts.) Quoting on chain anyway
      costs nothing that was not already being spent, and it turns the service
      from something trusted into something corroborated.
    */
    const [served, onChain] = await Promise.all([
      quoter ? quoter.route(input) : Promise.resolve<QuoterOutcome>({ kind: 'none', reason: 'no quoter' }),
      bestRoute(input.tokenIn, input.tokenOut, input.amountIn, addresses, read),
    ])
    const local = onChain?.best ?? null
    if (served.kind === 'route' && servedIsFair(served.quote.amountOut, local?.amountOut ?? 0n)) return { quote: served.quote, source: 'api' }
    return local ? { quote: local, source: 'onchain' } : null
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
    /*
      The safety level used to be decoration: one warning icon on one Explore
      row, and nothing in the swap path ever read it, so a token ElectroSwap had
      marked BLOCKED swapped exactly like any other. Refusing belongs here rather
      than in the screen, because the screen is not the only way to reach a swap.
      Only BLOCKED refuses: an unknown token is not a blocked one, and a silent
      API must not turn every token into a refusal.
    */
    for (const side of [inView, outView]) {
      if (await this.isBlocked(chainId, side.address)) problems.push(`${side.symbol} is marked unsafe by ElectroSwap. BoltVault will not swap it.`)
    }

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
    const withState: SwapQuote = { ...base, amountInRaw: amountIn.toString(), balanceInRaw: balanceIn.toString(), slippageBips, fee: { ...base.fee, bips: tier.bips, tier: tier.tier, name: tier.name, sink: tier.sink, source: tier.source, nextTierAt: tier.nextTierAt, nextTierBips: tier.nextTierBips } }
    if (problems.length > 0 || amountIn <= 0n) return withState

    // Route, spot (for impact) and taxes in as few batches as the reader allows.
    const addresses = quoteAddresses(chainId)
    const probeIn = amountIn / 1000n
    const [routed, probe, taxIn, taxOut] = await Promise.all([
      this.route({ chainId, tokenIn: wrappedIn, tokenOut: wrappedOut, amountIn, recipient: owner }, addresses, read),
      /*
        The spot probe stays on chain.

        It is a thousandth of the trade, quoted only to divide into the real
        output for the price impact figure, and the routing service allows
        thirty requests per five minutes — spending two of them per keystroke
        to price a rounding error would starve the quote that matters.
      */
      probeIn > 0n ? bestRoute(wrappedIn, wrappedOut, probeIn, addresses, read) : Promise.resolve<BestQuote | null>(null),
      same(wrappedIn, wetn) ? Promise.resolve(null) : detectTax(A.feeOnTransferDetector as Hex | null, wrappedIn, wetn, read),
      same(wrappedOut, wetn) ? Promise.resolve(null) : detectTax(A.feeOnTransferDetector as Hex | null, wrappedOut, wetn, read),
    ])
    if (!routed) {
      problems.push('No route on ElectroSwap for this pair.')
      return { ...withState, problems }
    }
    const best = routed.quote
    /*
      A probe that could not answer is not a probe that said "no tax" — and it
      is not a reason to refuse the swap either.

      Every failure path used to collapse to `null`, so a reverting detector or
      a rate-limited node read as a clean token. Turning that into a refusal
      went too far the other way: the detector reverts `PairLookupFailed` for
      any token with no V2 pair against WETN, which is an ordinary thing for a
      token to be, and the protection that actually matters — the minimum
      received, enforced on chain — does not depend on the probe at all. So the
      uncertainty is reported rather than either assumed away or treated as
      fatal.
    */
    const taxUnknown = taxIn === 'unavailable' || taxOut === 'unavailable'
    const taxBips = taxSlippageBips(taxIn, taxOut)
    const amountOut = best.amountOut
    const bips = tier.bips
    const sink = tier.sink
    // There is no sink contract any more: the fee goes to an address named in
    // `fees.json`, and a chain that names none has in-wallet swap switched off.
    if (bips > 0 && !sink) problems.push('In-wallet swaps are off on this network — no fee address is set for it in this build.')
    /*
      Slippage and the token's transfer tax were summed with no ceiling. At
      10 000 bps `minimumOut` computes to exactly zero — the swap would accept
      any output at all, including dust — and above it the subtraction goes
      negative and the encoder throws. A token declaring a large enough tax
      therefore disarmed the only protection the swap has. Refuse instead: a
      swap whose combined slippage reaches 100% has nothing left to protect.
    */
    const effectiveSlippage = Math.min(slippageBips + taxBips, MAX_EFFECTIVE_SLIPPAGE_BPS)
    if (slippageBips + taxBips >= BIPS_CEILING)
      problems.push('This token’s transfer tax plus your slippage would leave no minimum received. BoltVault will not sign a swap with no floor.')
    // What actually lands: the quoter's output, less the wallet fee, less the
    // token's own transfer tax. The tax used to widen slippage only, so the
    // "you receive" figure was the pre-tax number.
    const receive = (netAfterFee(amountOut, bips) * BigInt(10_000 - Math.min(taxBips, 9_999))) / 10_000n
    // The figure the router will enforce, not a parallel computation of it:
    // the same function the encoder writes into the delivering command.
    const minOut = deliveredMinimumOut(amountOut, bips, effectiveSlippage)
    const spot = probe ? rateOf(probeIn, probe.best.amountOut, inView.decimals, outView.decimals) : null
    const impact = priceImpactPct(amountIn, amountOut, spot, inView.decimals, outView.decimals)

    const steps: SwapStep[] = []
    if (!nativeIn) {
      if (erc20Allowance < amountIn) steps.push('approve')
      if (!p2 || !permitCovers({ amount: p2[0], expiration: Number(p2[1]), nonce: Number(p2[2]) }, amountIn, nowS)) steps.push('permit')
    }
    steps.push('swap')
    const gas = best.gasEstimate + 90_000n + (steps.includes('approve') ? 55_000n : 0n) + (steps.includes('permit') ? 35_000n : 0n)
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
      taxUnknown,
      fee: { ...withState.fee, amountRaw: feeAmount(amountOut, bips).toString() },
      route: { label: best.candidate.label, source: routed.source, hops: best.candidate.route.hops.map((h) => (h.kind === 'v3' ? { kind: 'v3' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut, fee: h.fee } : { kind: 'v2' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut })) },
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
          /*
            Stop if the price has moved further than the slippage the user
            accepted.

            The steps run strictly in sequence — an approve receipt and a permit
            signature both have to land first — so more than eight seconds has
            essentially always passed, and this re-quote is the one that gets
            encoded. The only test on it was that it succeeded. An adverse move
            or a deliberate pool manipulation between the two could therefore
            take the output well below what the user agreed to and still
            proceed, raising a sheet for the new figure on a screen they had
            already committed to. Their own slippage tolerance is the right
            bound: a move inside it is what they said they would accept, and a
            move beyond it is a different trade that needs asking again.
          */
          const before = BigInt(first.amountOutRaw)
          const now = BigInt(quote.amountOutRaw)
          if (before > 0n && now < before) {
            const droppedBips = ((before - now) * 10_000n) / before
            if (droppedBips > BigInt(first.slippageBips))
              throw new EngineError('invalid_argument', `The price moved by ${(Number(droppedBips) / 100).toFixed(2)}% while this swap was being set up, which is more than your slippage allows. Start it again to see the new price.`)
          }
          d.flows.setQuote(flowId, quote)
        }
        const bips = quote.fee.bips
        const sink = (quote.fee.sink ?? null) as Hex | null
        if (bips > 0 && !sink) throw new EngineError('invalid_argument', 'In-wallet swaps are off on this network — no fee address is set for it in this build.')
        const nowS = Math.floor(d.platform.now() / 1000)
        const enc = encodeSwap({
          route: { hops: quote.route.hops.map((h) => encodableHop(h)) },
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
