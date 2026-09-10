/**
 * `dynoWeight` — how much BOLT one DYNO counts for on the fee ladder —
 * measured from the market instead of typed into `fees.json`.
 *
 * The static number was 875.68, computed by hand from the two USD prices on
 * the day the ladder was written. It is a *ratio of two prices that move
 * independently*, so it starts wrong the moment it is committed: at the time
 * this was written the week's real ratio was ~829, and a DYNO holder was being
 * credited about 6 % more BOLT-equivalent than a DYNO was actually worth. It
 * only gets worse the longer nobody notices, and correcting it means a release.
 *
 * So the wallet measures it. `fees.json` keeps its number as the anchor and
 * the fallback; when a measurement is available and sane, it wins.
 *
 * Three properties make that safe to put on the signing path:
 *
 * 1. **It never fetches inline.** `weight()` answers from memory or from the
 *    document cache and, at worst, schedules a refresh for later. A tier read
 *    at sign time makes exactly the same two `balanceOf` calls it made before.
 * 2. **It is a time-weighted average over a week, not a spot price.** A spot
 *    ratio off a thin pair is a number an attacker can choose: one trade before
 *    signing, and DYNO is worth whatever they need it to be. Integrating over
 *    seven days means moving it costs seven days of holding the pair away from
 *    its true price. `WEEK` is also the shortest window ElectroSwap actually
 *    has enough DYNO points in — `DAY` returned one point when this was
 *    measured, which is why `MIN_POINTS` rejects it rather than averaging it.
 * 3. **It is clamped to a band around the configured anchor.** A feed that
 *    breaks, lies, or returns a decimal-shifted price cannot hand somebody the
 *    top tier or strip a legitimate holder of theirs — the worst it can do is
 *    move them within `dynoWeightBand`× of the number ops committed.
 *
 * When any of that fails — no indexer, too few points, a gappy window, a
 * measurement older than `MAX_AGE_MS` — the answer is the configured constant,
 * which is exactly the behaviour this file replaced.
 */
import { ELECTRONEUM_ADDRESSES, walletFeeConfig } from '@boltvault/chains'
import { DYNO_WEIGHT_ONE, fetchPriceHistory, type ElectroSwapClient, type HistoryDuration } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { cacheKey, type DocCache } from './cache'

/** The averaging window. See §2 above for why it is not `DAY`. */
const WINDOW: HistoryDuration = 'WEEK'
const WINDOW_SEC = 7 * 24 * 60 * 60

/**
 * Samples a series needs before it is allowed to speak for a week.
 *
 * Coverage alone is not enough: two trades a week apart cover the window
 * completely and describe nothing. Measured live, BOLT gave 34 points over a
 * week and DYNO 20, so this rejects a genuinely thin feed without rejecting
 * the thin end of a normal one.
 */
const MIN_POINTS = 8
/** How much of the window the samples must actually span. */
const MIN_COVERAGE = 0.5

/** How old a measurement may be before a new one is fetched behind it. */
const REFRESH_MS = 6 * 60 * 60 * 1000
/** How old a measurement may be before it stops being used at all. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
/** How long to leave the indexer alone after a failed measurement. */
const RETRY_MS = 30 * 60 * 1000

/** Six decimal places of a ratio in the hundreds is far more than the fee needs. */
const RATIO_SCALE = 1_000_000
const RATIO_ONE = 1_000_000n

const weightSpec = (chainId: number) => ({ key: cacheKey('holder', 'weight', chainId), schema: z.string().regex(/^\d+$/) })

/** What one DYNO is worth in BOLT, and whether that is a measurement or the committed constant. */
export interface DynoWeightValue {
  readonly value: bigint
  readonly measured: boolean
}

export interface DynoWeightDeps {
  readonly platform: Platform
  /** Null on a build with no indexer, and in most tests: the constant is then the whole answer. */
  readonly electroswap: ElectroSwapClient | null
  readonly cache?: DocCache
}

/**
 * A step-integrated time-weighted average over `[from, to]`, in seconds.
 *
 * Each sample holds until the next one, which is what a price does between
 * trades; a plain mean of the points would instead weight a quiet Tuesday the
 * same as a busy Friday and let a burst of trades drag the week. Integration
 * starts at the first sample rather than extrapolating backwards, and
 * `coverage` reports how much of the window that left uncovered so the caller
 * can refuse a series that only exists for the last afternoon.
 */
export function twap(points: ReadonlyArray<{ t: number; v: number }>, from: number, to: number): { value: number; coverage: number } | null {
  const pts = points.filter((p) => Number.isFinite(p.v) && p.v > 0 && p.t <= to).sort((a, b) => a.t - b.t)
  if (pts.length < MIN_POINTS || to <= from) return null
  let held = 0
  let sum = 0
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    if (p === undefined) continue
    const start = Math.max(p.t, from)
    const end = Math.min(pts[i + 1]?.t ?? to, to)
    if (end <= start) continue
    sum += p.v * (end - start)
    held += end - start
  }
  if (held <= 0) return null
  return { value: sum / held, coverage: held / (to - from) }
}

export class DynoWeight {
  private readonly live = new Map<number, { at: number; weight: bigint }>()
  private readonly hydrated = new Set<number>()
  private readonly inflight = new Map<number, Promise<void>>()
  private readonly cooldown = new Map<number, number>()

