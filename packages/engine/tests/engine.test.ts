import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { createChannelClient, createChannelPair, serveChannel } from '../src/transport'
import { createEngineClient } from '../src/client'
import { createEngine } from '../src/create'
import { EngineError } from '../src/errors'
import { EngineHost } from '../src/host'
import { readDoc, writeDoc, type DocSpec } from '../src/storage'
import { z } from 'zod'
import type { EngineEvent } from '../src/schema'

const heads = { blockNumber: async (chainId: number) => BigInt(chainId === 52014 ? 15_100_000 : 20_000_000) }
const FAST = { m: 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const VECTOR0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'

function boot(now = 1_700_000_000_000, platform = createMemoryPlatform({ now })) {
  const eng = createEngine({ platform, heads, kdf: FAST })
  return { platform, ...eng }
}

async function expectError(p: Promise<unknown>, code: EngineError['code']): Promise<EngineError> {
  try {
    await p
  } catch (err) {
    expect(err).toBeInstanceOf(EngineError)
    const e = err as EngineError
    expect(e.code).toBe(code)
    return e
  }
  throw new Error(`expected EngineError ${code}`)
}

describe('host + transport', () => {
  it('serves a host over a channel pair and validates arguments', async () => {
    const { host, ready } = boot()
    await ready
    const [a, b] = createChannelPair()
    serveChannel(host, b, 'ui')
    const client = createEngineClient(createChannelClient(a))
    expect((await client.chains.list()).some((c) => c.chainId === 52014 && c.isHome)).toBe(true)
    const head = await client.chains.head({ chainId: 52014 })
    expect(head.blockNumber).toBe('15100000')
    expect(head.live).toBe(true)
    const bad = await expectError(client.chains.head({ chainId: -1 } as never), 'invalid_argument')
    expect(bad.data).toBeDefined()
  })

  it('rejects unknown methods, content-class senders, and disconnects pending calls', async () => {
    const host = new EngineHost()
    host.register('demo', {
      slow: { handler: () => new Promise(() => undefined) },
      echo: { input: z.object({ v: z.string() }), handler: async (arg) => arg },
    })
    const [a, b] = createChannelPair()
    const stop = serveChannel(host, b, 'content')
    const client = createChannelClient(a)
    await expectError(client.call('demo', 'echo', { v: 'x' }), 'unauthorized')
    await expectError(client.call('nope', 'x', undefined), 'not_implemented')
    stop()
    const [c, d] = createChannelPair()
    serveChannel(host, d, 'ui')
    const uiClient = createChannelClient(c)
    expect(await uiClient.call('demo', 'echo', { v: 'x' })).toEqual({ v: 'x' })
    const pending = uiClient.call('demo', 'slow', undefined)
    c.disconnect()
    await expectError(pending, 'disconnected')
  })

  it('forwards host events to channel subscribers', async () => {
    const { host, ready } = boot()
    await ready
    const [a, b] = createChannelPair()
    serveChannel(host, b, 'ui')
    const client = createEngineClient(createChannelClient(a))
    const seen: EngineEvent[] = []
    client.events.subscribe((e) => seen.push(e))
    await client.settings.set({ displayCurrency: 'ETN' })
    await new Promise((r) => setTimeout(r, 0))
    expect(seen.some((e) => e.type === 'settings.changed' && e.settings.displayCurrency === 'ETN')).toBe(true)
  })
})

describe('vault v2 + accounts', () => {
  it('create → status → lock → unlock, wrong password, reveal, auto-lock alarm, metadata edits without a KDF', async () => {
    const { platform, engine, ready } = boot()
    await ready
    expect((await engine.vault.status()).exists).toBe(false)
    await expectError(engine.vault.unlock({ password: 'x' }), 'no_vault')

    const created = await engine.vault.create({ password: 'correct horse battery' })
    expect(created.mnemonic.split(' ')).toHaveLength(12)
    expect(created.accounts).toHaveLength(1)
    let status = await engine.vault.status()
    expect(status.exists && status.unlocked).toBe(true)
    expect(status.wraps).toEqual([{ by: 'password', id: 'password' }])
    expect(status.seeds).toEqual([{ id: created.seedId, label: 'Seed 1', backedUp: false, accountCount: 1, hasPassphrase: false }])
    expect(status.backupComplete).toBe(false)
    expect(status.lockAt).toBe(platform.now() + 900_000) // 15 idle minutes by default (plan A1)

    const active = await engine.accounts.active()
    expect(active?.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    expect(active?.seedId).toBe(created.seedId)
    const renamed = await engine.accounts.rename({ id: active!.id, label: 'Main' })
    expect(renamed.label).toBe('Main')

    await engine.vault.lock()
    expect((await engine.vault.status()).unlocked).toBe(false)
    expect(await engine.accounts.list()).toEqual([])
    await expectError(engine.accounts.rename({ id: active!.id, label: 'x' }), 'locked')

    await expectError(engine.vault.unlock({ password: 'nope' }), 'wrong_password')
    const unlocked = await engine.vault.unlock({ password: 'correct horse battery' })
    expect(unlocked.accounts[0]?.label).toBe('Main')
    expect(unlocked.accounts[0]?.address).toBe(active!.address)

    await expectError(engine.vault.reveal({ seedId: created.seedId, password: 'nope' }), 'wrong_password')
    const revealed = await engine.vault.reveal({ seedId: created.seedId, password: 'correct horse battery' })
    expect(revealed.mnemonic).toBe(created.mnemonic)

    // 15 idle minutes (plan A1); a touch at minute 14 pushes the deadline out, silence after that locks.
    await platform.clock.advance(14 * 60_000)
    expect((await engine.vault.touch()).lockAt).toBe(platform.now() + 900_000)
    await platform.clock.advance(120_000)
    expect((await engine.vault.status()).unlocked).toBe(true)
    await platform.clock.advance(900_001)
    status = await engine.vault.status()
    expect(status.unlocked).toBe(false)
    expect(await platform.storage.session.get('vault.dek')).toBeNull()
  })

  it('import with a passphrase derives a different account than without; preview shows both trees', async () => {
    const { engine, ready } = boot()
    await ready
    await expectError(engine.vault.import({ mnemonic: 'not a phrase', password: 'pw' }), 'invalid_mnemonic')
    const preview = await engine.accounts.previewDerivations({ mnemonic: PHRASE, count: 2 })
    expect(preview.bip44[0]).toBe(VECTOR0)
    expect(preview.ledgerLive[0]).toBe(VECTOR0) // the trees agree only at index 0
    expect(preview.bip44[1]).not.toBe(preview.ledgerLive[1])

    const r = await engine.vault.import({ mnemonic: `  ${PHRASE.toUpperCase()} `, password: 'pw' })
    expect(r.accounts[0]?.address).toBe(VECTOR0)
    const { accounts: withPass } = { accounts: (await engine.accounts.previewDerivations({ mnemonic: PHRASE, passphrase: 'TREZOR' })).bip44 }
    expect(withPass[0]).not.toBe(VECTOR0)
  })

  it('multi-seed, derive, imported, watch, hardware, hide, reorder, remove', async () => {
    const { engine, ready } = boot()
    await ready
    const { seedId } = await engine.vault.create({ password: 'pw' })
    const second = await engine.accounts.derive({ seedId })
    expect(second.index).toBe(1)
    expect(second.label).toBe('Account 2')
    const other = await engine.accounts.addSeed({ mnemonic: PHRASE, label: 'Old seed' })
    expect(other.account.address).toBe(VECTOR0)
    await expectError(engine.accounts.addSeed({ mnemonic: PHRASE }), 'invalid_argument')
    const imported = await engine.accounts.addImported({ privateKey: '0x' + '11'.repeat(32), label: 'Hot' })
    expect(imported.kind).toBe('imported')
    expect(imported.hasKey).toBe(true)
    const watch = await engine.accounts.addWatch({ address: '0x000000000000000000000000000000000000dead' })
    expect(watch.hasKey).toBe(false)
    const ledger = await engine.accounts.addHardware({ kind: 'ledger', address: '0x000000000000000000000000000000000000beef', path: "m/44'/60'/0'/0/0", deviceId: 'nano-x' })
    expect(ledger.hardware).toEqual({ path: "m/44'/60'/0'/0/0", deviceId: 'nano-x', scheme: 'bip44', index: 0 })
    await expectError(engine.accounts.addWatch({ address: '0x000000000000000000000000000000000000dead' }), 'invalid_argument')

    let list = await engine.accounts.list()
    expect(list.map((a) => a.kind)).toEqual(['hd', 'hd', 'hd', 'imported', 'watch', 'ledger'])
    expect((await engine.vault.status()).seeds.map((s) => s.accountCount)).toEqual([2, 1])

    await engine.accounts.reorder({ ids: [...list.map((a) => a.id)].reverse() })
    list = await engine.accounts.list()
    expect(list.map((a) => a.kind)).toEqual(['ledger', 'watch', 'imported', 'hd', 'hd', 'hd'])
    await expectError(engine.accounts.reorder({ ids: [list[0]!.id] }), 'invalid_argument')

    const hidden = await engine.accounts.setHidden({ id: second.id, hidden: true })
    expect(hidden.hidden).toBe(true)
    await expectError(engine.accounts.remove({ id: second.id }), 'invalid_argument')
    await engine.accounts.setActive({ id: watch.id })
    await engine.accounts.remove({ id: watch.id })
    expect((await engine.accounts.list()).some((a) => a.id === watch.id)).toBe(false)
    expect((await engine.accounts.active())?.id).not.toBe(watch.id)
  })

  it('passkey and device wraps unlock the vault; changePassword re-wraps; removal is guarded', async () => {
    const { engine, ready } = boot()
    await ready
    await engine.vault.create({ password: 'pw' })
    const prf = 'ab'.repeat(32)
    let status = await engine.vault.enrolPasskey({ credentialId: 'cred-1', prfSecretHex: prf })
    expect(status.wraps.map((w) => w.by)).toEqual(['password', 'prf'])
    status = await engine.vault.enrolDevice({ keyId: 'pixel', keyHex: 'cd'.repeat(32) })
    expect(status.wraps).toHaveLength(3)
    await engine.vault.lock()
    await expectError(engine.vault.unlockWithPasskey({ credentialId: 'cred-1', prfSecretHex: 'ff'.repeat(32) }), 'unauthorized')
    expect((await engine.vault.unlockWithPasskey({ credentialId: 'cred-1', prfSecretHex: prf })).accounts).toHaveLength(1)
    await engine.vault.lock()
    expect((await engine.vault.unlockWithDevice({ keyId: 'pixel', keyHex: 'cd'.repeat(32) })).accounts).toHaveLength(1)

    await expectError(engine.vault.changePassword({ current: 'wrong', next: 'new' }), 'wrong_password')
    await engine.vault.changePassword({ current: 'pw', next: 'new' })
    await engine.vault.lock()
    await expectError(engine.vault.unlock({ password: 'pw' }), 'wrong_password')
    await engine.vault.unlock({ password: 'new' })
    status = await engine.vault.removePasskey({ credentialId: 'cred-1' })
    expect(status.wraps.map((w) => w.by).sort()).toEqual(['device', 'password'])
  })

  it('backup quiz gates backupComplete; export/import moves the vault to a fresh device', async () => {
    const a = boot()
    await a.ready
    const { seedId, mnemonic } = await a.engine.vault.create({ password: 'pw' })
    const quiz = await a.engine.vault.backupQuiz({ seedId })
    expect(quiz.positions).toHaveLength(3)
    expect(quiz.wordCount).toBe(12)
    const words = mnemonic.split(' ')
    const wrong = await a.engine.vault.confirmBackup({ seedId, answers: quiz.positions.map((p) => ({ position: p, word: 'zoo' })) })
    expect(wrong.ok).toBe(false)
    const right = await a.engine.vault.confirmBackup({ seedId, answers: quiz.positions.map((p) => ({ position: p, word: words[p - 1]!.toUpperCase() })) })
    expect(right.ok).toBe(true)
    expect(right.status.backupComplete).toBe(true)

    /*
      The phrase is minted by the engine. What this envelope holds — every
      seed, passphrase and imported key — is rendered as a QR, so the
      ciphertext is public by design and the phrase is all of the protection;
      an eight-character user-invented one, lower-cased before the KDF, was not
      enough for something a camera can capture and grind offline.
    */
    await expectError(a.engine.vault.export({ password: 'pw', code: 'orbit velvet cactus' }), 'invalid_argument')
    const { frames, code } = await a.engine.vault.export({ password: 'pw' })
    expect(frames.length).toBeGreaterThan(0)
    expect(code.split(' ')).toHaveLength(6)
    const b = boot()
    await b.ready
    await expectError(b.engine.vault.importExport({ frames, code: 'wrong code!!', password: 'newpw' }), 'unauthorized')
    const moved = await b.engine.vault.importExport({ frames, code, password: 'newpw' })
    expect(moved.accounts[0]?.address).toBe(right.status.seeds.length ? (await a.engine.accounts.list())[0]?.address : '')
    expect((await b.engine.vault.status()).backupComplete).toBe(true)
    await expectError(a.engine.vault.importExport({ frames, code: 'orbit velvet cactus', password: 'x' }), 'invalid_argument')
  })

  it('migrates a v1 vault file on first unlock', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    const { createVault } = await import('@boltvault/core')
    const v1 = await createVault(
      'pw',
      { seedHex: '0x' + 'ab'.repeat(64), mnemonic: PHRASE, importedKeys: {}, accounts: [{ id: 'acct_v1', kind: 'hd', label: 'Legacy', address: VECTOR0, index: 0 }] },
      { kdf: FAST },
    )
    await platform.storage.secret.set('vault.file', JSON.stringify(v1))
    const { engine, ready } = boot(1_700_000_000_000, platform)
    await ready
    let status = await engine.vault.status()
    expect(status.exists).toBe(true)
    expect(status.wraps).toEqual([{ by: 'password', id: 'password' }])
    await expectError(engine.vault.unlockWithPasskey({ credentialId: 'c', prfSecretHex: 'ab' }), 'locked')
    const { accounts } = await engine.vault.unlock({ password: 'pw' })
    expect(accounts[0]?.label).toBe('Legacy')
    status = await engine.vault.status()
    expect(status.seeds[0]?.label).toBe('Seed 1')
    const raw = JSON.parse((await platform.storage.secret.get('vault.file')) ?? '{}') as { v?: number }
    expect(raw.v).toBe(2)
  })
})

describe('activity', () => {
  it('is empty while locked, sealed under the DEK, and readable after unlock', async () => {
    const { engine, activity, ready, platform } = boot()
    await ready
    expect(await engine.activity.list()).toEqual([])
    await engine.vault.create({ password: 'pw' })
    const acct = (await engine.accounts.active())!
    await activity.append({ id: 'e1', hash: null, chainId: 52014, accountId: acct.id, to: '0xabc', value: '0x1', nonce: 0, submittedAt: 10, origin: null, category: 'SEND', statements: ['Send 1 ETN to 0xabc'], riskCodes: [], status: 'pending', blockNumber: null })
    await activity.append({ id: 'e2', hash: '0xh', chainId: 52014, accountId: acct.id, to: '0xdef', value: '0x0', nonce: 1, submittedAt: 20, origin: 'https://app.electroswap.io', category: 'SWAP', statements: [], riskCodes: [], status: 'confirmed', blockNumber: 5 })
    expect((await engine.activity.list()).map((e) => e.id)).toEqual(['e2', 'e1'])
    expect((await engine.activity.list({ limit: 1 }))[0]?.id).toBe('e2')
    const blob = (await platform.storage.local.get('activity.blob')) ?? ''
    expect(blob).not.toContain('electroswap')
    await engine.vault.lock()
    expect(await engine.activity.list()).toEqual([])
    await engine.vault.unlock({ password: 'pw' })
    expect(await engine.activity.list()).toHaveLength(2)
    await engine.activity.clear()
    expect(await engine.activity.list()).toEqual([])
  })
})

describe('approvals', () => {
  it('a yes on a signing request is not final until the signature is, and a refusal can be retried', async () => {
    const { platform, approvals, engine, ready } = boot()
    await ready
    const req = await approvals.create({ kind: 'sign_message', origin: 'https://app.electroswap.io', accountId: null, chainId: 52014, payload: { hex: '0x00' } })
    expect(await engine.approvals.list()).toHaveLength(1)
    const again = createEngine({ platform, heads, kdf: FAST })
    await again.ready
    expect((await again.engine.approvals.list()).map((r) => r.id)).toEqual([req.id])

    // Saying yes releases the signer, but does not finish the request: a
    // hardware wallet can still refuse, and `approved` means "signed".
    const waited = approvals.waitFor(req.id)
    await engine.approvals.decide({ id: req.id, approve: true })
    expect((await waited).approved).toBe(true)
    expect(approvals.get(req.id)?.status).toBe('signing')
    // While it is with the signer it cannot be decided again.
    await expectError(engine.approvals.decide({ id: req.id, approve: false }), 'invalid_argument')

    // The device refuses — the wrong button, pressed by mistake. The request
    // comes back to the queue carrying the reason, rather than being lost.
    await approvals.settle(req.id, false, 'Rejected on the device.')
    expect(approvals.get(req.id)?.status).toBe('pending')
    expect(approvals.get(req.id)?.lastError).toBe('Rejected on the device.')
    expect(await engine.approvals.list()).toHaveLength(1)

    // So it can simply be approved again, and this time it signs.
    await engine.approvals.decide({ id: req.id, approve: true })
    await approvals.settle(req.id, true)
    expect(approvals.get(req.id)?.status).toBe('approved')
    await expectError(engine.approvals.decide({ id: req.id, approve: false }), 'already_decided')

    // BoltVault's own refusal is final: a blocked request must not come back
    // as something the user can approve one more time.
    const blocked = await approvals.create({ kind: 'send_transaction', origin: 'https://app.electroswap.io', accountId: null, chainId: 52014, payload: { hex: '0x00' } })
    await engine.approvals.decide({ id: blocked.id, approve: true })
    await approvals.settle(blocked.id, false, 'blocked', false)
    expect(approvals.get(blocked.id)?.status).toBe('rejected')
    await expectError(engine.approvals.decide({ id: blocked.id, approve: true }), 'already_decided')

    // A connect has no signature to wait for and is done on the yes.
    const c = await approvals.create({ kind: 'connect', origin: 'https://y.example', accountId: null, chainId: null, payload: null })
    await engine.approvals.decide({ id: c.id, approve: true })
    expect(approvals.get(c.id)?.status).toBe('approved')

    const r2 = await approvals.create({ kind: 'connect', origin: 'https://x.example', accountId: null, chainId: null, payload: null })
    await platform.clock.advance(5 * 60_000 + 1)
    expect(await engine.approvals.list()).toEqual([])
    await expectError(engine.approvals.decide({ id: r2.id, approve: true }), 'expired')
  })
})

describe('sites', () => {
  it('lists connected sites, re-seats chains, rejects unknown chains, disconnects', async () => {
    const { engine, sites, ready } = boot()
    await ready
    await sites.registry.connect('https://app.electroswap.io', { accountId: 'acct-1', accounts: ['0x1'] })
    expect(await engine.sites.list()).toMatchObject([{ origin: 'https://app.electroswap.io', chainId: 52014, accountId: 'acct-1', connected: true, title: null, icon: null }])
    const moved = await engine.sites.setChain({ origin: 'https://app.electroswap.io', chainId: 8453 })
    expect(moved.chainId).toBe(8453)
    await expectError(engine.sites.setChain({ origin: 'https://app.electroswap.io', chainId: 4242 }), 'invalid_argument')
    await engine.sites.disconnect({ origin: 'https://app.electroswap.io' })
    expect(await engine.sites.list()).toEqual([])
    expect((await engine.sites.get({ origin: 'https://app.electroswap.io' }))?.chainId).toBe(8453)
  })
})

describe('storage docs', () => {
  const spec: DocSpec<{ n: number }> = {
    key: 'doc',
    version: 2,
    schema: z.object({ n: z.number() }),
    migrate: (data, from) => (from === 1 ? { n: Number((data as { value: string }).value) } : data),
    defaultValue: () => ({ n: 0 }),
  }
  it('returns defaults, migrates, and quarantines corrupt data instead of overwriting it', async () => {
    const platform = createMemoryPlatform({ now: 42 })
    const store = platform.storage.local
    expect((await readDoc(store, spec)).value).toEqual({ n: 0 })
    await store.set('doc', JSON.stringify({ v: 1, data: { value: '7' } }))
    expect(await readDoc(store, spec)).toEqual({ value: { n: 7 }, migrated: true, quarantined: false })
    await writeDoc(store, spec, { n: 9 })
    expect((await readDoc(store, spec)).value).toEqual({ n: 9 })
    await store.set('doc', '{not json')
    const q = await readDoc(store, spec, () => 42)
    expect(q.quarantined).toBe(true)
    expect(await store.get('doc.quarantine.42')).toBe('{not json')
  })
})
