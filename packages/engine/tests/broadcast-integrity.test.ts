/**
 * A broadcast that errors after the node already took the bytes (ES-BV-002).
 *
 * The failure mode this guards is not exotic: the first endpoint of a failover
 * pair accepts the transaction, the HTTP response is lost at the ten-second
 * timeout, and the wallet used to write the row `failed` with no hash on it.
 * The user, told nothing happened, sends again — and both mine.
 *
 * The two properties that close it: the hash exists before the send, because
 * it is `keccak256` of the wallet's own signed bytes; and a delivery error
 * that does not prove the transaction is invalid leaves the row `pending`
 * rather than writing it off.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { keccak256, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420

describe('a broadcast whose answer never arrives', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  /** Swallow the answer to the next N sends, after the node has taken them. */
  let swallowSends = 0
  const seenRaw: Hex[] = []

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    const real = globalThis.fetch.bind(globalThis)
    const fetchImpl: typeof fetch = async (input, init) => {
      const body = typeof init?.body === 'string' ? init.body : ''
      const isSend = body.includes('eth_sendRawTransaction')
      if (isSend) {
        const parsed = JSON.parse(body) as { params?: unknown[] } | Array<{ params?: unknown[] }>
        const one = Array.isArray(parsed) ? parsed[0] : parsed
        const raw = (one?.params?.[0] ?? '') as Hex
        if (raw) seenRaw.push(raw)
      }
      const res = await real(input as never, init as never)
      if (isSend && swallowSends > 0) {
        // The node has the bytes; only the answer is lost.
        swallowSends -= 1
        throw new Error('The request timed out.')
      }
      return res
    }
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
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

  async function send(): Promise<string> {
    const { requestId } = await engine.engine.send.submit({ accountId, chainId: TESTNET, token: 'native', to: address, amount: '0.001' })
    const req = await new Promise<{ id: string }>((resolve) => {
      const hit = engine.approvals.list().find((r) => r.id === requestId)
      if (hit) return resolve(hit)
      const off = engine.host.events.subscribe((e) => {
        const found = e.type === 'approvals.changed' ? e.pending.find((p) => p.id === requestId) : undefined
        if (found) {
          off()
          resolve(found)
        }
      })
    })
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    return requestId
  }

  it('keeps the row pending with the local hash, and refuses a second send at the same number', async () => {
    swallowSends = 1
    const id = await send()
    await expect.poll(async () => (await engine.engine.activity.list({})).find((e) => e.id === id)?.hash, { timeout: 5_000 }).toBeTruthy()
    const row = (await engine.engine.activity.list({})).find((e) => e.id === id)
    // The hash is the wallet's own, not the node's, and the row is not written off.
    expect(row?.status).toBe('pending')
    expect(row?.hash).toMatch(/^0x[0-9a-f]{64}$/)
    // And it names the very transaction the node took, so the chain can be asked about it.
    expect(rpc.state.transactions.has(row?.hash as string)).toBe(true)
    if (seenRaw[0]) expect(row?.hash).toBe(keccak256(seenRaw[0]))
    /*
      And the number stays held. Before this the error released the nonce
      reservation, so the very next send took the same one and the two
      transactions were alternatives — whichever mined, the other's money was
      gone too if both did. Now the second send queues behind the first.
    */
    const second = await send()
    await expect.poll(async () => (await engine.engine.activity.list({})).find((e) => e.id === second)?.hash, { timeout: 5_000 }).toBeTruthy()
    const rows = await engine.engine.activity.list({})
    const first = rows.find((e) => e.id === id)
    const next = rows.find((e) => e.id === second)
    expect(next?.nonce).toBe((first?.nonce ?? 0) + 1)
  })

  it('a definitive rejection the node does not know still fails the row, with the reason on it', async () => {
    rpc.advanceBlocks()
    await new Promise((r) => setTimeout(r, 60))
    // Nothing left over from the first test: the row settled.
    const before = rpc.state.transactions.size
    swallowSends = 0
    const id = await send()
    await expect.poll(async () => (await engine.engine.activity.list({})).find((e) => e.id === id)?.hash, { timeout: 5_000 }).toBeTruthy()
    expect(rpc.state.transactions.size).toBe(before + 1)
  })
})
