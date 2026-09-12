/**
 * What "dropped" is allowed to mean, and what it costs to say it (ES-BV-064).
 *
 * The watcher wrote `dropped` the first time one endpoint answered `null` to
 * `eth_getTransactionByHash`, and Activity then told the user nothing had been
 * spent. On a failover pair whose nodes do not share a pool that is exactly
 * the wrong conclusion: the send timed out on the primary, the fallback took
 * it, and the lookup goes back to the primary, which never saw the bytes.
 * Worse, settling as dropped released nothing — the nonce reservation stayed
 * live — so the user's re-send was assigned `nonce + 1` and both transactions
 * could mine. That is a second, real send of the same amount.
 *
 * Three properties close it: one miss is not a verdict, a genuine drop gives
 * the number back, and a dropped row keeps its place in the queue until the
 * chain has moved past it.
 */
import { createMemoryPlatform, type MemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import type { Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420

describe('a transaction the node stops answering for', () => {
  let rpc: MockRpc
  let engine: Engine
  let platform: MemoryPlatform
  let address: Hex
  let accountId: string

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    platform = createMemoryPlatform()
    engine = createEngine({ platform, kdf: KDF, receiptPollMs: 20, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
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

  const rowOf = async (id: string) => (await engine.engine.activity.list({})).find((e) => e.id === id)

  it('is not written off on a single miss', async () => {
    const id = await send()
    await expect.poll(async () => (await rowOf(id))?.hash, { timeout: 5_000 }).toBeTruthy()

    // One endpoint of the pair has never heard of it. Exactly once.
    let misses = 1
    rpc.state.methods.set('eth_getTransactionByHash', (params) => {
      if (misses > 0) {
        misses -= 1
        return null
      }
      const hash = String(params[0]).toLowerCase()
      const tx = rpc.state.transactions.get(hash)
      return tx ? { hash, from: tx.from, to: tx.to, value: `0x${tx.value.toString(16)}`, nonce: `0x${tx.nonce.toString(16)}`, blockNumber: null } : null
    })
    // Past the grace period, so only the miss count is holding the verdict back.
    await platform.clock.advance(60_000)
    await new Promise((r) => setTimeout(r, 300))

    expect((await rowOf(id))?.status).toBe('pending')
    rpc.state.methods.delete('eth_getTransactionByHash')

    // Settle it so the next case starts from a quiet queue.
    rpc.advanceBlocks()
    await expect.poll(async () => (await rowOf(id))?.status, { timeout: 5_000 }).toBe('confirmed')
  })

  it('is dropped after two misses in a row, and then holds its place in the queue', async () => {
    const id = await send()
    await expect.poll(async () => (await rowOf(id))?.hash, { timeout: 5_000 }).toBeTruthy()
    const dropped = await rowOf(id)
    const nonce = dropped?.nonce ?? 0

    /*
      The endpoint the watcher reaches never saw this transaction: it answers
      `null` for the hash and reports a nonce count as if the send had not
      happened. That is the failover pair the finding is about.
    */
    rpc.state.methods.set('eth_getTransactionByHash', () => null)
    rpc.state.methods.set('eth_getTransactionCount', () => `0x${nonce.toString(16)}`)
    await platform.clock.advance(60_000)

    await expect.poll(async () => (await rowOf(id))?.status, { timeout: 5_000 }).toBe('dropped')

    /*
      And now the part that matters. The row is dropped, but the transaction
      may still be alive in the other node's pool, so a fresh send at the same
      number is refused rather than quietly queued behind it — which is what
      produced two live transactions for one payment.
    */
    const before = rpc.state.transactions.size
    const second = await send()
    // The refusal happens after the sheet, in `broadcast`, so it comes back on
    // the request rather than out of `decide()`.
    await expect
      .poll(() => engine.approvals.list().find((r) => r.id === second)?.lastError ?? null, { timeout: 5_000 })
      .toMatch(/already an unresolved transaction/i)
    // And nothing reached the node.
    expect(rpc.state.transactions.size).toBe(before)

    // The way out is a replacement, which can only ever take the place of the
    // original rather than sit beside it.
    expect(await engine.engine.tx.replaceable({ id })).toMatchObject({ can: true })

    rpc.state.methods.delete('eth_getTransactionByHash')
    rpc.state.methods.delete('eth_getTransactionCount')
  })
})
