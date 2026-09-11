import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { decodeCalldata, decodeUniversalRouter } from '@boltvault/security'
import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { bestRoute, candidates, deliveredMinimumOut, encodeSwap, feeAmount, minimumOut, permitCovers, permitSingleTypedData, tierFor, DYNO_WEIGHT_ONE, FALLBACK_SCHEDULE, MAX_CANDIDATES, taxSlippageBips, encodeSubmitOrder, encodeCloseOrder, COMMAND, ROUTER_AS_RECIPIENT, type QuoteAddresses, type ReadResult } from '../src/swap'

const A = ELECTRONEUM_ADDRESSES[52014]
const UR = A.universalRouter as Hex
const WETN = A.wetn as Hex
const USDC = A.usdc as Hex
const BOLT = A.bolt as Hex
const SINK = '0x00000000000000000000000000000000000051ab' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex
const addresses: QuoteAddresses = { quoterV2: A.quoterV2 as Hex, mixedRouteQuoter: A.mixedRouteQuoter as Hex, v2Router02: A.v2Router02 as Hex, bases: [WETN, USDC, A.usdt as Hex, BOLT] }

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

  it('a permit leads the plan; mixed routes carry the V2 flag in the path', () => {
    const permit = { token: BOLT, amount: 1_000_000n, expiration: 1_900_001_800, nonce: 3, spender: UR, sigDeadline: 1_900_001_800n, signature: `0x${'ab'.repeat(65)}` as Hex }
    const enc = encodeSwap({ ...base, route: { hops: [{ kind: 'v3', tokenIn: BOLT, tokenOut: WETN, fee: 3000 }, { kind: 'v2', tokenIn: WETN, tokenOut: USDC }] }, nativeIn: false, nativeOut: false, fee: { sink: SINK, bips: 50 }, permit })
    expect(enc.commands[0]).toBe(COMMAND.PERMIT2_PERMIT)
    const [p, swap] = decodeUniversalRouter(enc.data)?.commands ?? []
    expect(p?.type === 'PERMIT2_PERMIT' && p.spender === UR && p.amount === 1_000_000n && p.token === BOLT).toBe(true)
    expect(swap?.type === 'V3_SWAP_EXACT_IN' && swap.path.toLowerCase().includes('800000')).toBe(true)
  })
})

describe('mini-router', () => {
  it('asks at most 16 candidates: direct V2, V3 × 4 fees, then hops through the bases', () => {
    const c = candidates(BOLT, USDC, addresses)
    expect(c.length).toBeLessThanOrEqual(MAX_CANDIDATES)
    expect(c[0]?.kind).toBe('v2')
    expect(c.slice(1, 5).every((x) => x.kind === 'v3' && x.route.hops.length === 1)).toBe(true)
    /*
      Mixed V2/V3 routes are no longer offered: `encodeSwap` renders them as a
      single V3 swap over a packed path carrying the `0x800000` MixedRouteQuoter
      sentinel, which the Universal Router does not read — it would look for a
      pool at fee tier 8388608. A mixed route could therefore win the quote and
      then produce calldata that cannot execute. Re-enable when the encoder
      partitions a mixed route into one command per protocol run.
    */
    expect(c.some((x) => x.kind === 'mixed')).toBe(false)
  })
  it('picks the best output and prefers a single hop within 0.1 %', async () => {
    const answers = (calls: readonly { functionName: string; args: readonly unknown[] }[]): ReadResult[] =>
      calls.map((call) => {
        if (call.functionName === 'getAmountsOut') return { ok: true, value: [1_000_000n, 490_000n] }
        if (call.functionName === 'quoteExactInputSingle') {
          const fee = (call.args[0] as { fee: number }).fee
          return fee === 3000 ? { ok: true, value: [499_600n, 0n, 0, 90_000n] } : { ok: false }
        }
        if (call.functionName === 'quoteExactInput') return { ok: true, value: [500_000n, [], [], 180_000n] }
        return { ok: false }
      })
    const best = await bestRoute(BOLT, USDC, 1_000_000n, addresses, async (calls) => answers(calls))
    expect(best?.best.candidate.label).toBe('V3 0.3%')
    expect(best?.best.amountOut).toBe(499_600n)
    expect(best?.all[0]?.amountOut).toBe(500_000n)
  })
  it('returns null when nothing quotes', async () => {
    expect(await bestRoute(BOLT, USDC, 1n, addresses, async (calls) => calls.map(() => ({ ok: false })))).toBeNull()
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

describe('taxes and limit orders', () => {
  it('folds both sides of a tax into slippage', () => {
    expect(taxSlippageBips({ buyFeeBps: 100, sellFeeBps: 200, feeTakenOnTransfer: true, sellReverted: false }, { buyFeeBps: 300, sellFeeBps: 0, feeTakenOnTransfer: true, sellReverted: false })).toBe(500)
  })
  it('encodes submit and close for the limit-order manager', () => {
    const data = encodeSubmitOrder({ tokenIn: BOLT, tokenOut: USDC, unwrapOutput: false, amountInExact: 10n, amountOutMin: 9n, recipient: ME, durationSeconds: 86_400n })
    expect(data.startsWith('0x')).toBe(true)
    expect(encodeCloseOrder(7n).length).toBe(74)
  })
})
