/**
 * The confirming look at the chain, before the calldata is built (ES-BV-003).
 *
 * The served `amountOut` flows straight into `deliveredMinimumOut`, which is
 * the `amountOutMinimum` written into the calldata the user signs — so a
 * compromised, stale or simply wrong routing service sets the floor. And the
 * price-impact plates cannot catch it: they compare the served figure against
 * a probe on the *same served route*, which agrees with it by construction.
 *
 * The keystroke path still takes the service's word, which is the owner's
 * decision. This is the one `eth_call` that happens after the user says yes.
 */
import { describe, expect, it } from 'vitest'
import { feeAmount, routerMinimumOut } from '@boltvault/electroswap'
import { rebuiltFromChain, rebuiltInputFromChain, type SwapQuoteView } from '../src/namespaces/swap'

const served = (amountOut: bigint, over: Partial<SwapQuoteView> = {}): SwapQuoteView =>
  ({
    tradeType: 'exactIn',
    maximumInRaw: '0',
    chainId: 52014,
    tokenIn: '0x1111111111111111111111111111111111111111',
    tokenOut: 'native',
    symbolIn: 'FIX',
    symbolOut: 'ETN',
    decimalsIn: 18,
    decimalsOut: 18,
    amountInRaw: (10n ** 18n).toString(),
    balanceInRaw: (10n ** 21n).toString(),
    amountOutRaw: amountOut.toString(),
    receiveRaw: amountOut.toString(),
    minimumOutRaw: ((amountOut * 9950n) / 10_000n).toString(),
    rate: null,
    priceImpactPct: 0.1,
    slippageBips: 50,
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
    route: { label: 'FIX → ETN', hops: [], source: 'api' },
    gasEstimate: '0',
    steps: [],
    quotedAt: 1_700_000_000_000,
    ok: true,
    problems: [],
    ...over,
  }) as SwapQuoteView

const ONE = 10n ** 18n

describe('what gets encoded after the chain has been asked', () => {
  it('takes the chain when the service under-quoted its own route by more than a percent', () => {
    const quote = served((ONE * 90n) / 100n)
    const out = rebuiltFromChain(quote, ONE)
    expect(out.amountOutRaw).toBe(ONE.toString())
    expect(out.route.source).toBe('onchain')
    // And the floor is recomputed from the figure that will actually be paid,
    // not left at the low one the service set.
    expect(BigInt(out.minimumOutRaw)).toBeGreaterThan(BigInt(quote.minimumOutRaw))
  })

  it('leaves ordinary drift alone', () => {
    // Half a percent: a router's model and a simulated swap a moment later.
    const quote = served((ONE * 9950n) / 10_000n)
    expect(rebuiltFromChain(quote, ONE)).toBe(quote)
  })

  it('never replaces a served figure with a worse one', () => {
    // The service walks the whole pool graph and is the better router; it is
    // trusted for route selection, and a chain figure below it means the
    // simulated single route is simply not as good.
    const quote = served(ONE)
    expect(rebuiltFromChain(quote, (ONE * 50n) / 100n)).toBe(quote)
    expect(rebuiltFromChain(quote, ONE)).toBe(quote)
  })

  it('says nothing about a quote with no output to compare', () => {
    const quote = served(0n)
    expect(rebuiltFromChain(quote, ONE)).toBe(quote)
  })

  /*
    ES-BV-060. The first version priced the floor as though the fee were always
    taken on the output. When it is taken on the input — chosen when the
    output token's custody is unsafe — the router only ever swaps the input
    net of the fee, so that floor was higher than the router could deliver by
    the fee fraction and the transaction reverted on chain.
  */
  it('scales the floor by the fee when the fee came off the input', () => {
    const bips = 30
    const quote = served((ONE * 90n) / 100n, { fee: { bips, tier: 1, name: 'standard', amountRaw: '0', sink: '0x9999999999999999999999999999999999999999', source: 'config', nextTierAt: null, nextTierBips: null, onInput: true } })
    const out = rebuiltFromChain(quote, ONE)
    // Exactly the keystroke path's formula, not the output-side one.
    expect(out.minimumOutRaw).toBe(routerMinimumOut(ONE - feeAmount(ONE, bips), 50).toString())
    expect(BigInt(out.minimumOutRaw)).toBeLessThan(BigInt(rebuiltFromChain(served((ONE * 90n) / 100n), ONE).minimumOutRaw))
  })

  it('recomputes every figure the screen reads, not only the two it encodes', () => {
    const quote = served((ONE * 90n) / 100n, { priceImpactPct: 1 })
    const out = rebuiltFromChain(quote, ONE)
    // Left at their served values, these described a trade that no longer
    // existed: a receive amount and a rate from the low figure beside an
    // output from the high one.
    expect(out.receiveRaw).not.toBe(quote.receiveRaw)
    expect(BigInt(out.receiveRaw)).toBeGreaterThan(BigInt(quote.receiveRaw))
    expect(out.rate).not.toBe(quote.rate)
    // A better output against the same reference is a smaller impact.
    expect(out.priceImpactPct ?? 0).toBeLessThan(quote.priceImpactPct ?? 0)
  })

  it('leaves an input-side fee amount alone, because its base did not move', () => {
    const fee = { bips: 30, tier: 1, name: 'standard', amountRaw: '12345', sink: '0x9999999999999999999999999999999999999999', source: 'config' as const, nextTierAt: null, nextTierBips: null, onInput: true }
    const out = rebuiltFromChain(served((ONE * 90n) / 100n, { fee }), ONE)
    expect(out.fee.amountRaw).toBe('12345')
  })
})

describe('the same question asked of an exact-output swap', () => {
  const wanted = (amountIn: bigint) =>
    served(ONE, { tradeType: 'exactOut', amountInRaw: amountIn.toString(), maximumInRaw: ((amountIn * 10_050n) / 10_000n).toString() })

  it('brings the ceiling down when the served input buys more than was asked for', () => {
    // The service claimed 2 tokens in for 1 out; the chain says that input
    // buys 1.2, so only about 1.667 was ever needed.
    const quote = wanted(ONE * 2n)
    const out = rebuiltInputFromChain(quote, (ONE * 120n) / 100n)
    expect(BigInt(out.amountInRaw)).toBeLessThan(ONE * 2n)
    expect(BigInt(out.maximumInRaw)).toBeLessThan(BigInt(quote.maximumInRaw))
    expect(out.route.source).toBe('onchain')
    // The user's own slippage still sits on top of the new figure.
    expect(BigInt(out.maximumInRaw)).toBeGreaterThan(BigInt(out.amountInRaw))
  })

  it('never raises a ceiling the user has already seen', () => {
    const quote = wanted(ONE * 2n)
    // The chain says that input buys less than asked: the served input was, if
    // anything, too small. Not this function's business.
    expect(rebuiltInputFromChain(quote, (ONE * 80n) / 100n)).toBe(quote)
    expect(rebuiltInputFromChain(quote, ONE)).toBe(quote)
  })

  it('leaves ordinary drift alone here too', () => {
    const quote = wanted(ONE * 2n)
    expect(rebuiltInputFromChain(quote, (ONE * 10_050n) / 10_000n)).toBe(quote)
  })
})
