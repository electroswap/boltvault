/**
 * A token's decimals are asked for once, not once per request (ES-BV-086).
 *
 * `learnTokenDecimals` reads `decimals()` off a contract when a transfer is
 * about to be signed and no list can name the token — without it the firewall's
 * statement prints the raw integer, and that string is written onto the
 * activity row and shown for ever (ES-BV-083).
 *
 * The read was kept for the length of one assessment and then thrown away, so
 * every later request touching the same token paid for the same `eth_call`
 * again. Owner: "token decimals should be stored in the global token metadata
 * cache. we should not have to make special decimals RPC calls unless we have
 * to."
 *
 * What is pinned here is the count. A second assessment of the same token must
 * not reach the chain, and it must still produce the same decimals.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { type ProviderPortMessage } from '@boltvault/protocol'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, createChannelPair, parseApprovalPayload, type ApprovalRequest, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ORIGIN = 'https://a.example'
const TESTNET = 5201420
/** A token no list carries — the whole point is that the catalog cannot name it. */
const STRANGER = '0x3333333333333333333333333333333333333333' as Hex
const RECIPIENT = '0x4444444444444444444444444444444444444444'
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

/** `transfer(address,uint256)` — the one shape whose amount reads as a quantity. */
function transferData(to: string, amount: bigint): Hex {
  const addr = to.replace(/^0x/, '').toLowerCase().padStart(64, '0')
  const amt = amount.toString(16).padStart(64, '0')
  return `0xa9059cbb${addr}${amt}` as Hex
}

interface DappClient {
  request(method: string, params?: unknown): Promise<unknown>
}

function dapp(engine: Engine, origin: string): DappClient {
  const [a, b] = createChannelPair()
  engine.provider.serve(b, origin, {})
  const waiters = new Map<number, { resolve: (v: unknown) => void; reject: (e: unknown) => void }>()
  let next = 1
  a.onMessage((raw) => {
    const m = raw as ProviderPortMessage
    if (m.kind !== 'response') return
    const w = waiters.get(m.id)
    if (!w) return
    waiters.delete(m.id)
    if (m.error) w.reject(m.error)
    else w.resolve(m.result)
  })
  return {
    request(method, params) {
      const id = next++
      const p = new Promise<unknown>((resolve, reject) => waiters.set(id, { resolve, reject }))
      a.post({ kind: 'request', id, method, params, session: 'sess' })
      return p
    },
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

describe('decimals for a token no list carries', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  let client: DappClient
  let asked = 0

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20 })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 10n ** 18n)
    rpc.state.code.set(STRANGER.toLowerCase(), '0x6080')
    rpc.state.calls.set(STRANGER.toLowerCase(), ({ data }) => {
      if (data.slice(0, 10) === '0x313ce567') {
        asked += 1
        return u(9n)
      }
      return '0x'
    })
    /*
      Connected once, here. An unconnected origin is answered 4100 and never
      raises a transaction sheet at all — which is a timeout rather than a
      failed assertion, and cost me one before I saw it.
    */
    client = dapp(engine, ORIGIN)
    const connecting = client.request('eth_requestAccounts')
    const conn = await nextApproval(engine)
    await engine.engine.approvals.decide({ id: conn.id, approve: true, data: { accountId, chainId: TESTNET } })
    await connecting
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  /** Raise a transfer, read the sheet's statements, then reject it. */
  async function assess(): Promise<string[]> {
    void client
      .request('eth_sendTransaction', [
        { from: address, to: STRANGER, data: transferData(RECIPIENT, 1_500_000_000n), value: '0x0' },
      ])
      .catch(() => undefined)
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    const statements =
      payload && 'assessment' in payload ? (payload.assessment.statements ?? []) : []
    await engine.engine.approvals.decide({ id: req.id, approve: false }).catch(() => undefined)
    // Statements are structured, not strings; the rendered figure is inside.
    return statements.map((x) => JSON.stringify(x))
  }

  it('asks the contract once, and not again for the same token', async () => {
    const first = await assess()
    expect(asked).toBe(1)
    // 1.5e9 raw at 9 decimals is 1.5 of the token — the point of asking at all.
    expect(first.join(' ')).toContain('1.5')

    const second = await assess()
    expect(asked).toBe(1)
    expect(second.join(' ')).toContain('1.5')
  })

})
