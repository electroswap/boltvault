/**
 * A peer's name for itself cannot cost you every pairing you have
 * (ES-BV-061, ES-BV-014).
 *
 * The accepting side of a pairing bounded the peer's label; the offering side
 * stored the answer's label exactly as it arrived, and the answer schema
 * allows 256 characters where the stored row allows 64. So a 65-character
 * label sealed a blob that the map's own read schema refuses — and `SealedMap`
 * read that back as an *empty* map rather than an unreadable one, so the next
 * save committed the empty list. Every existing pairing on the offering
 * device, channel keys and all, gone silently: sync and remote sign simply
 * stop working.
 *
 * Three properties close it: the label is bounded and stripped wherever it
 * enters, a row that cannot survive its own schema is refused before it is
 * sealed, and a blob that decrypts but does not fit is treated as unreadable
 * rather than as empty.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EngineError } from '../src/errors'
import { SealedMap } from '../src/sealed'
import { deviceLabel, PairedDeviceRowSchema, type PairedDeviceRow } from '../src/namespaces/sync'

const dek = async (): Promise<Uint8Array> => new Uint8Array(32).fill(7)

const row = (over: Partial<PairedDeviceRow> = {}): PairedDeviceRow => ({
  deviceId: 'dev-1',
  label: 'Pixel 8',
  signingPublicKey: 'aa'.repeat(32),
  pairingId: 'pair-1',
  channelKey: 'bb'.repeat(32),
  relayUrl: 'https://electroswap.io/api/wallet/sync',
  pairedAt: 1_700_000_000_000,
  lastSeenAt: null,
  seqOut: 0,
  seqIn: 0,
  ...over,
})

describe('the label a peer sends', () => {
  it('is bounded, whatever length it arrives at', () => {
    // 32 characters plus the sanitiser's ellipsis, well inside the 64 the
    // stored row allows — which is the whole point.
    const long = deviceLabel('x'.repeat(300))
    expect(long.length).toBeLessThanOrEqual(33)
    expect(long.startsWith('x'.repeat(32))).toBe(true)
    expect(deviceLabel('Pixel 8')).toBe('Pixel 8')
  })

  it('loses the characters that reorder the line it sits on', () => {
    // It becomes the origin on a remote-sign sheet.
    const hostile = deviceLabel('Pixel\u202e 8\u200b')
    expect(hostile).not.toMatch(/[\u202e\u200b]/u)
  })

  it('is never empty, because the sheet needs something to name', () => {
    expect(deviceLabel('\u200b\u200b')).toBe('Device')
    expect(deviceLabel('')).toBe('Device')
  })

  it('is bounded again when an old row is read back', () => {
    // A row paired before the fix can hold 64 characters with bidi in them.
    const parsed = PairedDeviceRowSchema.parse(row({ label: `${'y'.repeat(60)}\u202e` }))
    expect(parsed.label.length).toBeLessThanOrEqual(33)
    expect(parsed.label).not.toMatch(/\u202e/u)
  })
})

describe('a blob that decrypts but does not fit its schema', () => {
  it('is unreadable, not empty, and is not written over', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    const opts = {
      key: 'sync.devices.blob',
      info: 'bv/sync/devices',
      aad: 'boltvault.sync.devices.v1',
      schema: z.array(PairedDeviceRowSchema) as unknown as z.ZodType<PairedDeviceRow[]>,
    }
    const map = new SealedMap<PairedDeviceRow[]>(platform, dek, opts)
    await map.set('all', [row()])
    const sealed = await platform.storage.local.get('sync.devices.blob')

    /*
      Seal something the read schema will refuse. This is what an over-long
      answer label used to produce, and the map read it back as an empty list.
    */
    const loose = new SealedMap<unknown>(platform, dek, { ...opts, schema: z.unknown() })
    loose.forget()
    await loose.set('all', [{ ...row(), seqOut: 'not a number' }])
    const broken = await platform.storage.local.get('sync.devices.blob')
    expect(broken).not.toBe(sealed)

    const strict = new SealedMap<PairedDeviceRow[]>(platform, dek, opts)
    expect(await strict.get('all')).toBeNull()
    // The old behaviour was for this write to succeed and commit the loss.
    await expect(strict.set('all', [row({ deviceId: 'dev-2' })])).rejects.toBeInstanceOf(EngineError)
    expect(await platform.storage.local.get('sync.devices.blob')).toBe(broken)

    // And the bytes are aside rather than gone.
    const keys = await platform.storage.local.keys()
    expect(keys.some((k) => k.startsWith('sync.devices.blob.sealed-quarantine.'))).toBe(true)
  })
})
