/**
 * What syncs (master plan §6): address book, labels, custom tokens, hidden
 * tokens, site chain preferences, settings, watch-only accounts, hardware
 * account metadata. Plus the two rules that hang off them — deletes travel as
 * tombstones, and an address-book entry or a custom token from a paired device
 * is untrusted until the user confirms it on the receiving device.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { createEngine, type Engine } from '../src/create'
import { MemoryRelay } from '../src/namespaces/sync'

const heads = { blockNumber: async () => 1n }
const FAST = { m: 1024, t: 1, p: 1 }
const RELAY = 'memory://relay'
const ETN = 52014
const MUM = '0x00000000000000000000000000000000000000aa'
const FAKE_USDC = '0x00000000000000000000000000000000000000bb'

function device(relay: MemoryRelay): Engine {
  return createEngine({ platform: createMemoryPlatform({ now: 1_700_000_000_000 }), heads, kdf: FAST, relayFor: () => relay })
}

async function pair(a: Engine, b: Engine): Promise<void> {
  await Promise.all([a.ready, b.ready])
  await a.engine.vault.create({ password: 'correct horse battery staple 42' })
  await b.engine.vault.create({ password: 'correct horse battery staple 42' })
  await a.engine.sync.setDeviceLabel({ label: 'Laptop' })
  await b.engine.sync.setDeviceLabel({ label: 'Pixel 8' })
  const { offer } = await a.engine.sync.createOffer({ relayUrl: RELAY })
  const { answer } = await b.engine.sync.acceptOffer({ offer })
  await a.engine.sync.completeOffer({ answer })
  await a.engine.sync.confirm()
  await b.engine.sync.confirm()
}

describe('the families of §6', () => {
  it('carries the address book, custom tokens, hidden tokens and account labels', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    await a.engine.contacts.add({ address: MUM, label: 'Mum' })
    await a.tokens.addSynced({ chainId: ETN, address: FAKE_USDC, name: 'USD Coin', symbol: 'USDC', decimals: 6 })
    await a.engine.tokens.setPrefs({ chainId: ETN, address: FAKE_USDC, hidden: true })
    await a.engine.accounts.addWatch({ address: '0x000000000000000000000000000000000000dead', label: 'Cold' })
    await a.engine.sync.push()
    await b.engine.sync.pull()

    expect((await b.engine.contacts.list()).map((c) => c.label)).toContain('Mum')
    expect((await b.tokens.customList()).map((t) => t.symbol)).toContain('USDC')
    expect((await b.tokens.prefs()).hidden).toContain(`${ETN}:${FAKE_USDC.toLowerCase()}`)
    expect((await b.engine.accounts.list()).map((x) => x.label)).toContain('Cold')
  })

  /*
    ATT-BV-007. §6 says a paired device is not trusted for security-relevant
    state; the collector shipped every setting but two and the receiver applied
    whatever arrived, so one pushed record could turn `eth_sign` back on, empty
    the send allow-list, put slippage at fifty percent and switch the preview
    off — silently, on the next pull.
  */
  it('will not carry a security setting, in either direction', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    const before = await a.engine.settings.get()
    await b.engine.settings.set({ ethSignEnabled: true, sendWhitelist: false, exactApprovals: false, txPreview: 'off', crashReports: true, displayCurrency: 'ETN' })
    await b.engine.sync.push()
    await a.engine.sync.pull()

    const after = await a.engine.settings.get()
    expect(after.ethSignEnabled).toBe(before.ethSignEnabled)
    expect(after.sendWhitelist).toBe(before.sendWhitelist)
    expect(after.exactApprovals).toBe(before.exactApprovals)
    expect(after.txPreview).toBe(before.txPreview)
    expect(after.crashReports).toBe(before.crashReports)
    // …while what is on the list still travels, so sync is not simply broken.
    expect(after.displayCurrency).toBe('ETN')
  })

  /*
    ES-BV-015. Slippage was on the synced list, and it is the one number that
    decides how much of a swap a searcher may take — the schema caps it at 5000
    bips, which is half. A compromised paired device could set it here
    silently, and the next swap the user made on this device gave away half of
    itself with nothing on screen that had changed. Enabled chains decide which
    networks this wallet will sign for at all.
  */
  it('will not carry slippage or the enabled chains, in either direction', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    const before = await a.engine.settings.get()
    await b.engine.settings.set({ slippageBips: 5000, enabledChains: [52014], displayCurrency: 'ETN' })
    await b.engine.sync.push()
    await a.engine.sync.pull()
    const after = await a.engine.settings.get()
    expect(after.slippageBips).toBe(before.slippageBips)
    expect(after.enabledChains).toEqual(before.enabledChains)
    expect(after.displayCurrency).toBe('ETN')

    // And the same the other way: A's own slippage stays A's own.
    await a.engine.settings.set({ slippageBips: 10 })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    expect((await b.engine.settings.get()).slippageBips).toBe(5000)
  })

  it('lands a synced watch or hardware account hidden, waiting to be claimed here', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    const PLANTED = '0x00000000000000000000000000000000000000cc'
    await b.engine.accounts.addHardware({ kind: 'ledger', address: PLANTED, path: "m/44'/60'/0'/0/0", label: 'Ledger' })
    await b.engine.sync.push()
    await a.engine.sync.pull()

    const seated = (await a.engine.accounts.list()).find((x) => x.address.toLowerCase() === PLANTED)
    expect(seated).toBeDefined()
    // It is here, but it is not offered: hidden keeps it off Receive and the
    // Send picker until somebody at this device says it is theirs.
    expect(seated?.hidden).toBe(true)
    const waiting = await a.engine.sync.incoming()
    expect(waiting.map((i) => i.collection)).toContain('account')
    expect(waiting.find((i) => i.collection === 'account')).toMatchObject({ key: PLANTED, fromLabel: 'Pixel 8' })

    await a.engine.sync.confirmIncoming({ collection: 'account', key: PLANTED })
    expect((await a.engine.accounts.list()).find((x) => x.address.toLowerCase() === PLANTED)?.hidden).toBe(false)
  })

  it('refusing a planted account takes it off this device', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    const PLANTED = '0x00000000000000000000000000000000000000dd'
    await b.engine.accounts.addWatch({ address: PLANTED, label: 'Savings' })
    await b.engine.sync.push()
    await a.engine.sync.pull()
    await a.engine.sync.rejectIncoming({ collection: 'account', key: PLANTED })
    expect((await a.engine.accounts.list()).some((x) => x.address.toLowerCase() === PLANTED)).toBe(false)
  })

  it('lands a rename instead of bailing out because the address is already here', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    const cold = await a.engine.accounts.addWatch({ address: '0x000000000000000000000000000000000000dead', label: 'Cold' })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    expect((await b.engine.accounts.list()).find((x) => x.kind === 'watch')?.label).toBe('Cold')

    await a.engine.accounts.rename({ id: cold.id, label: 'Deep cold' })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    expect((await b.engine.accounts.list()).find((x) => x.kind === 'watch')?.label).toBe('Deep cold')

    // And it round trips: the label does not grow a provenance suffix on the way back.
    await b.engine.sync.push()
    await a.engine.sync.pull()
    expect((await a.engine.accounts.list()).find((x) => x.kind === 'watch')?.label).toBe('Deep cold')
  })
})

