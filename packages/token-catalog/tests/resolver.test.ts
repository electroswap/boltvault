import { describe, expect, it } from 'vitest'
import {
  resolveChainList,
  inRepoTokens,
  FALLBACK_CHAIN_IDS,
  type ResolveResult,
  type TokenEntry,
} from '../src/index.js'

/** A controllable fetch stub: returns okRaw or throws, per call. */
function mockFetch(behavior: 'ok' | 'fail', okRaw?: unknown) {
  let calls = 0
  const fn: typeof fetch = async (_url, _opts) => {
    calls++
    if (behavior === 'fail') throw new Error('network down')
    return {
      ok: true,
      status: 200,
      json: async () => okRaw,
    } as unknown as Response
  }
  return { fn, calls: () => calls }
}

const remoteRaw = {
  tokens: [
    { chainId: 130, address: '0x02a24C380dA560E4032Dc6671d8164cfbEEAAE1e', name: 'Aave', symbol: 'AAVE', decimals: 18 },
    { chainId: 130, address: '0x6406A93b3bb1609677f6bE2f6fa7369e1Dc984C8', name: 'Wrapped Ether', symbol: 'WETH', decimals: 18 },
  ],
}

describe('resolveChainList — tier 1 (remote)', () => {
  it('returns the parsed remote list, source=remote, degraded=false', async () => {
    const { fn } = mockFetch('ok', remoteRaw)
    const r: ResolveResult = await resolveChainList(130, { fetchImpl: fn, now: 1000 })
    expect(r.source).toBe('remote')
    expect(r.degraded).toBe(false)
    expect(r.tokens).toHaveLength(2)
    expect(r.tokens[0]?.symbol).toBe('AAVE')
  })

  it('writes a successful remote fetch into the cache (last-good source)', async () => {
    const { fn } = mockFetch('ok', remoteRaw)
    const cache = new Map<number, { tokens: TokenEntry[]; at: number }>()
    await resolveChainList(130, { fetchImpl: fn, cache, now: 1000 })
    expect(cache.has(130)).toBe(true)
  })
})

describe('resolveChainList — tier 2 (last-good)', () => {
  it('remote fail + fresh cache → last-good, degraded=true', async () => {
    const { fn } = mockFetch('fail')
    const cache = new Map<number, { tokens: TokenEntry[]; at: number }>([
      [130, { tokens: [{ chainId: 130, address: '0x02a24C380dA560E4032Dc6671d8164cfbEEAAE1e', name: 'Aave', symbol: 'AAVE', decimals: 18 }], at: 1000 }],
    ])
    const r = await resolveChainList(130, { fetchImpl: fn, cache, now: 2000 })
    expect(r.source).toBe('last-good')
    expect(r.degraded).toBe(true)
  })

  it('stale cache (>cacheMs) is NOT used as last-good', async () => {
    const { fn } = mockFetch('fail')
    const cache = new Map<number, { tokens: TokenEntry[]; at: number }>([[130, { tokens: [], at: 0 }]])
    // 130 has an in-repo fallback, so we expect 'in-repo', not 'last-good'
    const r = await resolveChainList(130, { fetchImpl: fn, cache, now: 100_000_000, cacheMs: 60_000 })
    expect(r.source).toBe('in-repo')
  })
})

describe('resolveChainList — tier 3 (in-repo fallback)', () => {
  it('remote fail + no cache + fallback chain → in-repo, degraded=true', async () => {
    const { fn } = mockFetch('fail')
    const r = await resolveChainList(59144, { fetchImpl: fn, now: 1000 })
    expect(r.source).toBe('in-repo')
    expect(r.degraded).toBe(true)
    expect(r.tokens.length).toBeGreaterThan(0)
    expect(r.tokens.every((t) => t.chainId === 59144)).toBe(true)
  })

  it('the Linea fallback contains the widely-held tokens (RPC-verified)', async () => {
    const { fn } = mockFetch('fail')
    const r = await resolveChainList(59144, { fetchImpl: fn, now: 1000 })
    const syms = new Set(r.tokens.map((t) => t.symbol))
    expect(syms.has('USDC')).toBe(true)
    expect(syms.has('WETH')).toBe(true)
    expect(syms.has('DAI')).toBe(true)
  })

  it('the Unichain fallback is substantial (top of the Uniswap list)', async () => {
    const { fn } = mockFetch('fail')
    const r = await resolveChainList(130, { fetchImpl: fn, now: 1000 })
    expect(r.source).toBe('in-repo')
    expect(r.tokens.length).toBeGreaterThanOrEqual(100)
  })
})

describe('resolveChainList — tier 4 (none)', () => {
  it('remote fail + no cache + no fallback chain → none', async () => {
    const { fn } = mockFetch('fail')
    const r = await resolveChainList(1, { fetchImpl: fn, now: 1000 })
    expect(r.source).toBe('none')
    expect(r.degraded).toBe(true)
    expect(r.tokens).toHaveLength(0)
  })
})

describe('inRepoTokens / FALLBACK_CHAIN_IDS', () => {
  it('Unichain (130), Linea (59144) and both ETN chains ship in-repo fallbacks', () => {
    expect(FALLBACK_CHAIN_IDS).toContain(130)
    expect(FALLBACK_CHAIN_IDS).toContain(59144)
    expect(FALLBACK_CHAIN_IDS).toContain(52014)
    expect(FALLBACK_CHAIN_IDS).toContain(5201420)
    expect(FALLBACK_CHAIN_IDS).toHaveLength(4)
  })
  it('a chain with no fallback returns []', () => {
    expect(inRepoTokens(1)).toHaveLength(0)
  })
  it('the ETN fallback is chain-scoped from the one shared file', () => {
    const main = inRepoTokens(52014)
    const test = inRepoTokens(5201420)
    expect(main.length).toBeGreaterThan(0)
    expect(test.length).toBeGreaterThan(0)
    expect(main.every((t) => t.chainId === 52014)).toBe(true)
    expect(test.every((t) => t.chainId === 5201420)).toBe(true)
    expect(main.map((t) => t.symbol)).toContain('WETN')
    expect(main.map((t) => t.symbol)).toContain('BOLT')
  })
  it('fallback tokens are checksummed + chain-scoped', () => {
    const linea = inRepoTokens(59144)
    expect(linea.length).toBeGreaterThan(0)
    expect(linea.every((t) => t.chainId === 59144)).toBe(true)
    for (const t of linea) expect(t.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})
