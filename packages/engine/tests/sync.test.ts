import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { createEngine } from '../src/create'
import { EngineError } from '../src/errors'
import { MemoryRelay } from '../src/namespaces/sync'

const heads = { blockNumber: async () => 1n }
const FAST = { m: 1024, t: 1, p: 1 }
const RELAY = 'memory://relay'

function device(now: number, relay: MemoryRelay) {
  const platform = createMemoryPlatform({ now })
  return createEngine({ platform, heads, kdf: FAST, relayFor: () => relay })
}

describe('sync pairing and non-secret sync', () => {
  it('offer → answer → equal SAS → confirm on both; settings, site chains and watch accounts sync with provenance', async () => {
    const relay = new MemoryRelay()
    const a = device(1_000, relay)
    const b = device(1_000, relay)
    await Promise.all([a.ready, b.ready])
    await a.engine.vault.create({ password: 'correct horse battery staple 42' })
    await b.engine.vault.create({ password: 'correct horse battery staple 42' })
    await a.engine.sync.setDeviceLabel({ label: 'Laptop' })
    await b.engine.sync.setDeviceLabel({ label: 'Pixel 8' })

    const { offer } = await a.engine.sync.createOffer({ relayUrl: RELAY })
    await expect(b.engine.sync.acceptOffer({ offer: '{"v":1,"kind":"nope"}' })).rejects.toBeInstanceOf(EngineError)
    const { sas: sasB, answer } = await b.engine.sync.acceptOffer({ offer })
    const { sas: sasA } = await a.engine.sync.completeOffer({ answer })
    expect(sasA).toBe(sasB)
    expect((await a.engine.sync.status()).pending?.sas).toBe(sasA)

    const sa = await a.engine.sync.confirm()
    const sb = await b.engine.sync.confirm()
    expect(sa.devices.map((d) => d.label)).toEqual(['Pixel 8'])
    expect(sb.devices.map((d) => d.label)).toEqual(['Laptop'])
    expect(sa.pending).toBeNull()

    // A changes state, pushes; B pulls and applies with provenance.
    await a.engine.settings.set({ displayCurrency: 'ETN' })
    await a.sites.registry.connect('https://app.electroswap.io', { accountId: 'x' })
    await a.engine.sites.setChain({ origin: 'https://app.electroswap.io', chainId: 8453 })
    await b.sites.registry.connect('https://app.electroswap.io', { accountId: 'y' })
    await a.engine.accounts.addWatch({ address: '0x000000000000000000000000000000000000dead', label: 'Cold' })
    const { pushed } = await a.engine.sync.push()
    expect(pushed).toBeGreaterThanOrEqual(3)

    const { applied } = await b.engine.sync.pull()
    expect(applied).toBeGreaterThanOrEqual(2)
    expect((await b.engine.settings.get()).displayCurrency).toBe('ETN')
    /*
      Not while B is talking to that site (ES-BV-015). Moving a connected
      origin's chain underneath it changes which network the page's next
      transaction is prepared for, and tells the page so with a `chainChanged`
      it did not ask for. A peer's idea of which chain a site belongs on is
      worth taking when nothing here is using the session.
    */
    expect((await b.engine.sites.get({ origin: 'https://app.electroswap.io' }))?.chainId).not.toBe(8453)
    await b.engine.sites.disconnect({ origin: 'https://app.electroswap.io' })
    await a.engine.sites.setChain({ origin: 'https://app.electroswap.io', chainId: 1 })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    expect((await b.engine.sites.get({ origin: 'https://app.electroswap.io' }))?.chainId).toBe(1)
    const synced = (await b.engine.accounts.list()).find((x) => x.kind === 'watch')
    /*
      The label arrives as the author wrote it. It used to arrive as
      "Cold · from Laptop", which the next push sent back as the account's real
      name — provenance ate the label in one round trip.
    */
    expect(synced?.label).toBe('Cold')
    // idempotent: pulling again applies nothing new
    expect((await b.engine.sync.pull()).applied).toBe(0)
    // seeds never travel: B still has only its own seed
    expect((await b.engine.vault.status()).seeds).toHaveLength(1)
  })

  it('a stranger on the relay cannot inject records', async () => {
    const relay = new MemoryRelay()
    const a = device(1_000, relay)
    const b = device(1_000, relay)
    const mallory = device(1_000, relay)
    await Promise.all([a.ready, b.ready, mallory.ready])
    for (const d of [a, b, mallory]) await d.engine.vault.create({ password: 'correct horse battery staple 42' })
    const { offer } = await a.engine.sync.createOffer({ relayUrl: RELAY })
    const { answer } = await b.engine.sync.acceptOffer({ offer })
    await a.engine.sync.completeOffer({ answer })
    await a.engine.sync.confirm()
    await b.engine.sync.confirm()
    // Mallory pairs with A under a *different* pairing, then tries to poison B's pairing id.
    await mallory.engine.settings.set({ displayCurrency: 'ETN' })
    const { offer: o2 } = await mallory.engine.sync.createOffer({ relayUrl: RELAY })
    const { answer: an2 } = await a.engine.sync.acceptOffer({ offer: o2 })
    await mallory.engine.sync.completeOffer({ answer: an2 })
    await mallory.engine.sync.confirm()
    await a.engine.sync.confirm()
    await mallory.engine.sync.push()
    // B pulls only its pairing with A; Mallory's records are on another channel and signed by another key.
    expect((await b.engine.sync.pull()).applied).toBe(0)
    expect((await b.engine.settings.get()).displayCurrency).toBe('USD')
  })
})
