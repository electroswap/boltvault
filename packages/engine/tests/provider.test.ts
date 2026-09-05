/**
 * dApp traffic end to end inside the engine: a content channel → rpcFlow →
 * approvals → signing → broadcast against the mock RPC. Mirrors what the
 * extension does over Ports, without a browser.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { PROVIDER_PORT_NAME, type ProviderPortMessage } from '@boltvault/protocol'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { verifyMessage, verifyTypedData, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, createChannelPair, parseApprovalPayload, type ApprovalRequest, type Engine, type MemoryChannel } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ORIGIN_A = 'https://a.example'
const ORIGIN_B = 'https://b.example'
const TESTNET = 5201420
const UNKNOWN = '0x2222222222222222222222222222222222222222'

interface DappClient {
  request(method: string, params?: unknown, id?: number): Promise<unknown>
  events: Array<{ event: string; payload: unknown }>
  channel: MemoryChannel
}

function dapp(engine: Engine, origin: string, session = 'sess'): DappClient {
  const [a, b] = createChannelPair()
  engine.provider.serve(b, origin)
  const events: DappClient['events'] = []
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
    channel: a,
    request: (method, params, id) =>
      new Promise((resolve, reject) => {
        const rid = id ?? next++
        waiters.set(rid, { resolve, reject })
        a.post({ kind: 'request', id: rid, method, params, session })
      }),
  }
}

async function nextApproval(engine: Engine): Promise<ApprovalRequest> {
  const existing = engine.approvals.list()[0]
  if (existing) return existing
  return new Promise((resolve) => {
    const off = engine.host.events.subscribe((e) => {
      if (e.type === 'approvals.changed' && e.pending[0]) {
        off()
        resolve(e.pending[0])
      }
    })
  })
}

describe('provider service', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20 })
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

  it('answers SAFE methods on the origin chain and keeps origins apart', async () => {
    const a = dapp(engine, ORIGIN_A)
    expect(await a.request('eth_chainId')).toBe('0xcb2e')
    expect(await a.request('wallet_switchEthereumChain', [{ chainId: '0x4f5e0c' }])).toBeNull()
    expect(await a.request('eth_chainId')).toBe('0x4f5e0c')
    expect(await a.request('eth_blockNumber')).toBe('0xf4240')
    expect(await a.request('eth_accounts')).toEqual([])
    const b = dapp(engine, ORIGIN_B)
    expect(await b.request('eth_chainId')).toBe('0xcb2e')
    expect(a.events.find((e) => e.event === 'chainChanged')?.payload).toBe('0x4f5e0c')
    expect(b.events.find((e) => e.event === 'chainChanged')).toBeUndefined()
  })

  it('connects through an approval and reports the address', async () => {
    const a = dapp(engine, ORIGIN_A)
    const p = a.request('eth_requestAccounts')
    const req = await nextApproval(engine)
    expect(req.origin).toBe(ORIGIN_A)
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind).toBe('connect')
    expect(payload?.kind === 'connect' && payload.firstTime).toBe(true)
    await engine.engine.approvals.decide({ id: req.id, approve: true, data: { accountId, chainId: TESTNET } })
    expect(await p).toEqual([address])
    expect(await a.request('eth_accounts')).toEqual([address])
    expect(a.events.map((e) => e.event)).toEqual(expect.arrayContaining(['accountsChanged', 'connect']))
    // A permitted site does not get a second Connect sheet.
    expect(await a.request('eth_requestAccounts')).toEqual([address])
    expect(engine.approvals.list()).toEqual([])
    const sites = await engine.engine.sites.list()
    expect(sites.find((s) => s.origin === ORIGIN_A)).toMatchObject({ connected: true, chainId: TESTNET, accountId })
  })

  it('signs a message after approval and rejects with 4001 otherwise', async () => {
    const a = dapp(engine, ORIGIN_A)
    const message = `0x${Buffer.from('hello from a').toString('hex')}` as Hex
    const p = a.request('personal_sign', [message, address])
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind === 'sign_message' && payload.text).toBe('hello from a')
    expect(payload?.kind === 'sign_message' && payload.assessment.severity).toBe('info')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const sig = (await p) as Hex
    expect(await verifyMessage({ address, message: 'hello from a', signature: sig })).toBe(true)

    const rejected = a.request('personal_sign', [message, address])
    const req2 = await nextApproval(engine)
    await engine.engine.approvals.decide({ id: req2.id, approve: false })
    await expect(rejected).rejects.toMatchObject({ code: 4001 })
  })

  it('signs typed data with decimal-string uints normalised', async () => {
    const a = dapp(engine, ORIGIN_A)
    const typed = {
      types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }], Ping: [{ name: 'note', type: 'string' }, { name: 'n', type: 'uint256' }] },
      primaryType: 'Ping',
      domain: { name: 'Fixture', chainId: TESTNET },
      message: { note: 'hi', n: '42' },
    }
    const p = a.request('eth_signTypedData_v4', [address, JSON.stringify(typed)])
    const req = await nextApproval(engine)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const sig = (await p) as Hex
    expect(await verifyTypedData({ address, signature: sig, domain: { name: 'Fixture', chainId: TESTNET }, types: { Ping: typed.types.Ping }, primaryType: 'Ping', message: { note: 'hi', n: 42n } })).toBe(true)
  })

  it('prepares, previews, signs and broadcasts a transaction; activity is written first and confirmed later', async () => {
    const a = dapp(engine, ORIGIN_A)
    const p = a.request('eth_sendTransaction', [{ from: address, to: address, value: '0x1' }])
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction payload')
    expect(payload.tx.type).toBe('legacy') // baseFee 0 on the mock, like Electroneum
    expect(payload.fee.symbol).toBe('ETN')
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('SIM_FAILED')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const hash = (await p) as string
    expect(rpc.state.transactions.has(hash)).toBe(true)
    const pending = (await engine.engine.activity.list({})).find((e) => e.hash === hash)
    expect(pending?.status).toBe('pending')
    expect(pending?.origin).toBe(ORIGIN_A)
    rpc.advanceBlocks()
    await new Promise((r) => setTimeout(r, 80))
    const done = (await engine.engine.activity.list({})).find((e) => e.hash === hash)
    expect(done?.status).toBe('confirmed')
  })

  it('never signs a blocked request, even if a decision says approve', async () => {
    const a = dapp(engine, ORIGIN_A)
    const typed = {
      types: { PermitTransferFrom: [], TokenPermissions: [] },
      primaryType: 'PermitTransferFrom',
      domain: { name: 'Permit2', chainId: TESTNET },
      message: { permitted: { token: UNKNOWN, amount: '1000' }, spender: UNKNOWN, nonce: '1', deadline: '9999999999' },
    }
    const p = a.request('eth_signTypedData_v4', [address, JSON.stringify(typed)])
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind === 'sign_typed_data' && payload.assessment.presentation.blocked).toBe(true)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await expect(p).rejects.toMatchObject({ code: 4001, data: { rules: ['PERMIT2_SIGNATURE_TRANSFER'] } })
  })

  it('eth_sign is 4200 while disabled and unknown chains are 4902', async () => {
    const a = dapp(engine, ORIGIN_A)
    await expect(a.request('eth_sign', [address, `0x${'aa'.repeat(32)}`])).rejects.toMatchObject({ code: 4200 })
    await expect(a.request('wallet_addEthereumChain', [{ chainId: '0x539', rpcUrls: ['https://evil.example'] }])).rejects.toMatchObject({ code: 4902 })
  })

  it('a re-sent request after a worker restart re-attaches to the same approval', async () => {
    const first = dapp(engine, ORIGIN_A, 'page-1')
    const message = `0x${Buffer.from('twice').toString('hex')}` as Hex
    const p1 = first.request('personal_sign', [message, address], 77)
    const req = await nextApproval(engine)
    // The worker died and the bridge reconnected: same session, same id.
    const second = dapp(engine, ORIGIN_A, 'page-1')
    const p2 = second.request('personal_sign', [message, address], 77)
    await new Promise((r) => setTimeout(r, 10))
    expect(engine.approvals.list()).toHaveLength(1)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const [s1, s2] = await Promise.all([p1, p2])
    expect(s1).toBe(s2)
  })

  it('disconnecting from Settings tells the site', async () => {
    const a = dapp(engine, ORIGIN_A)
    await engine.engine.sites.disconnect({ origin: ORIGIN_A })
    expect(a.events.at(-1)).toEqual({ event: 'accountsChanged', payload: [] })
    expect(await a.request('eth_accounts')).toEqual([])
  })

  it('the Port name constant is shared with the extension', () => {
    expect(PROVIDER_PORT_NAME).toBe('bv-provider')
  })
})
