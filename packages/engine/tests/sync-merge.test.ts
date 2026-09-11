/**
 * The merge and the transport (master plan §6, §9.5).
 *
 * Three things used to be wrong and each has a test here: the winner was
 * decided by the author's wall clock, the pull cursor was moved by the
 * device's own records echoing off the relay, and both devices addressed one
 * relay slot per pairing so their writes collided.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform, type MemoryPlatform } from '@boltvault/platform/memory'
import { createEngine } from '../src/create'
import { authorSlot, MemoryRelay } from '../src/namespaces/sync'
import type { SealedRecord } from '@boltvault/core'

const heads = { blockNumber: async () => 1n }
const FAST = { m: 1024, t: 1, p: 1 }
const RELAY = 'memory://relay'

interface Device {
  readonly platform: MemoryPlatform
  readonly engine: ReturnType<typeof createEngine>
}

function device(now: number, relay: MemoryRelay): Device {
  const platform = createMemoryPlatform({ now })
  return { platform, engine: createEngine({ platform, heads, kdf: FAST, relayFor: () => relay }) }
}

async function pair(a: Device, b: Device, labelA: string, labelB: string): Promise<void> {
  await Promise.all([a.engine.ready, b.engine.ready])
  await a.engine.engine.vault.create({ password: 'pw' })
  await b.engine.engine.vault.create({ password: 'pw' })
  await a.engine.engine.sync.setDeviceLabel({ label: labelA })
  await b.engine.engine.sync.setDeviceLabel({ label: labelB })
  const { offer } = await a.engine.engine.sync.createOffer({ relayUrl: RELAY })
  const { answer } = await b.engine.engine.sync.acceptOffer({ offer })
  await a.engine.engine.sync.completeOffer({ answer })
  await a.engine.engine.sync.confirm()
  await b.engine.engine.sync.confirm()
}

describe('last-writer-wins by sequence number, not by clock', () => {
  it('lets a device whose clock stepped backwards overwrite its own earlier record', async () => {
    const relay = new MemoryRelay()
    const a = device(10_000_000_000, relay)
    const b = device(1_000, relay)
    await pair(a, b, 'Laptop', 'Pixel 8')

    await a.engine.engine.settings.set({ displayCurrency: 'ETN' })
    await a.engine.engine.sync.push()
    await b.engine.engine.sync.pull()
    expect((await b.engine.engine.settings.get()).displayCurrency).toBe('ETN')

    /*
      NTP corrects the laptop's clock backwards by three years. Under the old
      rule — "skip anything whose `at` is not newer than what I applied" — B
      would have kept ETN for as long as the two clocks disagreed. The record's
      sequence number does not care.
    */
    await a.platform.clock.set(2_000)
    await a.engine.engine.settings.set({ displayCurrency: 'USD' })
    await a.engine.engine.sync.push()
    expect((await b.engine.engine.sync.pull()).applied).toBeGreaterThan(0)
    expect((await b.engine.engine.settings.get()).displayCurrency).toBe('USD')
  })

  it('keeps the two counters comparable, so the later edit wins whichever device made it', async () => {
    const relay = new MemoryRelay()
    const a = device(1_000, relay)
    const b = device(1_000, relay)
    await pair(a, b, 'Laptop', 'Pixel 8')

    await a.engine.engine.settings.set({ slippageBips: 30 })
    await a.engine.engine.sync.push()
    await b.engine.engine.sync.pull()
    // B saw A's counter and steps past it, so B's answer is the later one.
    await b.engine.engine.settings.set({ slippageBips: 80 })
    await b.engine.engine.sync.push()
    await a.engine.engine.sync.pull()
    expect((await a.engine.engine.settings.get()).slippageBips).toBe(80)
    // ...and A does not talk B back out of it on the next round trip.
    await a.engine.engine.sync.push()
    await b.engine.engine.sync.pull()
    expect((await b.engine.engine.settings.get()).slippageBips).toBe(80)
  })
})

describe('the pull cursor', () => {
  it('does not skip the peer just because this device has pushed more records', async () => {
    const relay = new MemoryRelay()
    const a = device(1_000, relay)
    const b = device(1_000, relay)
    await pair(a, b, 'Laptop', 'Pixel 8')

    // A runs its sequence numbers well past B's.
    for (let i = 1; i <= 5; i++)
      await a.engine.engine.accounts.addWatch({ address: `0x${String(i).repeat(40)}`, label: `Cold ${i}` })
    await a.engine.engine.sync.push()

    await b.engine.engine.accounts.addWatch({ address: '0x000000000000000000000000000000000000dead', label: 'Phone cold' })
    await b.engine.engine.sync.push()

    /*
      A's own records echo back off the relay at higher sequence numbers than
      anything B has written. The cursor used to be raised past them, so every
      one of B's lower-numbered records was skipped forever.
    */
    await a.engine.engine.sync.pull()
    const labels = (await a.engine.engine.accounts.list()).map((x) => x.label)
    expect(labels).toContain('Phone cold')
  })
})

describe('the relay slot', () => {
  it('is unique per author, so two devices in one pairing cannot collide', () => {
    expect(authorSlot('aaaabbbbccccdddd0011', 1)).not.toBe(authorSlot('eeeeffff000011112233', 1))
    expect(authorSlot('AAAABBBBCCCCDDDD0011', 7)).toBe('aaaabbbbccccdddd-7')
  })

  it('hands each author only its own blobs, whatever the other wrote at the same number', async () => {
    const relay = new MemoryRelay()
    const blob = (key: string, seq: number): SealedRecord => ({ pairingId: 'p', seq, nonce: '00', ct: '11', sig: '22', authorSigningPublicKey: key })
    const keyA = 'aaaabbbbccccdddd0011'
    const keyB = 'eeeeffff000011112233'
    await relay.put('p', authorSlot(keyA, 1), blob(keyA, 1))
    await relay.put('p', authorSlot(keyB, 1), blob(keyB, 1))
    await relay.put('p', authorSlot(keyB, 2), blob(keyB, 2))

    const mine = await relay.list('p', 'aaaabbbbccccdddd', 0)
    expect(mine.map((r) => r.authorSigningPublicKey)).toEqual([keyA])
    const theirs = await relay.list('p', 'eeeeffff00001111', 0)
    expect(theirs.map((r) => r.seq)).toEqual([1, 2])
    expect(await relay.list('p', 'eeeeffff00001111', 1)).toHaveLength(1)
  })
})
