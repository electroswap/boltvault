import { describe, it, expect } from 'vitest'
import { knownSpenters } from '../src/known-spenters'
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'

describe('knownSpenters', () => {
  it('returns the 6 known spenders for 52014 with registry addresses', () => {
    const spenders = knownSpenters(52014)
    expect(spenders).toHaveLength(6)

    const byKind = Object.fromEntries(spenders.map((s) => [s.kind, s]))
    const reg = ELECTRONEUM_ADDRESSES[52014]

    expect(byKind['permit2']?.address).toBe(reg.permit2)
    expect(byKind['universal-router']?.address).toBe(reg.universalRouter)
    expect(byKind['swap-router02']?.address).toBe(reg.swapRouter02)
    expect(byKind['v2-router']?.address).toBe(reg.v2Router02)
    expect(byKind['seaport']?.address).toBe(reg.seaport15)
    expect(byKind['farm']?.address).toBe(reg.yieldFarm)

    expect(byKind['permit2']?.label).toBe('Permit2')
    expect(byKind['universal-router']?.label).toBe('Universal Router')
    expect(byKind['swap-router02']?.label).toBe('SwapRouter02')
    expect(byKind['v2-router']?.label).toBe('V2 Router')
    expect(byKind['seaport']?.label).toBe('Seaport')
    expect(byKind['farm']?.label).toBe('Yield Farm')
  })

  it('returns the 6 known spenders for 5201420 with testnet registry addresses', () => {
    const spenders = knownSpenters(5201420)
    expect(spenders).toHaveLength(6)
    const reg = ELECTRONEUM_ADDRESSES[5201420]
    const byKind = Object.fromEntries(spenders.map((s) => [s.kind, s]))
    expect(byKind['permit2']?.address).toBe(reg.permit2)
    expect(byKind['seaport']?.address).toBe(reg.seaport15)
    expect(byKind['farm']?.address).toBe(reg.yieldFarm)
  })

  it('throws for a non-ETN chain id', () => {
    expect(() => knownSpenters(1)).toThrow()
  })
})
