import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import FOT_ARTIFACT from '../abis/FeeOnTransferDetector.json'
import { decodeCalldata, decodeUniversalRouter } from '@boltvault/security'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { FOT_DETECTOR_ABI } from '../src/swap/abis'
import { detectTax } from '../src/swap/fot'
import { bestDirect, bestRoute, bestRouteExactOut, candidates, deliveredMinimumOut, encodeSwap, encodeSwapExactOut, feeAmount, minimumOut, permitCovers, permitSingleTypedData, protocolRuns, quoteOne, tierFor, DYNO_WEIGHT_ONE, FALLBACK_SCHEDULE, MAX_CANDIDATES, taxSlippageBips, encodeSubmitOrder, encodeCloseOrder, COMMAND, CONTRACT_BALANCE, ROUTER_AS_RECIPIENT, V2_FEE_FLAG, V3_FEES, type Candidate, type Hop, type QuoteAddresses, type ReadCall, type ReadResult } from '../src/swap'

const A = ELECTRONEUM_ADDRESSES[52014]
const UR = A.universalRouter as Hex
const WETN = A.wetn as Hex
const USDC = A.usdc as Hex
const BOLT = A.bolt as Hex
const SINK = '0x00000000000000000000000000000000000051ab' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex
const addresses: QuoteAddresses = { quoterV2: A.quoterV2 as Hex, mixedRouteQuoter: A.mixedRouteQuoter as Hex, v2Router02: A.v2Router02 as Hex, bases: [WETN, USDC, A.usdt as Hex, BOLT] }
const USDT = A.usdt as Hex
/** Testnet, where no MixedRouteQuoter is deployed (`packages/chains/src/electroneum.ts`). */
const T = ELECTRONEUM_ADDRESSES[5201420]
const TESTNET_ADDRESSES: QuoteAddresses = { quoterV2: T.quoterV2 as Hex, mixedRouteQuoter: T.mixedRouteQuoter as Hex | null, v2Router02: T.v2Router02 as Hex, bases: [T.wetn as Hex, T.usdc as Hex, T.usdt as Hex] }
/** A pair in none of the bases, so all four bases generate and the cap bites. */
const NOT_A_BASE = '0x7777777777777777777777777777777777777777' as Hex
const NOT_A_BASE_2 = '0x8888888888888888888888888888888888888888' as Hex

/**
 * The 3-byte fee fields of a packed V3 path, in route order.
 *
 * Read as fields rather than searched for as a substring, because
 * `CONTRACT_BALANCE` is `0x8000…0000` and a calldata search for '800000' matches
 * every partitioned route whether or not a V2 hop was ever mismarked. A fee is
 * either a tier that exists or the `0x800000` quoter sentinel, and the two are
 * only distinguishable at their own offset.
 */
const v3PathFees = (path: Hex): number[] => {
  const body = path.slice(2)
  const fees: number[] = []
  for (let i = 40; i + 6 <= body.length; i += 46) fees.push(Number.parseInt(body.slice(i, i + 6), 16))
  return fees
}

/** The mock pool set the mini-router quotes against; `mixed` is what the MixedRouteQuoter answers. */
const quoteAnswers = (calls: readonly ReadCall[], over: { readonly mixed?: bigint }): ReadResult[] =>
  calls.map((call) => {
    if (call.address === addresses.mixedRouteQuoter) return { ok: true, value: [over.mixed ?? 300_000n, [], [], 200_000n] }
    if (call.functionName === 'getAmountsOut') return { ok: true, value: [1_000_000n, 490_000n] }
    if (call.functionName === 'quoteExactInputSingle') {
      const fee = (call.args[0] as { fee: number }).fee
      return fee === 3000 ? { ok: true, value: [499_600n, 0n, 0, 90_000n] } : { ok: false }
    }
    if (call.functionName === 'quoteExactInput') return { ok: true, value: [500_000n, [], [], 180_000n] }
    return { ok: false }
  })

describe('fee math (§8.6, §8.18)', () => {
  it('tiers from the schedule, base for tier 0', () => {
    expect(tierFor(FALLBACK_SCHEDULE, 0n)).toEqual({ bips: 50, tier: 0 })
    expect(tierFor(FALLBACK_SCHEDULE, 13_599n * 10n ** 18n)).toEqual({ bips: 50, tier: 0 })
    expect(tierFor(FALLBACK_SCHEDULE, 13_600n * 10n ** 18n)).toEqual({ bips: 40, tier: 1 })
    expect(tierFor(FALLBACK_SCHEDULE, 1_359_999n * 10n ** 18n)).toEqual({ bips: 20, tier: 3 })
    expect(tierFor(FALLBACK_SCHEDULE, 1_360_000n * 10n ** 18n)).toEqual({ bips: 10, tier: 4 })
    // 1 DYNO = 875.68 BOLT-eq: 1,554 DYNO clears the top tier on its own (1,553 does not).
    expect((1_554n * 10n ** 18n * FALLBACK_SCHEDULE.dynoWeight) / DYNO_WEIGHT_ONE >= 1_360_000n * 10n ** 18n).toBe(true)
    expect((1_553n * 10n ** 18n * FALLBACK_SCHEDULE.dynoWeight) / DYNO_WEIGHT_ONE < 1_360_000n * 10n ** 18n).toBe(true)
  })
  it('minOut = quoted × (1 − bips) × (1 − slippage)', () => {
    expect(feeAmount(10_000n, 50)).toBe(50n)
    expect(minimumOut(10_000n, 50, 50)).toBe(9_901n) // 9950 − 0.5 % of 9950 (floored)
    /*
      Why the engine caps combined slippage (`packages/engine/src/namespaces/swap.ts`).
      Slippage and a token's transfer tax were summed with no ceiling, and
      `taxSlippageBips` reads both fees straight off the token, so a hostile
      token could push the total to 10 000 bps. At that point the floor is
      exactly zero — the swap accepts any output at all, including dust — which
      is the one thing a minimum-received number exists to prevent.
    */
    expect(minimumOut(10_000n, 0, 10_000)).toBe(0n)
    expect(minimumOut(10_000n, 0, 9_900)).toBeGreaterThan(0n)
  })
})

