/**
 * Serve stale, refresh behind it (plan A2). One persisted document per
 * resource, `{ value, observedAt }`, over the same `readDoc`/`writeDoc`
 * envelope everything else uses, so a service-worker restart — which is what
 * every popup open amounts to — paints the last-good value at once. A single
 * generic `cache.changed { key }` event tells every open page to re-read;
 * the value never crosses the Port inside the event.
 */
import type { KeyValueStore } from '@boltvault/platform'
import { z, type ZodType } from 'zod'
import type { EventBus } from './host'
import { readDoc, writeDoc, type DocSpec } from './storage'

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

export class DocCache {
  private readonly inflight = new Map<string, Promise<Cached<unknown>>>()

  constructor(
    private readonly store: KeyValueStore,
    private readonly bus: EventBus,
    private readonly now: () => number,
  ) {}

  private doc<T>(spec: CacheSpec<T>): DocSpec<Cached<T> | null> {
    return { key: `cache.${spec.key}`, version: spec.version ?? 1, schema: cachedSchema(spec.schema).nullable(), defaultValue: () => null }
  }

  /** The last-good value, or null when nothing was ever written (or it failed validation and was quarantined). */
  async read<T>(spec: CacheSpec<T>): Promise<Cached<T> | null> {
    return (await readDoc(this.store, this.doc(spec), this.now)).value
  }

  async write<T>(spec: CacheSpec<T>, value: T): Promise<Cached<T>> {
    const cached: Cached<T> = { value, observedAt: this.now() }
    await writeDoc(this.store, this.doc(spec), cached)
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
    await this.store.remove(`cache.${key}`)
    this.bus.emit({ type: 'cache.changed', key, observedAt: this.now() })
  }
}
