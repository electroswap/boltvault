/**
 * Watchlist and alerts (master plan §7.13, §8.14 Notifications): star a
 * token, collection or campaign; price / floor thresholds and "tell me when
 * it goes live"; plus the two position nudges — rewards to collect and
 * dividends to claim — at most once a day. Checks run on the platform's
 * alarm every five minutes (the extension's `chrome.alarms`; mobile push
 * takes over once the ElectroSwap watcher exists, B6) and notify through
 * the platform. Nothing here is a nag: every alert is opt-in per item.
 */
import { untrusted } from '@boltvault/security'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import type { SealedMap } from '../sealed'
import type { EventBus, NamespaceSpec } from '../host'
import { type WatchItem } from '../schema'
import type { VaultManager } from './vault'

/** What the checks read — handed in by `createEngine` as adapters, so this service depends on no other. */
/** How far either side of today's price a fresh watch fires. */
const DEFAULT_BAND = 0.1

/**
 * Round to three significant figures.
 *
 * A band has to read as a number a person would have typed. Fixed decimals
 * cannot do that across this range: ETN trades near $0.001 and a collection
 * floor near 4,000 ETN, so two decimal places would round the first to zero and
 * the second to noise. Significant figures give "0.00116" and "4400" from the
 * same rule.
 */
function sigFigs(n: number, digits = 3): number {
  if (!Number.isFinite(n) || n === 0) return 0
  const mag = Math.ceil(Math.log10(Math.abs(n)))
  const factor = 10 ** (digits - mag)
  return Math.round(n * factor) / factor
}

export interface WatchSources {
  tokens(chainId: number): Promise<ReadonlyArray<{ readonly address: string; readonly price: number | null }>>
  collections(chainId: number): Promise<ReadonlyArray<{ readonly address: string; readonly floorEtn: number | null }>>
  campaigns(chainId: number): Promise<ReadonlyArray<{ readonly pool: string; readonly phase: string }>>
  accessory(accountId: string, chainId: number): Promise<{ readonly kind: string; readonly text: string } | null>
}

export interface WatchlistDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly vault: VaultManager
  /** Watch items and nudge state, sealed under the DEK (one entry, id `all`). */
  readonly watchlist: SealedMap<{ items: WatchItem[]; nudgedAt: Record<string, number> }>
}

export const WATCH_ALARM = 'bv.watchlist'
const CHECK_EVERY_MS = 5 * 60_000
const NUDGE_EVERY_MS = 24 * 3_600_000

export class WatchlistService {
  private items: WatchItem[] = []
  private nudgedAt: Record<string, number> = {}
  private hydrated = false
  private sources: WatchSources | null = null

  constructor(private readonly deps: WatchlistDeps) {}

  /** Wire the sources after construction (they depend on this service for stars). */
  attach(sources: WatchSources): void {
    this.sources = sources
    this.deps.platform.alarms.onFire((name) => {
      if (name === WATCH_ALARM) void this.check().finally(() => this.schedule())
    })
    this.schedule()
  }

  private schedule(): void {
    void this.deps.platform.alarms.schedule(WATCH_ALARM, this.deps.platform.now() + CHECK_EVERY_MS).catch(() => undefined)
  }

  /**
   * Drop the decrypted list. Needed on *both* transitions: hydrating while
   * locked caches an empty list and sets `hydrated`, so without this the
   * service would keep serving "nothing watched" for the rest of the session.
   */
  forget(): void {
    this.hydrated = false
    this.items = []
    this.nudgedAt = {}
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return
    const value = (await this.deps.watchlist.get('all')) ?? { items: [], nudgedAt: {} }
    this.items = value.items
    this.nudgedAt = value.nudgedAt
    this.hydrated = true
  }

  private async persist(): Promise<void> {
    await this.deps.watchlist.set('all', { items: this.items, nudgedAt: this.nudgedAt })
    this.deps.bus.emit({ type: 'watchlist.changed', items: this.items })
  }

  /** Synchronous view for the services that mark stars. */
  cached(): WatchItem[] {
    return this.items
  }

  async list(): Promise<WatchItem[]> {
    await this.hydrate()
    return this.items
  }

