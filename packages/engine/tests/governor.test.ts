/**
 * The one budget (governor.ts): a token bucket per host, a cooldown on a
 * refusal, and the property that makes RPC failover free — a cooling host
 * throws at once instead of spending a timeout.
 */
import { describe, expect, it } from 'vitest'
import { Governor, RateLimited, governedFetch } from '../src/governor'

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 1_000_000
  return { now: () => t, advance: (ms) => (t += ms) }
}

const json = (status: number, headers: Record<string, string> = {}): Response => new Response('{}', { status, headers })

describe('the request governor', () => {
  it('spends a burst, then waits for the next slot, and refills over time', async () => {
    const c = clock()
    // The sleep is instant but moves the clock, so the maths is tested without the wait.
    const gov = new Governor(c.now, async (ms) => c.advance(ms))
    const host = 'rpc.example.com'
    const budget = gov.budget(host)
    for (let i = 0; i < budget.burst; i += 1) await gov.reserve(host)

    // The bucket is empty. An RPC endpoint's budget is wide, so the next slot
    // is moments away and the request waits for it — a broadcast is delayed,
    // never dropped.
    const before = c.now()
    await gov.reserve(host)
    expect(c.now()).toBeGreaterThan(before)
    expect(c.now() - before).toBeLessThanOrEqual(2_000)

    // A minute of quiet puts the whole burst back, and never more than a burst.
    c.advance(60_000)
    for (let i = 0; i < budget.burst; i += 1) await gov.reserve(host)
    expect(gov.snapshot().find((h) => h.host === host)?.tokens).toBe(0)
  })

  it('refuses rather than stalls once a tight budget is spent, because display data is optional', async () => {
    const c = clock()
    const gov = new Governor(c.now, async (ms) => c.advance(ms))
    // GeckoTerminal's free tier is ~30/min across every network; at 20 a
    // slot is three seconds away, which is longer than anything should wait
    // for a price. An unpriced row now beats a stalled portfolio.
    const budget = gov.budget('api.geckoterminal.com')
    expect(budget.perMinute).toBeLessThan(60)
    for (let i = 0; i < budget.burst; i += 1) await gov.reserve('api.geckoterminal.com')
    await expect(gov.reserve('api.geckoterminal.com')).rejects.toBeInstanceOf(RateLimited)
  })

  it('cools a host on 429 and refuses instantly while it cools, which is what makes failover free', async () => {
    const c = clock()
    const gov = new Governor(c.now, async (ms) => c.advance(ms))
    gov.observe('rpc.example.com', 429)
    expect(gov.available('rpc.example.com')).toBe(false)

    // Instant, not a timeout: viem's fallback gets to try the next URL now.
    const started = c.now()
    await expect(gov.reserve('rpc.example.com')).rejects.toBeInstanceOf(RateLimited)
    expect(c.now()).toBe(started)

    // A `Retry-After` longer than our backoff is honoured.
    gov.observe('slow.example.com', 429, '120')
    expect(gov.snapshot().find((h) => h.host === 'slow.example.com')?.coolingMs).toBe(120_000)

    // One good answer clears the record.
    c.advance(10_000)
    gov.observe('rpc.example.com', 200)
    expect(gov.available('rpc.example.com')).toBe(true)
  })

  it('treats a run of transport failures as a refusal, but forgives a single one', async () => {
    const c = clock()
    const gov = new Governor(c.now, async (ms) => c.advance(ms))
    gov.observeError('flaky.example.com')
    gov.observeError('flaky.example.com')
    expect(gov.available('flaky.example.com')).toBe(true)
    gov.observeError('flaky.example.com')
    expect(gov.available('flaky.example.com')).toBe(false)
  })

  it('meters a real fetch by host, and never meters a node the user runs', async () => {
    const c = clock()
    const gov = new Governor(c.now, async (ms) => c.advance(ms))
    const seen: string[] = []
    const fetchImpl = governedFetch(async (input) => {
      seen.push(String(input))
      return json(200)
    }, gov)

    await fetchImpl('https://api.geckoterminal.com/api/v2/networks/eth/tokens/multi/0x0')
    expect(gov.snapshot().find((h) => h.host === 'api.geckoterminal.com')).toBeTruthy()

    // Loopback and LAN have no shared quota to protect.
    const budget = gov.budget('api.geckoterminal.com')
    for (let i = 0; i < budget.burst * 4; i += 1) await fetchImpl('http://127.0.0.1:8545')
    expect(gov.snapshot().find((h) => h.host === '127.0.0.1:8545')).toBeUndefined()
    expect(seen).toHaveLength(1 + budget.burst * 4)
  })

  it('records what the host answered, so a 429 through the wrapper starts the cooldown', async () => {
    const c = clock()
    const gov = new Governor(c.now, async (ms) => c.advance(ms))
    const fetchImpl = governedFetch(async () => json(429, { 'retry-after': '30' }), gov)
    await fetchImpl('https://api.geckoterminal.com/x')
    expect(gov.available('api.geckoterminal.com')).toBe(false)
    expect(gov.snapshot().find((h) => h.host === 'api.geckoterminal.com')?.coolingMs).toBe(30_000)
  })
})
