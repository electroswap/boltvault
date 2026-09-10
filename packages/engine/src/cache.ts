/**
 * Serve stale, refresh behind it (plan A2). One logical entry per resource,
 * `{ value, observedAt }`, so a service-worker restart — which is what every
 * popup open amounts to — paints the last-good value at once. A single generic
 * `cache.changed { key }` event tells every open page to re-read; the value
 * never crosses the Port inside the event.
 *
 * Entries live inside DEK-sealed blobs, one per resource family, rather than
 * one plaintext document per key. The at-rest audit (2026-09-06, F2) read
 * prices, 1D/1W/1M/1Y price history, farm and launchpad holdings and per-NFT
 * balance counts straight off disk with the vault locked; worse, the *key*
 * `cache.nft.inventory.<chainId>.<accountId>` disclosed the account and its
 * holdings even before the value was read. Sharding by family keeps the blob a
 * bounded size to rewrite while removing chain, token and account identifiers
 * from the key space entirely (master plan §3.2).
 */
import { z, type ZodType } from 'zod'
import type { Platform } from '@boltvault/platform'
import type { EventBus } from './host'
import { SealedMap } from './sealed'

export interface Cached<T> {
  readonly value: T
  readonly observedAt: number
}

export function cachedSchema<T>(inner: ZodType<T>): ZodType<Cached<T>> {
  return z.object({ value: inner, observedAt: z.number().int().nonnegative() }) as unknown as ZodType<Cached<T>>
}

export interface CacheSpec<T> {
  /** Built with `cacheKey`; the UI builds the same key to match `cache.changed`. */
  readonly key: string
  readonly schema: ZodType<T>
  readonly version?: number
}

/** `cacheKey('explore', 'tokens', 52014)` → `explore.tokens.52014` — identical on both sides of the wire. */
export function cacheKey(...parts: ReadonlyArray<string | number>): string {
  return parts.map((p) => String(p).toLowerCase()).join('.')
}

/**
 * The stored entry, validated per-spec on read rather than per-shard: one blob
 * holds many resources whose value types differ.
 */
interface CachedRaw {
  value: unknown
  observedAt: number
}

const RAW_SCHEMA: ZodType<CachedRaw> = z.object({
  value: z.unknown(),
  observedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<CachedRaw>

/**
 * The family a cache key belongs to: its first two segments, which is the
 * non-variable part of every key `cacheKey` builds (`explore.history.<chain>.
 * <token>.<duration>` → `explore.history`).
 */
export function cacheShardOf(key: string): string {
  return key.split('.').slice(0, 2).join('.')
}

/** How many entries one family keeps before the least-recently-written is dropped. */
const SHARD_CAP = 128

/**
 * The sealed blobs behind the cache, created on demand per family. A cache
 * write is allowed to fail silently when the vault is locked (`whenLocked:
 * 'skip'`) — the background watchlist alarm runs locked and a dropped cache
 * write costs only a refetch, whereas throwing would break it.
 */
export class CacheShards {
  private readonly shards = new Map<string, SealedMap<CachedRaw>>()

  constructor(
    private readonly platform: Platform,
    private readonly dek: () => Promise<Uint8Array>,
  ) {}

  for(family: string): SealedMap<CachedRaw> {
    const existing = this.shards.get(family)
    if (existing) return existing
    const made = new SealedMap<CachedRaw>(this.platform, this.dek, {
      key: `cache.${family}.blob`,
      info: `bv/cache/${family}`,
      aad: `boltvault.cache.${family}.v1`,
      schema: RAW_SCHEMA,
      cap: SHARD_CAP,
      whenLocked: 'skip',
    })
    this.shards.set(family, made)
    return made
  }

  /** Forget every decrypted shard on lock. */
  forget(): void {
    for (const s of this.shards.values()) s.forget()
  }
}

export class DocCache {
  private readonly inflight = new Map<string, Promise<Cached<unknown>>>()

  constructor(
    private readonly shards: CacheShards,
    private readonly bus: EventBus,
    private readonly now: () => number,
  ) {}

  /** The last-good value, or null when nothing was written, the vault is locked, or it no longer validates. */
  async read<T>(spec: CacheSpec<T>): Promise<Cached<T> | null> {
    const shard = this.shards.for(cacheShardOf(spec.key))
    const raw = await shard.get(spec.key)
    if (!raw) return null
    const parsed = spec.schema.safeParse(raw.value)
    if (!parsed.success) {
      // Stale shape (a schema changed under it): drop it rather than keep an
      // entry nothing can read. Never copied aside — a quarantine copy of a
      // cache entry would be exactly the plaintext this module exists to avoid.
      await shard.delete(spec.key)
      return null
    }
    return { value: parsed.data, observedAt: raw.observedAt }
  }

  async write<T>(spec: CacheSpec<T>, value: T): Promise<Cached<T>> {
    const cached: Cached<T> = { value, observedAt: this.now() }
    await this.shards.for(cacheShardOf(spec.key)).set(spec.key, { value, observedAt: cached.observedAt })
    this.bus.emit({ type: 'cache.changed', key: spec.key, observedAt: cached.observedAt })
    return cached
  }

  /** Always loads (deduped per key while in flight); writes on success; on failure returns last-good, else rethrows. */
  refresh<T>(spec: CacheSpec<T>, load: () => Promise<T>): Promise<Cached<T>> {
    const running = this.inflight.get(spec.key)
    if (running) return running as Promise<Cached<T>>
    const p = (async (): Promise<Cached<T>> => {
      try {
        return await this.write(spec, await load())
      } catch (err) {
        const last = await this.read(spec)
        if (last) return last
        throw err
      }
    })()
    this.inflight.set(spec.key, p as Promise<Cached<unknown>>)
    const done = (): void => {
      if (this.inflight.get(spec.key) === p) this.inflight.delete(spec.key)
    }
    // The caller owns the rejection; this side only clears the slot.
    p.then(done, done)
    return p
  }

  /** Last-good when younger than `ttlMs`, else `refresh`. */
  async through<T>(spec: CacheSpec<T>, ttlMs: number, load: () => Promise<T>): Promise<Cached<T>> {
    const hit = await this.read(spec)
    if (hit && this.now() - hit.observedAt < ttlMs) return hit
    return this.refresh(spec, load)
  }

  async invalidate(key: string): Promise<void> {
    await this.shards.for(cacheShardOf(key)).delete(key)
    this.bus.emit({ type: 'cache.changed', key, observedAt: this.now() })
  }

  /** Drop every cached entry whose key names this account (used when an account is removed). */
  async forgetAccount(accountId: string): Promise<void> {
    const needle = accountId.toLowerCase()
    for (const family of KNOWN_SHARDS) {
      await this.shards.for(family).deleteWhere((k) => k.includes(needle))
    }
  }
}

/** Every family `cacheKey` can produce — needed to sweep without enumerating storage. */
const KNOWN_SHARDS = [
  'explore.tokens',
  'explore.tokendetail',
  'explore.history',
  'explore.liquidity',
  'explore.collections',
  'farm.list',
  'launchpad.list',
  'nft.inventory',
  'holder.tier',
  'holder.weight',
  'activity.scan',
] as const