describe('universal router encoding mirrors the SDK', () => {
  const base = { amountIn: 1_000_000n, quotedOut: 500_000n, slippageBips: 50, wrappedNative: WETN, recipient: ME, deadline: 1_900_000_000n, universalRouter: UR }
  /** `quotedOut` less the 0.50 % slippage: the floor the router enforces, before the fee. */
  const ROUTER_MIN = 497_500n

  it('token → token: V3 swap to the router, PAY_PORTION to the sink at the tier bips, then SWEEP', () => {
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 30 } })
    expect(enc.commands).toEqual([COMMAND.V3_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    expect(enc.value).toBe(0n)
    const ur = decodeUniversalRouter(enc.data)
    expect(ur?.deadline).toBe(1_900_000_000n)
    const [swap, pay, sweep] = ur?.commands ?? []
    expect(swap?.type === 'V3_SWAP_EXACT_IN' && swap.recipient === ROUTER_AS_RECIPIENT && swap.payerIsUser).toBe(true)
    expect(pay?.type === 'PAY_PORTION' && pay.recipient === SINK && pay.bips === 30n && pay.token === USDC).toBe(true)
    // routerMin = 497_500; after the 0.30 % fee: 497_500 − 1_492 = 496_008
    expect(sweep?.type === 'SWEEP' && sweep.recipient === ME && sweep.amount === 496_008n).toBe(true)
    expect(enc.minimumOut).toBe(496_008n)
    /*
      One number, three places. The screen used to compute its own floor with
      `minimumOut` — fee first, then slippage — while the router enforces
      slippage first and takes the fee from what survives. The two differ by
      their rounding, so the sheet promised very slightly more than the bytes
      guaranteed. `deliveredMinimumOut` is what the encoder writes, and is now
      what the quote reports.
    */
    expect(deliveredMinimumOut(base.quotedOut, 30, base.slippageBips)).toBe(enc.minimumOut)
    expect(sweep?.type === 'SWEEP' && sweep.amount === deliveredMinimumOut(base.quotedOut, 30, base.slippageBips)).toBe(true)
    // The firewall sees it as a router call with our fee.
    const decoded = decodeCalldata({ chainId: 52014, to: UR, data: enc.data, value: 0n })
    expect(decoded.kind).toBe('universal_router')
  })

  it('native in wraps to the router and the user is no longer the payer', () => {
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: true, nativeOut: false, fee: { sink: SINK, bips: 50 } })
    expect(enc.commands).toEqual([COMMAND.WRAP_ETH, COMMAND.V2_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    expect(enc.value).toBe(1_000_000n)
    const [wrap, swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(wrap?.type === 'WRAP_ETH' && wrap.recipient === ROUTER_AS_RECIPIENT && wrap.amount === 1_000_000n).toBe(true)
    expect(swap?.type === 'V2_SWAP_EXACT_IN' && swap.payerIsUser === false).toBe(true)
  })

  it('native out takes the fee on WETN then unwraps', () => {
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v3', tokenIn: USDC, tokenOut: WETN, fee: 500 }] }, nativeIn: false, nativeOut: true, fee: { sink: SINK, bips: 50 } })
    expect(enc.commands).toEqual([COMMAND.V3_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.UNWRAP_WETH])
    const cmds = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(cmds[1]?.type === 'PAY_PORTION' && cmds[1].token === WETN).toBe(true)
    expect(cmds[2]?.type === 'UNWRAP_WETH' && cmds[2].recipient === ME).toBe(true)
  })

  it('a zero-bips tier omits PAY_PORTION and lets the router pay the user directly', () => {
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: null })
    expect(enc.commands).toEqual([COMMAND.V3_SWAP_EXACT_IN])
    const [swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(swap?.type === 'V3_SWAP_EXACT_IN' && swap.recipient === ME).toBe(true)
  })

  it('a permit leads the plan, and a two-hop V3 path is packed into the one swap command', () => {
    const permit = { token: BOLT, amount: 1_000_000n, expiration: 1_900_001_800, nonce: 3, spender: UR, sigDeadline: 1_900_001_800n, signature: `0x${'ab'.repeat(65)}` as Hex }
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v3', tokenIn: WETN, tokenOut: USDC, fee: 500 }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 }, permit })
    expect(enc.commands).toEqual([COMMAND.PERMIT2_PERMIT, COMMAND.V3_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const [p, swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(p?.type === 'PERMIT2_PERMIT' && p.spender === UR && p.amount === 1_000_000n && p.token === BOLT).toBe(true)
    if (swap?.type !== 'V3_SWAP_EXACT_IN') throw new Error('unreachable')
    // token, uint24 fee, token, uint24 fee, token — packed, in route order.
    expect(swap.path.toLowerCase()).toBe(`0x${BOLT.slice(2)}000bb8${WETN.slice(2)}0001f4${USDC.slice(2)}`.toLowerCase())
  })

  /*
    A mixed route is partitioned now, not refused.

    V2 and V3 hops in one path used to fall through to the packed-path branch,
    where a V2 hop is marked with the `0x800000` fee sentinel. That sentinel is a
    MixedRouteQuoter convention: the Universal Router does not read it, and would
    look for a V3 pool at fee tier 8388608, which does not exist. The calldata was
    well formed, passed every check the wallet makes, and reverted on chain with
    the user's gas. Refusing the route stopped the revert but gave up the
    liquidity with it; `protocolRuns` keeps both — one swap command per contiguous
    same-protocol section, which is what `partitionMixedRouteByProtocol` in the
    router-sdk and `universal-router-sdk`'s `uniswap.ts` emit between them.

    The sections are chained through the router: every section but the first is
    paid `CONTRACT_BALANCE` ("whatever you are holding"), and only the last one
    carries a minimum, because an intermediate section's output is an
    intermediate token in an amount nobody knows until the pools answer.
  */
  it('splits a route into contiguous runs of one protocol, and nowhere else', () => {
    const a: Hop = { kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }
    const b: Hop = { kind: 'v3', tokenIn: WETN, tokenOut: USDT, fee: 500 }
    const c: Hop = { kind: 'v2', tokenIn: USDT, tokenOut: USDC }
    expect(protocolRuns([])).toEqual([])
    // One protocol is the one-section case, however many hops it has.
    expect(protocolRuns([a, b]).map((run) => run.length)).toEqual([2])
    expect(protocolRuns([a, b, c]).map((run) => run.map((h) => h.kind))).toEqual([['v3', 'v3'], ['v2']])
    expect(protocolRuns([c, a, b]).map((run) => run.map((h) => h.kind))).toEqual([['v2'], ['v3', 'v3']])
    // Alternating is three sections, not two: runs are contiguous, not grouped.
    expect(protocolRuns([c, a, c]).map((run) => run.map((h) => h.kind))).toEqual([['v2'], ['v3'], ['v2']])
  })

  it('a single-protocol route still encodes as the one command its protocol has', () => {
    const shared = { ...base, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } }
    const v2Hops = encodeSwap({ ...shared, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: WETN }, { kind: 'v2', tokenIn: WETN, tokenOut: USDC }] } })
    expect(v2Hops.commands).toEqual([COMMAND.V2_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const v3Hops = encodeSwap({ ...shared, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v3', tokenIn: WETN, tokenOut: USDC, fee: 500 }] } })
    expect(v3Hops.commands).toEqual([COMMAND.V3_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const [asV2] = decodeUniversalRouter(v2Hops.data)?.commands ?? []
    const [asV3] = decodeUniversalRouter(v3Hops.data)?.commands ?? []
    if (asV2?.type !== 'V2_SWAP_EXACT_IN' || asV3?.type !== 'V3_SWAP_EXACT_IN') throw new Error('unreachable')
    expect(asV2.path.map((t) => t.toLowerCase())).toEqual([BOLT, WETN, USDC].map((t) => t.toLowerCase()))
    expect(asV2.amountIn).toBe(base.amountIn)
    expect(asV2.amountOut).toBe(ROUTER_MIN)
    expect(asV3.path.toLowerCase()).toBe(`0x${BOLT.slice(2)}000bb8${WETN.slice(2)}0001f4${USDC.slice(2)}`.toLowerCase())
    // Both fee fields are tiers that exist; there is no V2 hop in here to mark.
    expect(v3PathFees(asV3.path)).toEqual([3000, 500])
  })

  it('V3 then V2 becomes two swap commands chained through the router', () => {
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } })
    expect(enc.commands).toEqual([COMMAND.V3_SWAP_EXACT_IN, COMMAND.V2_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const [first, second, pay, sweep] = decodeUniversalRouter(enc.data)?.commands ?? []
    if (first?.type !== 'V3_SWAP_EXACT_IN' || second?.type !== 'V2_SWAP_EXACT_IN') throw new Error('unreachable')
    // Section one: the user's money, into the router, with no floor of its own.
    expect(first.recipient).toBe(ROUTER_AS_RECIPIENT)
    expect(first.amountIn).toBe(base.amountIn)
    expect(first.amountOut).toBe(0n)
    expect(first.payerIsUser).toBe(true)
    // The fee field is the real tier. `0x800000` here would be the old bug, and
    // a substring search of the calldata cannot tell it from CONTRACT_BALANCE.
    expect(v3PathFees(first.path)).toEqual([3000])
    // Section two: whatever section one left, and the floor for the whole route.
    expect(second.recipient).toBe(ROUTER_AS_RECIPIENT)
    expect(second.amountIn).toBe(CONTRACT_BALANCE)
    expect(second.amountOut).toBe(ROUTER_MIN)
    expect(second.payerIsUser).toBe(false)
    expect(second.path.map((t) => t.toLowerCase())).toEqual([WETN, USDC].map((t) => t.toLowerCase()))
    expect(pay?.type === 'PAY_PORTION' && pay.token === USDC && pay.recipient === SINK && pay.bips === 50n).toBe(true)
    expect(sweep?.type === 'SWEEP' && sweep.recipient === ME && sweep.amount === deliveredMinimumOut(base.quotedOut, 50, base.slippageBips)).toBe(true)
    expect(enc.minimumOut).toBe(deliveredMinimumOut(base.quotedOut, 50, base.slippageBips))
  })

  it('V2 then V3 is the same shape the other way round', () => {
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: WETN }, { kind: 'v3', tokenIn: WETN, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } })
    expect(enc.commands).toEqual([COMMAND.V2_SWAP_EXACT_IN, COMMAND.V3_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const [first, second] = decodeUniversalRouter(enc.data)?.commands ?? []
    if (first?.type !== 'V2_SWAP_EXACT_IN' || second?.type !== 'V3_SWAP_EXACT_IN') throw new Error('unreachable')
    expect(first.amountIn).toBe(base.amountIn)
    expect(first.amountOut).toBe(0n)
    expect(first.payerIsUser).toBe(true)
    expect(first.recipient).toBe(ROUTER_AS_RECIPIENT)
    expect(second.amountIn).toBe(CONTRACT_BALANCE)
    expect(second.amountOut).toBe(ROUTER_MIN)
    expect(second.payerIsUser).toBe(false)
    expect(v3PathFees(second.path)).toEqual([3000])
  })

  it('adjacent hops of the same protocol collapse into one command, so V2,V3,V3 is two', () => {
    const enc = encodeSwap({
      ...base,
      route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: WETN }, { kind: 'v3', tokenIn: WETN, tokenOut: USDT, fee: 500 }, { kind: 'v3', tokenIn: USDT, tokenOut: USDC, fee: 3000 }] },
      nativeIn: false,
      nativeOut: false,
      fee: { sink: SINK, bips: 50 },
    })
    expect(enc.commands).toEqual([COMMAND.V2_SWAP_EXACT_IN, COMMAND.V3_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const [, second] = decodeUniversalRouter(enc.data)?.commands ?? []
    if (second?.type !== 'V3_SWAP_EXACT_IN') throw new Error('unreachable')
    // The two V3 hops are one packed path, in route order, at their own tiers.
    expect(second.path.toLowerCase()).toBe(`0x${WETN.slice(2)}0001f4${USDT.slice(2)}000bb8${USDC.slice(2)}`.toLowerCase())
    expect(v3PathFees(second.path)).toEqual([500, 3000])
    expect(second.amountIn).toBe(CONTRACT_BALANCE)
  })

  it('a mixed route with native on both ends wraps first and unwraps last', () => {
    const enc = encodeSwap({
      ...base,
      route: { hops: [{ kind: 'v2', tokenIn: WETN, tokenOut: USDC }, { kind: 'v3', tokenIn: USDC, tokenOut: WETN, fee: 3000 }] },
      nativeIn: true,
      nativeOut: true,
      fee: { sink: SINK, bips: 50 },
    })
    expect(enc.commands).toEqual([COMMAND.WRAP_ETH, COMMAND.V2_SWAP_EXACT_IN, COMMAND.V3_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.UNWRAP_WETH])
    expect(enc.value).toBe(base.amountIn)
    const [wrap, first, second, pay, unwrap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(wrap?.type === 'WRAP_ETH' && wrap.recipient === ROUTER_AS_RECIPIENT && wrap.amount === base.amountIn).toBe(true)
    if (first?.type !== 'V2_SWAP_EXACT_IN' || second?.type !== 'V3_SWAP_EXACT_IN') throw new Error('unreachable')
    // The router wrapped the ETN, so it is the payer for the first section too —
    // `payerIsUser && i === 0` is false when WRAP_ETH has already cleared it.
    expect(first.payerIsUser).toBe(false)
    expect(second.payerIsUser).toBe(false)
    expect(first.amountIn).toBe(base.amountIn)
    expect(second.amountIn).toBe(CONTRACT_BALANCE)
    expect(second.amountOut).toBe(ROUTER_MIN)
    expect(v3PathFees(second.path)).toEqual([3000])
    expect(pay?.type === 'PAY_PORTION' && pay.token === WETN).toBe(true)
    expect(unwrap?.type === 'UNWRAP_WETH' && unwrap.recipient === ME).toBe(true)
  })

  /*
    Exact-out is the one direction that still refuses, and deliberately:
    `encodeMixedRouteToPath` upstream is marked "only supports exactIn route
    encodings" and `MixedRouteTrade` is exact-in only. Working backwards through
    chained sections means solving each section's input from the next one's,
    which `CONTRACT_BALANCE` cannot express — there is no "whatever you are
    holding" for an amount you have not acquired yet.
  */
  it('refuses the same route priced by its output, where the chaining has no meaning', () => {
    const hops: Hop[] = [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v2', tokenIn: WETN, tokenOut: USDC }]
    expect(() => encodeSwap({ ...base, route: { hops }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } })).not.toThrow()
    expect(() => encodeSwapExactOut({ ...base, route: { hops }, amountOut: 500_000n, maximumIn: 1_000_000n, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } })).toThrow('mixed route')
    expect(() => encodeSwapExactOut({ ...base, route: { hops: [...hops].reverse() }, amountOut: 500_000n, maximumIn: 1_000_000n, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } })).toThrow('mixed route')
  })
})

