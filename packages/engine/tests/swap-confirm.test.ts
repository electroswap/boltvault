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
import { rebuiltFromChain, type SwapQuoteView } from '../src/namespaces/swap'

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
})
