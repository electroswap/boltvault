import { describe, expect, it } from 'vitest'
import { defaultKeepAlive, isAlive, nextPingAt } from '../src'

describe('defaultKeepAlive', () => {
  it('uses a 30000ms TTL by default', () => {
    const ka = defaultKeepAlive(1000)
    expect(ka).toEqual({ startedAt: 1000, ttlMs: 30000 })
  })

  it('honors a custom ttlMs', () => {
    const ka = defaultKeepAlive(0, 5000)
    expect(ka.ttlMs).toBe(5000)
    expect(ka.startedAt).toBe(0)
  })
})

describe('isAlive', () => {
  const ka = defaultKeepAlive(0) // startedAt=0, ttl=30000

  it('is alive within the window', () => {
    expect(isAlive(ka, 0)).toBe(true)
    expect(isAlive(ka, 29999)).toBe(true)
  })

  it('is not alive at or after expiry', () => {
    expect(isAlive(ka, 30000)).toBe(false)
    expect(isAlive(ka, 30001)).toBe(false)
  })
})

describe('nextPingAt', () => {
  const ka = defaultKeepAlive(0) // startedAt=0, ttl=30000

  it('returns null when dead', () => {
    expect(nextPingAt(ka, 30000)).toBeNull()
    expect(nextPingAt(ka, 50000)).toBeNull()
  })

  it('returns startedAt + floor(ttl*0.8) = 24000 when alive', () => {
    expect(nextPingAt(ka, 0)).toBe(24000)
    expect(nextPingAt(ka, 10000)).toBe(24000)
  })

  it('respects a non-zero startedAt', () => {
    const later = defaultKeepAlive(1000, 10000)
    expect(nextPingAt(later, 1000)).toBe(1000 + 8000)
    expect(nextPingAt(later, 11000)).toBeNull() // 11000-1000 = 10000 >= ttl
  })
})