describe('mini-router', () => {
  it('asks at most 24 candidates: direct V2, V3 × 4 fees, then hops through the bases', () => {
    const c = candidates(NOT_A_BASE, NOT_A_BASE_2, addresses, { mixed: true })
    expect(MAX_CANDIDATES).toBe(24)
    // Four bases × (V2 via + two mixed + four V3 combinations) + five direct is
    // 33, so this pair is the one that proves the cap is still doing something.
    expect(c.length).toBe(MAX_CANDIDATES)
    expect(c[0]?.kind).toBe('v2')
    expect(c[0]?.route.hops).toHaveLength(1)
    expect(c.slice(1, 5).every((x) => x.kind === 'v3' && x.route.hops.length === 1)).toBe(true)
    expect(c.slice(1, 5).map((x) => x.label)).toEqual(V3_FEES.map((f) => `V3 ${f / 10_000}%`))
    // The direct five lead whether or not mixed is asked for.
    expect(candidates(NOT_A_BASE, NOT_A_BASE_2, addresses).slice(0, 5).map((x) => x.label)).toEqual(c.slice(0, 5).map((x) => x.label))
  })

  /*
    Mixed routes are generated again, and only for exact-in.

    `encodeSwap` partitions a mixed route into one command per contiguous
    same-protocol run, so a route that crosses protocols is executable — which is
    what the guard here was waiting for. `callForExactOut` still has no mixed
    branch and `encodeSwapExactOut` still refuses one, so the other direction must
    not spend candidate slots on a price it could never honour.
  */
  it('offers mixed candidates only when they are asked for and there is a quoter to price them', () => {
    const kinds = (c: readonly Candidate[]): Set<string> => new Set(c.map((x) => x.kind))
    expect(kinds(candidates(BOLT, USDC, addresses, { mixed: true })).has('mixed')).toBe(true)
    // Omitted opts, and an explicit `false`, are the same answer.
    expect(kinds(candidates(BOLT, USDC, addresses)).has('mixed')).toBe(false)
    expect(kinds(candidates(BOLT, USDC, addresses, {})).has('mixed')).toBe(false)
    expect(kinds(candidates(BOLT, USDC, addresses, { mixed: false })).has('mixed')).toBe(false)
    /*
      And testnet, where there is no MixedRouteQuoter deployed at all
      (`packages/chains/src/electroneum.ts`, 5201420). `callFor` would send the
      call to `null` as an address, so asking for mixed there has to be ignored
      rather than obeyed.
    */
    expect(TESTNET_ADDRESSES.mixedRouteQuoter).toBeNull()
    expect(kinds(candidates(BOLT, USDC, TESTNET_ADDRESSES, { mixed: true })).has('mixed')).toBe(false)
  })

  it('ranks the two mixed candidates second in each base, behind the V2 hop and ahead of the fee combinations', () => {
    const c = candidates(BOLT, USDC, addresses, { mixed: true })
    // Two bases here (WETN and USDT), seven candidates each: nothing is trimmed,
    // so the order within a base is the order the generator chose.
    expect(c.length).toBe(19)
    const viaWetn = c.filter((x) => x.route.hops.length > 1 && x.route.hops[0]?.tokenOut.toLowerCase() === WETN.toLowerCase())
    expect(viaWetn.map((x) => x.label)).toEqual(['V2 via', 'V2 → V3 0.3%', 'V3 0.3% → V2', 'V3 0.05% → 0.05%', 'V3 0.05% → 0.3%', 'V3 0.3% → 0.05%', 'V3 0.3% → 0.3%'])
    const mixed = viaWetn.filter((x) => x.kind === 'mixed')
    expect(mixed.map((x) => x.route.hops.map((h) => h.kind))).toEqual([['v2', 'v3'], ['v3', 'v2']])
    // Only the deepest tier in each direction: two candidates per base, not four.
    expect(mixed.flatMap((x) => x.route.hops.map((h) => (h.kind === 'v3' ? h.fee : 0)))).toEqual([0, 3000, 3000, 0])
  })

  /*
    Candidates used to be generated base by base and then sliced to the cap, so
    the first base was quoted in full, the second partially, and the last two
    never at all. A pair whose liquidity sits in the USDT or BOLT pool was
    quoted a worse price than the site, with the wallet calling it the best
    route available.
  */
  it('quotes through every base, not just the first ones in the list', () => {
    const c = candidates(BOLT, USDC, addresses, { mixed: true })
    const viaBases = new Set(c.filter((x) => x.route.hops.length > 1).map((x) => x.route.hops[0]?.tokenOut?.toLowerCase()))
    for (const base of addresses.bases) {
      if (base.toLowerCase() === BOLT.toLowerCase() || base.toLowerCase() === USDC.toLowerCase()) continue
      expect(viaBases.has(base.toLowerCase())).toBe(true)
    }
  })
  it('picks the best output and prefers a single hop within 0.1 %', async () => {
    const best = await bestRoute(BOLT, USDC, 1_000_000n, addresses, async (calls) => quoteAnswers(calls, {}))
    expect(best?.best.candidate.label).toBe('V3 0.3%')
    expect(best?.best.amountOut).toBe(499_600n)
    expect(best?.all[0]?.amountOut).toBe(500_000n)
  })
  it('returns null when nothing quotes', async () => {
    expect(await bestRoute(BOLT, USDC, 1n, addresses, async (calls) => calls.map(() => ({ ok: false })))).toBeNull()
  })

  it('sends a mixed candidate to the MixedRouteQuoter, with the V2 hop marked by the sentinel the quoter reads', async () => {
    const seen: ReadCall[] = []
    await bestRoute(BOLT, USDC, 1_000_000n, addresses, async (calls) => {
      seen.push(...calls)
      return quoteAnswers(calls, {})
    })
    const mixedCalls = seen.filter((c) => c.address === addresses.mixedRouteQuoter)
    // Two per base, two bases.
    expect(mixedCalls).toHaveLength(4)
    expect(new Set(mixedCalls.map((c) => c.functionName))).toEqual(new Set(['quoteExactInput']))
    /*
      `0x800000` belongs in a MixedRouteQuoterV1 path and nowhere else: it is how
      that contract is told "this hop is a V2 pair". The Universal Router has no
      such convention, which is why `encodeSwap` partitions instead of packing —
      the same three bytes in calldata would address a V3 pool at fee tier
      8388608 that nobody has ever deployed.
    */
    // Round-robin, so both bases' `V2 → V3` calls come before either `V3 → V2`.
    expect(mixedCalls.map((c) => v3PathFees(c.args[0] as Hex))).toEqual([
      [V2_FEE_FLAG, 3000],
      [V2_FEE_FLAG, 3000],
      [3000, V2_FEE_FLAG],
      [3000, V2_FEE_FLAG],
    ])
    expect(V2_FEE_FLAG).toBe(0x800000)
  })

  it('lets a mixed route win when it is the best price, which is the whole reason for generating one', async () => {
    const best = await bestRoute(BOLT, USDC, 1_000_000n, addresses, async (calls) => quoteAnswers(calls, { mixed: 900_000n }))
    expect(best?.best.candidate.kind).toBe('mixed')
    expect(best?.best.amountOut).toBe(900_000n)
    expect(['V2 → V3 0.3%', 'V3 0.3% → V2']).toContain(best?.best.candidate.label)
    // And it is encodable, which is what separates this from the old behaviour.
    const hops = best?.best.candidate.route.hops ?? []
    expect(new Set(hops.map((h) => h.kind))).toEqual(new Set(['v2', 'v3']))
    expect(() => encodeSwap({ amountIn: 1_000_000n, quotedOut: 900_000n, slippageBips: 50, wrappedNative: WETN, recipient: ME, deadline: 1_900_000_000n, universalRouter: UR, route: { hops }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 30 } })).not.toThrow()
  })

  it('never offers a mixed candidate to an exact-output quote, because the encoder would refuse the winner', async () => {
    const seen: ReadCall[] = []
    const out = await bestRouteExactOut(BOLT, USDC, 500_000n, addresses, async (calls) => {
      seen.push(...calls)
      return calls.map((call) => (call.functionName === 'getAmountsIn' ? { ok: true as const, value: [600_000n, 500_000n] } : { ok: true as const, value: [610_000n, 0n, 0, 90_000n] }))
    })
    expect(seen.length).toBe(candidates(BOLT, USDC, addresses).length)
    expect(seen.some((c) => c.address === addresses.mixedRouteQuoter)).toBe(false)
    expect(out?.best.candidate.kind).not.toBe('mixed')
  })
})

