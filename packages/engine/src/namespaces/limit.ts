/**
 * Limit orders (master plan §8.6) on ElectroSwap's EsLimitOrderManagerV1:
 * place = (wrap ETN →) approve Permit2 → PermitSingle for the manager →
 * submitOrderWithPermit, one sheet each; cancel = closeOrder; list reads
 * the manager on chain. The contract takes 0.1 % on fill — there is no
 * wallet fee on limit orders and the copy says so.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { ERC20_ABI, LIMIT_PLATFORM_FEE_BIPS, PERMIT2_ABI, PERMIT_EXPIRY_S, bestRoute, encodeApprovePermit2, encodeCloseOrder, encodeSubmitOrder, encodeSubmitOrderWithPermit, openOrders, permitCovers, permitSingleTypedData } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { encodeFunctionData, maxUint256, parseAbi, type Hex } from 'viem'
import { z } from 'zod'
import { amountOrProblem } from '../amount'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import { AccountIdSchema, type LimitOrderView, type LimitQuote, type SwapStep, type TokenView } from '../schema'
import type { SettingsStore } from '../settingsStore'
import type { ChainsService } from './chains'
import type { FlowStepRun, FlowStore } from './flows'
import type { TokenSafetyLevel } from './swap'
import type { ProviderService } from './provider'
import { quoteAddresses, rateOf, readerFor } from './swap'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const WETH = parseAbi(['function deposit() payable'])

export interface LimitDeps {
  /** Signed kill-switches (§3.7); absent in hosts that serve no statics. */
  readonly statics?: { isDisabled(feature: 'limit'): boolean }
  readonly platform: Platform
  readonly bus: EventBus
  readonly chains: ChainsService
  readonly tokens: TokensService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly settings: SettingsStore
  readonly flows: FlowStore
  /** Build feature flag: off by default (`features.limitOrders` in EngineDeps). */
  readonly enabled: boolean
  /**
   * ElectroSwap's project safety level for a token (§8.3), same source the swap
   * gate reads. Optional: a build with no API cannot answer, and silence must
   * never be read as "blocked".
   */
  readonly safety?: { level(chainId: number, address: string): Promise<TokenSafetyLevel | null> }
}

export interface LimitInput {
  readonly accountId: string
  readonly chainId: number
  readonly tokenIn: string
  readonly tokenOut: string
  /** Human amount in. */
  readonly amountIn: string
  /** Human minimum out — the target. */
  readonly minOut: string
  readonly durationSeconds: number
}

const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const isEtn = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

export class LimitService {
  /**
   * The signed kill-switch for this surface (§3.7, docs/security.md).
   *
   * `statics.isDisabled` accepted six features and only `swap` and `bridge` ever
   * called it, so four of the six documented emergency controls did nothing: ops
   * could publish `limit: disabled` during an incident and the wallet would keep
   * placing orders. Hiding a screen is not the control either — every namespace
   * is callable from any UI page — so the check lives at the top of each verb
   * that starts a flow.
   */
  private assertEnabled(): void {
    if (this.deps.statics?.isDisabled('limit'))
      throw new EngineError(
        'invalid_argument',
        'Limit orders are switched off right now by a signed flag from ElectroSwap.',
      )
  }

  constructor(private readonly deps: LimitDeps) {}

  private manager(chainId: number): Hex | null {
    return isEtn(chainId) ? ((ELECTRONEUM_ADDRESSES[chainId].limitOrders as Hex | null) ?? null) : null
  }

  /** Fail-soft: an unreachable API, an unrated token, or the native coin all answer "not blocked". */
  private async isBlocked(chainId: number, address: string): Promise<boolean> {
    if (address === 'native' || !this.deps.safety) return false
    try {
      return (await this.deps.safety.level(chainId, address)) === 'BLOCKED'
    } catch {
      return false
    }
  }

