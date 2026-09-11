/**
 * Swapping by exact output (§8.6, "exact-out is a power toggle").
 *
 * Two things invert when the trade is priced from its other end, and both are
 * the sort of inversion that is silently wrong rather than loudly wrong:
 *
 *  - slippage guards the INPUT, as `amountInMaximum`, not the output;
 *  - the wallet fee has to come off the top, or `PAY_PORTION` eats into the
 *    exact amount the user asked for and the mode breaks its only promise.
 *
 * And V3 walks an exact-output path backwards, so the packed bytes run
 * output → input. A forward path there does not revert; it prices a different
 * trade.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { decodeUniversalRouter } from '@boltvault/security'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  BIPS,
  COMMAND,
  ROUTER_AS_RECIPIENT,
  bestRouteExactOut,
  encodeSwapExactOut,
  feeAmount,
  grossOutForExactOut,
  maximumIn,
  v3PackedPathExactOut,
  type QuoteAddresses,
  type ReadResult,
} from '../src/swap'

const A = ELECTRONEUM_ADDRESSES[52014]
const UR = A.universalRouter as Hex
const WETN = A.wetn as Hex
const USDC = A.usdc as Hex
const BOLT = A.bolt as Hex
const SINK = '0x00000000000000000000000000000000000051ab' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex
const addresses: QuoteAddresses = { quoterV2: A.quoterV2 as Hex, mixedRouteQuoter: A.mixedRouteQuoter as Hex, v2Router02: A.v2Router02 as Hex, bases: [WETN, USDC, A.usdt as Hex, BOLT] }

/** 100 USDC, the headline case: the user needs exactly this much. */
const EXACT = 100_000_000n

describe('the fee comes off the top, so the exact amount survives it', () => {
  it('grosses the order up by exactly enough, rounding the user’s way', () => {
    // 0.50 %: buy 100.502513 so that 0.502512 goes to the sink and 100.000001 is left.
    const gross = grossOutForExactOut(EXACT, 50)
    expect(gross).toBe(100_502_513n)
    expect(feeAmount(gross, 50)).toBe(502_512n)
    expect(gross - feeAmount(gross, 50)).toBeGreaterThanOrEqual(EXACT)
    // A zero-bips tier pays nothing, so there is nothing to gross up.
    expect(grossOutForExactOut(EXACT, 0)).toBe(EXACT)
  })

  it('never leaves the user a wei short, at any tier or any size', () => {
    for (const bips of [10, 20, 30, 40, 50]) {
      for (const exact of [1n, 7n, 999n, 1_000_001n, EXACT, 10n ** 24n]) {
        const gross = grossOutForExactOut(exact, bips)
        expect(gross - feeAmount(gross, bips), `${bips} bips of ${exact}`).toBeGreaterThanOrEqual(exact)
      }
    }
  })

  it('refuses a fee that would consume the whole output', () => {
    expect(() => grossOutForExactOut(EXACT, Number(BIPS))).toThrow('out of range')
  })
})

describe('slippage protects the other side now', () => {
  it('widens the most you can spend, and leaves the output alone', () => {
    expect(maximumIn(1_000_000n, 50)).toBe(1_005_000n)
    expect(maximumIn(1_000_000n, 0)).toBe(1_000_000n)
  })
})

