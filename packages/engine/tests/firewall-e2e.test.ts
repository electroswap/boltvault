/**
 * The firewall end to end through the engine, for the rules whose producers
 * were missing — each of these passed as a unit test with the context injected
 * by hand and could not fire in the real wallet:
 *
 *   - `RECIPIENT_POISON_SOURCE`: `inboundOnly` was never built (and was read
 *     off a RECEIVE row's `to`, which is the user's own address).
 *   - `NEW_CONTRACT`: the engine filled in `hasCode` and nothing else, so both
 *     branches of the rule were unreachable.
 *   - `VALUE_EXCEEDS_BUDGET` and the §3.6 clipboard check: new producers.
 *   - the simulation snapshot on the history row (§3.4 step 7).
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import type { ProviderPortMessage } from '@boltvault/protocol'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import type { Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createChannelPair, createEngine, parseApprovalPayload, type ApprovalRequest, type Engine, type MemoryChannel } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const EXPLORER = 'https://blockexplorer.electroneum.com'

const DUSTER = '0xdd00000000000000000000000000000000000001' as Hex
const STRANGER = '0xcc00000000000000000000000000000000000002' as Hex
const COPIED = '0xbb00000000000000000000000000000000000003' as Hex
const FRESH_CONTRACT = '0xfc00000000000000000000000000000000000004' as Hex
const CREATION_TX = `0x${'ab'.repeat(32)}`

/** Two days old, so `NEW_CONTRACT`'s "younger than a week" branch has something to read. */
const deployedAt = new Date(Date.now() - 2 * 86_400_000).toISOString()

const COLLECTION = '0xaa00000000000000000000000000000000000005' as Hex
/** What the marketplace index says this collection's cheapest piece goes for. */
const FLOOR_ETN = 40

const json = (body: unknown): Response => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

const outsideFetch: typeof fetch = async (input, init) => {
  const url = String(input)
  if (url === `${EXPLORER}/api/v2/addresses/${FRESH_CONTRACT}`)
    return json({ is_verified: true, creation_transaction_hash: CREATION_TX })
  if (url === `${EXPLORER}/api/v2/transactions/${CREATION_TX}`) return json({ timestamp: deployedAt })
  if (url.endsWith('/graphql')) {
    const query = String((JSON.parse(String(init?.body ?? '{}')) as { query?: string }).query ?? '')
    if (query.startsWith('query NftCollections'))
      return json({ data: { nftCollections: { edges: [{ node: { collectionId: COLLECTION, name: 'Volts', nftContracts: [{ address: COLLECTION, standard: 'ERC721' }], markets: [{ floorPrice: { value: FLOOR_ETN } }] } }] } } })
    return json({ data: {} })
  }
  return new Response('not found', { status: 404 })
}

interface DappClient {
  request(method: string, params?: unknown, id?: number): Promise<unknown>
}

/** One dApp on a memory channel, exactly as the content script would be served. */
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
    request: (method, params, id) =>
      new Promise((resolve, reject) => {
        const rid = id ?? next++
        waiters.set(rid, { resolve, reject })
        page.post({ kind: 'request', id: rid, method, params, session: 'sess' })
      }),
  }
}

