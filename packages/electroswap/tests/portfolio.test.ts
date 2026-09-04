import { describe, expect, it } from 'vitest'
import { buildEtnPortfolio, type PortfolioRow } from '../src'

function row(partial: Partial<PortfolioRow> & { address: string; symbol: string }): PortfolioRow {
  return {
    name: partial.symbol,
    decimals: 18,
    standard: 'erc20',
    rawQuantity: 0n,
    rawQuantityFromApi: null,
    price: null,
    denominatedValue: null,
    pricePercentChangeDay: null,
    currency: 'USD',
    ...partial,
  } as PortfolioRow
}

describe('buildEtnPortfolio merge rule (T4.2)', () => {
  it('RPC quantity is the source of truth; formattedQuantity uses it', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'ETN', standard: 'native', rawQuantity: 1234500000000000000000n, price: 0.5, denominatedValue: 617.25 }),
    ])
    expect(p.tokens[0]?.formattedQuantity).toBe('1234.5')
  })

  it('sums a fiat total and computes bus-bar shares that sum to ~1', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'A', rawQuantity: 1n, price: 100, denominatedValue: 100 }),
      row({ address: '0x2', symbol: 'B', rawQuantity: 3n, price: 10, denominatedValue: 30 }),
    ])
    expect(p.totalDenominated).toBe(130)
    const shares = p.tokens.map((t) => t.share)
    expect(shares[0]).toBeCloseTo(100 / 130, 5) // A first (larger value)
    expect(shares[1]).toBeCloseTo(30 / 130, 5)
    expect(shares.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 5)
  })

  it('sorts tokens by fiat value descending', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x2', symbol: 'B', rawQuantity: 1n, price: 1, denominatedValue: 10 }),
      row({ address: '0x1', symbol: 'A', rawQuantity: 1n, price: 10, denominatedValue: 100 }),
    ])
    expect(p.tokens[0]?.symbol).toBe('A')
    expect(p.tokens[1]?.symbol).toBe('B')
  })

  it('hides a zero balance entirely', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'ZERO', rawQuantity: 0n, price: 1, denominatedValue: 0 }),
      row({ address: '0x2', symbol: 'LIVE', rawQuantity: 1n, price: 1, denominatedValue: 50 }),
    ])
    expect(p.tokens.map((t) => t.symbol)).toEqual(['LIVE'])
    expect(p.tokenCount).toBe(2)
  })

  it('drops GraphQL fiat when RPC diverges from the indexer by >1%', () => {
    // RPC says 100 units, indexer says 1000 — diverged. Fiat should be dropped.
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'A', rawQuantity: 100n, rawQuantityFromApi: 1000n, price: 1, denominatedValue: 100 }),
    ])
    expect(p.tokens[0]?.denominatedValue).toBeNull()
    // Still visible (row kept), just no fiat.
    expect(p.tokens[0]?.symbol).toBe('A')
  })

  it('keeps fiat when RPC and indexer agree within 1%', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'A', rawQuantity: 1000n, rawQuantityFromApi: 1005n, price: 1, denominatedValue: 1000 }),
    ])
    expect(p.tokens[0]?.denominatedValue).toBe(1000)
  })

  it('hides dust (<$1) only when a price returned', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'DUST', rawQuantity: 1n, price: 0.5, denominatedValue: 0.4 }),
      row({ address: '0x2', symbol: 'BIG', rawQuantity: 1n, price: 10, denominatedValue: 100 }),
    ])
    // DUST row is in the dust list, not the bus bars.
    expect(p.dust.map((t) => t.symbol)).toEqual(['DUST'])
    expect(p.tokens.map((t) => t.symbol)).toEqual(['BIG'])
    expect(p.dust[0]?.hidden).toBe(true)
  })

  it('shows an unpriced row (no price) with priceUnavailable, not as dust', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'NOPE', rawQuantity: 999n, price: null, denominatedValue: null }),
      row({ address: '0x2', symbol: 'BIG', rawQuantity: 1n, price: 10, denominatedValue: 100 }),
    ])
    const nope = p.tokens.find((t) => t.symbol === 'NOPE')
    expect(nope).toBeDefined()
    expect(nope?.priceUnavailable).toBe(true)
    // Not dust, not hidden.
    expect(p.dust.map((t) => t.symbol)).not.toContain('NOPE')
  })

  it('returns null total + null change when nothing is priced', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'A', rawQuantity: 5n, price: null, denominatedValue: null }),
    ])
    expect(p.totalDenominated).toBeNull()
    expect(p.totalChange24h).toBeNull()
    expect(p.priceAvailableCount).toBe(0)
  })

  it('computes 24h change from per-row price change', () => {
    // A: +10% today (value 110, was 100). Total current 110, previous 100 => +10%.
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'A', rawQuantity: 1n, price: 11, denominatedValue: 110, pricePercentChangeDay: 10 }),
    ])
    expect(p.totalChange24h?.percentage).toBeCloseTo(10, 3)
    expect(p.totalChange24h?.absolute).toBeCloseTo(10, 3)
  })

  it('share is 0 when there is no fiat total (no priced rows)', () => {
    const p = buildEtnPortfolio('0xme', [
      row({ address: '0x1', symbol: 'A', rawQuantity: 5n, price: null, denominatedValue: null }),
    ])
    expect(p.tokens[0]?.share).toBe(0)
  })
})
