/**
 * Contract facts for `NEW_CONTRACT` (§3.4): when the code was deployed, and
 * whether its source is published.
 *
 * The property pinned here is that the wallet caches the deploy *instant* and
 * works the age out on every read. Caching the age instead is wrong in a way
 * that is easy to miss and lands exactly on the boundary the rule cares about:
 * an answer cached six hours ago as "6.9 days old" still reads as 6.9 days
 * today, so a contract cached just inside the week goes on being called new
 * long after it is not.
 */
import { createMemoryPlatform, type MemoryPlatform } from '@boltvault/platform/memory'
import type { ProviderPortMessage } from '@boltvault/protocol'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import type { Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChannelPair, createEngine, parseApprovalPayload, type ApprovalRequest, type Engine, type MemoryChannel } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
/*
  The chain registry gives Electroneum testnet the MAINNET explorer URL
  (packages/chains/src/registry.ts), so that is what the lookup actually calls.
  Matched here rather than corrected, because correcting it is a separate change.
*/
const EXPLORER = 'https://blockexplorer.electroneum.com'
/** The platform's clock at start of play; the stub dates its answers from it. */
let T0 = 0
const DAY = 86_400_000
const HOUR = 3_600_000

/** Three hours inside the week, so four hours of clock crosses the boundary. */
const ALMOST_A_WEEK = '0xaa00000000000000000000000000000000000001' as Hex
const CREATION_TX = `0x${'ab'.repeat(32)}`
/** Old enough that no amount of waiting makes it interesting. */
const ANCIENT = '0xbb00000000000000000000000000000000000002' as Hex
const ANCIENT_TX = `0x${'cd'.repeat(32)}`
/** Has code, and the explorer has never heard of it. */
const UNKNOWN_TO_EXPLORER = '0xcc00000000000000000000000000000000000003' as Hex
/** Old enough not to be new, but its source was never published. */
const UNVERIFIED = '0xdd00000000000000000000000000000000000004' as Hex
const UNVERIFIED_TX = `0x${'ef'.repeat(32)}`

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })
const iso = (at: number): string => new Date(at).toISOString()

/** How many times the explorer was asked, so "cached" is assertable. */
let addressCalls = 0

const outsideFetch: typeof fetch = async (input) => {
  const url = String(input)
  if (url === `${EXPLORER}/api/v2/addresses/${ALMOST_A_WEEK}`) {
    addressCalls += 1
    return json({ is_verified: true, creation_transaction_hash: CREATION_TX })
  }
  if (url === `${EXPLORER}/api/v2/transactions/${CREATION_TX}`) return json({ timestamp: iso(T0 - (7 * DAY - 3 * HOUR)) })
  // The other spelling Blockscout has shipped, so both are exercised.
  if (url === `${EXPLORER}/api/v2/addresses/${ANCIENT}`) return json({ is_verified: true, creation_tx_hash: ANCIENT_TX })
  if (url === `${EXPLORER}/api/v2/transactions/${ANCIENT_TX}`) return json({ timestamp: iso(T0 - 400 * DAY) })
  if (url === `${EXPLORER}/api/v2/addresses/${UNVERIFIED}`) return json({ is_verified: false, creation_transaction_hash: UNVERIFIED_TX })
  if (url === `${EXPLORER}/api/v2/transactions/${UNVERIFIED_TX}`) return json({ timestamp: iso(T0 - 400 * DAY) })
  return new Response('not found', { status: 404 })
}

interface DappClient {
  request(method: string, params?: unknown, id?: number): Promise<unknown>
}

