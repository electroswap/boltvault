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

function boot(now = 1_700_000_000_000) {
  const platform = createMemoryPlatform({ now })
  const eng = createEngine({ platform, heads })
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
    await expectError(client.chains.head({ chainId: 999_999 }), 'invalid_argument')
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

describe('vault + accounts', () => {
  it('create → lock → unlock, wrong password, reveal, auto-lock alarm', async () => {
    const { platform, engine, ready } = boot()
    await ready
    expect((await engine.vault.status()).exists).toBe(false)
    await expectError(engine.vault.unlock({ password: 'x' }), 'no_vault')

    const created = await engine.vault.create({ password: 'correct horse battery' })
    expect(created.mnemonic.split(' ')).toHaveLength(12)
    expect(created.accounts).toHaveLength(1)
    const status = await engine.vault.status()
    expect(status.exists && status.unlocked).toBe(true)
    expect(status.lockAt).toBe(platform.now() + 300_000)

    const active = await engine.accounts.active()
    expect(active?.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    const renamed = await engine.accounts.rename({ id: active!.id, label: 'Main' })
    expect(renamed.label).toBe('Main')

    await engine.vault.lock()
    expect((await engine.vault.status()).unlocked).toBe(false)
    expect(await engine.accounts.list()).toEqual([])
    await expectError(engine.accounts.setActive({ id: active!.id }), 'not_found')

    await expectError(engine.vault.unlock({ password: 'nope' }), 'wrong_password')
    const unlocked = await engine.vault.unlock({ password: 'correct horse battery' })
    expect(unlocked.accounts[0]?.label).toBe('Main') // meta override survives
    expect(unlocked.accounts[0]?.address).toBe(active!.address)

    const revealed = await engine.vault.reveal({ password: 'correct horse battery' })
    expect(revealed.mnemonic).toBe(created.mnemonic)

    // the alarm — not a timer — locks the vault
    await platform.clock.advance(300_001)
    expect((await engine.vault.status()).unlocked).toBe(false)
    expect(await platform.storage.session.get('vault.seedHex')).toBeNull()
  }, 60_000)

  it('import rejects a bad phrase and normalises a good one', async () => {
    const { engine, ready } = boot()
    await ready
    await expectError(engine.vault.import({ mnemonic: 'not a phrase', password: 'pw' }), 'invalid_mnemonic')
    const phrase = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const r = await engine.vault.import({ mnemonic: `  ${phrase.toUpperCase()} `, password: 'pw' })
    // the well-known BIP-39 test vector at m/44'/60'/0'/0/0
    expect(r.accounts[0]?.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
    const revealed = await engine.vault.reveal({ password: 'pw' })
    expect(revealed.mnemonic).toBe(phrase)
  }, 60_000)

  it('setAutoLock re-arms the alarm and settings.set never touches reducedMotion', async () => {
    const { platform, engine, ready } = boot()
    await ready
    await engine.vault.create({ password: 'pw' })
    const s = await engine.vault.setAutoLock({ autoLock: '1min' })
    expect(s.lockAt).toBe(platform.now() + 60_000)
    const settings = await engine.settings.set({ reducedMotion: true } as never)
    expect(settings.reducedMotion).toBe(false)
    const never = await engine.vault.setAutoLock({ autoLock: 'never' })
    expect(never.lockAt).toBeNull()
    await platform.clock.advance(10 * 60_000)
    expect((await engine.vault.status()).unlocked).toBe(true)
  }, 60_000)
})

describe('approvals', () => {
  it('one decision per id, expiry, persistence across a host restart', async () => {
    const { platform, approvals, engine, ready } = boot()
    await ready
    const req = await approvals.create({ kind: 'sign_message', origin: 'https://app.electroswap.io', accountId: null, chainId: 52014, payload: { hex: '0x00' } })
    expect(req.id).toMatch(/^[0-9a-f]{32}$/)
    expect(await engine.approvals.list()).toHaveLength(1)

    // a second host over the same platform sees the pending request
    const again = createEngine({ platform, heads })
    await again.ready
    expect((await again.engine.approvals.list()).map((r) => r.id)).toEqual([req.id])

    const waited = approvals.waitFor(req.id)
    await engine.approvals.decide({ id: req.id, approve: true })
    expect(await waited).toBe(true)
    await expectError(engine.approvals.decide({ id: req.id, approve: false }), 'already_decided')
    await expectError(engine.approvals.decide({ id: 'f'.repeat(32), approve: true }), 'not_found')

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
    expect(await engine.sites.list()).toEqual([{ origin: 'https://app.electroswap.io', chainId: 52014, accountId: 'acct-1', connected: true }])
    const moved = await engine.sites.setChain({ origin: 'https://app.electroswap.io', chainId: 8453 })
    expect(moved.chainId).toBe(8453)
    await expectError(engine.sites.setChain({ origin: 'https://app.electroswap.io', chainId: 4242 }), 'invalid_argument')
    await expectError(engine.sites.setChain({ origin: 'https://nobody.example', chainId: 1 }), 'not_found')
    await engine.sites.disconnect({ origin: 'https://app.electroswap.io' })
    expect(await engine.sites.list()).toEqual([])
    // the chain preference survives disconnect (Rabby behaviour)
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
    const migrated = await readDoc(store, spec)
    expect(migrated).toEqual({ value: { n: 7 }, migrated: true, quarantined: false })

    await writeDoc(store, spec, { n: 9 })
    expect((await readDoc(store, spec)).value).toEqual({ n: 9 })

    await store.set('doc', '{not json')
    const q = await readDoc(store, spec, () => 42)
    expect(q.quarantined).toBe(true)
    expect(q.value).toEqual({ n: 0 })
    expect(await store.get('doc.quarantine.42')).toBe('{not json')
    expect(await store.get('doc')).toBeNull()

    await store.set('doc', JSON.stringify({ v: 3, data: { n: 1 } })) // from the future
    expect((await readDoc(store, spec, () => 43)).quarantined).toBe(true)
  })
})