describe('universal router encoding for an exact output', () => {
  /** The quoted cost is 1_000_000; at 0.5 % slippage the ceiling the caller hands the encoder is 1_005_000. */
  const base = { amountOut: EXACT, maximumIn: maximumIn(1_000_000n, 50), wrappedNative: WETN, recipient: ME, deadline: 1_900_000_000n, universalRouter: UR }

  it('buys the grossed-up amount, caps the input, and sweeps exactly what was asked for', () => {
    const enc = encodeSwapExactOut({ ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 30 } })
    expect(enc.commands).toEqual([COMMAND.V3_SWAP_EXACT_OUT, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    expect(enc.value).toBe(0n)
    expect(enc.exactOut).toBe(EXACT)
    expect(enc.maximumIn).toBe(1_005_000n)
    expect(enc.grossOut).toBe(grossOutForExactOut(EXACT, 30))

    const cmds = decodeUniversalRouter(enc.data)?.commands ?? []
    const [swap, pay, sweep] = cmds
    /*
      The decoder names an exact-out command's second and third words
      `amountIn`/`amountOut` because it shares one tuple with the exact-in
      shape. In this direction they are `amountOut` then `amountInMaximum`, so
      the first is the grossed-up buy and the second is the ceiling.
    */
    if (swap?.type !== 'V3_SWAP_EXACT_OUT') throw new Error('unreachable')
    expect(swap.amountIn).toBe(enc.grossOut)
    expect(swap.amountOut).toBe(enc.maximumIn)
    expect(swap.recipient).toBe(ROUTER_AS_RECIPIENT)
    expect(swap.payerIsUser).toBe(true)

    // The fee assertion the firewall makes is untouched: one portion, pinned sink, tier bips.
    expect(pay?.type === 'PAY_PORTION' && pay.recipient === SINK && pay.bips === 30n && pay.token === USDC).toBe(true)
    // And what is left after that portion is the exact amount, not a penny less.
    expect(sweep?.type === 'SWEEP' && sweep.recipient === ME && sweep.amount === EXACT).toBe(true)
    expect(enc.grossOut - feeAmount(enc.grossOut, 30)).toBeGreaterThanOrEqual(EXACT)
  })

  it('walks the V3 path backwards — output first — and the router reads the same bytes', () => {
    const hops = [
      { kind: 'v3' as const, tokenIn: BOLT, tokenOut: WETN, fee: 3000 },
      { kind: 'v3' as const, tokenIn: WETN, tokenOut: USDC, fee: 500 },
    ]
    expect(v3PackedPathExactOut(hops).toLowerCase()).toBe(`0x${USDC.slice(2)}0001f4${WETN.slice(2)}000bb8${BOLT.slice(2)}`.toLowerCase())
    const enc = encodeSwapExactOut({ ...base, route: { hops }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } })
    const [swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    if (swap?.type !== 'V3_SWAP_EXACT_OUT') throw new Error('unreachable')
    expect(swap.path.toLowerCase()).toBe(v3PackedPathExactOut(hops).toLowerCase())
  })

  it('keeps a V2 path in trade order, because V2 asks the other way round', () => {
    const enc = encodeSwapExactOut({ ...base, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: WETN }, { kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } })
    expect(enc.commands).toEqual([COMMAND.V2_SWAP_EXACT_OUT, COMMAND.PAY_PORTION, COMMAND.SWEEP])
    const [swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    if (swap?.type !== 'V2_SWAP_EXACT_OUT') throw new Error('unreachable')
    expect(swap.path.map((x) => x.toLowerCase())).toEqual([BOLT, WETN, USDC].map((x) => x.toLowerCase()))
  })

  /*
    A native input has to be handed its change back.

    `WRAP_ETH` has to wrap the whole maximum, because nothing knows the real
    cost until the pools answer. Whatever the swap does not spend is then WETN
    sitting in the router, and without the trailing unwrap it belongs to
    whoever sweeps the router next.
  */
  it('wraps the maximum and returns the unspent change', () => {
    const enc = encodeSwapExactOut({ ...base, route: { hops: [{ kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: true, nativeOut: false, fee: { sink: SINK, bips: 50 } })
    expect(enc.commands).toEqual([COMMAND.WRAP_ETH, COMMAND.V2_SWAP_EXACT_OUT, COMMAND.PAY_PORTION, COMMAND.SWEEP, COMMAND.UNWRAP_WETH])
    expect(enc.value).toBe(enc.maximumIn)
    const cmds = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(cmds[0]?.type === 'WRAP_ETH' && cmds[0].recipient === ROUTER_AS_RECIPIENT && cmds[0].amount === enc.maximumIn).toBe(true)
    expect(cmds[1]?.type === 'V2_SWAP_EXACT_OUT' && cmds[1].payerIsUser === false).toBe(true)
    // The change: everything the router still holds, back to the user.
    expect(cmds[4]?.type === 'UNWRAP_WETH' && cmds[4].recipient === ME && cmds[4].amount === 0n).toBe(true)
  })

  it('takes the fee on the wrapped output, then unwraps exactly what was asked for', () => {
    const enc = encodeSwapExactOut({ ...base, route: { hops: [{ kind: 'v3', tokenIn: USDC, tokenOut: WETN, fee: 500 }] }, nativeIn: false, nativeOut: true, fee: { sink: SINK, bips: 50 } })
    expect(enc.commands).toEqual([COMMAND.V3_SWAP_EXACT_OUT, COMMAND.PAY_PORTION, COMMAND.UNWRAP_WETH])
    const cmds = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(cmds[1]?.type === 'PAY_PORTION' && cmds[1].token === WETN).toBe(true)
    expect(cmds[2]?.type === 'UNWRAP_WETH' && cmds[2].recipient === ME && cmds[2].amount === EXACT).toBe(true)
  })

  it('a zero-bips tier pays the user directly and grosses nothing up', () => {
    const enc = encodeSwapExactOut({ ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: USDC, fee: 3000 }] }, nativeIn: false, nativeOut: false, fee: null })
    expect(enc.commands).toEqual([COMMAND.V3_SWAP_EXACT_OUT])
    expect(enc.grossOut).toBe(EXACT)
    const [swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(swap?.type === 'V3_SWAP_EXACT_OUT' && swap.recipient === ME).toBe(true)
  })

  it('refuses the same things the exact-in encoder refuses', () => {
    const shared = { ...base, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 } }
    expect(() => encodeSwapExactOut({ ...shared, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v2', tokenIn: WETN, tokenOut: USDC }] } })).toThrow('mixed route')
    expect(() => encodeSwapExactOut({ ...shared, route: { hops: [] } })).toThrow('empty route')
    expect(() => encodeSwapExactOut({ ...shared, amountOut: 0n, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: USDC }] } })).toThrow('empty output')
    // A swap with no ceiling on what it may spend is the one thing this direction must never encode.
    expect(() => encodeSwapExactOut({ ...shared, maximumIn: 0n, route: { hops: [{ kind: 'v2', tokenIn: BOLT, tokenOut: USDC }] } })).toThrow('no spending ceiling')
  })
})

describe('the mini-router, priced from the other end', () => {
  const answers = (calls: readonly { functionName: string; args: readonly unknown[] }[]): ReadResult[] =>
    calls.map((call) => {
      // V2 costs 1_100_000; the 0.3 % V3 pool costs 1_000_000; everything else declines.
      if (call.functionName === 'getAmountsIn') return { ok: true, value: [1_100_000n, EXACT] }
      if (call.functionName === 'quoteExactOutputSingle') {
        const fee = (call.args[0] as { fee: number }).fee
        return fee === 3000 ? { ok: true, value: [1_000_000n, 0n, 0, 90_000n] } : { ok: false }
      }
      if (call.functionName === 'quoteExactOutput') return { ok: true, value: [1_400_000n, [], [], 180_000n] }
      return { ok: false }
    })

  it('asks each candidate what it costs and picks the cheapest', async () => {
    const best = await bestRouteExactOut(BOLT, USDC, EXACT, addresses, async (calls) => answers(calls))
    expect(best?.best.candidate.label).toBe('V3 0.3%')
    expect(best?.best.amountIn).toBe(1_000_000n)
    // Sorted the other way from `bestRoute`: least first, because least is best.
    expect(best?.all[0]?.amountIn).toBe(1_000_000n)
    expect(best?.all[best.all.length - 1]?.amountIn).toBe(1_400_000n)
  })

  it('reads the cost off the front of getAmountsIn, not the back', async () => {
    const v2Only = await bestRouteExactOut(BOLT, USDC, EXACT, addresses, async (calls) => calls.map((c) => (c.functionName === 'getAmountsIn' ? { ok: true as const, value: [1_100_000n, EXACT] } : { ok: false as const })))
    expect(v2Only?.best.amountIn).toBe(1_100_000n)
  })

  it('says nothing rather than something when no pool answers', async () => {
    expect(await bestRouteExactOut(BOLT, USDC, EXACT, addresses, async (calls) => calls.map(() => ({ ok: false })))).toBeNull()
    // An output of zero is not a trade, and is refused before a single call is made.
    let asked = 0
    expect(
      await bestRouteExactOut(BOLT, USDC, 0n, addresses, async (calls) => {
        asked += calls.length
        return calls.map(() => ({ ok: false }))
      }),
    ).toBeNull()
    expect(asked).toBe(0)
  })
})
