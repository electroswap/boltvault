import { describe, expect, it } from 'vitest'
import { DataEngine, toSafeRow, noOpPrices, type RpcReader, type PriceSource } from '../src/data-engine'
import type { TokenEntry } from '@boltvault/token-catalog'

const USDC: TokenEntry = { chainId: 52014, address: '0x3187deAd7A2Bd6770F5Fe815926AAe6e', name: 'USD Coin', symbol: 'USDC', decimals: 6 }
const WETN: TokenEntry = { chainId: 52014, address: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31c77', name: 'Wrapped ETN', symbol: 'WETN', decimals: 18 }
const UNIVERSE = [USDC, WETN]

function fakeReader(overrides: Partial<RpcReader> = {}): RpcReader {
  return {
    blockNumber: async () => 1000n,
    nativeBalance: async () => 10n * 10n ** 18n, // 10 ETN
    erc20Balances: async () => ({ [USDC.address.toLowerCase()]: 5n * 10n ** 6n, [WETN.address.toLowerCase()]: 0n }),
    ...overrides,
  }
}

function pricedSource(): PriceSource {
  return {
    async prices(_c, addresses) {
      const out: Record<string, { usd: number; at: number } | null> = {}
      for (const a of addresses) out[a.toLowerCase()] = { usd: 1, at: 1 }
      return out
    },
    async nativePrice() {
      return { usd: 2, at: 1 }
    },
  }
}

describe('DataEngine', () => {
  it('blockHead returns a number', async () => {
    const e = new DataEngine({ reader: fakeReader(), universe: () => UNIVERSE, prices: noOpPrices })
    const r = await e.blockHead(52014)
    expect(r).toEqual({ ok: true, block: 1000, chainId: 52014, at: expect.any(Number) })
  })

  it('portfolio maps to SafeRows with STRING rawBalance + priced usd', async () => {
    const e = new DataEngine({ reader: fakeReader(), universe: () => UNIVERSE, prices: pricedSource() })
    const r = (await e.portfolio(52014, '0xacc')) as any
    expect(r.ok).toBe(true)
    // native row present with string rawBalance
    expect(r.native).not.toBeNull()
    expect(typeof r.native.rawBalance).toBe('string')
    expect(r.native.usd).toBe(20) // 10 * 2
    // USDC row priced
    const usdc = r.rows.find((x: any) => x.symbol === 'USDC')
    expect(usdc.priced).toBe(true)
    expect(typeof usdc.rawBalance).toBe('string')
    expect(usdc.usd).toBe(5) // 5 * 1
    // WETN has 0 balance -> may be hidden/absent from rows but priced flag consistent
    expect(typeof r.pricedTotalUsd).toBe('number')
  })

  it('unpriced rows carry priced:false (no-op prices)', async () => {
    const e = new DataEngine({ reader: fakeReader(), universe: () => UNIVERSE, prices: noOpPrices })
    const r = (await e.portfolio(52014, '0xacc')) as any
    expect(r.ok).toBe(true)
    expect(r.pricedTotalUsd).toBe(0)
    for (const row of r.rows) expect(row.priced).toBe(false)
  })

  it('price returns null when the source has no entry', async () => {
    const e = new DataEngine({ reader: fakeReader(), universe: () => UNIVERSE, prices: noOpPrices })
    const r = (await e.price(52014, '0xabc')) as any
    expect(r).toEqual({ ok: true, usd: null, at: expect.any(Number) })
  })

  it('fail-soft: a throwing native read still returns the ok portfolio (native 0)', async () => {
    const e = new DataEngine({
      reader: fakeReader({ nativeBalance: async () => { throw new Error('rpc down') } }),
      universe: () => UNIVERSE,
      prices: pricedSource(),
    })
    const r = (await e.portfolio(52014, '0xacc')) as any
    expect(r.ok).toBe(true)
    // USDC still priced
    const usdc = r.rows.find((x: any) => x.symbol === 'USDC')
    expect(usdc.priced).toBe(true)
  })
})

describe('toSafeRow', () => {
  it('stringifies rawBalance and preserves share/priced', () => {
    const row = toSafeRow({
      address: '0x1', symbol: 'X', name: 'X', decimals: 6, rawBalance: 123456n,
      quantity: '123.456', priceUsd: 1, usd: 123.456, share: 0.5, hidden: false, priced: true,
    } as any)
    expect(row.rawBalance).toBe('123456')
    expect(row.priced).toBe(true)
    expect(row.share).toBe(0.5)
  })
})