async function nextApproval(engine: Engine): Promise<ApprovalRequest> {
  const existing = engine.approvals.list()[0]
  if (existing) return existing
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

describe('the firewall, end to end', () => {
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

  /** Raise a transaction sheet and read the codes the firewall put on it. */
  async function codesFor(client: DappClient, tx: Record<string, unknown>): Promise<{ codes: string[]; id: string }> {
    const p = client.request('eth_sendTransaction', [{ from: address, ...tx }])
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction sheet')
    const codes = payload.assessment.rules.map((r) => r.code)
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await p.catch(() => undefined)
    return { codes, id: req.id }
  }

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    rpc.state.code.set(FRESH_CONTRACT.toLowerCase(), '0x6080')
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: outsideFetch, staticsUrl: null, electroswapUrl: null })
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

  it('flags an address that only ever dusted you, and still refuses to treat it as a reference', async () => {
    // A duster's inbound row: the counterparty is `from`; `to` is the user.
    await engine.activity.append({
      id: 'dust-1',
      hash: `0x${'11'.repeat(32)}`,
      chainId: TESTNET,
      accountId,
      to: address,
      from: DUSTER,
      value: '1',
      nonce: null,
      submittedAt: 1,
      origin: null,
      category: 'RECEIVE',
      statements: [],
      riskCodes: [],
      status: 'confirmed',
      blockNumber: 1,
    })
    const client = await connect('https://poison.example')
    const dust = await codesFor(client, { to: DUSTER, value: '0x1' })
    expect(dust.codes).toContain('RECIPIENT_POISON_SOURCE')

    /*
      §3.6, the half that matters: the duster must never join the lookalike
      reference set. A lookalike of the duster — which is what the *legitimate*
      address would be — has to stay signable, or the rule inverts the attack.
    */
    const lookalikeOfDuster = '0xdd99999999999999999999999999999999999901' as Hex
    const legit = await codesFor(client, { to: lookalikeOfDuster, value: '0x1' })
    expect(legit.codes).not.toContain('RECIPIENT_LOOKALIKE')
  })

  it('warns on a contract the explorer says was deployed this week', async () => {
    const client = await connect('https://newcontract.example')
    const { codes } = await codesFor(client, { to: FRESH_CONTRACT, data: '0xdeadbeef' })
    expect(codes).toContain('NEW_CONTRACT')
  })

  it('warns when a site asks for more than the budget left on its origin', async () => {
    const origin = 'https://budget.example'
    const client = await connect(origin)
    expect((await codesFor(client, { to: STRANGER, value: '0x64' })).codes).not.toContain('VALUE_EXCEEDS_BUDGET')
    // One wei of headroom; a hundred is over it.
    await engine.sites.setBudget(origin, '1')
    expect(engine.sites.get(origin)?.budget).toBe('1')
    expect((await codesFor(client, { to: STRANGER, value: '0x64' })).codes).toContain('VALUE_EXCEEDS_BUDGET')
    await engine.sites.setBudget(origin, null)
    expect((await codesFor(client, { to: STRANGER, value: '0x64' })).codes).not.toContain('VALUE_EXCEEDS_BUDGET')
  })

  it('catches a recipient that is not the address the wallet just copied', async () => {
    const client = await connect('https://clipboard.example')
    engine.sites.noteAddressCopied(COPIED)
    expect((await codesFor(client, { to: STRANGER, value: '0x1' })).codes).toContain('CLIPBOARD_MISMATCH')
    expect((await codesFor(client, { to: COPIED, value: '0x1' })).codes).not.toContain('CLIPBOARD_MISMATCH')
  })

  it('reads the collection floor and flags a listing priced at a fraction of it', async () => {
    const client = await connect('https://market.example')
    const order = (priceEtn: number): string =>
      JSON.stringify({
        types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }] },
        primaryType: 'OrderComponents',
        domain: { name: 'Seaport', chainId: TESTNET },
        message: {
          offerer: address,
          offer: [{ itemType: 2, token: COLLECTION, identifierOrCriteria: '12', startAmount: '1' }],
          consideration: [{ itemType: 0, token: '0x0000000000000000000000000000000000000000', identifierOrCriteria: '0', startAmount: (BigInt(priceEtn) * 10n ** 18n).toString(), recipient: address }],
        },
      })
    const codesForOrder = async (priceEtn: number): Promise<string[]> => {
      const p = client.request('eth_signTypedData_v4', [address, order(priceEtn)])
      const req = await nextApproval(engine)
      const payload = parseApprovalPayload(req.payload)
      if (payload?.kind !== 'sign_typed_data') throw new Error('expected a typed-data sheet')
      const codes = payload.assessment.rules.map((r) => r.code)
      await engine.engine.approvals.decide({ id: req.id, approve: false })
      await p.catch(() => undefined)
      return codes
    }
    expect(await codesForOrder(1)).toContain('SEAPORT_UNDERPRICED')
    // Cached from the first lookup, and an ordinary discount is the seller's business.
    expect(await codesForOrder(20)).not.toContain('SEAPORT_UNDERPRICED')
  })

  it('writes the preview it showed into the history row, before the broadcast', async () => {
    const client = await connect('https://record.example')
    const p = client.request('eth_sendTransaction', [{ from: address, to: address, value: '0x1' }])
    const req = await nextApproval(engine)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const hash = (await p) as string
    const entry = (await engine.engine.activity.list({})).find((e) => e.hash === hash)
    expect(entry?.simulation).toBeDefined()
    expect(entry?.simulation?.mode).toBe('estimate')
    expect(entry?.simulation?.ok).toBe(true)
    // Decimal strings only: the row is JSON, and JSON.stringify refuses bigint.
    expect(typeof entry?.simulation?.gas).toBe('string')
    expect(JSON.stringify(entry)).toContain('"simulation"')
  })
})
