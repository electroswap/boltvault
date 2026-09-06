/**
 * DocCache (plan A2): last-good on disk, one generic `cache.changed`, dedupe
 * in flight, fall back to the last value when a load fails.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { z } from 'zod'
import { DocCache, cacheKey } from '../src/cache'
import { EventBus } from '../src/host'
import type { EngineEvent } from '../src/schema'

const SPEC = { key: cacheKey('explore', 'tokens', 52014), schema: z.array(z.string()) }

function boot(now = 1_700_000_000_000) {
  const platform = createMemoryPlatform({ now })
  const bus = new EventBus()
  const events: EngineEvent[] = []
  bus.subscribe((e) => events.push(e))
  const cache = new DocCache(platform.storage.local, bus, () => platform.now())
  return { platform, bus, events, cache }
}

describe('cacheKey', () => {
  it('lowercases and dot-joins, so an address matches however it was cased', () => {
    expect(cacheKey('explore', 'TokenDetail', 52014, '0xABC')).toBe('explore.tokendetail.52014.0xabc')
  })
})

describe('DocCache', () => {
  it('reads null before any write, then the written value with its observedAt, and announces the key', async () => {
    const { cache, events, platform } = boot()
    expect(await cache.read(SPEC)).toBeNull()
    const written = await cache.write(SPEC, ['ETN', 'BOLT'])
    expect(written).toEqual({ value: ['ETN', 'BOLT'], observedAt: platform.now() })
    expect(await cache.read(SPEC)).toEqual(written)
    expect(events).toEqual([{ type: 'cache.changed', key: SPEC.key, observedAt: platform.now() }])
  })

  it('through() serves a young value without loading and refreshes an old one', async () => {
    const { cache, platform } = boot()
    let loads = 0
    const load = async (): Promise<string[]> => {
      loads += 1
      return [`load-${loads}`]
    }
    expect((await cache.through(SPEC, 60_000, load)).value).toEqual(['load-1'])
    expect((await cache.through(SPEC, 60_000, load)).value).toEqual(['load-1'])
    expect(loads).toBe(1)
    await platform.clock.advance(61_000)
    expect((await cache.through(SPEC, 60_000, load)).value).toEqual(['load-2'])
    expect(loads).toBe(2)
  })

  it('refresh() dedupes concurrent loads per key', async () => {
    const { cache } = boot()
    let loads = 0
    let release: (v: string[]) => void = () => undefined
    const load = (): Promise<string[]> => {
      loads += 1
      return new Promise((resolve) => {
        release = resolve
      })
    }
    const a = cache.refresh(SPEC, load)
    const b = cache.refresh(SPEC, load)
    release(['one'])
    expect((await a).value).toEqual(['one'])
    expect((await b).value).toEqual(['one'])
    expect(loads).toBe(1)
    // The slot is clear afterwards: a new refresh loads again.
    const c = cache.refresh(SPEC, load)
    release(['two'])
    expect((await c).value).toEqual(['two'])
    expect(loads).toBe(2)
  })

  it('a failed load returns the last-good value; with nothing cached it rethrows', async () => {
    const { cache, platform } = boot()
    const boom = async (): Promise<string[]> => {
      throw new Error('offline')
    }
    await expect(cache.refresh(SPEC, boom)).rejects.toThrow('offline')
    await cache.write(SPEC, ['kept'])
    const at = platform.now()
    await platform.clock.advance(5_000)
    const got = await cache.refresh(SPEC, boom)
    expect(got).toEqual({ value: ['kept'], observedAt: at })
  })

  it('invalidate() removes the document and announces the key', async () => {
    const { cache, events } = boot()
    await cache.write(SPEC, ['x'])
    await cache.invalidate(SPEC.key)
    expect(await cache.read(SPEC)).toBeNull()
    expect(events.map((e) => e.type)).toEqual(['cache.changed', 'cache.changed'])
  })

  it('a document that no longer validates reads as null instead of throwing', async () => {
    const { cache, platform } = boot()
    await cache.write(SPEC, ['x'])
    // Same key, stricter schema: the stored strings are not numbers.
    const strict = { key: SPEC.key, schema: z.array(z.number()) }
    expect(await cache.read(strict)).toBeNull()
    expect(platform.now()).toBeGreaterThan(0)
  })
})