describe('deletes are tombstones', () => {
  it('propagates a removed contact and a removed watch account', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    const mum = await a.engine.contacts.add({ address: MUM, label: 'Mum' })
    const cold = await a.engine.accounts.addWatch({ address: '0x000000000000000000000000000000000000dead', label: 'Cold' })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    expect(await b.engine.contacts.list()).toHaveLength(1)
    expect((await b.engine.accounts.list()).some((x) => x.kind === 'watch')).toBe(true)

    /*
      `collect()` only ever enumerates live rows, so without a tombstone the
      peer simply stops hearing about these two and keeps them forever.
    */
    await a.engine.contacts.remove({ id: mum.id })
    await a.engine.accounts.remove({ id: cold.id })
    await a.engine.sync.push()
    expect((await b.engine.sync.pull()).applied).toBe(2)
    expect(await b.engine.contacts.list()).toHaveLength(0)
    /*
      An account going away waits for a yes here (ES-BV-015). A new account
      from a peer is quarantined precisely because a compromised phone must not
      change what this device holds; taking one away is the same class of
      change with a worse failure — the address a user was expecting is simply
      not there, with nothing said.
    */
    expect((await b.engine.accounts.list()).some((x) => x.kind === 'watch')).toBe(true)
    const waiting = await b.engine.sync.incoming()
    expect(waiting.find((i) => i.collection === 'account')?.removal).toBe(true)
    await b.engine.sync.confirmIncoming({ collection: 'account', key: '0x000000000000000000000000000000000000dead' })
    expect((await b.engine.accounts.list()).some((x) => x.kind === 'watch')).toBe(false)
  })

  it('never deletes an account whose key lives here', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)
    // B imports a key for an address A only watches.
    const key = `0x${'11'.repeat(32)}`
    const imported = await b.engine.accounts.addImported({ privateKey: key, label: 'Spending' })
    await a.engine.accounts.addWatch({ address: imported.address, label: 'Watched there' })
    await a.engine.sync.push()
    await b.engine.sync.pull()

    await a.engine.accounts.remove({ id: (await a.engine.accounts.list()).find((x) => x.kind === 'watch')?.id ?? '' })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    // A paired device asking for a delete must not destroy the one copy of a private key.
    expect((await b.engine.accounts.list()).some((x) => x.id === imported.id)).toBe(true)
  })
})

