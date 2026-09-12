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
  bestRoute,
  quoteOne,
  bestRouteExactOut,
  detectTax,
  isTaxUnknown,
  sellsAreRefused,
  custodyIsUnsafe,
  encodeApprovePermit2,
  encodeSwap,
  encodeSwapExactOut,
  feeAmount,
  deliveredMinimumOut,
  routerMinimumOut,
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
import { formatUnits, maxUint256, parseUnits, type Abi, type Hex } from 'viem'
import { z } from 'zod'
import type {
  ClientFailureInput,
  ClientFailures,
  FailureKind,
  FailureStage,
  FailureTaxProbe,
} from '../clientFailureApi'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { multicallAddress, readMany } from '../multicall'
import type { Quoter, QuoterInput } from '../quoterApi'
import {
  AccountIdSchema,
  type ActivityEntry,
  type SwapFlow,
  type SwapHop,
  type SwapQuote,
  type SwapStep,
  type TokenView,
} from '../schema'
import type { SettingsStore } from '../settingsStore'
import type { ChainsService } from './chains'
import { FlowReceiptError, type FlowStepFailure, type FlowStepRun, type FlowStore } from './flows'
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
  /**
   * Where a swap that did not work gets reported (§3.7, `clientFailureApi`).
   *
   * Absent when the build ships no wallet key — the route answers 401 without
   * one — and in tests. Every use of it is fire-and-forget: nothing on the
   * user's path may await it, and a swap that already failed must not be made
   * slower or more likely to fail by being reported.
   */
  readonly failures?: ClientFailures
}

/** ElectroSwap's project safety levels, as the market data reports them. */
export type TokenSafetyLevel = 'VERIFIED' | 'MEDIUM_WARNING' | 'STRONG_WARNING' | 'BLOCKED'

/** Which side of the trade the user fixed. Typing in the receive well is exact-out. */
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
  /** Only on a quote that actually got a price; a skeleton has nothing to explain. */
  readonly diagnostics?: SwapDiagnostics
}

/**
 * Everything a failure report needs and no screen does.
 *
 * It rides on `SwapQuoteView` for the same reason `tradeType` does, and it is
 * deliberately not in `SwapQuoteSchema`: none of it is drawn, and the account
 * state in it is the most personal thing the wallet ever sends anywhere. The
 * quote is the only place these facts exist at once — by the time a swap fails,
 * three steps later, the balances have been read and forgotten and the routing
 * service's answer is long gone.
 */
export interface SwapDiagnostics {
  readonly provenance: QuoteProvenance
  readonly account: SwapAccountState
  /** Both probes as measured, plus whether this chain has a detector to ask at all. */
  readonly tax: { readonly in: TaxProbe; readonly out: TaxProbe; readonly detector: boolean }
}

/** What the routing service said about the quote it served beyond the price, or why it was not used. */
export interface QuoteProvenance {
  /** The service's own `quoteId`: the join back to its log for this exact quote. */
  readonly id: string | null
  readonly cached: boolean | null
  readonly blockNumber: string | null
  readonly fallbackReason: string | null
}

/** What the account held when the quote was priced. Most swaps fail on one of these rather than on a router bug. */
export interface SwapAccountState {
  readonly account: string
  readonly balanceIn: string
  readonly nativeBalance: string
  /** Null on a native-input swap, which needs no ERC-20 allowance and holds no Permit2 permit. */
  readonly erc20Allowance: string | null
  readonly permit2Amount: string | null
  readonly permit2Expiration: number | null
}

/**
 * The one Multicall3 function the swap path calls directly.
 *
 * Every other read here is a contract call that Multicall3 wraps; the native
 * balance is the exception, and this is how it joins the same aggregate rather
 * than costing a round trip of its own.
 */
const MULTICALL3_ABI = [
  {
    type: 'function',
    name: 'getEthBalance',
    stateMutability: 'view',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ name: 'balance', type: 'uint256' }],
  },
] as const satisfies Abi

const ZERO = '0x0000000000000000000000000000000000000000' as Hex
/** The UR deadline for a swap the user is looking at (§8.6: stale after 8 s, but the chain needs headroom). */
const DEADLINE_S = 20 * 60
/** Combined slippage at which `minimumOut` reaches zero, i.e. no floor at all. */
const BIPS_CEILING = 10_000
/** Hard clamp, so a path that ever skips the refusal still leaves a non-zero floor. */
/** How long a gas price stays good enough for a fee reserve. */
const GAS_PRICE_CACHE_MS = 15_000
/**
 * Transfer tax is a property of the token, not the amount. Re-probing it on
 * every keystroke was a round trip in front of a number the routing service
 * had already returned.
 */
const TAX_CACHE_MS = 60_000
/**
 * Spot rate for a named route, used only for the impact figure. The receive
 * amount does not depend on it; caching it means a second quote of the same
 * path does not wait on another `eth_call` after the routing service answers.
 */
const SPOT_CACHE_MS = 15_000
const MAX_EFFECTIVE_SLIPPAGE_BPS = 9_900
const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const isEtn = (chainId: number): chainId is 52014 | 5201420 =>
  chainId === 52014 || chainId === 5201420
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** The engine's multicall reader in the router's shape. */
export function readerFor(
  chains: ChainsService,
  chainId: number,
): (calls: readonly EsReadCall[]) => Promise<EsReadResult[]> {
  return (calls) => readMany(chains, chainId, calls)
}

export function quoteAddresses(chainId: 52014 | 5201420): QuoteAddresses {
  const a = ELECTRONEUM_ADDRESSES[chainId]
  return {
    quoterV2: a.quoterV2 as Hex,
    mixedRouteQuoter: a.mixedRouteQuoter as Hex | null,
    v2Router02: a.v2Router02 as Hex,
    bases: [a.wetn, a.usdc, a.usdt, ...(a.bolt ? [a.bolt] : [])].map((x) => x as Hex),
  }
}