  private key(kind: WatchItem['kind'], chainId: number, address: string): string {
    return `${kind}:${chainId}:${address.toLowerCase()}`
  }

  /**
   * Start watching something, with an alert band it can actually fire on.
   *
   * This used to write `above: null, below: null`, which made the star a
   * bookmark with no behaviour: nothing happened until the user found the
   * Notifications screen and typed a number into it. A beta tester starred a
   * collection, waited, and reported the control as broken — "seems like it has
   * no function" — then found the item sitting on the notifications tab as a
   * settings row, which read as stranger still.
   *
   * So watching means watching. The band is ±10% of what the thing is worth at
   * the moment you tap, which is a figure nobody has to think about and every
   * price alert starts from; the Notifications row is where you tune it
   * afterwards rather than where you have to go to make it work at all.
   *
   * `lastValue` is seeded with the same reading on purpose: `check()` fires on
   * a *crossing*, so without a baseline the first pass would see `null → price`
   * and could announce a move that never happened.
   */
  async star(input: { kind: WatchItem['kind']; chainId: number; address: string; label: string }): Promise<WatchItem[]> {
    await this.hydrate()
    const k = this.key(input.kind, input.chainId, input.address)
    if (!this.items.some((i) => this.key(i.kind, i.chainId, i.address) === k)) {
      const value = await this.valueNow(input.kind, input.chainId, input.address)
      const band = value !== null && value > 0 ? { above: sigFigs(value * (1 + DEFAULT_BAND)), below: sigFigs(value * (1 - DEFAULT_BAND)) } : { above: null, below: null }
      this.items = [...this.items, { kind: input.kind, chainId: input.chainId, address: input.address, label: untrusted(input.label, 32), above: band.above, below: band.below, onLive: input.kind === 'campaign', addedAt: this.deps.platform.now(), lastValue: value }]
      await this.persist()
    }
    return this.items
  }

  /**
   * What the watched thing is worth right now, or null if nothing can say.
   *
   * Reads the same sources `check()` does, so a band set here is expressed in
   * the units the check will later compare against — dollars for a token, ETN
   * for a collection floor. A campaign has no price; it watches `onLive`.
   */
  private async valueNow(kind: WatchItem['kind'], chainId: number, address: string): Promise<number | null> {
    const s = this.sources
    if (!s || kind === 'campaign') return null
    try {
      const at = address.toLowerCase()
      if (kind === 'token') return (await s.tokens(chainId)).find((t) => t.address.toLowerCase() === at)?.price ?? null
      return (await s.collections(chainId)).find((c) => c.address.toLowerCase() === at)?.floorEtn ?? null
    } catch {
      // A band is a convenience; failing to read a price must not refuse the watch.
      return null
    }
  }

  async unstar(input: { kind: WatchItem['kind']; chainId: number; address: string }): Promise<WatchItem[]> {
    await this.hydrate()
    const k = this.key(input.kind, input.chainId, input.address)
    this.items = this.items.filter((i) => this.key(i.kind, i.chainId, i.address) !== k)
    await this.persist()
    return this.items
  }

  async setAlert(input: { kind: WatchItem['kind']; chainId: number; address: string; above: number | null; below: number | null; onLive: boolean }): Promise<WatchItem[]> {
    await this.hydrate()
    const k = this.key(input.kind, input.chainId, input.address)
    this.items = this.items.map((i) => (this.key(i.kind, i.chainId, i.address) === k ? { ...i, above: input.above, below: input.below, onLive: input.onLive } : i))
    await this.persist()
    return this.items
  }

