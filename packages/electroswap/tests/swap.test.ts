import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import FOT_ARTIFACT from '../abis/FeeOnTransferDetector.json'
import FOT_V2_ARTIFACT from '../abis/FeeOnTransferDetectorV2.json'
import { assess, decodeCalldata, decodeUniversalRouter, emptyContext } from '@boltvault/security'
import { keccak256, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { FOT_DETECTOR_ABI } from '../src/swap/abis'
import { custodyIsUnsafe, detectTax, sellsAreRefused, type TokenTax } from '../src/swap/fot'
import { bestRoute, bestRouteExactOut, candidates, deliveredMinimumOut, encodeSwap, encodeSwapExactOut, feeAmount, minimumOut, permitCovers, permitSingleTypedData, protocolRuns, quoteOne, tierFor, DYNO_WEIGHT_ONE, FALLBACK_SCHEDULE, MAX_CANDIDATES, taxSlippageBips, encodeSubmitOrder, encodeCloseOrder, COMMAND, CONTRACT_BALANCE, ROUTER_AS_RECIPIENT, V2_FEE_FLAG, V3_FEES, type Candidate, type EncodeSwapInput, type Hop, type QuoteAddresses, type ReadCall, type ReadResult } from '../src/swap'

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

  /*
    The bytes of an ordinary swap, pinned.

    The fee moving to the input side is a new branch, and the one thing it must
    not do is change a swap that does not take it. These digests were recorded
    from the encoder as it stood before `feeOnInput` existed (4d1bc73), across
    every shape the cases above cover; a mismatch means a normal swap's calldata
    moved, whatever else still passes.
  */
  it('leaves the calldata of every swap that does not take its fee on the input byte for byte as it was', () => {
    const permit = { token: BOLT, amount: 1_000_000n, expiration: 1_900_001_800, nonce: 3, spender: UR, sigDeadline: 1_900_001_800n, signature: `0x${'ab'.repeat(65)}` as Hex }
    const shapes: ReadonlyArray<readonly [string, EncodeSwapInput, Hex]> = [
      [
        'token → token, fee on the output',
        { ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 30 } },
        '0x7011dd120dc2a9e8dbc84193f5602dfe71c331f2cd20f10713c79643abd4692e',
      ],
      ['native in', { ...base, route: { hops: [{ kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: true, nativeOut: false, fee: { sink: SINK, bips: 50 } }, '0xfca772d70c0d9c6d2342dec465678e611b8332c897d6e4df16dbb49d51bf7487'],
      ['native out', { ...base, route: { hops: [{ kind: 'v3', tokenIn: USDC, tokenOut: WETN, fee: 500 }] }, nativeIn: false, nativeOut: true, fee: { sink: SINK, bips: 50 } }, '0xfa8842dac7cb2f5d6f14a470180b6785e01f5c4f26113ab0a1b0dd185d204ac3'],
      ['a zero-bips tier', { ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: null }, '0xdd17a9dbab42d86188fa3cb4bfe45a8c5c3c8ec73b0fb3a0a3b806c0fe4e494e'],
      [
        'a permit and two V3 hops',
        { ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v3', tokenIn: WETN, tokenOut: USDC, fee: 500 }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 }, permit },
        '0xe805330372649d22071df9eee1e98cd644b5dcd9b6938d07f8e172cd289f5984',
      ],
      [
        'V3 then V2',
        { ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } },
        '0x44a9e553d4956a60b9d7f081ab5430125bec1422ca4ffc7ee61e1fd3ac3cabd9',
      ],
      [
        'V2 then V3, native on both ends',
        { ...base, route: { hops: [{ kind: 'v2', tokenIn: WETN, tokenOut: USDC }, { kind: 'v3', tokenIn: USDC, tokenOut: WETN, fee: 3000 }] }, nativeIn: true, nativeOut: true, fee: { sink: SINK, bips: 50 } },
        '0x3098334cc01c3325e1faea1739d28c4fbe9166226695d3663ce561d730f7e6a9',
      ],
      [
        'V2, V3, V3',
        { ...base, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: WETN }, { kind: 'v3', tokenIn: WETN, tokenOut: USDT, fee: 500 }, { kind: 'v3', tokenIn: USDT, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } },
        '0xdb543c258dc9090c70fd7d8a49b5fb3aca1331e901252cf04260f6a38e5f50a6',
      ],
    ]
    for (const [name, input, digest] of shapes) {
      expect(keccak256(encodeSwap(input).data), name).toBe(digest)
      // An explicit `false` is the same instruction as saying nothing at all.
      expect(keccak256(encodeSwap({ ...input, feeOnInput: false }).data), name).toBe(digest)
    }
  })
})