/*
  One route, one call — what the price-impact probe asks for now.

  It used to re-run the whole candidate set at a thousandth of the trade, which
  is a second `eth_call` of sixteen simulated swaps to produce one number to
  divide into another. `quoteOne` prices the route that already won, and it can
  never be the reason a quote fails: a reader that rejects is `null`, not a
  throw, because the probe only decorates a quote that is otherwise complete.
*/
describe('quoteOne', () => {
  const v2Candidate: Candidate = { kind: 'v2', label: 'V2', route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: USDC }] } }
  const v3Candidate: Candidate = { kind: 'v3', label: 'V3 0.3%', route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: USDC, fee: 3000 }] } }
  const mixedCandidate: Candidate = { kind: 'mixed', label: 'V2 → V3 0.3%', route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: WETN }, { kind: 'v3', tokenIn: WETN, tokenOut: USDC, fee: 3000 }] } }

  it('asks Router02 for a V2 route and reads the last amount along the path', async () => {
    const seen: ReadCall[] = []
    const q = await quoteOne(v2Candidate, 1_000n, addresses, async (calls) => {
      seen.push(...calls)
      return [{ ok: true, value: [1_000n, 490n] }]
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.address).toBe(addresses.v2Router02)
    expect(seen[0]?.functionName).toBe('getAmountsOut')
    expect(seen[0]?.args[0]).toBe(1_000n)
    expect(q?.amountOut).toBe(490n)
    expect(q?.candidate).toBe(v2Candidate)
    expect(q?.gasEstimate).toBe(120_000n)
  })

  it('asks QuoterV2 for a single V3 hop and keeps the quoter’s own gas figure', async () => {
    const seen: ReadCall[] = []
    const q = await quoteOne(v3Candidate, 1_000n, addresses, async (calls) => {
      seen.push(...calls)
      return [{ ok: true, value: [512n, 0n, 0, 77_000n] }]
    })
    expect(seen[0]?.address).toBe(addresses.quoterV2)
    expect(seen[0]?.functionName).toBe('quoteExactInputSingle')
    expect(q?.amountOut).toBe(512n)
    expect(q?.gasEstimate).toBe(77_000n)
  })

  it('asks the MixedRouteQuoter for a mixed route', async () => {
    const seen: ReadCall[] = []
    const q = await quoteOne(mixedCandidate, 1_000n, addresses, async (calls) => {
      seen.push(...calls)
      return [{ ok: true, value: [700n, [], [], 210_000n] }]
    })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.address).toBe(addresses.mixedRouteQuoter)
    expect(seen[0]?.functionName).toBe('quoteExactInput')
    expect(v3PathFees(seen[0]?.args[0] as Hex)).toEqual([V2_FEE_FLAG, 3000])
    expect(q?.amountOut).toBe(700n)
    expect(q?.gasEstimate).toBe(210_000n)
  })

  it('answers null rather than throwing, whichever way the read failed', async () => {
    expect(await quoteOne(v3Candidate, 1_000n, addresses, async () => [{ ok: false }])).toBeNull()
    // A reverting quote inside a successful multicall, and a reader that rejects
    // outright, are both "no answer" — the probe must not take the quote down.
    await expect(quoteOne(v3Candidate, 1_000n, addresses, () => Promise.reject(new Error('rpc down')))).resolves.toBeNull()
    // An empty batch back from the reader is the third shape of the same thing.
    expect(await quoteOne(v3Candidate, 1_000n, addresses, async () => [])).toBeNull()
    // A quote of zero is not a price.
    expect(await quoteOne(v2Candidate, 1_000n, addresses, async () => [{ ok: true, value: [1_000n, 0n] }])).toBeNull()
  })
})