  constructor(private readonly deps: DynoWeightDeps) {}

  /**
   * BOLT-equivalent per DYNO for this chain, as an 18-decimal fixed point.
   *
   * Answers from memory or the document cache; a measurement it wants to renew
   * is fetched behind the answer, never in front of it.
   */
  async weight(chainId: number): Promise<DynoWeightValue> {
    const config = walletFeeConfig(chainId)
    const anchor = BigInt(config?.dynoWeight ?? '0')
    const fixed: DynoWeightValue = { value: anchor, measured: false }
    if (!this.measurable(chainId)) return fixed

    await this.hydrate(chainId)
    const now = this.deps.platform.now()
    const held = this.live.get(chainId)
    const age = held ? now - held.at : Number.POSITIVE_INFINITY
    if (age >= REFRESH_MS) void this.refresh(chainId).catch(() => undefined)
    if (!held || age >= MAX_AGE_MS) return fixed
    return { value: held.weight, measured: true }
  }

  /**
   * Measure now and wait for it — the one entry point that does hold a caller
   * for the network, which is why nothing on the signing path calls it. Tests
   * use it; so could a warm-up that wants a measured ladder on first paint.
   * Resolves either way: a failed measurement leaves the anchor in place.
   */
  async prime(chainId: number): Promise<void> {
    if (!this.measurable(chainId)) return
    await this.hydrate(chainId)
    await this.refresh(chainId).catch(() => undefined)
  }

  /**
   * Whether this chain has a ratio to measure at all.
   *
   * Testnet does not: it has a DYNO but no BOLT (`bolt: null`), so its
   * configured weight of 1 BOLT-eq is a convention for exercising the tiers
   * rather than a price, and there is nothing to divide.
   */
  private measurable(chainId: number): boolean {
    const config = walletFeeConfig(chainId)
    if (!config || config.dynoWeightBand <= 1 || BigInt(config.dynoWeight) <= 0n) return false
    if (this.deps.electroswap === null) return false
    return Boolean(pair(chainId))
  }

  private async hydrate(chainId: number): Promise<void> {
    if (this.hydrated.has(chainId)) return
    this.hydrated.add(chainId)
    const last = await this.deps.cache?.read(weightSpec(chainId)).catch(() => null)
    // Only if nothing newer landed while the (sealed, therefore async) read ran.
    if (last && !this.live.has(chainId)) this.live.set(chainId, { at: last.observedAt, weight: BigInt(last.value) })
  }

  private refresh(chainId: number): Promise<void> {
    const running = this.inflight.get(chainId)
    if (running) return running
    const now = this.deps.platform.now()
    const until = this.cooldown.get(chainId) ?? 0
    if (now < until) return Promise.resolve()
    const run = this.measure(chainId)
      .then((weight) => {
        if (weight === null) {
          this.cooldown.set(chainId, this.deps.platform.now() + RETRY_MS)
          return
        }
        this.live.set(chainId, { at: this.deps.platform.now(), weight })
        this.cooldown.delete(chainId)
        return this.deps.cache
          ?.write(weightSpec(chainId), weight.toString())
          .then(() => undefined)
          .catch(() => undefined)
      })
      .catch(() => {
        this.cooldown.set(chainId, this.deps.platform.now() + RETRY_MS)
      })
      .finally(() => {
        if (this.inflight.get(chainId) === run) this.inflight.delete(chainId)
      })
    this.inflight.set(chainId, run)
    return run
  }

  /** One measurement, clamped to the configured band; null when the feed cannot support one. */
  private async measure(chainId: number): Promise<bigint | null> {
    const client = this.deps.electroswap
    const config = walletFeeConfig(chainId)
    const tokens = pair(chainId)
    if (!client || !config || !tokens) return null
    const [bolt, dyno] = await Promise.all([fetchPriceHistory(client, chainId, tokens.bolt, WINDOW), fetchPriceHistory(client, chainId, tokens.dyno, WINDOW)])
    if (!bolt || !dyno) return null
    const to = Math.floor(this.deps.platform.now() / 1000)
    const from = to - WINDOW_SEC
    const b = twap(bolt.points, from, to)
    const d = twap(dyno.points, from, to)
    if (!b || !d || b.coverage < MIN_COVERAGE || d.coverage < MIN_COVERAGE || b.value <= 0) return null
    const ratio = d.value / b.value
    if (!Number.isFinite(ratio) || ratio <= 0) return null
    const weight = (BigInt(Math.round(ratio * RATIO_SCALE)) * DYNO_WEIGHT_ONE) / RATIO_ONE
    return clamp(weight, BigInt(config.dynoWeight), BigInt(config.dynoWeightBand))
  }
}

/** BOLT and DYNO on a chain that has both; null anywhere else. */
function pair(chainId: number): { bolt: string; dyno: string } | null {
  if (chainId !== 52014 && chainId !== 5201420) return null
  const a = ELECTRONEUM_ADDRESSES[chainId]
  return a.bolt ? { bolt: a.bolt, dyno: a.dyno } : null
}

/** Never further than `band`× from the committed anchor, in either direction. */
function clamp(measured: bigint, anchor: bigint, band: bigint): bigint {
  const max = anchor * band
  const min = anchor / band
  if (measured > max) return max
  if (measured < min) return min
  return measured
}
