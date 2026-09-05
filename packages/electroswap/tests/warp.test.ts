import { describe, expect, it } from 'vitest'
import { ICA_ROUTER, WARP_ROUTES, warpAsset } from '../src'

const ETN = 52014
const CORRIDORS = [1, 56, 8453, 43114, 42161, 10, 137]

describe('WARP_ROUTES (Hyperlane warp table, ETN)', () => {
  it('has exactly one USDC and one USDT warp, both on ETN (52014)', () => {
    const usdc = WARP_ROUTES.filter((r) => r.symbol === 'USDC')
    const usdt = WARP_ROUTES.filter((r) => r.symbol === 'USDT')
    expect(usdc).toHaveLength(1)
    expect(usdt).toHaveLength(1)
    for (const r of WARP_ROUTES) {
      expect(r.chainId).toBe(ETN)
      expect(r.destinations).toEqual(CORRIDORS)
    }
  })

  it('lists the warp corridors [1, 56, 8453, 43114, 42161, 10, 137]', () => {
    for (const r of WARP_ROUTES) {
      expect(r.destinations).toEqual([1, 56, 8453, 43114, 42161, 10, 137])
    }
  })
})

describe('warpAsset', () => {
  it('matches the USDC warp address (case-insensitive)', () => {
    const route = WARP_ROUTES.find((r) => r.symbol === 'USDC')!
    const hit = warpAsset(route.token)
    expect(hit).not.toBeNull()
    expect(hit!.symbol).toBe('USDC')
    expect(hit!.destinations).toEqual(CORRIDORS)
    // lowercase + uppercase variants both match
    expect(warpAsset(route.token.toLowerCase())!.symbol).toBe('USDC')
    expect(warpAsset(route.token.toUpperCase())!.symbol).toBe('USDC')
  })

  it('matches the USDT warp address', () => {
    const route = WARP_ROUTES.find((r) => r.symbol === 'USDT')!
    const hit = warpAsset(route.token)
    expect(hit).not.toBeNull()
    expect(hit!.symbol).toBe('USDT')
    expect(hit!.destinations).toEqual(CORRIDORS)
  })

  it('returns null for an unknown address', () => {
    expect(warpAsset('0x1234567890123456789012345678901234567890')).toBeNull()
  })

  it('returns destinations as a copy (callers can mutate safely)', () => {
    const route = WARP_ROUTES.find((r) => r.symbol === 'USDC')!
    const hit = warpAsset(route.token)!
    hit.destinations.push(999)
    expect(hit.destinations).toContain(999)
    expect(route.destinations).not.toContain(999)
  })
})

describe('ICA_ROUTER', () => {
  it('is a 42-char checksummed ETN address', () => {
    expect(ICA_ROUTER).toBe('0x9fE454AA8156E49F130aB73c6b783008f53e99a9')
    expect(ICA_ROUTER).toMatch(/^0x[0-9a-fA-F]{40}$/)
  })
})