/*
  The five direct pools, priced on chain, as a check on somebody else's answer.

  The routing service prices from a pool list (`GET /api/pools/3`) rather than
  from the chain, so a pool missing from that list is invisible to it at every
  size — on 2026-09-11 the list held eleven V3 pools and named only the 0.3%
  WETN/BOLT pool, while the 0.05% pool beside it paid 2.64% more on a 3 ETN
  swap. A fee tier either has a pool or reverts, so the chain cannot have that
  blind spot. `bestDirect` is the narrowest question that closes it: one call,
  five single-hop candidates, at the real size.
*/
describe('bestDirect', () => {
  /** Every direct pool answers; `tiers` says what each V3 tier pays, `v2` the pair. */
  const pools = (tiers: Partial<Record<number, bigint>>, v2: bigint | null) =>
    async (calls: readonly ReadCall[]): Promise<ReadResult[]> =>
      calls.map((call) => {
        if (call.functionName === 'getAmountsOut') return v2 === null ? { ok: false } : { ok: true, value: [1_000_000n, v2] }
        const fee = (call.args[0] as { fee: number }).fee
        const out = tiers[fee]
        return out === undefined ? { ok: false } : { ok: true, value: [out, 0n, 0, 90_000n] }
      })

  it('quotes the five direct candidates at the real size, and no multi-hop one', async () => {
    const seen: ReadCall[] = []
    await bestDirect(BOLT, USDC, 1_000_000n, addresses, async (calls) => {
      seen.push(...calls)
      return pools({ 3000: 500_000n }, 490_000n)(calls)
    })
    // One batch of five: the V2 pair and the four V3 tiers.
    expect(seen).toHaveLength(5)
    // `quoteExactInput` is the packed-path call, which only a multi-hop route makes.
    expect(seen.map((c) => c.functionName)).toEqual(['getAmountsOut', 'quoteExactInputSingle', 'quoteExactInputSingle', 'quoteExactInputSingle', 'quoteExactInputSingle'])
    expect(seen.some((c) => c.functionName === 'quoteExactInput')).toBe(false)
    expect(seen.some((c) => c.address === addresses.mixedRouteQuoter)).toBe(false)
    expect((seen[0]?.args[1] as readonly Hex[]).map((t) => t.toLowerCase())).toEqual([BOLT, USDC].map((t) => t.toLowerCase()))
    expect(seen.slice(1).map((c) => (c.args[0] as { fee: number }).fee)).toEqual([...V3_FEES])
    // The full amount, not the thousandth the impact probe uses.
    expect(seen[0]?.args[0]).toBe(1_000_000n)
    expect(seen.slice(1).every((c) => (c.args[0] as { amountIn: bigint }).amountIn === 1_000_000n)).toBe(true)
  })

  it('takes the deepest tier that answers, which is the pool the service could not see', async () => {
    // The shape of the real finding: the service's list names only 0.3%, and the
    // 0.05% pool beside it pays more.
    const best = await bestDirect(BOLT, USDC, 1_000_000n, addresses, pools({ 500: 1_332_394n, 3000: 1_297_115n }, 1_000_000n))
    expect(best?.candidate.label).toBe('V3 0.05%')
    expect(best?.amountOut).toBe(1_332_394n)
    expect(best?.candidate.route.hops).toHaveLength(1)
    // No single-hop preference to apply here — every candidate is a single hop,
    // so the largest output simply wins, V2 included.
    const v2Wins = await bestDirect(BOLT, USDC, 1_000_000n, addresses, pools({ 500: 900n, 3000: 800n }, 1_000n))
    expect(v2Wins?.candidate.label).toBe('V2')
    expect(v2Wins?.amountOut).toBe(1_000n)
  })

  it('says null when no direct pool answers, and null rather than throwing when the reader does not', async () => {
    expect(await bestDirect(BOLT, USDC, 1_000_000n, addresses, pools({}, null))).toBeNull()
    // A pool that quotes zero is not a pool that quoted.
    expect(await bestDirect(BOLT, USDC, 1_000_000n, addresses, pools({ 3000: 0n }, null))).toBeNull()
    /*
      A rejecting reader must be `null`, not a throw: this runs on the path where
      the routing service already answered, and an RPC that is down must cost the
      wallet its cross-check, never the quote.
    */
    await expect(bestDirect(BOLT, USDC, 1_000_000n, addresses, () => Promise.reject(new Error('rpc down')))).resolves.toBeNull()
    expect(await bestDirect(BOLT, USDC, 1_000_000n, addresses, async () => [])).toBeNull()
  })
})

