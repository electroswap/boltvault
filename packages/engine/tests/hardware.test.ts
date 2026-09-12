/**
 * Ledger through the engine (master plan §2.7 S7, §8.1): the worker finds
 * the paired device through the HidProvider, lists addresses on both
 * schemes, adds a hardware account, and a Send from it goes through the same
 * sheet and lands on chain signed by the device — with Electroneum's legacy
 * `v` normalised — while the device's refusals surface as plain copy.
 */
import { FakeLedgerDevice, fakeHidProvider, pathFor } from '@boltvault/hardware'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, type ApprovalRequest, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const FRIEND = '0x4444444444444444444444444444444444444444' as Hex

async function approvalById(engine: Engine, id: string): Promise<ApprovalRequest> {
  const existing = engine.approvals.get(id)
  if (existing) return existing
  return new Promise((resolve) => {
    const off = engine.host.events.subscribe((e) => {
      const hit = e.type === 'approvals.changed' ? e.pending.find((p) => p.id === id) : undefined
      if (hit) {
        off()
        resolve(hit)
      }
    })
  })
}

describe('a Ledger account through the engine', () => {
  let rpc: MockRpc
  let engine: Engine
  let device: FakeLedgerDevice
  let ledgerAccountId = ''
  let ledgerAddress = ''

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    device = new FakeLedgerDevice({ blindSigning: false })
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, electroswapUrl: null, hid: fakeHidProvider(device) })
    await engine.ready
    await engine.engine.vault.create({ password: PASSWORD })
    await engine.chains.setRpc(TESTNET, rpc.url)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('sees the paired device and its Ethereum app', async () => {
    const st = await engine.engine.hardware.ledgerStatus()
    expect(st.available).toBe(true)
    expect(st.devices[0]?.model).toBe('Ledger Nano S Plus')
    expect(st.app).toEqual({ version: '1.12.0', blindSigning: false })
  })

  it('lists both derivation schemes and adds an account from Ledger Live', async () => {
    const bip44 = await engine.engine.hardware.ledgerAddresses({ scheme: 'bip44', count: 3 })
    const live = await engine.engine.hardware.ledgerAddresses({ scheme: 'live', count: 3 })
    expect(bip44.map((x) => x.path)).toEqual([pathFor('bip44', 0), pathFor('bip44', 1), pathFor('bip44', 2)])
    expect(live[0]?.path).toBe(pathFor('live', 0))
    expect(bip44[1]?.address).not.toBe(live[1]?.address)
    const chosen = live[1] as { path: string; address: string }
    const view = await engine.engine.accounts.addHardware({ kind: 'ledger', address: chosen.address, path: chosen.path, deviceId: (await engine.engine.hardware.ledgerStatus()).devices[0]?.deviceId ?? '' })
    expect(view.kind).toBe('ledger')
    expect(view.hardware?.path).toBe(chosen.path)
    ledgerAccountId = view.id
    ledgerAddress = view.address
    // Verify on device shows the same address.
    expect((await engine.engine.hardware.verifyAccount({ accountId: view.id })).address.toLowerCase()).toBe(chosen.address.toLowerCase())
  })

  it('sends from the Ledger account: the device signs, the wallet broadcasts', async () => {
    rpc.state.balances.set(ledgerAddress.toLowerCase(), 5n * 10n ** 18n)
    const { requestId } = await engine.engine.send.submit({ accountId: ledgerAccountId, chainId: TESTNET, token: 'native', to: FRIEND, amount: '1' })
    const req = await approvalById(engine, requestId)
    expect(req.accountId).toBe(ledgerAccountId)
    await engine.engine.approvals.decide({ id: requestId, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(1)
    const raw = [...rpc.state.transactions.values()][0]?.raw as Hex
    const tx = parseTransaction(raw)
    expect(tx.to?.toLowerCase()).toBe(FRIEND.toLowerCase())
    expect(tx.chainId).toBe(TESTNET)
    expect((await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toLowerCase()).toBe(ledgerAddress.toLowerCase())
    expect(device.app.log.some((l) => l.ins === 0x04)).toBe(true)
    rpc.advanceBlocks()
    await expect.poll(async () => (await engine.engine.activity.list({ accountId: ledgerAccountId })).find((e) => e.id === requestId)?.status, { timeout: 10_000 }).toBe('confirmed')
  })

  it('a mis-pressed reject leaves the row waiting, and the retry confirms it', async () => {
    /*
      ATT-BV-018. `broadcast()` marked the row `failed` for any signing error,
      including the device refusal that `settle(…, retryable)` deliberately
      returns to `pending` so the same request can be approved again. The retry
      then found the write-ahead entry and skipped the append, and the hash
      update did not reset the status — so a confirmed transaction stayed
      recorded as failed, and `resumeWatchers` (which re-watches `pending` rows
      only) would not pick it up across a restart.
    */
    const before = rpc.state.transactions.size
    const { requestId } = await engine.engine.send.submit({ accountId: ledgerAccountId, chainId: TESTNET, token: 'native', to: FRIEND, amount: '1' })
    await approvalById(engine, requestId)
    device.app.rejectNext = true
    await engine.engine.approvals.decide({ id: requestId, approve: true })
    // The refusal comes back to the queue, and the row is still waiting with it.
    await expect.poll(() => engine.approvals.get(requestId)?.status, { timeout: 10_000 }).toBe('pending')
    const refused = (await engine.engine.activity.list({ accountId: ledgerAccountId })).find((e) => e.id === requestId)
    expect(refused?.status).toBe('pending')
    expect(refused?.statements.some((t) => /reject/i.test(t))).toBe(true)
    expect(rpc.state.transactions.size).toBe(before)

    // Approve again, this time with the right button.
    await engine.engine.approvals.decide({ id: requestId, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(before + 1)
    rpc.advanceBlocks()
    await expect.poll(async () => (await engine.engine.activity.list({ accountId: ledgerAccountId })).find((e) => e.id === requestId)?.status, { timeout: 10_000 }).toBe('confirmed')
  })

  /*
    The device signs with the key it holds; the wallet broadcasts for the
    account the user chose. Nothing used to check those were the same key — so
    a second device plugged into the same port, a path picked by a model-level
    id, or a transport that swapped bytes all ended with a valid signature from
    an account the user never selected, and the wallet sent it.

    Here the account record names an address the device cannot produce. The
    signature comes back well-formed and belongs to a different key, and the
    broadcast must not happen.
  */
  it('refuses to broadcast a signature that recovers to a different account', async () => {
    const before = rpc.state.transactions.size
    const impostor = '0x00000000000000000000000000000000000000ff'
    const view = await engine.engine.accounts.addHardware({ kind: 'ledger', address: impostor, path: pathFor('live', 9), deviceId: 'fake', label: 'Wrong device' })
    rpc.state.balances.set(impostor.toLowerCase(), 5n * 10n ** 18n)
    const { requestId } = await engine.engine.send.submit({ accountId: view.id, chainId: TESTNET, token: 'native', to: FRIEND, amount: '1' })
    await approvalById(engine, requestId)
    await engine.engine.approvals.decide({ id: requestId, approve: true })
    await expect.poll(async () => (await engine.engine.activity.list({ accountId: view.id })).find((e) => e.id === requestId)?.status, { timeout: 10_000 }).toBe('failed')
    expect(rpc.state.transactions.size).toBe(before)
  })

  it('a contract call with blind signing off fails honestly, and never twice', async () => {
    const before = rpc.state.transactions.size
    const { requestId } = await engine.engine.allowances.revoke({ accountId: ledgerAccountId, chainId: TESTNET, token: '0x1111111111111111111111111111111111111111', spender: FRIEND, standard: 'erc20' })
    await approvalById(engine, requestId)
    await engine.engine.approvals.decide({ id: requestId, approve: true })
    await expect.poll(async () => (await engine.engine.activity.list({ accountId: ledgerAccountId })).find((e) => e.id === requestId)?.status, { timeout: 10_000 }).toBe('failed')
    expect(rpc.state.transactions.size).toBe(before)
  })
})