export function rateOf(
  amountIn: bigint,
  amountOut: bigint,
  decimalsIn: number,
  decimalsOut: number,
): number | null {
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
/**
 * The transfer-tax probes for a pair — one per side, WETN excepted.
 *
 * They were built inline where the route was awaited. The route now starts a
 * wave earlier and carries these with it, so the pair is named once here and
 * used from both the exact-in and exact-out paths rather than written twice.
 */
/**
 * MAX leaves room for the fee to move.
 *
 * Subtracting the measured fee exactly is the fee at the gas price of the
 * moment the quote asked — so a MAX swap that sat on screen while the price
 * ticked up could fail for being one wei short of its own gas. A fifth over is
 * the same margin Send uses. Owner: "clicking MAX should account for the
 * network fee of ETN plus a 20% buffer."
 */
function maxSpendableAfterFee(balance: bigint, feeWei: bigint): bigint {
  const feeReserve = (feeWei * 120n) / 100n
  return balance > feeReserve ? balance - feeReserve : 0n
}

function taxKey(chainId: number, epoch: number, token: Hex): string {
  return `${String(chainId)}:${String(epoch)}:${token.toLowerCase()}`
}

function spotKey(chainId: number, epoch: number, candidate: Candidate): string {
  const hops = candidate.route.hops
    .map((h) =>
      h.kind === 'v3' ? `v3:${h.tokenIn}:${h.tokenOut}:${String(h.fee)}` : `v2:${h.tokenIn}:${h.tokenOut}`,
    )
    .join('>')
  return `${String(chainId)}:${String(epoch)}:${hops}`
}

function encodableHop(h: SwapHop): Hop {
  if (h.kind === 'v2') return { kind: 'v2', tokenIn: h.tokenIn as Hex, tokenOut: h.tokenOut as Hex }
  if (h.fee === undefined)
    throw new EngineError(
      'invalid_argument',
      'That route came back without a fee tier. Start the swap again to re-price it.',
    )
  return { kind: 'v3', tokenIn: h.tokenIn as Hex, tokenOut: h.tokenOut as Hex, fee: h.fee }
}

export class SwapService {
  constructor(private readonly deps: SwapDeps) {}

  /**
   * The last gas price read, and when.
   *
   * `eth_gasPrice` cannot join the aggregate — it is not a contract call, and
   * Multicall3's `getBasefee` is the base fee, not the same number — so the way
   * to get it off the keystroke path is not to ask for it every keystroke. It
   * feeds one thing: how much native currency to hold back for the network fee
   * on a native-input swap. That is a reserve, and a reserve computed from a gas
   * price a few seconds old is the same reserve.
   *
   * Keyed by the endpoint as well as the chain, like the holder tier: a price
   * read through an RPC the user has just replaced is the old endpoint's answer.
   */
  private readonly gasPriceCache = new Map<string, { at: number; value: bigint }>()
  private readonly taxCache = new Map<string, { at: number; value: Promise<TaxProbe> }>()
  private readonly spotCache = new Map<string, { at: number; rate: number }>()

  private cachedTax(chainId: number, token: Hex, wetn: Hex, detector: Hex | null, read: EsReader): Promise<TaxProbe> {
    if (same(token, wetn)) return Promise.resolve<TaxProbe>(null)
    const key = taxKey(chainId, this.deps.chains.rpcEpoch(chainId), token)
    const now = this.deps.platform.now()
    const hit = this.taxCache.get(key)
    if (hit && now - hit.at < TAX_CACHE_MS) return hit.value
    const value = detectTax(detector, token, wetn, read)
    this.taxCache.set(key, { at: now, value })
    void value.then((v) => {
      if (v && 'unavailable' in v && v.reason === 'not-answered') this.taxCache.delete(key)
    })
    return value
  }

  private taxPair(
    chainId: number,
    A: (typeof ELECTRONEUM_ADDRESSES)[52014],
    wrappedIn: Hex,
    wrappedOut: Hex,
    wetn: Hex,
    read: EsReader,
  ): readonly [Promise<TaxProbe>, Promise<TaxProbe>] {
    const detector = A.feeOnTransferDetector as Hex | null
    return [
      this.cachedTax(chainId, wrappedIn, wetn, detector, read),
      this.cachedTax(chainId, wrappedOut, wetn, detector, read),
    ] as const
  }

  /**
   * Spot rate of a named route, for price impact only.
   *
   * The first quote of a path still asks the chain once, at a thousandth of
   * the size. The next few seconds reuse that rate: the receive amount comes
   * from the routing service, and waiting on this call was what made a 100 ms
   * quote look like three seconds on the screen.
   */
  private async spotRate(
    chainId: number,
    candidate: Candidate,
    probeIn: bigint,
    addresses: QuoteAddresses,
    read: EsReader,
    decimalsIn: number,
    decimalsOut: number,
  ): Promise<number | null> {
    if (probeIn <= 0n) return null
    const key = spotKey(chainId, this.deps.chains.rpcEpoch(chainId), candidate)
    const now = this.deps.platform.now()
    const hit = this.spotCache.get(key)
    if (hit && now - hit.at < SPOT_CACHE_MS) return hit.rate
    const probe = await quoteOne(candidate, probeIn, addresses, read)
    if (!probe) return null
    const rate = rateOf(probeIn, probe.amountOut, decimalsIn, decimalsOut)
    if (rate !== null) this.spotCache.set(key, { at: now, rate })
    return rate
  }

  private async routeAndSpot(
    input: QuoterInput,
    addresses: QuoteAddresses,
    read: EsReader,
    decimalsIn: number,
    decimalsOut: number,
  ): Promise<{
    routed: { quote: RouteQuote; source: 'api' | 'onchain'; provenance: QuoteProvenance } | null | 'superseded'
    spot: number | null
  }> {
    const routed = await this.route(input, addresses, read)
    if (!routed || routed === 'superseded') return { routed, spot: null }
    const probeIn = input.amountIn / 1000n
    const spot = await this.spotRate(
      input.chainId,
      routed.quote.candidate,
      probeIn,
      addresses,
      read,
      decimalsIn,
      decimalsOut,
    )
    return { routed, spot }
  }

  private async gasPriceFor(chainId: number): Promise<bigint> {
    const key = `${String(chainId)}:${String(this.deps.chains.rpcEpoch(chainId))}`
    const now = this.deps.platform.now()
    const hit = this.gasPriceCache.get(key)
    if (hit && now - hit.at < GAS_PRICE_CACHE_MS) return hit.value
    const raw = await this.deps.chains
      .rpc(chainId, 'eth_gasPrice', [])
      .catch(() => '0x3b9aca00')
    const value = BigInt(String(raw ?? '0x3b9aca00'))
    this.gasPriceCache.set(key, { at: now, value })
    return value
  }

  private async pair(
    chainId: number,
    tokenIn: string,
    tokenOut: string,
  ): Promise<{ inView: TokenView | null; outView: TokenView | null }> {
    const [inView, outView] = await Promise.all([
      this.deps.tokens.get(chainId, tokenIn),
      this.deps.tokens.get(chainId, tokenOut),
    ])
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

  private skeleton(
    input: SwapInput,
    inView: TokenView | null,
    outView: TokenView | null,
    problems: string[],
  ): SwapQuoteView {
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
      fee: {
        bips: 0,
        tier: 0,
        name: '',
        amountRaw: '0',
        sink: null,
        source: 'fallback',
        nextTierAt: null,
        nextTierBips: null,
        onInput: false,
      },
      route: { label: '', hops: [], source: 'onchain' },
      gasEstimate: '0',
      steps: [],
      quotedAt: this.deps.platform.now(),
      ok: false,
      problems,
      maxSpendableRaw: '0',
    }
  }

  /**
   * The routing service first, the on-chain mini-router when it cannot answer.
   *
   * "Cannot answer" is deliberately wide: unreachable, slow, rate limited, no
   * route, or a response the wallet cannot read — `parseQuote` refuses a bad
   * amount echo, a split route, a broken path or the wrong tokens at either
   * end. All of those land in the same place, which is the behaviour that
   * shipped before the service was asked at all — so the worst it can do to a
   * quote is cost it one bounded round trip before the wallet falls back to
   * quoting for itself. It is never the reason a swap is refused.
   *
   * What is NOT a reason to fall back is the served price itself: an answer
   * the wallet can read is used as given, without a confirming call to the
   * chain (owner's decision — see the note where the route is returned).
   */
  private async route(
    input: QuoterInput,
    addresses: QuoteAddresses,
    read: EsReader,
  ): Promise<
    { quote: RouteQuote; source: 'api' | 'onchain'; provenance: QuoteProvenance } | null | 'superseded'
  > {
    const quoter = this.deps.quoter
    /*
      Why the service was not used, kept even on the happy path to nothing.

      "The wallet quoted on chain" and "the wallet quoted on chain because the
      service said `3 splits`" are different bug reports, and the second one is
      the answer. It is one string, only ever read by a failure report.
    */
    let fallbackReason: string | null = quoter ? null : 'no routing service in this build'
    if (quoter) {
      const served = await quoter.route(input)
      /*
        Nobody is waiting for this one: a newer amount for the same pair
        replaced it while it was in flight. Falling through to the mini-router
        here would spend the wallet's largest RPC call answering a question that
        has already been asked again — so the whole quote is abandoned instead,
        and `quote()` returns the neutral skeleton the caller will discard.
      */
      if (served.kind === 'superseded') return 'superseded'
      if (served.kind === 'route') {
        /*
          The served quote is used as served. No second opinion from the chain.

          §8.6 and docs/security.md used to promise "on-chain wins": a served
          quote more than a percent below the chain's figure for the same route
          was to be replaced by the chain's. That was implemented, and it cost
          one `eth_call` on *every* quote — on the happy path, in front of the
          number the user is waiting for, on every keystroke.

          The owner has overridden it: "use the quoter's rate as-is without
          calling the on-chain quoter unless the quoter-api's response is
          invalid/errors." The docs that asked for the check have been changed
          to say this instead, so the next reader does not put it back.

          What is given up is real and worth stating: a compromised or stale
          routing service can now move `deliveredMinimumOut` down, bounded only
          by the user's slippage and the 5 %/15 % price-impact plates. What is
          NOT given up is everything the chain enforces — `amountOutMinimum`
          still rides in the calldata, the firewall still checks the shape, and
          a served route the encoder cannot express is still refused. The
          validation in `parseQuote` (amount echo, single split, joined-up path,
          right tokens at both ends) is what "invalid" means here, and that
          still falls through to the mini-router below.
        */
        return {
          quote: served.quote,
          source: 'api',
          provenance: {
            id: served.id,
            cached: served.cached,
            blockNumber: served.blockNumber,
            fallbackReason: null,
          },
        }
      }
      fallbackReason = served.reason
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
    const onChain =
      (input.tradeType ?? 'EXACT_INPUT') === 'EXACT_OUTPUT'
        ? await bestRouteExactOut(input.tokenIn, input.tokenOut, input.amountIn, addresses, read).then((q) =>
            q
              ? {
                  candidate: q.best.candidate,
                  /*
                    `RouteQuote.amountOut` is the service's dependent amount —
                    exact-in: what you receive; exact-out: what you spend.
                  */
                  amountOut: q.best.amountIn,
                  gasEstimate: q.best.gasEstimate,
                }
              : null,
          )
        : await bestRoute(input.tokenIn, input.tokenOut, input.amountIn, addresses, read).then((q) => q?.best ?? null)
    return onChain
      ? {
          quote: onChain,
          source: 'onchain',
          provenance: { id: null, cached: null, blockNumber: null, fallbackReason },
        }
      : null
  }

  async quote(input: SwapInput): Promise<SwapQuoteView> {
    const d = this.deps
    const { chainId } = input
    /*
      Start the lookups that do not need the pair, in the same tick as the
      pair itself. They used to sit behind `await pair()`, which is a cache
      hit on a warm screen and a round trip on a cold one — either way it was
      idle time in front of the routing service.
    */
    const accountsP = d.vault.accounts()
    const settingsP = d.settings.get()
    const statusP = d.vault.status()
    const gasP = this.gasPriceFor(chainId)
    const tierP = d.holder.tier(input.accountId, chainId)
    const { inView, outView } = await this.pair(chainId, input.tokenIn, input.tokenOut)
    const problems: string[] = []
    // The kill-switch (§3.7) comes before every other answer, even for a pair the wallet does not know.
    if (this.deps.statics?.isDisabled('swap'))
      return this.skeleton(input, inView, outView, [
        'In-wallet swaps are switched off right now by a signed flag from ElectroSwap. Swap on app.electroswap.io meanwhile.',
      ])
    if (!isEtn(chainId))
      return this.skeleton(input, inView, outView, [
        'Swaps happen on Electroneum. Bridge first, then swap.',
      ])
    if (!inView || !outView) return this.skeleton(input, inView, outView, ['Pick two tokens.'])
    const blockedInP = this.isBlocked(chainId, inView.address)
    const blockedOutP = this.isBlocked(chainId, outView.address)
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
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const wetn = A.wetn as Hex
    const nativeIn = inView.address === 'native'
    const nativeOut = outView.address === 'native'
    const wrappedIn = nativeIn ? wetn : (inView.address as Hex)
    const wrappedOut = nativeOut ? wetn : (outView.address as Hex)
    if (same(wrappedIn, wrappedOut)) problems.push('Pick two different tokens.')
    if (typed <= 0n) problems.push('Enter an amount above zero.')
    /*
      The routing service needs the pair, the amount and the recipient — not
      the fee tier, not the block-list, not the gas price. Starting it after
      those had resolved put a whole phone round-trip in front of a 100 ms
      quote. Owner: the quoted output was taking ~3 s to appear while the
      routing service itself answered in ~100 ms.

      A blocked token still gets a request it will discard; that is cheaper
      than making every good quote wait to find out it is good.
    */
    const accountList = await accountsP
    const account = accountList.find((a) => a.id === input.accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    const owner = account.address as Hex
    const read = readerFor(d.chains, chainId)
    const addresses = quoteAddresses(chainId)
    const canPrice = typed > 0n && !same(wrappedIn, wrappedOut)
    const routeEarly = !exactOut && canPrice
      ? this.routeAndSpot(
          { chainId, tokenIn: wrappedIn, tokenOut: wrappedOut, amountIn, recipient: owner },
          addresses,
          read,
          inView.decimals,
          outView.decimals,
        )
      : null
    const taxEarly = canPrice ? this.taxPair(chainId, A, wrappedIn, wrappedOut, wetn, read) : null
    /*
      Everything else the quote needs, asked for at once.

      These were nine `await`s in a column: accounts, settings, status, the two
      safety lookups, the balance, the gas price, the holder tier, the allowance
      multicall — and only then the router. None of them depends on any other,
      so on a phone they were nine round trips end to end in front of the one
      call that produces the number the user is waiting for. Owner: "updating an
      input number seems like it's a lot slower to get a quote back than on the
      web interface … we want to get the quoted output showing as quickly as
      possible."

      They are two waves now: this one rides *beside* the router, and then the
      balance reads. The gate between them is unchanged — a swap with a problem
      still returns before anything is *used* — because every problem is
      decided by this wave and by parsing the amount, both of which happen here.
    */
    const [settings, status, blockedIn, blockedOut, gasPriceRaw, tier] =
      await Promise.all([
        settingsP,
        statusP,
        blockedInP,
        blockedOutP,
        gasP,
        tierP,
      ])
    const slippageBips = input.slippageBips ?? settings.slippageBips
    if (account.kind === 'watch')
      problems.push('Watch-only — import a key or pair a device to swap.')
    if (!status.backupComplete && status.seeds.length > 0 && account.kind === 'hd')
      problems.push('Back up your recovery phrase before you swap.')
    /*
      The safety level used to be decoration: one warning icon on one Explore
      row, and nothing in the swap path ever read it, so a token ElectroSwap had
      marked BLOCKED swapped exactly like any other. Refusing belongs here rather
      than in the screen, because the screen is not the only way to reach a swap.
      Only BLOCKED refuses: an unknown token is not a blocked one, and a silent
      API must not turn every token into a refusal.
    */
    if (blockedIn)
      problems.push(`${inView.symbol} is marked unsafe by ElectroSwap. BoltVault will not swap it.`)
    if (blockedOut)
      problems.push(`${outView.symbol} is marked unsafe by ElectroSwap. BoltVault will not swap it.`)

    // Balances and the network fee reserve.
    const gasPrice = gasPriceRaw
    const stateCalls: EsReadCall[] = nativeIn
      ? []
      : [
          { address: wrappedIn, abi: ERC20_ABI, functionName: 'balanceOf', args: [owner] },
          {
            address: wrappedIn,
            abi: ERC20_ABI,
            functionName: 'allowance',
            args: [owner, A.permit2 as Hex],
          },
          {
            address: A.permit2 as Hex,
            abi: PERMIT2_ABI,
            functionName: 'allowance',
            args: [owner, wrappedIn, A.universalRouter as Hex],
          },
        ]
    /*
      The native balance rides in the aggregate instead of being its own call.

      `eth_getBalance` is not a contract call, so it looked like it had to go on
      its own — but Multicall3 exposes `getEthBalance(address)`, so it can sit in
      the same batch as the allowances and the tax probes. `readMany` coalesces
      every read issued within 12 ms into one aggregate, and these all are, so
      the whole of the owner's state plus both tax probes is one round trip.
      Owner: "any of those calls that could become multicall should."

      When a chain has no working Multicall3 (`multicallAddress` probes once and
      caches), `readMany` falls back to one call per read anyway, so there is
      nothing to fold into — the plain `eth_getBalance` is used instead.
    */
    const mc = await multicallAddress(d.chains, chainId)
    const nativeCall: readonly EsReadCall[] = mc
      ? [{ address: mc, abi: MULTICALL3_ABI, functionName: 'getEthBalance', args: [owner] }]
      : []
    const batched = [...nativeCall, ...stateCalls]
    const [batchedResults, rawNative] = await Promise.all([
      batched.length ? read(batched) : Promise.resolve([] as EsReadResult[]),
      mc
        ? Promise.resolve(null)
        : d.chains.rpc(chainId, 'eth_getBalance', [owner, 'latest']).catch(() => '0x0'),
    ])
    const state = mc ? batchedResults.slice(nativeCall.length) : batchedResults
    const nativeSlot = mc ? batchedResults[0] : undefined
    /*
      A slot that did not answer is not a balance of zero.

      Reading a failed `getEthBalance` as 0n would tell the user they cannot
      afford the network fee on a funded account — the wallet refusing a swap
      because a batch entry came back empty. A Multicall3 variant without the
      helper, or an aggregate that partially failed, therefore falls back to the
      plain `eth_getBalance` rather than to a number nobody measured. It costs a
      round trip in a case that should not happen, which is the right way round.
    */
    const nativeBalance =
      nativeSlot?.ok && typeof nativeSlot.value === 'bigint'
        ? nativeSlot.value
        : BigInt(
            String(
              (rawNative ??
                (await d.chains
                  .rpc(chainId, 'eth_getBalance', [owner, 'latest'])
                  .catch(() => '0x0'))) ??
                '0x0',
            ),
          )
    const balanceIn = nativeIn
      ? nativeBalance
      : state[0]?.ok && typeof state[0].value === 'bigint'
        ? state[0].value
        : 0n
    const erc20Allowance =
      !nativeIn && state[1]?.ok && typeof state[1].value === 'bigint' ? state[1].value : 0n
    const p2 =
      !nativeIn && state[2]?.ok && Array.isArray(state[2].value)
        ? (state[2].value as [bigint, number, number])
        : null
    const nowS = Math.floor(d.platform.now() / 1000)

    const base = this.skeleton(input, inView, outView, problems)
    const withState: SwapQuoteView = {
      ...base,
      amountInRaw: amountIn.toString(),
      balanceInRaw: balanceIn.toString(),
      // Native MAX waits for the measured fee below; an ERC-20 can spend its whole balance.
      maxSpendableRaw: nativeIn ? '0' : balanceIn.toString(),
      slippageBips,
      fee: {
        ...base.fee,
        bips: tier.sink ? tier.bips : 0,
        tier: tier.tier,
        name: tier.name,
        sink: tier.sink,
        source: tier.source,
        nextTierAt: tier.nextTierAt,
        nextTierBips: tier.nextTierBips,
      },
    }
    if (problems.length > 0 || typed <= 0n) return withState

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
    if (!sink && chainId !== ELECTRONEUM_TESTNET_CHAIN_ID)
      problems.push(
        'In-wallet swaps are off on this network — no fee address is set for it in this build.',
      )
    /*
      An exact-output order is grossed up before it is priced.

      `PAY_PORTION` takes its share of whatever the router is holding, so buying
      exactly the amount the user asked for would pay the wallet fee out of that
      amount and hand them less than they typed. Asking the pools for a little
      more instead means the fee comes off the top and the exact amount survives
      it — the fee is paid in extra input, and the screen says so.
    */
    const grossWanted = exactOut ? grossOutForExactOut(wantOut, bips) : 0n
    let candidate: Candidate | null = null
    let source: 'api' | 'onchain' = 'onchain'
    let gasEstimate = 0n
    let amountOut = 0n
    let taxIn: TaxProbe = null
    let taxOut: TaxProbe = null
    let spot: number | null = null
    let provenance: QuoteProvenance = {
      id: null,
      cached: null,
      blockNumber: null,
      fallbackReason: null,
    }

    if (exactOut) {
      /*
        The routing service answers `EXACT_OUTPUT` the same way the web
        interface asks it. `quote.quote` is the required spend; the encoder
        still writes `amountInMaximum`, which no router can talk the wallet
        past. Mixed routes are refused at parse time and the mini-router
        prices a V2/V3 path instead.
      */
      const [routed, tIn, tOut] = await Promise.all([
        this.route(
          {
            chainId,
            tokenIn: wrappedIn,
            tokenOut: wrappedOut,
            amountIn: grossWanted,
            recipient: owner,
            tradeType: 'EXACT_OUTPUT',
          },
          addresses,
          read,
        ),
        ...(taxEarly ?? this.taxPair(chainId, A, wrappedIn, wrappedOut, wetn, read)),
      ])
      taxIn = tIn
      taxOut = tOut
      if (routed === 'superseded') return withState
      if (routed) {
        candidate = routed.quote.candidate
        gasEstimate = routed.quote.gasEstimate
        // Dependent amount: what this exact-out costs at the quoted price.
        amountIn = routed.quote.amountOut
        amountOut = grossWanted
        source = routed.source
        provenance = routed.provenance
      }
      const probeIn = amountIn / 1000n
      spot = candidate
        ? await this.spotRate(chainId, candidate, probeIn, addresses, read, inView.decimals, outView.decimals)
        : null
    } else {
      /*
        Already in flight since before the rest of the quote — `routeEarly`.
        It is only ever null when something above decided not to quote at all,
        and that path has returned by now, so the fallback is for the type
        system rather than for a case that happens.
      */
      const [packed, tIn, tOut] = await Promise.all([
        routeEarly ??
          this.routeAndSpot(
            { chainId, tokenIn: wrappedIn, tokenOut: wrappedOut, amountIn, recipient: owner },
            addresses,
            read,
            inView.decimals,
            outView.decimals,
          ),
        taxEarly?.[0] ?? this.cachedTax(chainId, wrappedIn, wetn, A.feeOnTransferDetector as Hex | null, read),
        taxEarly?.[1] ?? this.cachedTax(chainId, wrappedOut, wetn, A.feeOnTransferDetector as Hex | null, read),
      ])
      /*
        Abandoned mid-flight because the amount changed. Return the neutral
        skeleton: the caller has already thrown this answer away, and every
        step after this one — the price-impact probe, the encode, the fee
        arithmetic — would be work done for nobody.
      */
      if (packed.routed === 'superseded') return withState
      if (packed.routed) {
        candidate = packed.routed.quote.candidate
        gasEstimate = packed.routed.quote.gasEstimate
        amountOut = packed.routed.quote.amountOut
        source = packed.routed.source
        provenance = packed.routed.provenance
      }
      taxIn = tIn
      taxOut = tOut
      spot = packed.spot
    }
    if (!candidate) {
      problems.push('No route on ElectroSwap for this pair.')
      return { ...withState, problems }
    }
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
    const taxUnknown = isTaxUnknown(taxIn) || isTaxUnknown(taxOut)
    const taxBips = taxSlippageBips(taxIn, taxOut)
    /*
      A token the detector could not sell back is not a token with a large fee.

      The probe borrows from the pair, sends it back, and measures the
      shortfall. When that send reverts, the detector says so — and a token that
      refuses to be sold is one a user can be talked into buying and then never
      get out of. Nothing downstream can protect them: the swap in succeeds, the
      minimum received is honoured, and the position is simply stuck.

      The detector this replaced had no way to report it. It caught the failing
      sell and echoed `buyFeeBps`, so a honeypot came back looking like an
      ordinary 3% token and was quoted like one.
    */
    if (sellsAreRefused(taxOut))
      problems.push(
        `${outView.symbol} cannot be sold back — the check that buys it succeeds and then nothing can get you out. BoltVault will not buy it for you.`,
      )
    if (sellsAreRefused(taxIn))
      problems.push(
        `${inView.symbol} refuses to be sold, so this swap would fail on chain. Nothing BoltVault can sign will move it.`,
      )
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
      problems.push(
        `${taxed} charges a fee every time it moves, so BoltVault cannot promise you an exact amount of it. Set the amount you pay instead.`,
      )
    }
    /*
      Slippage and the token's transfer tax were summed with no ceiling. At
      10 000 bps `minimumOut` computes to exactly zero — the swap would accept
      any output at all, including dust — and above it the subtraction goes
      negative and the encoder throws. A token declaring a large enough tax
      therefore disarmed the only protection the swap has. Refuse instead: a
      swap whose combined slippage reaches 100% has nothing left to protect.
    */
    /*
      Where the wallet takes its fee, which the output token decides.

      `PAY_PORTION` needs the router to hold the output, and the hop from the
      router to the user is one more transfer for a token that charges on
      transfer to tax — taken after `Payments.sweep` has already compared its
      minimum against the *router's* balance. The figure on screen was not the
      figure guaranteed. Charging the input instead means the router never holds
      the output: the swap pays the user directly and the V2 router measures
      their balance before and after, which is a real delivered-amount floor.

      Only when the detector actually measured something. A probe that could not
      answer is not evidence of anything, and the ordinary case keeps the shape
      it has always had.
    */
    const feeOnInput = custodyIsUnsafe(taxOut) && bips > 0 && sink !== null
    const effectiveSlippage = Math.min(slippageBips + taxBips, MAX_EFFECTIVE_SLIPPAGE_BPS)
    if (slippageBips + taxBips >= BIPS_CEILING)
      problems.push(
        'This token’s transfer tax plus your slippage would leave no minimum received. BoltVault will not sign a swap with no floor.',
      )
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
    /*
      What lands, which depends on where the fee was taken.

      On the output, the router's quote is reduced by the fee and then by the
      token's own transfer tax. On the input, the fee came off before the pools
      were asked at all — so the whole swap output is the user's, less the tax,
      and subtracting the fee again here would under-report what they get by the
      fee twice over.
    */
    const receive = exactOut
      ? wantOut
      : ((feeOnInput ? amountOut : netAfterFee(amountOut, bips)) *
          BigInt(10_000 - Math.min(taxBips, 9_999))) /
        10_000n
    /*
      The same number the encoder writes, whichever side the fee came from.

      `deliveredMinimumOut` subtracts the fee from the floor because the router
      takes its portion out of what it is holding. On the input side there is no
      portion to take — the fee left before the pools were asked — so the floor
      is the scaled quote less slippage, and subtracting the fee again would
      promise the user less than the bytes actually guarantee.
    */
    const scaledOut = feeOnInput ? amountOut - feeAmount(amountOut, bips) : amountOut
    const minOut = exactOut
      ? wantOut
      : feeOnInput
        ? routerMinimumOut(scaledOut, effectiveSlippage)
        : deliveredMinimumOut(amountOut, bips, effectiveSlippage)
    const maxIn = exactOut ? maximumInFor(amountIn, effectiveSlippage) : 0n
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
      if (
        !p2 ||
        !permitCovers(
          { amount: p2[0], expiration: Number(p2[1]), nonce: Number(p2[2]) },
          spendCeiling,
          nowS,
        )
      )
        steps.push('permit')
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
    const gas =
      gasEstimate +
      90_000n +
      boundaries * 40_000n +
      (steps.includes('approve') ? 55_000n : 0n) +
      (steps.includes('permit') ? 35_000n : 0n)
    const feeWei = gas * gasPrice
    if (spendCeiling > balanceIn) problems.push(`Not enough ${inView.symbol}.`)
    if ((nativeIn ? spendCeiling : 0n) + feeWei > nativeBalance)
      problems.push('Not enough ETN for the network fee.')
    const maxSpendableRaw = nativeIn
      ? maxSpendableAfterFee(nativeBalance, feeWei).toString()
      : balanceIn.toString()

    return {
      ...withState,
      amountInRaw: amountIn.toString(),
      maximumInRaw: maxIn.toString(),
      maxSpendableRaw,
      amountOutRaw: amountOut.toString(),
      receiveRaw: receive.toString(),
      minimumOutRaw: minOut.toString(),
      rate: rateOf(amountIn, amountOut, inView.decimals, outView.decimals),
      priceImpactPct: impact,
      taxBips,
      taxUnknown,
      // Denominated in whichever token it is actually taken from.
      fee: {
        ...withState.fee,
        onInput: feeOnInput,
        amountRaw: (feeOnInput ? feeAmount(amountIn, bips) : feeAmount(amountOut, bips)).toString(),
      },
      route: {
        label: candidate.label,
        source,
        hops: candidate.route.hops.map((h) =>
          h.kind === 'v3'
            ? { kind: 'v3' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut, fee: h.fee }
            : { kind: 'v2' as const, tokenIn: h.tokenIn, tokenOut: h.tokenOut },
        ),
      },
      gasEstimate: gas.toString(),
      steps,
      quotedAt: d.platform.now(),
      ok: problems.length === 0,
      problems,
      diagnostics: {
        provenance,
        account: {
          account: owner,
          balanceIn: balanceIn.toString(),
          nativeBalance: nativeBalance.toString(),
          erc20Allowance: nativeIn ? null : erc20Allowance.toString(),
          permit2Amount: p2 ? p2[0].toString() : null,
          permit2Expiration: p2 ? Number(p2[1]) : null,
        },
        tax: { in: taxIn, out: taxOut, detector: A.feeOnTransferDetector !== null },
      },
    }
  }

  /** Start the flow: approve → permit → swap, one sheet each. Resolves once the first sheet exists. */
  async execute(input: SwapInput): Promise<{ flowId: string; requestId: string | null }> {
    const d = this.deps
    if (d.statics?.isDisabled('swap'))
      throw new EngineError('invalid_argument', 'In-wallet swaps are switched off right now.')
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
    /*
      Three facts the failure report needs, kept where the flow can still see
      them after the step that produced them has thrown.

      `swapStage` is the one that cannot be recovered from the error: the swap
      step re-quotes, encodes and then broadcasts, and all three throw
      `EngineError`s that look alike from the outside. The step says where it
      had got to as it goes, which is cheaper and more honest than guessing from
      a message.
    */
    let swapStage: FailureStage = 'quote'
    let encoded = first
    let swapCall: { to: string; value: string; data: string } | null = null

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
            tx: {
              from: owner,
              to: tokenIn,
              value: '0x0',
              data: encodeApprovePermit2(
                permit2,
                settings.exactApprovals ? spendCeiling : maxUint256,
              ).data,
            },
            clientRequestId: `swap:${tag}:approve`,
          }),
      })
    }
    if (first.steps.includes('permit')) {
      steps.push({
        step: 'permit',
        run: async () => {
          const [r] = await readMany(d.chains, chainId, [
            {
              address: permit2,
              abi: PERMIT2_ABI,
              functionName: 'allowance',
              args: [owner, tokenIn, ur],
            },
          ])
          const nonce =
            r?.ok && Array.isArray(r.value) ? Number((r.value as [bigint, number, number])[2]) : 0
          const nowS = Math.floor(d.platform.now() / 1000)
          const typed = permitSingleTypedData({
            chainId,
            permit2,
            token: tokenIn,
            amount: spendCeiling,
            nonce,
            spender: ur,
            nowSeconds: nowS,
          })
          const { requestId, result } = await d.provider.runInternal({
            kind: 'sign_typed_data',
            origin: 'internal:swap:permit',
            chainId,
            accountId: input.accountId,
            from: owner,
            typedData: typed,
            version: 'v4',
            clientRequestId: `swap:${tag}:permit`,
          })
          const settled = result.then((sig) => {
            permit = {
              token: tokenIn,
              amount: spendCeiling,
              expiration: nowS + PERMIT_EXPIRY_S,
              nonce,
              spender: ur,
              sigDeadline: BigInt(nowS + PERMIT_EXPIRY_S),
              signature: sig as Hex,
            }
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
        swapStage = 'quote'
        // The tier is re-read at sign time; if it moved, the whole quote is redone (never a stale bips).
        const tier = await d.holder.tier(input.accountId, chainId, true)
        let quote = first
        if (tier.bips !== first.fee.bips || d.platform.now() - first.quotedAt > 8_000) {
          quote = await this.quote({ ...input, slippageBips: first.slippageBips })
          if (!quote.ok)
            throw new EngineError('invalid_argument', quote.problems[0] ?? 'the quote changed')
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
            const movedBips = ((exactOut ? now - before : before - now) * 10_000n) / before
            if (movedBips > BigInt(first.slippageBips))
              throw new EngineError(
                'invalid_argument',
                `The price moved by ${(Number(movedBips) / 100).toFixed(2)}% while this swap was being set up, which is more than your slippage allows. Start it again to see the new price.`,
              )
          }
          d.flows.setQuote(flowId, quote)
        }
        // From here the quote is settled and everything left is building bytes:
        // a report about what follows describes the trade that was encoded, not
        // the one the sheet was opened on.
        encoded = quote
        swapStage = 'sign'
        const bips = quote.fee.bips
        const sink = (quote.fee.sink ?? null) as Hex | null
        if (bips > 0 && !sink)
          throw new EngineError(
            'invalid_argument',
            'In-wallet swaps are off on this network — no fee address is set for it in this build.',
          )
        const nowS = Math.floor(d.platform.now() / 1000)
        const shared = {
          route: { hops: quote.route.hops.map((h) => encodableHop(h)) },
          nativeIn,
          nativeOut,
          wrappedNative: wetn,
          recipient: owner,
          fee: bips > 0 && sink ? { sink, bips } : null,
          ...(quote.fee.onInput ? { feeOnInput: true } : {}),
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
          ? encodeSwapExactOut({
              ...shared,
              amountOut: BigInt(quote.receiveRaw),
              maximumIn: ceiling < spendCeiling ? ceiling : spendCeiling,
            })
          : encodeSwap({
              ...shared,
              amountIn,
              quotedOut: BigInt(quote.amountOutRaw),
              slippageBips: quote.slippageBips + quote.taxBips,
            })
        /*
          The bytes as handed over, kept so a failure can be replayed on a fork.
          Decimal, not the `0x` form below: the report's `value` is a raw amount
          like every other amount that crosses a wallet boundary. The Permit2
          signature inside `data` is stripped by the reporter, not here — the
          transaction itself needs it, and the one copy that leaves the wallet
          is the one that must not carry it.
        */
        swapCall = { to: enc.to, value: enc.value.toString(), data: enc.data }
        swapStage = 'broadcast'
        return d.provider.runInternal({
          kind: 'send_transaction',
          origin: 'internal:swap',
          chainId,
          accountId: input.accountId,
          tx: { from: owner, to: enc.to, value: hex(enc.value), data: enc.data },
          clientRequestId: `swap:${tag}:swap`,
          /*
            The amount is handed over rather than derived: on the input side the
            swap command's `amountIn` is already net of the fee, so there is
            nothing left in the calldata for the firewall to recompute it from.
          */
          expectedFee: {
            sink: sink ?? ZERO,
            bips,
            ...(quote.fee.onInput && sink
              ? {
                  onInput: {
                    token: (nativeIn ? wetn : tokenIn) as Hex,
                    amount: feeAmount(amountIn, bips),
                  },
                }
              : {}),
          },
        })
      },
    })
    const failures = d.failures
    const flow = await d.flows.start({
      kind: 'swap',
      accountId: input.accountId,
      chainId,
      quote: first,
      steps,
      /*
        A declined sheet stops here and goes no further.

        `ClientFailures` refuses a `rejected` report as well, twice over — but
        "the wallet never reports a user saying no" should be visible at the
        place the decision is made, not only in the thing it is handed to.
      */
      ...(failures
        ? {
            onFailed: (f: FlowStepFailure) =>
              f.rejected
                ? undefined
                : failures.report(
                    swapFailureReport({
                      failure: f,
                      quote: encoded,
                      chainId,
                      stage: swapStage,
                      call: swapCall,
                    }),
                  ),
          }
        : {}),
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  flow(id: string): SwapFlow | null {
    return this.deps.flows.get(id)
  }

  flows(accountId?: string): SwapFlow[] {
    return this.deps.flows.list(accountId)
  }
}

/**
 * Which stage a failed step belongs to.
 *
 * The approve and permit steps name themselves rather than deferring to the
 * phase: a reverted approve filed as `receipt/revert` loses the only thing that
 * made it diagnosable, which is that it was the approve and not the swap. Only
 * the swap step has three places to fail, and `stage` is what it was told it
 * had reached.
 */
function stageOf(failure: FlowStepFailure, stage: FailureStage): FailureStage {
  if (failure.step === 'approve') return 'approve'
  if (failure.step === 'permit') return 'permit'
  if (failure.phase === 'receipt') return 'receipt'
  // The sheet was decided and the send came back against us.
  if (failure.phase === 'result') return 'broadcast'
  return stage
}

/**
 * What kind of failure this was, from the error itself wherever possible.
 *
 * `EngineError` carries a code, so the common cases are read rather than
 * guessed: a rejection and a validation refusal are exact. The patterns below
 * are for what an RPC endpoint hands back, which is prose and varies by node.
 * They are ordered so a certainty beats a guess — a mined receipt with a zero
 * status is a revert whatever the message says about it.
 */
function kindOf(error: unknown, entry: ActivityEntry | null): FailureKind {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof EngineError) {
    if (error.code === 'rejected') return 'rejected'
    if (error.code === 'timeout') return 'timeout'
    if (error.code === 'invalid_argument') return 'validation'
  }
  if (/rejected/i.test(message)) return 'rejected'
  if (entry?.status === 'failed') return 'revert'
  // A receipt wait that produced no row at all ran out the clock; one that
  // produced a `replaced` row is a transaction that was superseded, which is
  // not a revert and not a timeout.
  if (error instanceof FlowReceiptError) return entry === null ? 'timeout' : 'unknown'
  if (/revert/i.test(message)) return 'revert'
  if (/timed out|timeout|deadline/i.test(message)) return 'timeout'
  if (/network|fetch|socket|econn|dns/i.test(message)) return 'network'
  return 'unknown'
}

/**
 * The revert reason and the custom-error selector, when the message carries them.
 *
 * Nodes answer a refused `eth_sendRawTransaction` with `execution reverted: X`,
 * or — for a custom error, which is most of Permit2 and the Universal Router —
 * with four bytes and no words at all. Both fields are nullable and nothing
 * downstream depends on either, so a pattern that misses costs a null rather
 * than a wrong answer.
 */
function revertOf(message: string): { revertReason: string | null; revertSelector: string | null } {
  const reason = /execution reverted:?\s*([^\n"]+)/i.exec(message)
  const selector = /\b(0x[0-9a-fA-F]{8})\b/.exec(message)
  return { revertReason: reason?.[1]?.trim() ?? null, revertSelector: selector?.[1] ?? null }
}

/**
 * One side's tax probe in the endpoint's vocabulary.
 *
 * The reason a probe failed travels, because the reasons are not equally
 * interesting. `no-pair` is the ordinary case — the detector reverts
 * `PairLookupFailed` for any token with no V2 pair against the base, and most
 * tokens have no reason to have one. `probe-reverted` is the finding: the pair
 * existed, the loan went out, and the token fought it. Reporting the first as
 * the second, which an earlier `TaxProbe` had no way not to do, sends a reader
 * of this log after a defect that is not there.
 *
 * A null probe is two different things and the detector settles which: no
 * detector on this chain, or a side that was not probed because it *is* the
 * wrapped native and cannot tax itself.
 */
function probeOf(probe: TaxProbe, detector: boolean): FailureTaxProbe | null {
  const blank = {
    buyFeeBps: null,
    sellFeeBps: null,
    sellReverted: null,
    externalTransferFailed: null,
    feeTakenOnTransfer: null,
  }
  if (isTaxUnknown(probe)) return { status: probe.reason, ...blank }
  if (probe === null) return detector ? null : { status: 'no-detector', ...blank }
  return {
    status: 'measured',
    buyFeeBps: probe.buyFeeBps,
    sellFeeBps: probe.sellFeeBps,
    sellReverted: probe.sellReverted,
    externalTransferFailed: probe.externalTransferFailed,
    feeTakenOnTransfer: probe.feeTakenOnTransfer,
  }
}

/**
 * A failed swap step as the client-failure endpoint takes it.
 *
 * Pure, and exported, because everything interesting about this is the mapping
 * and the mapping is worth asserting against the real schema without booting an
 * engine: the stage, the kind, and the fact that a rejection never gets this
 * far. `ClientFailures` does the clamping and the signature stripping, so this
 * is free to hand over whatever it has.
 */
export function swapFailureReport(input: {
  readonly failure: FlowStepFailure
  readonly quote: SwapQuoteView
  readonly chainId: number
  /** How far the swap step had got. Ignored for the approve and permit steps, which name themselves. */
  readonly stage: FailureStage
  readonly call: { to: string; value: string; data: string } | null
}): ClientFailureInput {
  const { failure, quote } = input
  const message = failure.error instanceof Error ? failure.error.message : String(failure.error)
  const entry = failure.error instanceof FlowReceiptError ? failure.error.entry : null
  const diagnostics = quote.diagnostics
  return {
    chainId: input.chainId,
    operation: 'swap',
    failure: {
      stage: stageOf(failure, input.stage),
      kind: kindOf(failure.error, entry),
      message,
      ...revertOf(message),
      txHash: failure.hash ?? entry?.hash ?? null,
      blockNumber:
        entry?.blockNumber === undefined || entry?.blockNumber === null
          ? null
          : String(entry.blockNumber),
      /*
        The receipt watcher reads `status` and `blockNumber` and nothing else,
        so the wallet does not know what the transaction actually spent. Null is
        the honest answer; sending the pre-flight estimate under this name would
        be worse than sending nothing.
      */
      gasUsed: null,
    },
    /*
      Only the swap step's bytes are worth keeping. An approve is one ERC-20
      call and a permit is one signature, both reconstructible from the trade —
      and the permit's calldata is the one thing in this whole flow that must
      never be recorded.
    */
    call: failure.step === 'swap' ? input.call : null,
    state: diagnostics?.account ?? null,
    swap: {
      quote: {
        id: diagnostics?.provenance.id ?? null,
        // The wallet has exactly two routers, and `route.source` records which
        // priced this quote; 'client-fallback' is the web app's third option.
        source: quote.route.source === 'api' ? 'routing-api' : 'onchain-mini-router',
        cached: diagnostics?.provenance.cached ?? null,
        blockNumber: diagnostics?.provenance.blockNumber ?? null,
        fallbackReason: diagnostics?.provenance.fallbackReason ?? null,
      },
      trade: {
        type: quote.tradeType === 'exactOut' ? 'exact-out' : 'exact-in',
        tokenIn: { address: quote.tokenIn, symbol: quote.symbolIn, decimals: quote.decimalsIn },
        tokenOut: { address: quote.tokenOut, symbol: quote.symbolOut, decimals: quote.decimalsOut },
        amountIn: quote.amountInRaw,
        slippageBips: quote.slippageBips,
        taxBips: quote.taxBips,
      },
      quoted: {
        amountOut: quote.amountOutRaw,
        minimumOut: quote.minimumOutRaw,
        gasEstimate: quote.gasEstimate,
        priceImpactPct: quote.priceImpactPct,
      },
      route: quote.route.hops.map((h) => ({
        protocol: h.kind,
        tokenIn: h.tokenIn,
        tokenOut: h.tokenOut,
        feeTier: h.fee ?? null,
      })),
      // `parseQuote` refuses a split route outright and the mini-router never
      // produces one, so this is always one — stated rather than left null,
      // because null would read as "the client did not know".
      splits: 1,
      tax: {
        in: probeOf(diagnostics?.tax.in ?? null, diagnostics?.tax.detector ?? false),
        out: probeOf(diagnostics?.tax.out ?? null, diagnostics?.tax.detector ?? false),
      },
      fee: { bips: quote.fee.bips, sink: quote.fee.sink, onInput: quote.fee.onInput },
    },
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
  .refine(
    (v) => (v.tradeType === 'exactOut' ? v.amountOut !== undefined : v.amountIn !== undefined),
    {
      message:
        'Say which amount you fixed: amountIn for an exact-in swap, amountOut for an exact-out one.',
    },
  )

export function swapNamespace(swap: SwapService): NamespaceSpec {
  return {
    quote: { input: InputSchema, handler: (arg) => swap.quote(arg as SwapInput) },
    execute: { input: InputSchema, handler: (arg) => swap.execute(arg as SwapInput) },
    flow: {
      input: z.object({ flowId: z.string() }),
      handler: async (arg) => swap.flow((arg as { flowId: string }).flowId),
    },
    flows: {
      input: z.object({ accountId: AccountIdSchema.optional() }).optional(),
      handler: async (arg) => swap.flows((arg as { accountId?: string } | undefined)?.accountId),
    },
  }
}
