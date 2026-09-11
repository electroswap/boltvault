/**
 * Changing which account a connected site sees (master plan §8.14, §4.6).
 *
 * Connected Sites could change a site's chain and could only *show* its
 * account, so moving a dApp to another address meant disconnecting and hoping
 * the site offered a way back in. `sites.setAccount` is the missing verb, and
 * the half that matters is the fan-out: EIP-1193 says the page must be told,
 * and §4.6 says `accountsChanged` reaches the ports of that origin and no
 * other surface's session.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import type { ProviderPortMessage } from '@boltvault/protocol'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import type { Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, createChannelPair, type ApprovalRequest, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'
const TESTNET = 5201420

interface Dapp {
  request(method: string, params?: unknown): Promise<unknown>
  events: Array<{ event: string; payload: unknown }>
}

function dapp(engine: Engine, origin: string): Dapp {
  const [a, b] = createChannelPair()
  engine.provider.serve(b, origin)
  const events: Dapp['events'] = []
  const waiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  let next = 1
  a.onMessage((raw) => {
    const m = raw as ProviderPortMessage
    if (m.kind === 'event') events.push({ event: m.event, payload: m.payload })
    if (m.kind === 'response') {
      const w = waiters.get(m.id)
      if (!w) return
      waiters.delete(m.id)
      if (m.error) w.reject(m.error)
      else w.resolve(m.result)
    }
  })
  return {
    events,
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = next++
        waiters.set(id, { resolve, reject })
        a.post({ kind: 'request', id, method, params, session: 'sess' })
      }),
  }
}

function nextApproval(engine: Engine): Promise<ApprovalRequest> {
  const existing = engine.approvals.list()[0]
  if (existing) return Promise.resolve(existing)
  return new Promise((resolve) => {
    const off = engine.host.events.subscribe((e) => {
      const hit = e.type === 'approvals.changed' ? e.pending[0] : undefined
      if (hit) {
        off()
        resolve(hit)
      }
    })
  })
}

/** Poll until `ready` holds, so an assertion is never racing a fan-out. */
async function settled<T>(read: () => T, ready: (v: T) => boolean, tries = 50): Promise<T> {
  for (let i = 0; i < tries; i++) {
    const v = read()
    if (ready(v)) return v
    await new Promise((r) => setTimeout(r, 5))
  }
  return read()
}

describe('sites.setAccount', () => {
  let rpc: MockRpc
  let engine: Engine
  let first: { id: string; address: Hex }
  let second: { id: string; address: Hex }

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20 })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    first = { id: created.accounts[0]?.id ?? '', address: created.accounts[0]?.address as Hex }
    const derived = await engine.engine.accounts.derive({ seedId: created.seedId })
    second = { id: derived.id, address: derived.address as Hex }
    await engine.chains.setRpc(TESTNET, rpc.url)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  async function connect(origin: string): Promise<Dapp> {
    const d = dapp(engine, origin)
    const p = d.request('eth_requestAccounts')
    const req = await nextApproval(engine)
    await engine.engine.approvals.decide({ id: req.id, approve: true, data: { accountId: first.id, chainId: TESTNET } })
    await p
    return d
  }

  it('re-seats one origin, tells it, and tells nobody else', async () => {
    const a = await connect(ORIGIN_A)
    const b = await connect(ORIGIN_B)
    const seenBefore = b.events.length

    const sites = engine.engine.sites
    const row = await sites.setAccount({ origin: ORIGIN_A, accountId: second.id })
    expect(row.accountId).toBe(second.id)

    /*
      The fan-out is not part of the call's promise: the provider has to ask
      the vault for the address before it can tell anyone, and the screen does
      not wait on a dApp being notified. So the event is awaited rather than
      assumed to have landed by the time `setAccount` resolves.
    */
    const told = await settled(() => a.events.filter((e) => e.event === 'accountsChanged'), (xs) => xs.length === 2)
    expect(told[told.length - 1]?.payload).toEqual([second.address])
    // …and the other origin hears nothing at all (§4.6).
    expect(b.events.length).toBe(seenBefore)
    expect(await b.request('eth_accounts')).toEqual([first.address])
    // The session itself moved, so the next request answers as the new account.
    expect(await a.request('eth_accounts')).toEqual([second.address])
  })

  it('records what the origin was handed, not what it used to hold', async () => {
    const sites = engine.engine.sites
    await sites.setAccount({ origin: ORIGIN_A, accountId: first.id })
    const row = await engine.engine.sites.get({ origin: ORIGIN_A })
    expect(row?.accountId).toBe(first.id)
  })

  it('refuses an origin that is not connected, rather than inventing a session for it', async () => {
    const sites = engine.engine.sites
    await expect(sites.setAccount({ origin: 'https://never.example', accountId: first.id })).rejects.toThrow()
    // A disconnected site keeps its row so its chain preference survives, but
    // it must go on seeing no account at all — re-seating it would fan a real
    // address out to a page that has no session.
    await engine.engine.sites.disconnect({ origin: ORIGIN_B })
    await expect(sites.setAccount({ origin: ORIGIN_B, accountId: second.id })).rejects.toThrow()
  })
})
