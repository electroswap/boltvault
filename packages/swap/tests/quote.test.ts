import { describe, expect, it } from 'vitest'
import { encodeAbiParameters } from 'viem'
import {
  quoteOnChain,
  resolveQuote,
  divergesPct,
  pickRoute,
  type EthCall,
} from '../src/quote'
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'

const TOKEN_IN = '0xb2b2b2b2b2B2b2B2B2b2b2B2B2b2B2B2b2b2b2b2'
const TOKEN_OUT = '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1'
const AMOUNT_IN = 10n ** 18n

/** Build a fake eth_call that decodes the request, then returns a fixed amountOut. */
function mockEthCall(amountOut: bigint, seen: { to?: string; fn?: string }): EthCall {
  return async (to, data) => {
    // Inspect the selector to learn which function was called.
    const selector = data.slice(0, 10)
    seen.to = to
    seen.fn = selector
    // Return ABI-encoded uint256(amountOut) (both quoter fns return (uint256)).
    return encodeAbiParameters([{ type: 'uint256' }], [amountOut])
  }
}

describe('pickRoute (T5.1)', () => {
  it('prefers the mixed (V2) quoter when present, else quoterV2', () => {
    // mainnet has mixedRouteQuoter → v2-mixed-single
    expect(pickRoute(52014).route).toBe('v2-mixed-single')
    expect(pickRoute(52014).quoter).toBe(ELECTRONEUM_ADDRESSES[52014].mixedRouteQuoter)
    // testnet has mixedRouteQuoter: null → v3-single via quoterV2
    expect(pickRoute(5201420).route).toBe('v3-single')
    expect(pickRoute(5201420).quoter).toBe(ELECTRONEUM_ADDRESSES[5201420].quoterV2)
  })
})

describe('quoteOnChain (T5.1, injectable eth_call)', () => {
  it('quotes via the mixed quoter on mainnet and decodes amountOut', async () => {
    const seen: { to?: string; fn?: string } = {}
    const q = await quoteOnChain(
      { chainId: 52014, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: AMOUNT_IN },
      mockEthCall(9_900_000n, seen),
    )
    expect(q.amountOut).toBe(9_900_000n)
    expect(q.route).toBe('v2-mixed-single')
    expect(q.quoter).toBe(ELECTRONEUM_ADDRESSES[52014].mixedRouteQuoter)
    expect(seen.to).toBe(ELECTRONEUM_ADDRESSES[52014].mixedRouteQuoter)
    expect(q.amountIn).toBe(AMOUNT_IN)
  })

  it('quotes via quoterV2 on testnet (no mixed quoter)', async () => {
    const q = await quoteOnChain(
      { chainId: 5201420, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: AMOUNT_IN },
      mockEthCall(5_000n, {}),
    )
    expect(q.route).toBe('v3-single')
    expect(q.amountOut).toBe(5_000n)
    expect(q.quoter).toBe(ELECTRONEUM_ADDRESSES[5201420].quoterV2)
  })

  it('throws on zero output (no liquidity)', async () => {
    await expect(
      quoteOnChain(
        { chainId: 52014, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: AMOUNT_IN },
        mockEthCall(0n, {}),
      ),
    ).rejects.toThrow(/no liquidity/)
  })

  it('throws for a non-ETN chain', async () => {
    await expect(
      quoteOnChain(
        { chainId: 1, tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: AMOUNT_IN },
        mockEthCall(1n, {}),
      ),
    ).rejects.toThrow(/not ETN/)
  })
})

describe('resolveQuote + divergence (T5.1 fallback)', () => {
  it('on-chain wins when present (source on-chain), even with a divergent API', () => {
    const r = resolveQuote(
      { route: 'v2-mixed-single', tokenIn: TOKEN_IN, tokenOut: TOKEN_OUT, amountIn: 1n, amountOut: 1000n, quoter: '0x' },
      { amountOut: 900n }, // 10% off
    )
    expect(r.quote.source).toBe('on-chain')
    expect(r.quote.amountOut).toBe(1000n)
    expect(r.usedFallback).toBe(false)
  })

  it('uses the API fallback (source api) when on-chain is absent', () => {
    const r = resolveQuote(null, { amountOut: 777n })
    expect(r.quote.source).toBe('api')
    expect(r.quote.amountOut).toBe(777n)
    expect(r.usedFallback).toBe(true)
  })

  it('throws when neither source exists', () => {
    expect(() => resolveQuote(null, null)).toThrow(/no quote/)
  })

  it('divergesPct computes the relative difference', () => {
    expect(divergesPct(1000n, 1000n)).toBe(0)
    expect(divergesPct(1000n, 900n)).toBeCloseTo(10, 5)
    expect(divergesPct(1000n, 990n)).toBeCloseTo(1, 5)
    expect(divergesPct(0n, 0n)).toBe(0)
  })
})
