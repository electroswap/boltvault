import { describe, expect, it } from 'vitest'
import { SwClient, type SwTransport } from '../src/sw-client'
import type { SwRequest, SwResponse } from '../src/sw-messages'

/** A fake transport that returns canned responses per request type. */
function fakeTransport(handlers: Record<string, unknown | ((m: SwRequest) => unknown)>): SwTransport & { calls: SwRequest[] } {
  const calls: SwRequest[] = []
  return {
    calls,
    async send(m: SwRequest) {
      calls.push(m)
      const h = handlers[m.type]
      if (h === undefined) return { ok: false, error: 'no handler' }
      return typeof h === 'function' ? (h as (m: SwRequest) => unknown)(m) : h
    },
  }
}

describe('SwClient', () => {
  it('imports cleanly in node without a browser global (no top-level browser access)', () => {
    // Requiring sw-client must not throw even though `browser` is undefined.
    expect(() => new SwClient()).not.toThrow()
  })

  it('ping unwraps { pong, ts }', async () => {
    const t = fakeTransport({ 'bv:ping': { ok: true, pong: true, ts: 42 } })
    const c = new SwClient(t)
    await expect(c.ping()).resolves.toEqual({ pong: true, ts: 42 })
  })

  it('blockHead returns the number', async () => {
    const t = fakeTransport({ 'bv:block:head': (m: any) => ({ ok: true, block: 1000 + m.chainId, chainId: m.chainId, at: 1 }) })
    const c = new SwClient(t)
    await expect(c.blockHead(52014)).resolves.toBe(53014)
  })

  it('portfolio returns the typed payload', async () => {
    const rows = [{ address: '0xa', symbol: 'ETN', name: 'E', decimals: 18, rawBalance: '1', quantity: '0.001', share: 1, hidden: false, priced: false }]
    const t = fakeTransport({ 'bv:portfolio': { ok: true, chainId: 1, account: '0xacc', native: null, rows, pricedTotalUsd: 0, at: 9 } })
    const c = new SwClient(t)
    const p = await c.portfolio(1, '0xacc')
    expect(p.chainId).toBe(1)
    expect(p.rows).toHaveLength(1)
    expect(p.pricedTotalUsd).toBe(0)
  })

  it('price returns null when unpriced', async () => {
    const t = fakeTransport({ 'bv:price': { ok: true, usd: null, at: 1 } })
    const c = new SwClient(t)
    await expect(c.price(1, '0xa')).resolves.toBeNull()
  })

  it('throws on { ok:false } responses', async () => {
    const t = fakeTransport({ 'bv:block:head': { ok: false, error: 'rpc down' } as SwResponse })
    const c = new SwClient(t)
    await expect(c.blockHead(1)).rejects.toThrow('rpc down')
  })

  it('runtimeTransport throws a clean error when browser is absent (does not crash at import)', async () => {
    const c = new SwClient() // default = runtimeTransport
    await expect(c.blockHead(1)).rejects.toThrow(/sendMessage|unavailable/i)
  })
})
