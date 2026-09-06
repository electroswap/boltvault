/**
 * SealedMap: the DEK-sealed blob that replaces plaintext per-account keys
 * (at-rest audit 2026-09-06, master plan §3.2).
 */
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { z } from 'zod'
import { EngineError } from '../src/errors'
import { SealedMap } from '../src/sealed'

const SCHEMA = z.object({ total: z.number(), symbol: z.string() })
type Row = z.infer<typeof SCHEMA>

function boot(opts: { locked?: boolean; cap?: number; whenLocked?: 'throw' | 'skip' } = {}) {
  const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
  let locked = opts.locked ?? false
  const dek = async (): Promise<Uint8Array> => {
    if (locked) throw new EngineError('locked', 'the vault is locked')
    return new Uint8Array(32).fill(7)
  }
  const map = new SealedMap<Row>(platform, dek, {
    key: 'portfolio.blob',
    info: 'bv/portfolio',
    aad: 'boltvault.portfolio.v1',
    schema: SCHEMA,
    ...(opts.cap !== undefined ? { cap: opts.cap } : {}),
    ...(opts.whenLocked ? { whenLocked: opts.whenLocked } : {}),
  })
  return { platform, map, lock: (): void => { locked = true }, unlock: (): void => { locked = false } }
}

describe('SealedMap', () => {
  it('round-trips entries and leaves no plaintext on disk', async () => {
    const { platform, map } = boot()
    await map.set('acct_4ea7f813c364ab11', { total: 20645.81, symbol: 'ETN' })
    expect(await map.get('acct_4ea7f813c364ab11')).toEqual({ total: 20645.81, symbol: 'ETN' })

    // The whole point: neither the account id nor the value is on disk.
    const raw = (await platform.storage.local.get('portfolio.blob')) ?? ''
    expect(raw).not.toContain('acct_4ea7f813c364ab11')
    expect(raw).not.toContain('20645')
    expect(raw).not.toContain('ETN')
    expect(JSON.parse(raw)).toEqual({ nonce: expect.any(String), ct: expect.any(String) })

    // ...and the account id is not in the key space either.
    expect(await platform.storage.local.keys()).toEqual(['portfolio.blob'])
  })

  it('survives a restart — a second instance over the same storage reads it back', async () => {
    const { platform, map } = boot()
    await map.set('a', { total: 1, symbol: 'X' })
    const again = new SealedMap<Row>(platform, async () => new Uint8Array(32).fill(7), {
      key: 'portfolio.blob',
      info: 'bv/portfolio',
      aad: 'boltvault.portfolio.v1',
      schema: SCHEMA,
    })
    expect(await again.get('a')).toEqual({ total: 1, symbol: 'X' })
  })

  it('reads empty while locked and never throws, then returns after unlock', async () => {
    const { map, lock, unlock } = boot()
    await map.set('a', { total: 1, symbol: 'X' })
    lock()
    map.forget()
    expect(await map.get('a')).toBeNull()
    expect(await map.entries()).toEqual({})
    expect(await map.ids()).toEqual([])
    unlock()
    expect(await map.get('a')).toEqual({ total: 1, symbol: 'X' })
  })

  it('throws locked on a durable write, so the caller cannot silently lose state', async () => {
    const { map, lock } = boot()
    lock()
    map.forget()
    await expect(map.set('a', { total: 1, symbol: 'X' })).rejects.toThrow(/locked/)
  })

  it("skips a locked write when configured 'skip', which is what a cache needs", async () => {
    const { map, lock } = boot({ whenLocked: 'skip' })
    lock()
    map.forget()
    expect(await map.set('a', { total: 1, symbol: 'X' })).toBe(false)
  })

  it('caps entries by eviction order even when ids are integer-like chain ids', async () => {
    const { map } = boot({ cap: 2 })
    await map.set('52014', { total: 1, symbol: 'A' })
    await map.set('1', { total: 2, symbol: 'B' })
    await map.set('137', { total: 3, symbol: 'C' })
    // '52014' was written first, so it is the one evicted.
    expect(await map.ids()).toEqual(['1', '137'])
    expect(await map.get('52014')).toBeNull()
  })

  it('re-writing an entry refreshes its position rather than duplicating it', async () => {
    const { map } = boot({ cap: 2 })
    await map.set('a', { total: 1, symbol: 'A' })
    await map.set('b', { total: 2, symbol: 'B' })
    await map.set('a', { total: 9, symbol: 'A' })
    await map.set('c', { total: 3, symbol: 'C' })
    // 'b' is now the oldest, not 'a'.
    expect(await map.ids()).toEqual(['a', 'c'])
    expect(await map.get('a')).toEqual({ total: 9, symbol: 'A' })
  })

  it('purges by predicate — the path that cleans up a removed account', async () => {
    const { map } = boot()
    await map.set('acct_keep.52014', { total: 1, symbol: 'A' })
    await map.set('acct_drop.52014', { total: 2, symbol: 'B' })
    await map.deleteWhere((id) => id.startsWith('acct_drop'))
    expect(await map.ids()).toEqual(['acct_keep.52014'])
  })

  it('treats a foreign key or tampered blob as empty and never overwrites it silently', async () => {
    const { platform, map } = boot()
    await map.set('a', { total: 1, symbol: 'X' })
    const before = await platform.storage.local.get('portfolio.blob')

    const wrongKey = new SealedMap<Row>(platform, async () => new Uint8Array(32).fill(9), {
      key: 'portfolio.blob',
      info: 'bv/portfolio',
      aad: 'boltvault.portfolio.v1',
      schema: SCHEMA,
    })
    expect(await wrongKey.get('a')).toBeNull()
    expect(await platform.storage.local.get('portfolio.blob')).toBe(before)
  })

  it('separates blobs derived with a different info string', async () => {
    const { platform, map } = boot()
    await map.set('a', { total: 1, symbol: 'X' })
    const other = new SealedMap<Row>(platform, async () => new Uint8Array(32).fill(7), {
      key: 'other.blob',
      info: 'bv/other',
      aad: 'boltvault.other.v1',
      schema: SCHEMA,
    })
    expect(await other.get('a')).toBeNull()
  })
})