describe('permit2', () => {
  it('builds the PermitSingle typed data with exact amount and a 30-minute deadline', () => {
    const td = permitSingleTypedData({ chainId: 52014, permit2: A.permit2 as Hex, token: BOLT, amount: 5n, nonce: 2, spender: UR, nowSeconds: 1_000 })
    expect(td.domain).toEqual({ name: 'Permit2', chainId: 52014, verifyingContract: A.permit2 })
    expect(td.message).toEqual({ details: { token: BOLT, amount: '5', expiration: '2800', nonce: '2' }, spender: UR, sigDeadline: '2800' })
    expect(permitCovers({ amount: 10n, expiration: 5_000, nonce: 2 }, 5n, 1_000)).toBe(true)
    expect(permitCovers({ amount: 10n, expiration: 1_010, nonce: 2 }, 5n, 1_000)).toBe(false)
  })
})

/*
  The hand-written ABI must match the contract ElectroSwap actually deployed.

  `FOT_DETECTOR_ABI` declared five return fields — the shape of a later Uniswap
  FeeOnTransferDetector — while the deployed contract returns
  `TokenFees{buyFeeBps, sellFeeBps}` and nothing more. Every decode of a
  two-word return against a five-field tuple failed, so the probe never once
  succeeded: `detectTax` returned null, the wallet read that as "no tax", and
  the three phantom fields were permanently `undefined`. The synced artifact
  had it right the whole time, so pin the two together.
*/
describe('the fee-on-transfer probe reports what it knows', () => {
  const DETECTOR = '0x34dc8af1FFe9F71aB8B37F9Ea79c567ab64140b3' as Hex

  it('measures a tax when the detector answers', async () => {
    const read = async () => [{ ok: true as const, value: { buyFeeBps: 300n, sellFeeBps: 100n } }]
    expect(await detectTax(DETECTOR, BOLT, WETN, read)).toEqual({ buyFeeBps: 300, sellFeeBps: 100 })
  })

  it('says "unavailable" when the call fails, and "null" when there is no detector', async () => {
    const failed = async () => [{ ok: false as const }]
    expect(await detectTax(DETECTOR, BOLT, WETN, failed)).toBe('unavailable')
    // No detector on this chain is a different fact, and not one to report.
    expect(await detectTax(null, BOLT, WETN, failed)).toBeNull()
  })

  /*
    An unmeasurable probe is not evidence of a tax. It briefly refused the swap
    outright, which broke ETN→BOLT for everyone: the detector reverts
    `PairLookupFailed` for any token with no V2 pair against the base, and the
    minimum received is enforced on chain whether or not the probe answered.
  */
  it('contributes no slippage when it could not answer', async () => {
    expect(taxSlippageBips('unavailable', 'unavailable')).toBe(0)
    expect(taxSlippageBips('unavailable', { buyFeeBps: 250, sellFeeBps: 0 })).toBe(250)
  })
})

