/**
 * Swap (master plan §8.6): ElectroSwap's routing service prices the trade and
 * the mini-router quotes on chain whenever it cannot, the wallet fee comes from
 * the holder tier (§8.18), and execution is a flow of internal
 * approvals — approve Permit2 once per token, a per-swap exact PermitSingle
 * signature, then the Universal Router call with PAY_PORTION to the pinned
 * sink. The tier is re-read at sign time; a moved tier re-quotes, and the
 * firewall's FEE_SINK/FEE_TIER rules check the bytes we hand it (T10).
 */
import { ELECTRONEUM_ADDRESSES, ELECTRONEUM_TESTNET_CHAIN_ID } from '@boltvault/chains'
import {
  DEFAULT_SLIPPAGE_BIPS,
  ERC20_ABI,
  PERMIT2_ABI,
  PERMIT_EXPIRY_S,
  bestDirect,
  bestRoute,
  quoteOne,
  bestRouteExactOut,
  detectTax,
  encodeApprovePermit2,
  encodeSwap,
  encodeSwapExactOut,
  feeAmount,
  deliveredMinimumOut,
  grossOutForExactOut,
  maximumIn as maximumInFor,
  netAfterFee,
  permitCovers,
  permitSingleTypedData,
  protocolRuns,
  priceImpactPct,
  taxOf,
  taxSlippageBips,
  type Candidate,
  type Hop,
  type PermitInput,
  type QuoteAddresses,
  type ReadCall as EsReadCall,
  type Reader as EsReader,
  type ReadResult as EsReadResult,
  type RouteQuote,
  type TaxProbe,
} from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { formatUnits, maxUint256, parseUnits, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import type { Quoter, QuoterInput } from '../quoterApi'
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

/** Which side of the trade the user fixed. §8.6: exact-out is a power toggle, default off. */
export type TradeType = 'exactIn' | 'exactOut'

export interface SwapInput {
  readonly accountId: string
  readonly chainId: number
  /** 'native' or a token address. */
  readonly tokenIn: string
  readonly tokenOut: string
  /** Human amount, decimal string. The amount the user typed when `tradeType` is 'exactIn'. */
  readonly amountIn?: string
  /** Human amount, decimal string. The amount the user typed when `tradeType` is 'exactOut'. */
  readonly amountOut?: string
  readonly tradeType?: TradeType
  readonly slippageBips?: number
}

/**
 * A quote plus the two facts that only exist once a trade can be priced from
 * either end.
 *
 * `SwapQuoteSchema` lives in `schema.ts`, which is owned elsewhere while this
 * lands, so the extra fields ride on the same object rather than in it. Nothing
 * validates a handler's *output*, so they survive the wire; the two lines that
 * would move them into the schema proper are in this change's notes.
 *
 * How to read the inherited fields in the exact-out direction:
 *  - `amountInRaw`    what the swap costs at the quoted price (an estimate).
 *  - `maximumInRaw`   what it may cost at worst. This is the guaranteed figure.
 *  - `amountOutRaw`   what the router buys, before the wallet fee (grossed up).
 *  - `receiveRaw`     exactly what the user typed.
 *  - `minimumOutRaw`  the same number: in this direction the floor IS the ask.
 */
export interface SwapQuoteView extends SwapQuote {
  readonly tradeType: TradeType
  /** The most an exact-output swap may spend. `'0'` on an exact-in quote, where the input is already fixed. */
  readonly maximumInRaw: string
}

const ZERO = '0x0000000000000000000000000000000000000000' as Hex
/** The UR deadline for a swap the user is looking at (§8.6: stale after 8 s, but the chain needs headroom). */
const DEADLINE_S = 20 * 60
/** Combined slippage at which `minimumOut` reaches zero, i.e. no floor at all. */
const BIPS_CEILING = 10_000
/** Hard clamp, so a path that ever skips the refusal still leaves a non-zero floor. */
const MAX_EFFECTIVE_SLIPPAGE_BPS = 9_900
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

  private skeleton(input: SwapInput, inView: TokenView | null, outView: TokenView | null, problems: string[]): SwapQuoteView {
    return {
      tradeType: input.tradeType ?? 'exactIn',
      maximumInRaw: '0',
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
   * worst it can do to a quote is cost it one bounded round trip before the
   * wallet falls back to quoting for itself. It is never the reason a swap is
   * refused.
   */
  private async route(input: QuoterInput, addresses: QuoteAddresses, read: EsReader): Promise<{ quote: RouteQuote; source: 'api' | 'onchain' } | null> {
    const quoter = this.deps.quoter
    if (quoter) {
      const served = await quoter.route(input)
      if (served.kind === 'route') {
        /*
          The service's answer, unless this pair has a pool it cannot see.

          It prices from a pool list rather than from the chain, so a pool
          missing from that list is missing at every size — and on 2026-09-11 the
          list held eleven V3 pools and named only the 0.3% WETN/BOLT pool, while
          the 0.05% pool beside it paid 2.64% more on a 3 ETN swap. That is an
          order of magnitude more than the wallet's own fee, on the pair most
          people trade.

          So the five direct pools are priced too — one call, not the twenty-four
          of a full search, because the multi-hop routing is the part the service
          is genuinely better at and this does not second-guess it. It is a check
          against a blind spot, not a second opinion.
        */
        const direct = await bestDirect(input.tokenIn, input.tokenOut, input.amountIn, addresses, read)
        if (direct && direct.amountOut > served.quote.amountOut) return { quote: direct, source: 'onchain' }
        return { quote: served.quote, source: 'api' }
      }
    }
    /*
      Only now, and only because the service could not answer.

      The mini-router's sixteen candidates are sixteen simulated quotes in one
      `eth_call`, re-run on a 250 ms debounce while somebody types an amount.
      That is the wallet's largest single draw on an RPC endpoint, and spending
      it to check an answer we already have buys a comparison rather than a
      price. The service walks the whole pool graph and is the better router;
      the mini-router is what stands when it is unreachable.
    */
    const onChain = await bestRoute(input.tokenIn, input.tokenOut, input.amountIn, addresses, read)
    return onChain ? { quote: onChain.best, source: 'onchain' } : null
  }

  async quote(input: SwapInput): Promise<SwapQuoteView> {
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
    const exactOut = input.tradeType === 'exactOut'
    /*
      Only the side the user typed is parsed here; the other is the answer.

      An exact-in quote knows its input and asks what it gets; an exact-out
      quote knows its output and asks what it costs. `typed` is whichever one
      came from the keyboard, and it is the one that has to be above zero
      before anything is worth quoting.
    */
    let amountIn = 0n
    let wantOut = 0n
    try {
      if (exactOut) wantOut = parseUnits((input.amountOut ?? '').trim() || '0', outView.decimals)
      else amountIn = parseUnits((input.amountIn ?? '').trim() || '0', inView.decimals)
    } catch {
      problems.push('That amount is not a number.')
    }
    const typed = exactOut ? wantOut : amountIn
    if (same(wrappedIn, wrappedOut)) problems.push('Pick two different tokens.')
    if (typed <= 0n) problems.push('Enter an amount above zero.')
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
    const withState: SwapQuoteView = { ...base, amountInRaw: amountIn.toString(), balanceInRaw: balanceIn.toString(), slippageBips, fee: { ...base.fee, bips: tier.sink ? tier.bips : 0, tier: tier.tier, name: tier.name, sink: tier.sink, source: tier.source, nextTierAt: tier.nextTierAt, nextTierBips: tier.nextTierBips } }
    if (problems.length > 0 || typed <= 0n) return withState

    const addresses = quoteAddresses(chainId)
    const sink = tier.sink
    /*
      There is no sink contract any more: the fee goes to an address named in
      `fees.json`, and on mainnet a chain that names none has in-wallet swap
      switched off — that is the whole gate, and it stays shut.

      Testnet is not that. There is no revenue to protect on a chain whose funds
      are valueless, so refusing to swap there protects nothing and breaks the
      one thing testnet is for. It swaps fee-free instead: `bips` of zero means
      no `PAY_PORTION` command, which is a shape the firewall already knows —
      `feeSinkRules` requires the absence of a portion at a zero tier exactly as
      firmly as it requires a correct one otherwise.
    */
    const bips = sink ? tier.bips : 0
    if (!sink && chainId !== ELECTRONEUM_TESTNET_CHAIN_ID) problems.push('In-wallet swaps are off on this network — no fee address is set for it in this build.')
    /*
      An exact-output order is grossed up before it is priced.

      `PAY_PORTION` takes its share of whatever the router is holding, so buying
      exactly the amount the user asked for would pay the wallet fee out of that
      amount and hand them less than they typed. Asking the pools for a little
      more instead means the fee comes off the top and the exact amount survives
      it — the fee is paid in extra input, and the screen says so.
    */
    const grossWanted = exactOut ? grossOutForExactOut(wantOut, bips) : 0n
    const taxes = [
      same(wrappedIn, wetn) ? Promise.resolve<TaxProbe>(null) : detectTax(A.feeOnTransferDetector as Hex | null, wrappedIn, wetn, read),
      same(wrappedOut, wetn) ? Promise.resolve<TaxProbe>(null) : detectTax(A.feeOnTransferDetector as Hex | null, wrappedOut, wetn, read),
    ] as const

    let candidate: Candidate | null = null
    let source: 'api' | 'onchain' = 'onchain'
    let gasEstimate = 0n
    let amountOut = 0n
    let probeIn = 0n
    let probe: RouteQuote | null = null
    let taxIn: TaxProbe = null
    let taxOut: TaxProbe = null

    if (exactOut) {
      /*
        The routing service is exact-in only — its request carries an input
        amount and nothing else — so an exact-output trade is priced by the
        mini-router alone. That is a narrower search, not a worse guarantee: the
        number it produces is the *input*, and the input is bounded on chain by
        `amountInMaximum`, which no router can talk the wallet past.
      */
      const [outRoute, tIn, tOut] = await Promise.all([bestRouteExactOut(wrappedIn, wrappedOut, grossWanted, addresses, read), ...taxes])
      taxIn = tIn
      taxOut = tOut
      if (outRoute) {
        candidate = outRoute.best.candidate
        gasEstimate = outRoute.best.gasEstimate
        amountIn = outRoute.best.amountIn
        amountOut = grossWanted
      }
      // The probe divides into the input, and here the input is the answer — so it follows the quote rather than riding with it.
      probeIn = amountIn / 1000n
    } else {
      const [routed, tIn, tOut] = await Promise.all([
        this.route({ chainId, tokenIn: wrappedIn, tokenOut: wrappedOut, amountIn, recipient: owner }, addresses, read),
        ...taxes,
      ])
      probeIn = amountIn / 1000n
      taxIn = tIn
      taxOut = tOut
      if (routed) {
        candidate = routed.quote.candidate
        gasEstimate = routed.quote.gasEstimate
        amountOut = routed.quote.amountOut
        source = routed.source
      }
    }
    if (!candidate) {
      problems.push('No route on ElectroSwap for this pair.')
      return { ...withState, problems }
    }
    /*
      The spot reference is the chosen route at a thousandth of the size.

      It used to be a second `bestRoute` — sixteen simulated swaps in their own
      `eth_call`, run on every keystroke, to produce one number to divide into
      another. Quoting the route that actually won is a single simulated swap,
      and it is the more honest comparison besides: price impact means "what did
      going this big through *this* path cost", not "what might some other path
      have charged for a dust trade". When the routing service answered, this is
      now the only quoting call the chain is asked for at all.
    */
    probe = probeIn > 0n ? await quoteOne(candidate, probeIn, addresses, read) : null
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
    /*
      A token that charges a fee on transfer cannot honour an exact output, so
      the wallet refuses rather than promising one.

      Exact-in folds a transfer tax into slippage and reports a smaller "you
      receive": the floor moves, the promise still holds. Exact-out has no such
      room. The number in the delivering command is measured on the router's
      balance *before* the transfer out, so the tax is taken after the check
      passes and the user is handed less than the exact amount they typed —
      which is the one thing this mode exists to guarantee. Quoting it anyway
      would be quoting a trade that cannot happen.
    */
    if (exactOut && taxBips > 0) {
      const taxed = (taxOf(taxOut)?.buyFeeBps ?? 0) > 0 ? outView.symbol : inView.symbol
      problems.push(`${taxed} charges a fee every time it moves, so BoltVault cannot promise you an exact amount of it. Set the amount you pay instead.`)
    }
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
    /*
      The two guarantees, and which direction each one guards.

      Exact in: the output floats, so the promise is a floor under it —
      `deliveredMinimumOut`, the very number the encoder writes into the
      delivering command, after the fee and the token's own transfer tax.

      Exact out: the output is the number the user typed, so there is nothing to
      floor; the promise is a ceiling over the *input* instead. `maximumIn` is
      what the router enforces as `amountInMaximum`, and it is the figure the
      screen and the sheet have to show, because it is the one the user is
      committing to.
    */
    const receive = exactOut ? wantOut : (netAfterFee(amountOut, bips) * BigInt(10_000 - Math.min(taxBips, 9_999))) / 10_000n
    const minOut = exactOut ? wantOut : deliveredMinimumOut(amountOut, bips, effectiveSlippage)
    const maxIn = exactOut ? maximumInFor(amountIn, effectiveSlippage) : 0n
    const spot = probe ? rateOf(probeIn, probe.amountOut, inView.decimals, outView.decimals) : null
    const impact = priceImpactPct(amountIn, amountOut, spot, inView.decimals, outView.decimals)

    /*
      What the allowance and the balance have to cover is what the swap CAN
      spend, not what it is expected to. In the exact-in direction those are the
      same number; in the exact-out direction the estimate is smaller than the
      ceiling, and sizing the Permit2 permit off the estimate would leave the
      router unable to pull the last few percent — a revert, after three
      signatures, for a swap the wallet had said was fine.
    */
    const spendCeiling = exactOut ? maxIn : amountIn
    const steps: SwapStep[] = []
    if (!nativeIn) {
      if (erc20Allowance < spendCeiling) steps.push('approve')
      if (!p2 || !permitCovers({ amount: p2[0], expiration: Number(p2[1]), nonce: Number(p2[2]) }, spendCeiling, nowS)) steps.push('permit')
    }
    steps.push('swap')
    /*
      A mixed route costs more than the pools it touches.

      Each contiguous protocol run is its own Universal Router command, and the
      output of one is moved into the next through the router's own custody —
      an extra ERC-20 transfer per boundary that the quoter's estimate, which
      prices the pools, does not see. The transaction carries no explicit gas
      limit, so an underestimate here is not a revert; it is the "not enough ETN
      for the network fee" check passing a swap that then cannot pay for itself.
    */
    const boundaries = BigInt(protocolRuns(candidate.route.hops).length - 1)
    const gas = gasEstimate + 90_000n + boundaries * 40_000n + (steps.includes('approve') ? 55_000n : 0n) + (steps.includes('permit') ? 35_000n : 0n)
    const feeWei = gas * gasPrice
    if (spendCeiling > balanceIn) problems.push(`Not enough ${inView.symbol}.`)
    if ((nativeIn ? spendCeiling : 0n) + feeWei > nativeBalance) problems.push('Not enough ETN for the network fee.')

    return {
      ...withState,
      amountInRaw: amountIn.toString(),
      maximumInRaw: maxIn.toString(),
      amountOutRaw: amountOut.toString(),
      receiveRaw: receive.toString(),
      minimumOutRaw: minOut.toString(),
      rate: rateOf(amountIn, amountOut, inView.decimals, outView.decimals),
      priceImpactPct: impact,
      taxBips,
      taxUnknown,
      fee: { ...withState.fee, amountRaw: feeAmount(amountOut, bips).toString() },
      route: { label: candidate.label, source, hops: candidate.route.hops.map((h) => (h.kind === 'v3' ? { kind: 'v3' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut, fee: h.fee } : { kind: 'v2' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut })) },
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
    const exactOut = first.tradeType === 'exactOut'
    const amountIn = BigInt(first.amountInRaw)
    /*
      The allowance and the permit are sized to the ceiling, not the estimate.

      In the exact-out direction the router decides how much it actually needs
      when it touches the pools, and it may need anything up to `maximumIn`. A
      permit for the quoted amount would be a permit for slightly too little,
      and the swap would revert at the last step after the user had already
      signed twice.
    */
    const spendCeiling = exactOut ? BigInt(first.maximumInRaw) : amountIn
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
            tx: { from: owner, to: tokenIn, value: '0x0', data: encodeApprovePermit2(permit2, settings.exactApprovals ? spendCeiling : maxUint256).data },
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
          const typed = permitSingleTypedData({ chainId, permit2, token: tokenIn, amount: spendCeiling, nonce, spender: ur, nowSeconds: nowS })
          const { requestId, result } = await d.provider.runInternal({ kind: 'sign_typed_data', origin: 'internal:swap:permit', chainId, accountId: input.accountId, from: owner, typedData: typed, version: 'v4', clientRequestId: `swap:${tag}:permit` })
          const settled = result.then((sig) => {
            permit = { token: tokenIn, amount: spendCeiling, expiration: nowS + PERMIT_EXPIRY_S, nonce, spender: ur, sigDeadline: BigInt(nowS + PERMIT_EXPIRY_S), signature: sig as Hex }
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
          /*
            And "worse" means the opposite thing in the two directions. An
            exact-in swap gets worse when the output falls; an exact-out swap
            gets worse when the input rises, because the output is fixed and
            the cost is what moves. Comparing outputs in the exact-out
            direction would compare two identical numbers and never fire.
          */
          const before = exactOut ? BigInt(first.amountInRaw) : BigInt(first.amountOutRaw)
          const now = exactOut ? BigInt(quote.amountInRaw) : BigInt(quote.amountOutRaw)
          const worse = exactOut ? now > before : now < before
          if (before > 0n && worse) {
            const movedBips = (((exactOut ? now - before : before - now) * 10_000n) / before)
            if (movedBips > BigInt(first.slippageBips))
              throw new EngineError('invalid_argument', `The price moved by ${(Number(movedBips) / 100).toFixed(2)}% while this swap was being set up, which is more than your slippage allows. Start it again to see the new price.`)
          }
          d.flows.setQuote(flowId, quote)
        }
        const bips = quote.fee.bips
        const sink = (quote.fee.sink ?? null) as Hex | null
        if (bips > 0 && !sink) throw new EngineError('invalid_argument', 'In-wallet swaps are off on this network — no fee address is set for it in this build.')
        const nowS = Math.floor(d.platform.now() / 1000)
        const shared = {
          route: { hops: quote.route.hops.map((h) => encodableHop(h)) },
          nativeIn,
          nativeOut,
          wrappedNative: wetn,
          recipient: owner,
          fee: bips > 0 && sink ? { sink, bips } : null,
          ...(permit ? { permit } : {}),
          deadline: BigInt(nowS + DEADLINE_S),
          universalRouter: ur,
        }
        /*
          The encoded ceiling can never exceed what was actually authorised.

          A re-quote inside the user's slippage can raise the cost slightly, and
          its own ceiling with it — but the Permit2 signature and the ERC-20
          approval were given for the ceiling of the FIRST quote, minutes ago.
          Writing the larger number into `amountInMaximum` would promise the
          router money Permit2 will not release: the same revert, but discovered
          in the pool instead of in the wallet, and with the user believing they
          had agreed to the larger figure.
        */
        const ceiling = BigInt(quote.maximumInRaw)
        const enc = exactOut
          ? encodeSwapExactOut({ ...shared, amountOut: BigInt(quote.receiveRaw), maximumIn: ceiling < spendCeiling ? ceiling : spendCeiling })
          : encodeSwap({ ...shared, amountIn, quotedOut: BigInt(quote.amountOutRaw), slippageBips: quote.slippageBips + quote.taxBips })
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

/*
  One schema for both directions. `amountIn` stays optional rather than
  required-but-ignored: an exact-out caller has no input amount to send, and a
  field that must be present and must not be read is a field that will one day
  be read.
*/
const InputSchema = z
  .object({
    accountId: AccountIdSchema,
    chainId: z.number().int().positive(),
    tokenIn: z.string(),
    tokenOut: z.string(),
    amountIn: z.string().max(80).optional(),
    amountOut: z.string().max(80).optional(),
    tradeType: z.enum(['exactIn', 'exactOut']).optional(),
    slippageBips: z.number().int().min(1).max(5_000).optional(),
  })
  .refine((v) => (v.tradeType === 'exactOut' ? v.amountOut !== undefined : v.amountIn !== undefined), {
    message: 'Say which amount you fixed: amountIn for an exact-in swap, amountOut for an exact-out one.',
  })

export function swapNamespace(swap: SwapService): NamespaceSpec {
  return {
    quote: { input: InputSchema, handler: (arg) => swap.quote(arg as SwapInput) },
    execute: { input: InputSchema, handler: (arg) => swap.execute(arg as SwapInput) },
    flow: { input: z.object({ flowId: z.string() }), handler: async (arg) => swap.flow((arg as { flowId: string }).flowId) },
    flows: { input: z.object({ accountId: AccountIdSchema.optional() }).optional(), handler: async (arg) => swap.flows((arg as { accountId?: string } | undefined)?.accountId) },
  }
}
