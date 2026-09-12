/**
 * The published fee ladder: `GET /api/wallet/fees?chainId=` (§8.18).
 *
 * The rungs live in the service now (`services/api`,
 * `src/config/walletFeeTiers.ts`) so ops can re-tune them without a wallet
 * release, and so the docs site and the wallet cannot disagree about what a
 * tier is worth. `fees.json` stays in the build as the offline fallback and,
 * more importantly, as the ceiling: `applyServedLadder` refuses any ladder
 * that would charge more than the bundled one at any score, so a compromised
 * answer can cost us revenue but can never cost a holder their discount.
 *
 * Everything here fails quietly. A wallet that could not reach the service, or
 * got something it did not like, keeps charging the bundled ladder — which is
 * a correct fee schedule, just possibly an old one. There is no degraded state
 * to explain to anybody.
 */
import { applyServedLadder, type ServedLadder } from '@boltvault/chains'
import { authHeaders } from './apiAuth'

/** A whole BOLT figure from the service, as the 18-decimal string the wallet works in. */
function toWei(amount: number): string {
  if (!Number.isFinite(amount) || amount < 0) return '0'
  const [whole = '0', fraction = ''] = amount.toFixed(18).split('.')
  return `${BigInt(whole) * 10n ** 18n + BigInt(fraction.padEnd(18, '0').slice(0, 18))}`
}

interface ServedTierJson {
  readonly name: string
  readonly minScoreBolt: number
  readonly bips: number
}

interface ServedFeesJson {
  readonly baseName: string
  readonly baseBips: number
  readonly tiers: readonly ServedTierJson[]
  readonly dynoWeightBolt: number
  readonly dynoWeightBand: number
  readonly countFarmBolt: boolean
}

/** Narrow the response by hand: the engine's boundary rule, and zod is not needed for seven fields. */
function parse(body: unknown): ServedFeesJson | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  const tiers = b['tiers']
  if (typeof b['baseName'] !== 'string' || typeof b['baseBips'] !== 'number' || !Array.isArray(tiers)) return null
  if (typeof b['dynoWeightBolt'] !== 'number' || typeof b['dynoWeightBand'] !== 'number') return null
  if (typeof b['countFarmBolt'] !== 'boolean') return null
  const parsed: ServedTierJson[] = []
  for (const tier of tiers) {
    if (typeof tier !== 'object' || tier === null) return null
    const t = tier as Record<string, unknown>
    if (typeof t['name'] !== 'string' || typeof t['minScoreBolt'] !== 'number' || typeof t['bips'] !== 'number') return null
    parsed.push({ name: t['name'], minScoreBolt: t['minScoreBolt'], bips: t['bips'] })
  }
  return {
    baseName: b['baseName'],
    baseBips: b['baseBips'],
    tiers: parsed,
    dynoWeightBolt: b['dynoWeightBolt'],
    dynoWeightBand: b['dynoWeightBand'],
    countFarmBolt: b['countFarmBolt'],
  }
}

function toLadder(json: ServedFeesJson): ServedLadder {
  return {
    baseName: json.baseName,
    baseBips: json.baseBips,
    tiers: json.tiers.map((tier) => ({ name: tier.name, minScore: toWei(tier.minScoreBolt), bips: tier.bips })),
    dynoWeight: toWei(json.dynoWeightBolt),
    dynoWeightBand: json.dynoWeightBand,
    countFarmBolt: json.countFarmBolt,
  }
}

export interface FeeLadderDeps {
  readonly fetch: typeof fetch
  readonly url: string
  readonly key?: string | undefined
  readonly now: () => number
}

/** A ladder is re-read at most this often; it changes on a deploy, not on a block. */
const REFRESH_MS = 6 * 60 * 60 * 1000
/** After a failure, wait this long before trying again rather than on every quote. */
const RETRY_MS = 10 * 60 * 1000

export class FeeLadders {
  private readonly checked = new Map<number, number>()
  private readonly inflight = new Map<number, Promise<void>>()

  constructor(private readonly deps: FeeLadderDeps) {}

  /**
   * Make sure this chain's ladder is as fresh as it needs to be, then return.
   *
   * Callers await this on a path that must not stall — a swap quote — so it
   * resolves immediately when the ladder was read recently, and a fetch that
   * fails resolves rather than rejecting.
   */
  async ensure(chainId: number): Promise<void> {
    const last = this.checked.get(chainId)
    if (last !== undefined && this.deps.now() - last < REFRESH_MS) return
    const running = this.inflight.get(chainId)
    if (running) return running
    const run = this.load(chainId)
    this.inflight.set(chainId, run)
    try {
      await run
    } finally {
      this.inflight.delete(chainId)
    }
  }

  private async load(chainId: number): Promise<void> {
    try {
      const url = `${this.deps.url}?chainId=${String(chainId)}`
      /*
        Bounded, because `holder.scheduleFrom` awaits this and Home awaits that.

        Without a deadline an unreachable-but-not-refusing host holds the fee
        ladder open for the browser's default timeout, and the holder tier — and
        therefore Home's first paint and the Field's warmth — waits behind it.
        Six seconds is what `prices.ts` uses for the same reason. The catch below
        already treats a failure as "try again in a bit", so a slow network costs
        a stale ladder, never a stalled screen.
      */
      // The key never travels; a per-request signature does (§9.1, `apiAuth`).
      const response = await this.deps.fetch(url, {
        headers: { accept: 'application/json', ...(this.deps.key ? authHeaders({ key: this.deps.key, method: 'GET', url, now: this.deps.now() }) : {}) },
        signal: AbortSignal.timeout(6_000),
      })
      // 404 means this chain has no in-wallet swap, which is an answer, not a
      // failure — do not keep asking.
      if (!response.ok) {
        this.checked.set(chainId, response.status === 404 ? this.deps.now() : this.deps.now() - REFRESH_MS + RETRY_MS)
        return
      }
      const json = parse(await response.json())
      if (json) applyServedLadder(chainId, toLadder(json))
      this.checked.set(chainId, this.deps.now())
    } catch {
      this.checked.set(chainId, this.deps.now() - REFRESH_MS + RETRY_MS)
    }
  }
}