/*
  The wallet fee, taken out of what the user spends.

  `PAY_PORTION` needs the router to custody the output, and the hop from the
  router's custody to the user is one more transfer. `Payments.sol:83-85`
  compares `balanceOf(address(this))` — the ROUTER's balance — against the
  minimum and only then sends it on, so for a token that charges on transfer
  that last cut is taken after the only on-chain assertion has already passed:
  the minimum received on the screen was not the amount guaranteed.

  Paying the sink out of the input first means the router never holds the
  output at all. The swap delivers straight to the user, and the floor becomes
  `V2SwapRouter.sol:69-73`'s `balanceOf(recipient)` delta — a real
  delivered-amount assertion, with no extra hop left for a tax to apply to.
*/
describe('the wallet fee taken out of the input', () => {
  const ONE = 10n ** 18n
  /** One whole token in, half a token out, 0.50 % slippage, a 30-bips tier. */
  const base18 = { amountIn: ONE, quotedOut: ONE / 2n, slippageBips: 50, wrappedNative: WETN, recipient: ME, deadline: 1_900_000_000n, universalRouter: UR, fee: { sink: SINK, bips: 30 } }
  /** The quote less 0.50 % slippage: the floor the router enforces, before any fee. */
  const ROUTER_MIN = 497_500_000_000_000_000n
  /** 30 bips of the whole input — the fee, denominated in the token being spent. */
  const INPUT_FEE = 3_000_000_000_000_000n

  it('is not taken from the input unless it is asked for: the output-side plan is untouched', () => {
    const enc = encodeSwap({ ...base18, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: USDC }] }, nativeIn: false, nativeOut: false })
    expect(enc.commands).toEqual([COMMAND.V2_SWAP_EXACT_IN, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const [swap, pay, sweep] = decodeUniversalRouter(enc.data)?.commands ?? []
    if (swap?.type !== 'V2_SWAP_EXACT_IN') throw new Error('unreachable')
    // The whole input is swapped, into the router, which then owes the user a transfer.
    expect(swap.recipient).toBe(ROUTER_AS_RECIPIENT)
    expect(swap.amountIn).toBe(ONE)
    expect(swap.amountOut).toBe(ROUTER_MIN)
    expect(swap.payerIsUser).toBe(true)
    expect(pay?.type === 'PAY_PORTION' && pay.recipient === SINK && pay.bips === 30n).toBe(true)
    // And the floor the user is given is the one the fee has already come out of.
    expect(sweep?.type === 'SWEEP' && sweep.amount === 496_007_500_000_000_000n).toBe(true)
    expect(enc.minimumOut).toBe(496_007_500_000_000_000n)
  })

  it('pays the sink from the user’s Permit2 allowance and has the swap deliver straight to them', () => {
    const enc = encodeSwap({ ...base18, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: USDC }] }, nativeIn: false, nativeOut: false, feeOnInput: true })
    // No PAY_PORTION and no SWEEP: with nothing to take a portion of and nothing
    // to unwrap, the router has no reason to custody the output.
    expect(enc.commands).toEqual([COMMAND.PERMIT2_TRANSFER_FROM, COMMAND.V2_SWAP_EXACT_IN])
    expect(enc.value).toBe(0n)
    const [paid, swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    if (paid?.type !== 'PERMIT2_TRANSFER_FROM' || swap?.type !== 'V2_SWAP_EXACT_IN') throw new Error('unreachable')
    // The fee is in the token being spent — the route's first input, not the wrapped native.
    expect(paid.token.toLowerCase()).toBe(BOLT.toLowerCase())
    expect(paid.recipient).toBe(SINK)
    expect(paid.amount).toBe(INPUT_FEE)
    expect(paid.amount).toBe(feeAmount(ONE, 30))
    // What is left is what is swapped: nothing is stranded in the router.
    expect(swap.amountIn).toBe(ONE - INPUT_FEE)
    expect(swap.amountIn).toBe(997_000_000_000_000_000n)
    expect(paid.amount + swap.amountIn).toBe(ONE)
    // Straight to the user, and the user still pays for the swap itself.
    expect(swap.recipient).toBe(ME)
    expect(swap.payerIsUser).toBe(true)
    /*
      The floor is a floor under the trade that is actually made.

      Nothing is deducted from it for the fee — the fee never touched the output
      — but only 99.7 % of the input reaches the pools, so the quote is scaled by
      the same proportion before slippage comes off it. Left unscaled it would be
      a floor under a larger trade than the one being made: at this 30-bips tier
      and 50 bips of slippage the margin collapses to about two basis points, and
      an ordinary movement between quoting and mining reverts a swap that was
      never bad.

      Scaling and deducting arrive at the same number, which is the point — the
      user is promised exactly what the output-side plan promised them, and the
      whole of their slippage is still theirs.
    */
    expect(swap.amountOut).toBe(496_007_500_000_000_000n)
    expect(enc.minimumOut).toBe(496_007_500_000_000_000n)
    expect(enc.minimumOut).toBe(deliveredMinimumOut(base18.quotedOut, 30, base18.slippageBips))
    expect(enc.minimumOut).toBeLessThan(ROUTER_MIN)
  })

  it('pays the sink out of the router’s own balance when the input was just wrapped for it', () => {
    const enc = encodeSwap({ ...base18, route: { hops: [{ kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: true, nativeOut: false, feeOnInput: true })
    // There is no Permit2 allowance to pull ETN from; the wrap put WETN in the router.
    expect(enc.commands).toEqual([COMMAND.WRAP_ETH, COMMAND.TRANSFER, COMMAND.V2_SWAP_EXACT_IN])
    // The whole amount is still wrapped: the fee is paid out of it, not on top of it.
    expect(enc.value).toBe(ONE)
    const [wrap, paid, swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(wrap?.type === 'WRAP_ETH' && wrap.recipient === ROUTER_AS_RECIPIENT && wrap.amount === ONE).toBe(true)
    if (paid?.type !== 'TRANSFER' || swap?.type !== 'V2_SWAP_EXACT_IN') throw new Error('unreachable')
    expect(paid.token.toLowerCase()).toBe(WETN.toLowerCase())
    expect(paid.recipient).toBe(SINK)
    expect(paid.amount).toBe(INPUT_FEE)
    expect(swap.recipient).toBe(ME)
    expect(swap.amountIn).toBe(ONE - INPUT_FEE)
    // The router wrapped it, so the router pays for the swap.
    expect(swap.payerIsUser).toBe(false)
  })

  it('keeps the output in the router for a native output, which has to be unwrapped before it can be paid', () => {
    const enc = encodeSwap({ ...base18, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: WETN }] }, nativeIn: false, nativeOut: true, feeOnInput: true })
    expect(enc.commands).toEqual([COMMAND.PERMIT2_TRANSFER_FROM, COMMAND.V2_SWAP_EXACT_IN, COMMAND.UNWRAP_WETH])
    const [paid, swap, unwrap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(paid?.type === 'PERMIT2_TRANSFER_FROM' && paid.recipient === SINK && paid.amount === INPUT_FEE).toBe(true)
    if (swap?.type !== 'V2_SWAP_EXACT_IN') throw new Error('unreachable')
    expect(swap.recipient).toBe(ROUTER_AS_RECIPIENT)
    expect(swap.amountIn).toBe(ONE - INPUT_FEE)
    // ETN cannot be a swap's recipient, so the floor moves to the UNWRAP that pays
    // it — scaled to the amount actually swapped, with no fee deducted from it.
    expect(unwrap?.type === 'UNWRAP_WETH' && unwrap.recipient === ME && unwrap.amount === 496_007_500_000_000_000n).toBe(true)
    expect(enc.minimumOut).toBe(496_007_500_000_000_000n)
  })

  /*
    A zero-bips tier has no fee to move. `PAY_PORTION` reverts on zero bips, so
    the fee is `null` rather than 0 — and a transfer of nothing to the sink
    would be the same mistake in the other direction: a command that costs gas,
    says the user is paying a fee, and pays none.
  */
  it('does nothing at all when the tier charges nothing', () => {
    const route = { hops: [{ kind: 'v2' as const, tokenIn: BOLT, tokenOut: USDC }] }
    const free = encodeSwap({ ...base18, route, nativeIn: false, nativeOut: false, fee: null })
    const asked = encodeSwap({ ...base18, route, nativeIn: false, nativeOut: false, fee: null, feeOnInput: true })
    expect(asked.commands).toEqual([COMMAND.V2_SWAP_EXACT_IN])
    expect(asked.data).toBe(free.data)
    expect(asked.minimumOut).toBe(free.minimumOut)
    const [swap] = decodeUniversalRouter(asked.data)?.commands ?? []
    expect(swap?.type === 'V2_SWAP_EXACT_IN' && swap.amountIn === ONE && swap.recipient === ME).toBe(true)
  })

  /*
    What the firewall will be handed, from the encoder that will hand it over.

    `feeSinkRules` asserts the input-side fee against a `PERMIT2_TRANSFER_FROM`
    or `TRANSFER` of an exact amount to the pinned sink; those bytes are
    rebuilt by hand in the security package's own tests, which cannot import
    this one. This is the pair being checked against each other for real.
  */
  it('produces bytes the firewall’s fee assertion accepts', () => {
    const enc = encodeSwap({ ...base18, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: USDC }] }, nativeIn: false, nativeOut: false, feeOnInput: true })
    const request = { kind: 'transaction' as const, tx: { from: ME, to: enc.to, data: enc.data, value: enc.value, chainId: 52014 } }
    const ok = assess({ origin: 'internal:swap', chainId: 52014, account: ME, request, context: emptyContext({ expectedFee: { sink: SINK, bips: 30, onInput: { token: BOLT, amount: INPUT_FEE } } }) })
    expect(ok.rules.map((r) => r.code)).not.toContain('FEE_SINK_MISMATCH')
    expect(ok.rules.map((r) => r.code)).not.toContain('FEE_TIER_MISMATCH')
    expect(ok.presentation.blocked).toBe(false)
    // And the same bytes with the fee still expected on the output are refused,
    // which is what makes the assertion above worth anything.
    const stale = assess({ origin: 'internal:swap', chainId: 52014, account: ME, request, context: emptyContext({ expectedFee: { sink: SINK, bips: 30 } }) })
    expect(stale.rules.map((r) => r.code)).toContain('FEE_SINK_MISMATCH')
    expect(stale.presentation.blocked).toBe(true)
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

  `FOT_DETECTOR_ABI` once declared five return fields against a detector that
  returned two, so every decode failed, `detectTax` returned null, and the wallet
  read null as "no tax" — for tokens whose entire trick is charging on transfer.
  The lesson was not "count the fields more carefully", it was that a
  hand-written ABI needs something to be wrong against. The artifacts are synced
  from the compiled contract and pinned here.
*/
/** A measured tax, with the flags defaulted, so a case says only what it is about. */
const tax = (over: Partial<TokenTax>): TokenTax => ({ buyFeeBps: 0, sellFeeBps: 0, sellReverted: false, externalTransferFailed: false, feeTakenOnTransfer: false, ...over })

describe('the fee-on-transfer probe reports what it knows', () => {
  const DETECTOR = '0x0704B84d3D20E5dF67169649f216C368185EE841' as Hex
  const answer = (report: Record<string, unknown>) => async () => [{ ok: true as const, value: { status: 0, sellReverted: false, externalTransferFailed: false, feeTakenOnTransfer: false, ...report } }]

  it('measures a tax when the detector answers', async () => {
    expect(await detectTax(DETECTOR, BOLT, WETN, answer({ buyFeeBps: 300n, sellFeeBps: 100n }))).toEqual({
      buyFeeBps: 300,
      sellFeeBps: 100,
      sellReverted: false,
      externalTransferFailed: false,
      feeTakenOnTransfer: false,
    })
  })

  it('says "unavailable" when the call fails, and "null" when there is no detector', async () => {
    const failed = async () => [{ ok: false as const }]
    expect(await detectTax(DETECTOR, BOLT, WETN, failed)).toBe('unavailable')
    // No detector on this chain is a different fact, and not one to report.
    expect(await detectTax(null, BOLT, WETN, failed)).toBeNull()
  })

  /*
    The zeros that come back with a status are not a measurement.

    `NoPair`, `PairTooThin` and `ProbeReverted` are ordinary return values, not
    reverts, so the call succeeds and the fees are zero. Reading those zeros is
    the exact mistake the three-state type exists to prevent — and it is the one
    the interface makes today, where one unpaired token in a batch reports 0% tax
    for every token in it.
  */
  it('refuses to read an unmeasured probe as an untaxed token', async () => {
    for (const status of [1, 2, 3]) {
      expect(await detectTax(DETECTOR, BOLT, WETN, answer({ status, buyFeeBps: 0n, sellFeeBps: 0n }))).toBe('unavailable')
    }
  })

  /*
    A token nobody can sell is not a token with a large fee.

    The detector this replaced caught the failing sell and reported
    `sellFeeBps = buyFeeBps`, so a honeypot came back looking like an ordinary
    3% token. The flag is the whole difference between quoting it and refusing
    it.
  */
  it('carries the honeypot flag rather than a plausible number', async () => {
    const probe = await detectTax(DETECTOR, BOLT, WETN, answer({ buyFeeBps: 300n, sellFeeBps: 10_000n, sellReverted: true }))
    expect(sellsAreRefused(probe)).toBe(true)
    expect(sellsAreRefused('unavailable')).toBe(false)
    expect(sellsAreRefused(null)).toBe(false)
  })

  /*
    Any measured fee is enough, and a refusal is enough on its own.

    `feeTakenOnTransfer` is measured by moving an eighth of a thousand-wei probe
    and looking for a shortfall, so a small percentage of a small number
    truncates to nothing and the flag reads false for tokens that do charge. PDY
    settles it live: `feeTakenOnTransfer: false`, `externalTransferFailed: true`,
    because the transfer never survived to be measured — and PDY is precisely
    the token whose swap reverts when the router custodies the output.
  */
  it('treats any measured fee, or a refused transfer, as a reason not to custody', async () => {
    expect(custodyIsUnsafe(await detectTax(DETECTOR, BOLT, WETN, answer({ buyFeeBps: 400n, sellFeeBps: 396n, externalTransferFailed: true })))).toBe(true)
    expect(custodyIsUnsafe(await detectTax(DETECTOR, BOLT, WETN, answer({ buyFeeBps: 150n, sellFeeBps: 720n })))).toBe(true)
    expect(custodyIsUnsafe(await detectTax(DETECTOR, BOLT, WETN, answer({ buyFeeBps: 0n, sellFeeBps: 400n })))).toBe(true)
    // A token that refuses an ordinary address breaks the custody path whether or not it charges.
    expect(custodyIsUnsafe(await detectTax(DETECTOR, BOLT, WETN, answer({ buyFeeBps: 0n, sellFeeBps: 0n, externalTransferFailed: true })))).toBe(true)
    // An ordinary token keeps the shape it has always had.
    expect(custodyIsUnsafe(await detectTax(DETECTOR, BOLT, WETN, answer({ buyFeeBps: 0n, sellFeeBps: 0n })))).toBe(false)
    // And a probe that could not answer is not evidence of anything.
    expect(custodyIsUnsafe('unavailable')).toBe(false)
    expect(custodyIsUnsafe(null)).toBe(false)
  })

  /*
    An unmeasurable probe is not evidence of a tax. It briefly refused the swap
    outright, which broke ETN→BOLT for everyone: the detector reverts
    `PairLookupFailed` for any token with no V2 pair against the base, and the
    minimum received is enforced on chain whether or not the probe answered.
  */
  it('contributes no slippage when it could not answer', async () => {
    expect(taxSlippageBips('unavailable', 'unavailable')).toBe(0)
    expect(taxSlippageBips('unavailable', tax({ buyFeeBps: 250 }))).toBe(250)
  })
})

describe('the fee-on-transfer ABI matches the deployed detector', () => {
  const components = (abi: unknown, fn: string): string[] => {
    const entry = (abi as Array<{ name?: string; outputs?: Array<{ components?: Array<{ name?: string; type: string }> }> }>).find((e) => e.name === fn)
    return (entry?.outputs?.[0]?.components ?? []).map((c) => `${c.type} ${c.name ?? ''}`)
  }

  it('declares exactly the outputs the synced artifacts do', () => {
    // The legacy surface, unchanged, so an old caller can be re-pointed by address alone.
    expect(components(FOT_ARTIFACT, 'validate').length).toBeGreaterThan(0)
    expect(components(FOT_DETECTOR_ABI, 'validate')).toEqual(components(FOT_ARTIFACT, 'validate'))
    // And the one the wallet actually uses.
    expect(components(FOT_V2_ARTIFACT, 'inspect').length).toBeGreaterThan(0)
    expect(components(FOT_DETECTOR_ABI, 'inspect')).toEqual(components(FOT_V2_ARTIFACT, 'inspect'))
  })
})

describe('taxes and limit orders', () => {
  it('folds both sides of a tax into slippage', () => {
    expect(taxSlippageBips(tax({ buyFeeBps: 100, sellFeeBps: 200 }), tax({ buyFeeBps: 300 }))).toBe(500)
  })
  it('encodes submit and close for the limit-order manager', () => {
    const data = encodeSubmitOrder({ tokenIn: BOLT, tokenOut: USDC, unwrapOutput: false, amountInExact: 10n, amountOutMin: 9n, recipient: ME, durationSeconds: 86_400n })
    expect(data.startsWith('0x')).toBe(true)
    expect(encodeCloseOrder(7n).length).toBe(74)
  })
})