function dapp(engine: Engine, origin: string): DappClient {
  const [page, worker]: [MemoryChannel, MemoryChannel] = createChannelPair()
  engine.provider.serve(worker, origin)
  const waiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  let next = 1
  page.onMessage((raw) => {
    const m = raw as ProviderPortMessage
    if (m.kind !== 'response') return
    const w = waiters.get(m.id)
    if (!w) return
    waiters.delete(m.id)
    if (m.error) w.reject(m.error)
    else w.resolve(m.result)
  })
  return {
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = next++
        waiters.set(id, { resolve, reject })
        page.post({ kind: 'request', id, method, params, session: 'sess' })
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

describe('a contract’s age is worked out, not remembered', () => {
  let rpc: MockRpc
  let engine: Engine
  let platform: MemoryPlatform
  let address: Hex
  let accountId: string

  async function connect(origin: string): Promise<DappClient> {
    const client = dapp(engine, origin)
    const p = client.request('eth_requestAccounts')
    const req = await nextApproval(engine)
    await engine.engine.approvals.decide({ id: req.id, approve: true, data: { accountId, chainId: TESTNET } })
    await p
    return client
  }

  async function codesFor(client: DappClient, to: Hex): Promise<string[]> {
    const p = client.request('eth_sendTransaction', [{ from: address, to, data: '0xdeadbeef' }])
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction sheet')
    const codes = payload.assessment.rules.map((r) => r.code)
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await p.catch(() => undefined)
    return codes
  }

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    for (const a of [ALMOST_A_WEEK, ANCIENT, UNKNOWN_TO_EXPLORER, UNVERIFIED]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    platform = createMemoryPlatform()
    T0 = platform.now()
    engine = createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: outsideFetch, staticsUrl: null, electroswapUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 10n ** 18n)
    /*
      This test moves the clock by hours, and the auto-lock alarm is on the same
      clock — four hours of it locks the vault, which drops the dApp's session
      and makes every later request a 4100. Auto-lock is not what is under test.
    */
    await engine.engine.settings.set({ autoLock: 'never' })
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('warns inside the week and stops warning once the clock has passed it, without re-asking', async () => {
    const client = await connect('https://facts.example')
    expect(await codesFor(client, ALMOST_A_WEEK)).toContain('NEW_CONTRACT')
    const asked = addressCalls
    expect(asked).toBeGreaterThan(0)

    /*
      Four hours: less than the six-hour cache, more than the three hours of
      week the contract had left. So the cached answer is reused — `asked` must
      not move — and the verdict has to change anyway, which it can only do if
      the age is derived at the point of use.
    */
    await platform.clock.advance(4 * HOUR)
    expect(await codesFor(client, ALMOST_A_WEEK)).not.toContain('NEW_CONTRACT')
    expect(addressCalls).toBe(asked)
  })

  it('says nothing about a contract that has been there for a year', async () => {
    const client = await connect('https://ancient.example')
    expect(await codesFor(client, ANCIENT)).not.toContain('NEW_CONTRACT')
  })

  it('warns about an old contract whose source was never published', async () => {
    const client = await connect('https://unverified.example')
    // The rule's other branch: a year old, so nothing to do with age.
    expect(await codesFor(client, UNVERIFIED)).toContain('NEW_CONTRACT')
  })

  it('says nothing about a contract the explorer has never heard of', async () => {
    const client = await connect('https://unknown.example')
    // Unknown is not the same as new. A 404 must never read as "deployed today".
    expect(await codesFor(client, UNKNOWN_TO_EXPLORER)).not.toContain('NEW_CONTRACT')
  })
})

/*
  The same two facts, from the API instead — and the fallback behind it.

  The wallet asks the API first because it answers from a cache shared by every
  caller, so the same router is not fetched once per wallet per six hours. The
  explorer stays behind it because the API is Electroneum-only and can be
  unreachable, and a wallet that quietly stops answering this question stops
  warning about new contracts without telling anybody.
*/
const API = 'https://api.test/graphql'

/** Answers the API knows, by address. `null` means it was asked and did not know. */
const API_FRESH = '0xa100000000000000000000000000000000000001' as Hex
const API_BLANK = '0xa100000000000000000000000000000000000002' as Hex
const API_BROKEN = '0xa100000000000000000000000000000000000003' as Hex

let apiCalls = 0
let explorerCalls = 0

const withApiFetch = (base: number): typeof fetch => async (input, init) => {
  const url = String(input)
  if (url === API) {
    const body = JSON.parse(String(init?.body ?? '{}')) as { query?: string; variables?: Record<string, unknown> }
    if (!String(body.query ?? '').includes('ContractFacts')) return json({ data: {} })
    apiCalls += 1
    const asked = String(body.variables?.['address'] ?? '').toLowerCase()
    if (asked === API_FRESH.toLowerCase())
      /*
        Two days old, in SECONDS as the API serves it. If the wallet read these
        as milliseconds the instant would land in 1970 and the contract would
        look twenty thousand days old — so the warning firing is what proves the
        conversion.
      */
      return json({ data: { contractFacts: { address: API_FRESH, hasCode: true, verified: true, deployedAt: Math.floor((base - 2 * DAY) / 1000) } } })
    if (asked === API_BLANK.toLowerCase())
      return json({ data: { contractFacts: { address: API_BLANK, hasCode: true, verified: null, deployedAt: null } } })
    if (asked === API_BROKEN.toLowerCase()) return json({ errors: [{ message: 'upstream is having a bad minute' }] })
    return json({ data: { contractFacts: { address: asked, hasCode: null, verified: null, deployedAt: null } } })
  }
  if (url.startsWith(`${EXPLORER}/api/v2/addresses/`)) {
    explorerCalls += 1
    // Whatever the API could not say, the explorer calls three days old.
    return json({ is_verified: true, creation_transaction_hash: CREATION_TX })
  }
  if (url === `${EXPLORER}/api/v2/transactions/${CREATION_TX}`) return json({ timestamp: iso(base - 3 * DAY) })
  return new Response('not found', { status: 404 })
}

describe('the API answers first, and the explorer catches what it cannot', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string

  async function connect(origin: string): Promise<DappClient> {
    const client = dapp(engine, origin)
    const p = client.request('eth_requestAccounts')
    const req = await nextApproval(engine)
    await engine.engine.approvals.decide({ id: req.id, approve: true, data: { accountId, chainId: TESTNET } })
    await p
    return client
  }

  async function codesFor(client: DappClient, to: Hex): Promise<string[]> {
    const p = client.request('eth_sendTransaction', [{ from: address, to, data: '0xdeadbeef' }])
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction sheet')
    const codes = payload.assessment.rules.map((r) => r.code)
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await p.catch(() => undefined)
    return codes
  }

  beforeAll(async () => {
    apiCalls = 0
    explorerCalls = 0
    rpc = await startMockRpc({ chainId: TESTNET })
    for (const a of [API_FRESH, API_BLANK, API_BROKEN]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    const platform = createMemoryPlatform()
    engine = createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: withApiFetch(platform.now()), staticsUrl: null, electroswapUrl: API })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 10n ** 18n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('takes the API’s answer and does not touch the explorer', async () => {
    const client = await connect('https://api-first.example')
    const before = explorerCalls
    expect(await codesFor(client, API_FRESH)).toContain('NEW_CONTRACT')
    expect(apiCalls).toBeGreaterThan(0)
    expect(explorerCalls).toBe(before)
  })

  it('falls through to the explorer when the API was asked and did not know', async () => {
    const client = await connect('https://api-blank.example')
    const before = explorerCalls
    expect(await codesFor(client, API_BLANK)).toContain('NEW_CONTRACT')
    expect(explorerCalls).toBeGreaterThan(before)
  })

  it('falls through when the API answers with an error rather than an answer', async () => {
    const client = await connect('https://api-broken.example')
    const before = explorerCalls
    expect(await codesFor(client, API_BROKEN)).toContain('NEW_CONTRACT')
    expect(explorerCalls).toBeGreaterThan(before)
  })
})
