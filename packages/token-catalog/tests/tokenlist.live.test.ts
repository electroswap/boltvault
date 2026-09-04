import { describe, expect, it } from 'vitest'
import { fetchTokenList, PUBLIC_LIST_URLS } from '../src/index.js'

/**
 * Live tokenlist check — skipped with SKIP_LIVE=1. The real ElectroSwap list
 * (fetched 2026-09-04) has 10 tokens on 52014 and 5 on 5201420 in one file.
 */
const SKIP = process.env.SKIP_LIVE === '1'

describe.runIf(!SKIP)('live tokenlist (marked)', () => {
  it('ETN mainnet list has >= 10 tokens, all chainId 52014, includes BOLT + WETN + USDC', async () => {
    const { tokens, stale } = await fetchTokenList(52014)
    expect(stale).toBe(false)
    expect(tokens.length).toBeGreaterThanOrEqual(10)
    expect(tokens.every((t) => t.chainId === 52014)).toBe(true)
    const syms = new Set(tokens.map((t) => t.symbol))
    for (const s of ['WETN', 'BOLT', 'USDC', 'USDT']) expect(syms.has(s)).toBe(true)
  }, 20_000)

  it('ETN testnet entries parse from the same file (C5)', async () => {
    const { tokens } = await fetchTokenList(5201420)
    expect(tokens.length).toBeGreaterThanOrEqual(5)
    expect(tokens.every((t) => t.chainId === 5201420)).toBe(true)
    const syms = new Set(tokens.map((t) => t.symbol))
    expect(syms.has('tWETN')).toBe(true)
  }, 20_000)
})

describe('PUBLIC_LIST_URLS', () => {
  it('has a pinned list for all 10 supported chains', () => {
    for (const id of [52014, 5201420, 1, 56, 8453, 42161, 10, 137, 43114, 130, 59144]) {
      expect(PUBLIC_LIST_URLS[id], `chain ${id} needs a pinned list URL`).toMatch(/^https:\/\//)
    }
  })
})