  private skeleton(input: LimitInput, inView: TokenView | null, outView: TokenView | null, problems: string[]): LimitQuote {
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
      minOutRaw: '0',
      targetRate: null,
      marketRate: null,
      distancePct: null,
      durationSeconds: input.durationSeconds,
      platformFeeBips: LIMIT_PLATFORM_FEE_BIPS,
      steps: [],
      ok: false,
      problems,
    }
  }

  async quote(input: LimitInput): Promise<LimitQuote> {
    this.assertEnabled()
    const d = this.deps
    if (!d.enabled) throw new EngineError('not_implemented', 'Limit orders are not enabled in this build.')
    const { chainId } = input
    const [inView, outView] = await Promise.all([d.tokens.get(chainId, input.tokenIn), d.tokens.get(chainId, input.tokenOut)])
    const manager = this.manager(chainId)
    if (!isEtn(chainId) || !manager) return this.skeleton(input, inView, outView, ['Limit orders live on Electroneum mainnet.'])
    if (!inView || !outView) return this.skeleton(input, inView, outView, ['Pick two tokens.'])
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const wetn = A.wetn as Hex
    const nativeIn = inView.address === 'native'
    const tokenIn = nativeIn ? wetn : (inView.address as Hex)
    const tokenOut = outView.address === 'native' ? wetn : (outView.address as Hex)
    const problems: string[] = []
    const amountIn = amountOrProblem(input.amountIn, inView.decimals, problems)
    const minOut = amountOrProblem(input.minOut, outView.decimals, problems)
    if (same(tokenIn, tokenOut)) problems.push('Pick two different tokens.')
    if (amountIn <= 0n) problems.push('Enter an amount above zero.')
    if (minOut <= 0n) problems.push('Enter the least you will accept.')
    if (input.durationSeconds < 60) problems.push('An order must stay open for at least a minute.')
    if (account.kind === 'watch') problems.push('Watch-only — import a key or pair a device to place orders.')
    const status = await d.vault.status()
    if (!status.backupComplete && status.seeds.length > 0 && account.kind === 'hd') problems.push('Back up your recovery phrase before you place orders.')
    // The same refusal the swap path makes. A limit order is a swap with a
    // delay, and leaving this out would be a second door into the same trade.
    for (const side of [inView, outView]) {
      if (await this.isBlocked(input.chainId, side.address)) problems.push(`${side.symbol} is marked unsafe by ElectroSwap. BoltVault will not trade it.`)
    }

    const read = readerFor(d.chains, chainId)
    const nativeBalance = BigInt(String((await d.chains.rpc(chainId, 'eth_getBalance', [owner, 'latest']).catch(() => '0x0')) ?? '0x0'))
    const state = await read([
      { address: tokenIn, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] },
      { address: tokenIn, abi: ERC20_ABI, functionName: 'allowance', args: [owner, A.permit2 as Hex] },
      { address: A.permit2 as Hex, abi: PERMIT2_ABI, functionName: 'allowance', args: [owner, tokenIn, manager] },
    ])
    const wetnBalance = state[0]?.ok && typeof state[0].value === 'bigint' ? state[0].value : 0n
    const balanceIn = nativeIn ? nativeBalance + wetnBalance : wetnBalance
    const erc20Allowance = state[1]?.ok && typeof state[1].value === 'bigint' ? state[1].value : 0n
    const p2 = state[2]?.ok && Array.isArray(state[2].value) ? (state[2].value as [bigint, number, number]) : null
    const nowS = Math.floor(d.platform.now() / 1000)
    const base: LimitQuote = { ...this.skeleton(input, inView, outView, problems), amountInRaw: amountIn.toString(), balanceInRaw: balanceIn.toString(), minOutRaw: minOut.toString() }
    if (problems.length > 0) return base

    const market = await bestRoute(tokenIn, tokenOut, amountIn, quoteAddresses(chainId), read).catch(() => null)
    const marketRate = market ? rateOf(amountIn, market.best.amountOut, inView.decimals, outView.decimals) : null
    const targetRate = rateOf(amountIn, minOut, inView.decimals, outView.decimals)
    const distancePct = marketRate && targetRate ? (targetRate / marketRate - 1) * 100 : null
    const steps: SwapStep[] = []
    // ETN in: the manager trades ERC-20s, so the native side is wrapped first (the order unwraps on fill when ETN is the output).
    if (nativeIn && wetnBalance < amountIn) steps.push('wrap')
    if (erc20Allowance < amountIn) steps.push('approve')
    if (!p2 || !permitCovers({ amount: p2[0], expiration: Number(p2[1]), nonce: Number(p2[2]) }, amountIn, nowS)) steps.push('permit')
    steps.push('submit')
    if (amountIn > balanceIn) problems.push(`Not enough ${inView.symbol}.`)
    const gasPrice = BigInt(String((await d.chains.rpc(chainId, 'eth_gasPrice', []).catch(() => '0x3b9aca00')) ?? '0x3b9aca00'))
    const feeWei = 250_000n * gasPrice
    if ((nativeIn && steps.includes('wrap') ? amountIn - wetnBalance : 0n) + feeWei > nativeBalance) problems.push('Not enough ETN for the network fee.')
    return { ...base, targetRate, marketRate, distancePct, steps, ok: problems.length === 0, problems }
  }

  async place(input: LimitInput): Promise<{ flowId: string; requestId: string | null }> {
    this.assertEnabled()
    const d = this.deps
    if (!d.enabled) throw new EngineError('not_implemented', 'Limit orders are not enabled in this build.')
    const { chainId } = input
    const manager = this.manager(chainId)
    if (!isEtn(chainId) || !manager) throw new EngineError('invalid_argument', 'Limit orders live on Electroneum mainnet.')
    const q = await this.quote(input)
    if (!q.ok) throw new EngineError('invalid_argument', q.problems[0] ?? 'cannot place this order')
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const wetn = A.wetn as Hex
    const permit2 = A.permit2 as Hex
    const nativeIn = input.tokenIn === 'native'
    const tokenIn = nativeIn ? wetn : (input.tokenIn as Hex)
    const unwrapOutput = input.tokenOut === 'native'
    const tokenOut = unwrapOutput ? wetn : (input.tokenOut as Hex)
    const amountIn = BigInt(q.amountInRaw)
    const minOut = BigInt(q.minOutRaw)
    const settings = await d.settings.get()
    const tag = d.platform.now().toString(36)
    const steps: FlowStepRun[] = []
    let permit: { token: Hex; amount: bigint; expiration: number; nonce: number; spender: Hex; sigDeadline: bigint; signature: Hex } | null = null

    if (q.steps.includes('wrap')) {
      steps.push({
        step: 'wrap',
        waitReceipt: true,
        run: async () => {
          // Wrap only the shortfall: WETN already in the wallet counts.
          const [r] = await readMany(d.chains, chainId, [{ address: wetn, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] }])
          const held = r?.ok && typeof r.value === 'bigint' ? r.value : 0n
          const shortfall = amountIn > held ? amountIn - held : 0n
          return d.provider.runInternal({ kind: 'send_transaction', origin: 'internal:limit:wrap', chainId, accountId: input.accountId, tx: { from: owner, to: wetn, value: hex(shortfall), data: encodeFunctionData({ abi: WETH, functionName: 'deposit' }) }, clientRequestId: `limit:${tag}:wrap` })
        },
      })
    }
    if (q.steps.includes('approve')) {
      steps.push({
        step: 'approve',
        waitReceipt: true,
        run: () => d.provider.runInternal({ kind: 'send_transaction', origin: 'internal:limit:approve', chainId, accountId: input.accountId, tx: { from: owner, to: tokenIn, value: '0x0', data: encodeApprovePermit2(permit2, settings.exactApprovals ? amountIn : maxUint256).data }, clientRequestId: `limit:${tag}:approve` }),
      })
    }
    if (q.steps.includes('permit')) {
      steps.push({
        step: 'permit',
        run: async () => {
          const [r] = await readMany(d.chains, chainId, [{ address: permit2, abi: PERMIT2_ABI, functionName: 'allowance', args: [owner, tokenIn, manager] }])
          const nonce = r?.ok && Array.isArray(r.value) ? Number((r.value as [bigint, number, number])[2]) : 0
          const nowS = Math.floor(d.platform.now() / 1000)
          const typed = permitSingleTypedData({ chainId, permit2, token: tokenIn, amount: amountIn, nonce, spender: manager, nowSeconds: nowS })
          const { requestId, result } = await d.provider.runInternal({ kind: 'sign_typed_data', origin: 'internal:limit:permit', chainId, accountId: input.accountId, from: owner, typedData: typed, version: 'v4', clientRequestId: `limit:${tag}:permit` })
          const settled = result.then((sig) => {
            permit = { token: tokenIn, amount: amountIn, expiration: nowS + PERMIT_EXPIRY_S, nonce, spender: manager, sigDeadline: BigInt(nowS + PERMIT_EXPIRY_S), signature: sig as Hex }
            return sig
          })
          settled.catch(() => undefined)
          return { requestId, result: settled }
        },
      })
    }
    steps.push({
      step: 'submit',
      waitReceipt: true,
      run: () => {
        const order = { tokenIn, tokenOut, unwrapOutput, amountInExact: amountIn, amountOutMin: minOut, recipient: owner, durationSeconds: BigInt(input.durationSeconds) }
        const data = permit ? encodeSubmitOrderWithPermit({ ...order, permit }) : encodeSubmitOrder(order)
        return d.provider.runInternal({ kind: 'send_transaction', origin: 'internal:limit', chainId, accountId: input.accountId, tx: { from: owner, to: manager, value: '0x0', data }, clientRequestId: `limit:${tag}:submit` })
      },
    })
    const flow = await d.flows.start({ kind: 'limit', accountId: input.accountId, chainId, quote: null, steps })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  async cancel(input: { accountId: string; chainId: number; orderId: string }): Promise<{ flowId: string; requestId: string | null }> {
    const d = this.deps
    if (!d.enabled) throw new EngineError('not_implemented', 'Limit orders are not enabled in this build.')
    const manager = this.manager(input.chainId)
    if (!manager) throw new EngineError('invalid_argument', 'Limit orders live on Electroneum mainnet.')
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const flow = await d.flows.start({
      kind: 'limit_cancel',
      accountId: input.accountId,
      chainId: input.chainId,
      quote: null,
      steps: [{ step: 'cancel', waitReceipt: true, run: () => d.provider.runInternal({ kind: 'send_transaction', origin: 'internal:limit:cancel', chainId: input.chainId, accountId: input.accountId, tx: { from: owner, to: manager, value: '0x0', data: encodeCloseOrder(BigInt(input.orderId)) }, clientRequestId: `limit:cancel:${input.orderId}:${d.platform.now()}` }) }],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  async list(input: { accountId: string; chainId: number }): Promise<LimitOrderView[]> {
    const d = this.deps
    if (!d.enabled) return []
    const manager = this.manager(input.chainId)
    if (!manager) return []
    const account = (await d.vault.accounts()).find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const orders = await openOrders(manager, account.address as Hex, readerFor(d.chains, input.chainId), Math.floor(d.platform.now() / 1000))
    const universe = await d.tokens.universe(input.chainId)
    const meta = (address: Hex): { symbol: string; decimals: number } => {
      const t = universe.find((x) => x.address.toLowerCase() === address.toLowerCase())
      return t ? { symbol: t.symbol, decimals: t.decimals } : { symbol: `${address.slice(0, 6)}…${address.slice(-4)}`, decimals: 18 }
    }
    const rows = orders.map((o): LimitOrderView => {
      const i = meta(o.tokenIn)
      const out = meta(o.tokenOut)
      return {
        chainId: input.chainId,
        orderId: o.orderId.toString(),
        tokenIn: o.tokenIn,
        tokenOut: o.tokenOut,
        symbolIn: i.symbol,
        symbolOut: o.unwrapOutput ? 'ETN' : out.symbol,
        decimalsIn: i.decimals,
        decimalsOut: out.decimals,
        amountInExact: o.amountInExact.toString(),
        amountOutMin: o.amountOutMin.toString(),
        amountInRemaining: o.amountInRemaining.toString(),
        amountOutFilled: o.amountOutFilled.toString(),
        unwrapOutput: o.unwrapOutput,
        createdAt: o.createdAt,
        expiresAt: o.expiresAt,
        status: o.status,
      }
    })
    d.bus.emit({ type: 'limit.changed', accountId: input.accountId, chainId: input.chainId, orders: rows })
    return rows
  }
}

const InputSchema = z.object({
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  amountIn: z.string().max(80),
  minOut: z.string().max(80),
  durationSeconds: z.number().int().positive().max(365 * 86_400),
})
const AccountChain = z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() })

export function limitNamespace(limit: LimitService): NamespaceSpec {
  return {
    quote: { input: InputSchema, handler: (arg) => limit.quote(arg as LimitInput) },
    place: { input: InputSchema, handler: (arg) => limit.place(arg as LimitInput) },
    cancel: { input: AccountChain.extend({ orderId: z.string().regex(/^\d+$/) }), handler: (arg) => limit.cancel(arg as { accountId: string; chainId: number; orderId: string }) },
    list: { input: AccountChain, handler: (arg) => limit.list(arg as { accountId: string; chainId: number }) },
  }
}