describe('untrusted until confirmed (§6)', () => {
  it('holds an incoming contact and custom token back until the user vouches for them here', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    await a.engine.contacts.add({ address: MUM, label: 'Mum' })
    await a.tokens.addSynced({ chainId: ETN, address: FAKE_USDC, name: 'USD Coin', symbol: 'USDC', decimals: 6 })
    await a.engine.sync.push()
    await b.engine.sync.pull()

    const waiting = await b.engine.sync.incoming()
    expect(waiting.map((i) => i.collection).sort()).toEqual(['contact', 'customToken'])
    // Provenance travels with it: "from Pixel 8, 3 May".
    expect(waiting.every((i) => i.fromLabel === 'Laptop')).toBe(true)
    expect(waiting.every((i) => i.at > 0)).toBe(true)

    // Unconfirmed: out of the lookalike reference set, and out of the
    // firewall's "known token" identity.
    expect((await b.engine.contacts.list())[0]?.confirmed).toBe(false)
    expect(await b.contacts.referenceAddresses()).toHaveLength(0)
    expect(await b.sync.unconfirmedTokens()).toEqual([`${ETN}:${FAKE_USDC.toLowerCase()}`])

    await b.engine.sync.confirmIncoming({ collection: 'contact', key: MUM.toLowerCase() })
    expect((await b.engine.contacts.list())[0]?.confirmed).toBe(true)
    expect(await b.contacts.referenceAddresses()).toHaveLength(1)

    await b.engine.sync.confirmIncoming({ collection: 'customToken', key: `${ETN}:${FAKE_USDC.toLowerCase()}` })
    expect(await b.sync.unconfirmedTokens()).toEqual([])
    expect(await b.engine.sync.incoming()).toHaveLength(0)
  })

  it('does not un-confirm an entry when the peer echoes it back unchanged', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    await a.engine.contacts.add({ address: MUM, label: 'Mum' })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    await b.engine.sync.confirmIncoming({ collection: 'contact', key: MUM.toLowerCase() })

    // B now holds the contact too, so its own push mentions it; A must not
    // hear a change, and the echo back must not reopen the question on B.
    await b.engine.sync.push()
    await a.engine.sync.pull()
    await a.engine.sync.push()
    await b.engine.sync.pull()
    expect((await b.engine.contacts.list())[0]?.confirmed).toBe(true)
    expect(await b.engine.sync.incoming()).toHaveLength(0)
  })

  it('refusing one removes it here without telling the other device to delete it', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)

    await a.tokens.addSynced({ chainId: ETN, address: FAKE_USDC, name: 'USD Coin', symbol: 'USDC', decimals: 6 })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    await b.engine.sync.rejectIncoming({ collection: 'customToken', key: `${ETN}:${FAKE_USDC.toLowerCase()}` })
    expect(await b.tokens.customList()).toHaveLength(0)

    await b.engine.sync.push()
    await a.engine.sync.pull()
    expect(await a.tokens.customList()).toHaveLength(1)
  })
})

describe('a locked vault', () => {
  it('refuses to push, because every family would read as empty and go out as a delete', async () => {
    const relay = new MemoryRelay()
    const a = device(relay)
    const b = device(relay)
    await pair(a, b)
    await a.engine.contacts.add({ address: MUM, label: 'Mum' })
    await a.engine.sync.push()
    await b.engine.sync.pull()

    await a.engine.vault.lock()
    await expect(a.engine.sync.push()).rejects.toThrow()
    expect((await a.engine.sync.pull()).applied).toBe(0)

    await a.engine.vault.unlock({ password: 'correct horse battery staple 42' })
    await a.engine.sync.push()
    await b.engine.sync.pull()
    expect(await b.engine.contacts.list()).toHaveLength(1)
  })
})
