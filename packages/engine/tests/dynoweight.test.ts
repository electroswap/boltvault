/**
 * The measured `dynoWeight`: what one DYNO is worth in BOLT on the fee ladder.
 *
 * The number used to be typed into `fees.json` from one day's two prices, so
 * it began drifting the moment it was committed. These tests pin the three
 * properties that let a market number sit on the signing path: it is a week's
 * time-weighted average rather than a spot price, it can never move further
 * than the configured band from the committed anchor, and asking for it never
 * waits on the network.
 */
import type { Platform } from '@boltvault/platform'
import { ElectroSwapClient } from '@boltvault/electroswap'
import { describe, expect, it } from 'vitest'
import { DynoWeight, twap } from '../src/dynoweight'

const ETN = 52014
const BOLT = '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1'.toLowerCase()
const ANCHOR = 875_680n * 10n ** 15n
const WEEK_SEC = 7 * 24 * 60 * 60
const NOW = 1_780_000_000_000

/** A week of evenly spaced samples at one price, which is the easy case to reason about. */
function flat(price: number, at: number, count = 24): Array<{ timestamp: number; value: number }> {
  const to = Math.floor(at / 1000)
  const step = WEEK_SEC / count
  return Array.from({ length: count }, (_, i) => ({ timestamp: Math.floor(to - WEEK_SEC + i * step), value: price }))
}

interface Feed {
  readonly bolt: Array<{ timestamp: number; value: number }>
  readonly dyno: Array<{ timestamp: number; value: number }>
}

function harness(feed: () => Feed, start = NOW): { weights: DynoWeight; clock: { now: number }; calls: () => number } {
  const clock = { now: start }
  let calls = 0
  const fetchImpl: typeof fetch = async (_url, init) => {
    calls += 1
    const body = JSON.parse(String(init?.body ?? '{}')) as { variables?: { address?: string } }
    const f = feed()
    const priceHistory = String(body.variables?.address).toLowerCase() === BOLT ? f.bolt : f.dyno
    return new Response(JSON.stringify({ data: { token: { market: { priceHistory, high: null, low: null } } } }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  const platform = { now: () => clock.now } as unknown as Platform
  const electroswap = new ElectroSwapClient({ url: 'https://example.invalid/graphql', fetchImpl })
  return { weights: new DynoWeight({ platform, electroswap }), clock, calls: () => calls }
}

describe('the time-weighted BOLT/DYNO ratio', () => {
  it('is the ratio of the two weekly averages', async () => {
    const { weights } = harness(() => ({ bolt: flat(0.002, NOW), dyno: flat(1.6, NOW) }))
    await weights.prime(ETN)
    // 1.6 / 0.002 = 800 BOLT per DYNO, against an anchor of 875.68.
    expect(await weights.weight(ETN)).toEqual({ value: 800n * 10n ** 18n, measured: true })
  })

  it('answers from the anchor before it has measured anything, without waiting on the feed', async () => {
    const { weights, calls } = harness(() => ({ bolt: flat(0.002, NOW), dyno: flat(1.6, NOW) }))
    // The very first ask is on the signing path as far as this class knows: it
    // returns the committed number at once and fetches behind the answer.
    expect(await weights.weight(ETN)).toEqual({ value: ANCHOR, measured: false })
    expect(calls()).toBeLessThanOrEqual(2)
  })

  it('will not let a broken feed move the weight further than the band', async () => {
    // A decimal-shifted BOLT price: a hundredth of the real one, so the raw
    // ratio is 80,000 BOLT per DYNO and every DYNO holder is a Reactor.
    const { weights } = harness(() => ({ bolt: flat(0.00002, NOW), dyno: flat(1.6, NOW) }))
    await weights.prime(ETN)
    expect(await weights.weight(ETN)).toEqual({ value: ANCHOR * 4n, measured: true })
  })

  it('clamps a collapse the same way, so a real holder cannot be stripped of a tier', async () => {
    const { weights } = harness(() => ({ bolt: flat(2, NOW), dyno: flat(1.6, NOW) }))
    await weights.prime(ETN)
    expect(await weights.weight(ETN)).toEqual({ value: ANCHOR / 4n, measured: true })
  })

  it('refuses a week too thin to average', async () => {
    // Three trades is not a week's price, whatever timestamps they carry.
    const { weights } = harness(() => ({ bolt: flat(0.002, NOW, 3), dyno: flat(1.6, NOW, 3) }))
    await weights.prime(ETN)
    expect(await weights.weight(ETN)).toEqual({ value: ANCHOR, measured: false })
  })

  it('refuses a series that only covers the last afternoon', async () => {
    const to = Math.floor(NOW / 1000)
    const recent = Array.from({ length: 24 }, (_, i) => ({ timestamp: to - 6 * 3600 + i * 900, value: 1.6 }))
    const { weights } = harness(() => ({ bolt: flat(0.002, NOW), dyno: recent }))
    await weights.prime(ETN)
    expect(await weights.weight(ETN)).toEqual({ value: ANCHOR, measured: false })
  })

  it('stops trusting a measurement that has gone stale', async () => {
    const { weights, clock } = harness(() => ({ bolt: flat(0.002, NOW), dyno: flat(1.6, NOW) }))
    await weights.prime(ETN)
    expect((await weights.weight(ETN)).measured).toBe(true)
    // Eight days later — a wallet that has been offline, or an indexer that has
    // been down. A week-old ratio is not a ratio.
    clock.now = NOW + 8 * 24 * 60 * 60 * 1000
    expect(await weights.weight(ETN)).toEqual({ value: ANCHOR, measured: false })
  })

  it('measures nothing on a chain with no BOLT to divide by', async () => {
    const { weights, calls } = harness(() => ({ bolt: flat(0.002, NOW), dyno: flat(1.6, NOW) }))
    // Testnet has DYNO and no BOLT, so its configured 1 BOLT-eq is a convention.
    await weights.prime(5201420)
    expect(await weights.weight(5201420)).toEqual({ value: 10n ** 18n, measured: false })
    expect(calls()).toBe(0)
  })
})

describe('twap', () => {
  it('weights a price by how long it held, not by how often it was sampled', async () => {
    // Ten samples at 1.0 crammed into an hour, then one at 2.0 that holds for
    // the remaining nine hours. A plain mean says 1.09; the truth is 1.9.
    const points = [...Array.from({ length: 10 }, (_, i) => ({ t: i * 360, v: 1 })), { t: 3600, v: 2 }]
    const out = twap(points, 0, 36_000)
    expect(out?.value).toBeCloseTo(1.9, 6)
    expect(out?.coverage).toBeCloseTo(1, 6)
  })

  it('reports the uncovered part of the window rather than extrapolating into it', async () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ t: 5_000 + i * 500, v: 3 }))
    const out = twap(points, 0, 10_000)
    expect(out?.value).toBeCloseTo(3, 6)
    expect(out?.coverage).toBeCloseTo(0.5, 6)
  })

  it('has nothing to say about too few samples', async () => {
    expect(twap([{ t: 0, v: 1 }, { t: 10, v: 2 }], 0, 100)).toBeNull()
  })
})