describe('the fee-on-transfer ABI matches the deployed detector', () => {
  it('declares exactly the outputs the synced artifact does', () => {
    const synced = (FOT_ARTIFACT as { abi?: unknown[] }).abi ?? (FOT_ARTIFACT as unknown as unknown[])
    const fromArtifact = (synced as Array<{ name?: string; outputs?: Array<{ components?: Array<{ name: string; type: string }> }> }>).find((e) => e.name === 'validate')
    const expected = (fromArtifact?.outputs?.[0]?.components ?? []).map((c) => `${c.type} ${c.name}`)
    const ours = FOT_DETECTOR_ABI.find((e) => e.type === 'function' && e.name === 'validate')
    const mine = ((ours as { outputs?: ReadonlyArray<{ components?: ReadonlyArray<{ name?: string; type: string }> }> } | undefined)?.outputs?.[0]?.components ?? []).map((c) => `${c.type} ${c.name ?? ''}`)
    expect(expected.length).toBeGreaterThan(0)
    expect(mine).toEqual(expected)
  })
})

describe('taxes and limit orders', () => {
  it('folds both sides of a tax into slippage', () => {
    expect(taxSlippageBips({ buyFeeBps: 100, sellFeeBps: 200 }, { buyFeeBps: 300, sellFeeBps: 0 })).toBe(500)
  })
  it('encodes submit and close for the limit-order manager', () => {
    const data = encodeSubmitOrder({ tokenIn: BOLT, tokenOut: USDC, unwrapOutput: false, amountInExact: 10n, amountOutMin: 9n, recipient: ME, durationSeconds: 86_400n })
    expect(data.startsWith('0x')).toBe(true)
    expect(encodeCloseOrder(7n).length).toBe(74)
  })
})