  /** One pass: thresholds crossed, campaigns gone live, positions worth a nudge. Returns what was sent. */
  async check(): Promise<string[]> {
    // The watch list is sealed under the DEK, so a locked wallet cannot read
    // what to watch or record what it nudged. The alarm used to run regardless,
    // which also meant it wrote account-scoped cache entries while locked.
    // Alerts now surface at the next unlock instead of on a locked device —
    // which is also the more private behaviour for a lock-screen notification.
    if (!(await this.deps.vault.isUnlocked())) return []
    await this.hydrate()
    const s = this.sources
    if (!s) return []
    const sent: string[] = []
    const notify = async (title: string, body: string, tag: string): Promise<void> => {
      await this.deps.platform.notify({ title, body, tag }).catch(() => undefined)
      sent.push(tag)
    }
    const chainIds = [...new Set(this.items.map((i) => i.chainId))]
    let changed = false
    for (const chainId of chainIds) {
      const tokens = this.items.some((i) => i.kind === 'token' && i.chainId === chainId) ? await s.tokens(chainId) : []
      const collections = this.items.some((i) => i.kind === 'collection' && i.chainId === chainId) ? await s.collections(chainId) : []
      const campaigns = this.items.some((i) => i.kind === 'campaign' && i.chainId === chainId && i.onLive) ? await s.campaigns(chainId) : []
      this.items = await Promise.all(
        this.items.map(async (i) => {
          if (i.chainId !== chainId) return i
          let value: number | null = i.lastValue
          if (i.kind === 'token') value = tokens.find((t) => t.address.toLowerCase() === i.address.toLowerCase())?.price ?? i.lastValue
          else if (i.kind === 'collection') value = collections.find((c) => c.address.toLowerCase() === i.address.toLowerCase())?.floorEtn ?? i.lastValue
          else {
            const c = campaigns.find((x) => x.pool.toLowerCase() === i.address.toLowerCase())
            value = c ? (c.phase === 'live' ? 1 : 0) : i.lastValue
          }
          if (value !== i.lastValue) changed = true
          if (i.kind === 'campaign') {
            if (i.onLive && value === 1 && i.lastValue !== 1) await notify(`${i.label} is live`, 'The campaign is taking contributions now.', `live:${i.address}`)
            return { ...i, lastValue: value }
          }
          const prev = i.lastValue
          if (value !== null && prev !== null) {
            const unit = i.kind === 'token' ? '$' : ''
            const suffix = i.kind === 'token' ? '' : ' ETN'
            if (i.above !== null && prev < i.above && value >= i.above) await notify(`${i.label} above ${unit}${i.above}${suffix}`, `Now ${unit}${value}${suffix}.`, `above:${i.kind}:${i.address}`)
            if (i.below !== null && prev > i.below && value <= i.below) await notify(`${i.label} below ${unit}${i.below}${suffix}`, `Now ${unit}${value}${suffix}.`, `below:${i.kind}:${i.address}`)
          }
          return { ...i, lastValue: value }
        }),
      )
    }
    // The two position nudges, once a day each (§7.13 Collect, Legends dividends).
    const active = await this.deps.vault.active().catch(() => null)
    const unlocked = (await this.deps.vault.status().catch(() => null))?.unlocked === true
    if (active && unlocked) {
      const acc = await s.accessory(active.id, 52014).catch(() => null)
      if (acc && (acc.kind === 'collect' || acc.kind === 'dividends')) {
        const key = `${acc.kind}:${active.id}`
        const last = this.nudgedAt[key] ?? 0
        if (this.deps.platform.now() - last > NUDGE_EVERY_MS) {
          await notify(acc.kind === 'collect' ? 'Rewards to collect' : 'Dividends to claim', acc.text, key)
          this.nudgedAt = { ...this.nudgedAt, [key]: this.deps.platform.now() }
          changed = true
        }
      }
    }
    if (changed) await this.persist()
    return sent
  }
}

const Key = z.object({ kind: z.enum(['token', 'collection', 'campaign']), chainId: z.number().int().positive(), address: z.string() })

export function watchlistNamespace(watchlist: WatchlistService): NamespaceSpec {
  return {
    list: { handler: () => watchlist.list() },
    star: { input: Key.extend({ label: z.string().max(64) }), handler: (arg) => watchlist.star(arg as { kind: WatchItem['kind']; chainId: number; address: string; label: string }) },
    unstar: { input: Key, handler: (arg) => watchlist.unstar(arg as { kind: WatchItem['kind']; chainId: number; address: string }) },
    setAlert: { input: Key.extend({ above: z.number().nullable(), below: z.number().nullable(), onLive: z.boolean() }), handler: (arg) => watchlist.setAlert(arg as { kind: WatchItem['kind']; chainId: number; address: string; above: number | null; below: number | null; onLive: boolean }) },
    check: { handler: () => watchlist.check() },
  }
}
