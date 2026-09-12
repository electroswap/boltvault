/**
 * A blob that will not open is not an empty blob (ES-BV-012).
 *
 * `SealedMap` learned this; the activity log and the address book did not.
 * Both set their cache to `[]` on a failed decrypt and the next write put that
 * empty list straight over the ciphertext — so one transient wrong key (an
 * interrupted migration, a vault restored from an export beside an older
 * blob) took the write-ahead history and every saved name with it, silently.
 * Losing the address book is worse than it sounds: it is the reference set the
 * firewall's lookalike check reads.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, expect, it } from 'vitest'
import { ActivityStore } from '../src/activityStore'
import { EventBus } from '../src/host'
import { ContactsStore } from '../src/namespaces/contacts'
import type { ActivityEntry } from '../src/schema'

const entry = (id: string): ActivityEntry => ({
  id,
  hash: null,
  chainId: 52014,
  accountId: 'acct-1',
  to: '0x2222222222222222222222222222222222222222',
  value: '1',
  nonce: 1,
  submittedAt: 1_700_000_000_000,
  origin: 'internal:send',
  category: 'SEND',
  statements: ['Send 1 ETN'],
  riskCodes: [],
  status: 'pending',
  blockNumber: null,
})

const dekOf = (fill: number) => async (): Promise<Uint8Array> => new Uint8Array(32).fill(fill)

describe('the activity log under a key that does not open it', () => {
  it('refuses to write over the ciphertext, and keeps a copy of it', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    const bus = new EventBus()
    const mine = new ActivityStore(platform, bus, dekOf(7))
    await mine.append(entry('a'))
    const sealed = await platform.storage.local.get('activity.blob')
    expect(sealed).toBeTruthy()

    // The same storage, a different DEK: the migration-gone-wrong shape.
    const stranger = new ActivityStore(platform, bus, dekOf(9))
    expect(await stranger.list({})).toEqual([])
    await expect(stranger.append(entry('b'))).rejects.toThrow(/set aside|will not be overwritten/)
    expect(await platform.storage.local.get('activity.blob')).toBe(sealed)
    const keys = await platform.storage.local.keys()
    expect(keys.some((k) => k.startsWith('activity.blob.sealed-quarantine.'))).toBe(true)

    // And the right key still opens it, unharmed.
    const again = new ActivityStore(platform, bus, dekOf(7))
    expect((await again.list({})).map((e) => e.id)).toEqual(['a'])
  })

  it('re-decides on the next load, so a key change is not inherited as a refusal', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    const bus = new EventBus()
    await new ActivityStore(platform, bus, dekOf(7)).append(entry('a'))
    let key = 9
    const store = new ActivityStore(platform, bus, async () => new Uint8Array(32).fill(key))
    expect(await store.list({})).toEqual([])
    await expect(store.append(entry('b'))).rejects.toThrow()
    // The vault this store belongs to unlocks with the right key after all.
    key = 7
    store.forget()
    expect((await store.list({})).map((e) => e.id)).toEqual(['a'])
    await store.append(entry('b'))
    expect((await store.list({})).map((e) => e.id).sort()).toEqual(['a', 'b'])
  })
})

describe('the address book under a key that does not open it', () => {
  it('refuses to write over the ciphertext, and keeps a copy of it', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    const bus = new EventBus()
    const mine = new ContactsStore(platform, bus, dekOf(7))
    await mine.add({ address: '0x3333333333333333333333333333333333333333', label: 'Friend' })
    const sealed = await platform.storage.local.get('contacts.blob')
    expect(sealed).toBeTruthy()

    const stranger = new ContactsStore(platform, bus, dekOf(9))
    expect(await stranger.list()).toEqual([])
    await expect(stranger.add({ address: '0x4444444444444444444444444444444444444444', label: 'Other' })).rejects.toThrow(/set aside|will not be overwritten/)
    expect(await platform.storage.local.get('contacts.blob')).toBe(sealed)
    const keys = await platform.storage.local.keys()
    expect(keys.some((k) => k.startsWith('contacts.blob.sealed-quarantine.'))).toBe(true)

    const again = new ContactsStore(platform, bus, dekOf(7))
    expect((await again.list()).map((c) => c.label)).toEqual(['Friend'])
  })
})
