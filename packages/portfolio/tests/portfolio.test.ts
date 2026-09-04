import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import { buildPortfolio, balanceReads, type BuildPortfolioOpts } from '../src'
import type { TokenEntry } from '@boltvault/token-catalog'

// Real, EIP-55 addresses from the Linea in-repo fallback (chainId 59144).
const USDC = getAddress('0x176211869cA2b568f2A7D4EE941E073a821EE1ff')
const WETH = getAddress('0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f')
const DAI = getAddress('0x4AF15ec2A0BD43Db75dd04E62FAA3B8EF36b00d5')
const LINK = getAddress('0x5B16228B94b68C7cE33AF2ACc5663eBdE4dCFA2d')
const WBTC = getAddress('0x3aAB2285ddcDdaD8edf438C1bAB47e1a9D05a9b4')

function token(addr: string, symbol: string, name: string, decimals: number): TokenEntry {
  return { chainId: 59144, address: addr, name, symbol, decimals }
}

function universe(): TokenEntry[] {
  return [
    { chainId: 59144, address: 'native', name: 'Native', symbol: 'NATIVE', decimals: 18 },
    token(USDC, 'USDC', 'USD Coin', 6),
    token(WETH, 'WETH', 'Wrapped Ether', 18),
    token(DAI, 'DAI', 'Dai', 18),
    token(LINK, 'LINK', 'Chainlink', 18),
    token(WBTC, 'WBTC', 'Wrapped BTC', 8),
  ]
}

describe('buildPortfolio (T7.2) — quantity is truth, price is display', () => {
  it('formats raw balances to human quantity (never from the price)', () => {
    const opts: BuildPortfolioOpts = {
      chainId: 59144,
      universe: universe(),
      balances: {
        native: 2_500_000_000_000_000_000n, // 2.5 ETH
        [USDC.toLowerCase()]: 1_234_567n, // 1234.567
      },
      prices: {
        native: { usd: 3000 },
        [USDC.toLowerCase()]: { usd: 1 },
      },
    }
    const p = buildPortfolio(opts)
    expect(p.native?.quantity).toBe('2.5')
    const usdc = p.rows.find((r) => r.address === USDC)
    expect(usdc?.quantity).toBe('1.234567')
    expect(usdc?.rawBalance).toBe(1_234_567n)
  })

  it('unpriced rows show quantity with NO fiat (not zero, not hidden)', () => {
    const opts: BuildPortfolioOpts = {
      chainId: 59144,
      universe: universe(),
      balances: { [LINK.toLowerCase()]: 100n * 10n ** 18n },
      prices: {}, // nothing priced
    }
    const p = buildPortfolio(opts)
    const link = p.rows.find((r) => r.address === LINK)
    expect(link?.priced).toBe(false)
    expect(link?.usd).toBeUndefined()
    expect(link?.hidden).toBe(false)
    expect(p.visibleRows.some((r) => r.address === LINK)).toBe(true)
    expect(p.pricedTotalUsd).toBe(0)
  })

  it('dust-hides priced rows below $1 (but keeps them in rows, not visibleRows)', () => {
    const opts: BuildPortfolioOpts = {
      chainId: 59144,
      universe: universe(),
      balances: {
        // 0.5 USDC = $0.50 → dust
        [USDC.toLowerCase()]: 50n,
        // 100 DAI = $100 → visible
        [DAI.toLowerCase()]: 100n * 10n ** 18n,
      },
      prices: {
        [USDC.toLowerCase()]: { usd: 1 },
        [DAI.toLowerCase()]: { usd: 1 },
      },
    }
    const p = buildPortfolio(opts)
    const usdc = p.rows.find((r) => r.address === USDC)
    expect(usdc?.hidden).toBe(true)
    expect(p.hiddenRows.some((r) => r.address === USDC)).toBe(true)
    expect(p.visibleRows.some((r) => r.address === USDC)).toBe(false)
    const dai = p.rows.find((r) => r.address === DAI)
    expect(dai?.hidden).toBe(false)
  })

  it('does NOT dust-hide an unpriced row even if it would be tiny', () => {
    const opts: BuildPortfolioOpts = {
      chainId: 59144,
      universe: universe(),
      balances: { [USDC.toLowerCase()]: 1n }, // 0.000001 USDC, unpriced
      prices: {},
    }
    const p = buildPortfolio(opts)
    const usdc = p.rows.find((r) => r.address === USDC)
    expect(usdc?.hidden).toBe(false)
  })

  it('computes per-row share of the priced total (bus bar)', () => {
    const opts: BuildPortfolioOpts = {
      chainId: 59144,
      universe: universe(),
      balances: {
        native: 1n * 10n ** 18n, // 1 ETH
        [DAI.toLowerCase()]: 1n * 10n ** 18n, // 1 DAI
      },
      prices: {
        native: { usd: 3000 },
        [DAI.toLowerCase()]: { usd: 1 },
      },
    }
    const p = buildPortfolio(opts)
    const eth = p.native
    const dai = p.rows.find((r) => r.address === DAI)
    expect(eth?.usd).toBeCloseTo(3000)
    expect(dai?.usd).toBeCloseTo(1)
    // shares sum to ~1 across priced rows
    const ethShare = eth?.share ?? 0
    const daiShare = dai?.share ?? 0
    expect(ethShare + daiShare).toBeCloseTo(1, 5)
    expect(ethShare).toBeGreaterThan(0.99)
  })

  it('native participates in the priced total + shares', () => {
    const opts: BuildPortfolioOpts = {
      chainId: 59144,
      universe: universe(),
      balances: { native: 1n * 10n ** 18n },
      prices: { native: { usd: 3000 } },
    }
    const p = buildPortfolio(opts)
    expect(p.pricedTotalUsd).toBeCloseTo(3000)
    expect(p.native?.share).toBeCloseTo(1)
  })
})

describe('balanceReads (T7.2)', () => {
  it('lists erc20 addresses to read (excludes native), lowercased', () => {
    const reads = balanceReads(universe())
    expect(reads).not.toContain('native')
    expect(reads).toContain(USDC.toLowerCase())
    expect(reads).toContain(WBTC.toLowerCase())
    expect(reads.length).toBe(5)
  })
})
