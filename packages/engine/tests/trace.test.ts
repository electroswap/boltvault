/**
 * The transaction preview, and where it comes from (master plan §9.2).
 *
 * Electroneum is the reason this route exists. `etn-sc` is a custom geth port
 * carrying the debug namespace precisely so a wallet can trace, and no public
 * RPC on the network has it — but that node is deliberately not on the open
 * internet, so the wallet asks our API for one validated `debug_traceCall`
 * instead of holding a node URL. Owner: "I want to expose the tracing via the
 * API, which should only be available to the wallet."
 *
 * The distinction the sheet has to get right is between a network that cannot
 * preview anything and a tracer that was asked and could not answer. Only the
 * first is "Balance changes could not be simulated".
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import type { ProviderPortMessage } from '@boltvault/protocol'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, padHex, parseAbiParameters, type Hex } from 'viem'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createEngine,
  createChannelPair,
  parseApprovalPayload,
  type ApprovalRequest,
  type Engine,
} from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const ORIGIN = 'https://dapp.example'
const API = 'https://api.test'
const KEY = 'a-wallet-key'
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const OTHER = '0x2222222222222222222222222222222222222222' as Hex
const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef' as Hex

/** A callTracer frame in which `me` sends 90 units of TOKEN away. */
function frame(me: Hex): unknown {
  return {
    type: 'CALL',
    from: me,
    to: TOKEN,
    gasUsed: '0x5208',
    logs: [
      {
        address: TOKEN,
        topics: [TRANSFER, padHex(me, { size: 32 }), padHex(OTHER, { size: 32 })],
        data: encodeAbiParameters(parseAbiParameters('uint256'), [90n]),
      },
    ],
  }
}

interface Answer {
  readonly status: number
  readonly body: unknown
}

interface Dapp {
  request(method: string, params?: unknown): Promise<unknown>
}

function dapp(engine: Engine, origin: string): Dapp {
  const [a, b] = createChannelPair()
  engine.provider.serve(b, origin)
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
    request: (method, params) =>
      new Promise((resolve, reject) => {
        const id = next++
        waiters.set(id, { resolve, reject })
        a.post({ kind: 'request', id, method, params, session: 'sess' })
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

describe('the transaction preview', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  let answer: Answer
  let seenAuth: string | null
  let seenKey: string | null

  beforeEach(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    answer = { status: 200, body: {} }
    seenAuth = null
    seenKey = null
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.endsWith('/api/wallet/trace')) {
        const headers = new Headers(init?.headers)
        seenAuth = headers.get('x-boltvault-auth')
        seenKey = headers.get('x-boltvault-key')
        return new Response(JSON.stringify(answer.body), {
          status: answer.status,
          headers: { 'content-type': 'application/json' },
        })
      }
      return new Response('', { status: 404 })
    }
    engine = createEngine({
      platform: createMemoryPlatform(),
      kdf: KDF,
      receiptPollMs: 20,
      fetch: fetchImpl,
      electroswapUrl: null,
      pricesUrl: null,
      apiOrigin: API,
      clientKey: KEY,
    })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 10n ** 18n)
    // Code at the target, so the mock's `eth_estimateGas` succeeds and the
    // revert check is clean — otherwise SIM_FAILED fires first and the preview
    // rules never run.
    rpc.state.code.set(TOKEN.toLowerCase(), '0x6080')
  })

  afterEach(async () => {
    engine.dispose()
    await rpc.close()
  })

  /** Connect a dApp, offer it an opaque contract call, and read the sheet the user would see. */
  async function preview(): Promise<
    Extract<NonNullable<ReturnType<typeof parseApprovalPayload>>, { kind: 'send_transaction' }>
  > {
    const a = dapp(engine, ORIGIN)
    const connecting = a.request('eth_requestAccounts')
    const conn = await nextApproval(engine)
    await engine.engine.approvals.decide({
      id: conn.id,
      approve: true,
      data: { accountId, chainId: TESTNET },
    })
    await connecting
    // An opaque selector decodes to `contract_call`, which is the kind the preview rules speak about.
    const sending = a.request('eth_sendTransaction', [
      { from: address, to: TOKEN, data: '0xdeadbeef' },
    ])
    const req = await nextApproval(engine)
    const payload = parseApprovalPayload(req.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction payload')
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await sending.catch(() => undefined)
    return payload
  }

  it('previews what moves, through our own API, with the wallet key', async () => {
    answer = { status: 200, body: { jsonrpc: '2.0', id: 1, result: frame(address) } }
    const payload = await preview()
    expect(payload.assessment.simulationMode).toBe('trace')
    expect(payload.assessment.changes.length).toBeGreaterThan(0)
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('SIM_INCOMPLETE')
    /*
      The route is credentialled, and the credential is a signature over this
      call — not the key. The key in the bundle is not a secret, but a bearer
      token in the network tab is one anybody can reuse against the tracer.
    */
    expect(seenAuth).toMatch(/^v1\.[0-9a-f]{8}\.\d+\./)
    expect(seenAuth).not.toContain(KEY)
    expect(seenKey).toBeNull()
  })

  it('says the network cannot preview only when tracing is switched off', async () => {
    // What the route answers with `trace: null` — 503, JSON-RPC -32002.
    answer = {
      status: 503,
      body: { jsonrpc: '2.0', id: 1, error: { code: -32002, message: 'tracing is not enabled' } },
    }
    const payload = await preview()
    expect(payload.assessment.simulationMode).toBe('estimate')
    const rule = payload.assessment.rules.find((r) => r.code === 'SIM_INCOMPLETE')
    expect(rule?.title).toBe('Balance changes could not be simulated')
  })

  it('repeats the tracer’s own reason when it was asked and could not answer', async () => {
    answer = {
      status: 429,
      body: { jsonrpc: '2.0', id: 1, error: { code: -32003, message: 'the tracer is busy' } },
    }
    const payload = await preview()
    const codes = payload.assessment.rules.map((r) => r.code)
    // A tracer that exists and refused is not "this network cannot preview".
    expect(codes).not.toContain('SIM_INCOMPLETE')
    expect(payload.assessment.rules.find((r) => r.code === 'SIM_UNAVAILABLE')?.detail).toContain(
      'the tracer is busy',
    )
  })

  it('falls back quietly when the API cannot be reached at all', async () => {
    answer = { status: 502, body: {} }
    const payload = await preview()
    expect(payload.assessment.simulationMode).toBe('estimate')
    // No tracer answered, so there is nothing to repeat: the plain message stands.
    expect(payload.assessment.rules.map((r) => r.code)).toContain('SIM_INCOMPLETE')
  })
})
