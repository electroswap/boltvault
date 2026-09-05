/**
 * M8 inside the engine: a Trezor account signing a send through the sheet
 * (the fake Connect answers like the device), a Keystone account whose
 * signature arrives as scanned frames through the pending table, and remote
 * sign — a phone that holds only the Trezor's address asks the paired laptop,
 * which runs the firewall, shows the sheet with origin `device:Pixel 8`,
 * signs and answers; the phone broadcasts and records.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { FakeTrezorConnect, pathFor } from '@boltvault/hardware'
import { FakeKeystone, encodeSignRequest } from '@boltvault/hardware/keystone'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { parseTransaction, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, MemoryRelay, resetMulticallCache, CANONICAL_MULTICALL3, type ApprovalRequest, type Engine, type KeystonePending } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const TO = '0x1111111111111111111111111111111111111111' as Hex
const RELAY = 'memory://relay'

async function approvalOn(engine: Engine, predicate: (r: ApprovalRequest) => boolean, timeoutMs = 8_000): Promise<ApprovalRequest> {
  const now = engine.approvals.list().find(predicate)
  if (now) return now
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no approval appeared')), timeoutMs)
    const off = engine.host.events.subscribe((e) => {
      const hit = e.type === 'approvals.changed' ? e.pending.find(predicate) : undefined
      if (hit) {
        clearTimeout(timer)
        off()
        resolve(hit)
      }
    })
  })
}

async function firstRaw(rpc: MockRpc, timeoutMs = 8_000): Promise<{ hash: string; raw: Hex }> {
  const started = Date.now()
  for (;;) {
    const [entry] = [...rpc.state.transactions.entries()]
    if (entry) return { hash: entry[0], raw: entry[1].raw }
    if (Date.now() - started > timeoutMs) throw new Error('nothing was broadcast')
    await new Promise((res) => setTimeout(res, 20))
  }
}

async function setUp(engine: Engine, rpc: MockRpc): Promise<void> {
  await engine.ready
  const created = await engine.engine.vault.create({ password: PASSWORD })
  const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
  const words = created.mnemonic.split(' ')
  await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
  await engine.chains.setRpc(TESTNET, rpc.url)
}

describe('Trezor through the sheet', () => {
  let rpc: MockRpc
  let engine: Engine
  const trezor = new FakeTrezorConnect()

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET, baseFeePerGas: 0n })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, trezor })
    await setUp(engine, rpc)
  })
  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('lists both derivation trees from Connect and adds the account', async () => {
    const status = await engine.engine.hardware.trezorStatus()
    expect(status).toMatchObject({ available: true, model: 'T', label: 'My Trezor', problem: null })
    const bip44 = await engine.engine.hardware.trezorAddresses({ scheme: 'bip44', count: 3 })
    const live = await engine.engine.hardware.trezorAddresses({ scheme: 'live', count: 3 })
    expect(bip44.map((r) => r.path)).toEqual([pathFor('bip44', 0), pathFor('bip44', 1), pathFor('bip44', 2)])
    expect(bip44[1]?.address).toBe(trezor.addressFor(pathFor('bip44', 1)))
    expect(live[1]?.address).toBe(trezor.addressFor(pathFor('live', 1)))
    expect(live[1]?.address).not.toBe(bip44[1]?.address)
    const acct = await engine.engine.accounts.addHardware({ kind: 'trezor', address: bip44[1]?.address ?? '', path: pathFor('bip44', 1), label: 'Trezor #1' })
    expect(acct.kind).toBe('trezor')
    expect((await engine.engine.hardware.verifyAccount({ accountId: acct.id })).address).toBe(acct.address)
    expect(trezor.log).toContain(`getAddress:${pathFor('bip44', 1)}:show`)
  })

  it('signs a send on the device with the legacy v and broadcasts it', async () => {
    const acct = (await engine.engine.accounts.list()).find((a) => a.kind === 'trezor')
    if (!acct) throw new Error('no trezor account')
    rpc.state.balances.set(acct.address.toLowerCase(), 5n * 10n ** 18n)
    const { requestId } = await engine.engine.send.submit({ accountId: acct.id, chainId: TESTNET, token: 'native', to: TO, amount: '1' })
    const req = await approvalOn(engine, (r) => r.id === requestId)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const { raw } = await firstRaw(rpc)
    expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toBe(acct.address)
    expect(parseTransaction(raw).chainId).toBe(TESTNET)
    expect(trezor.log.some((l) => l.startsWith('signTransaction:'))).toBe(true)
  })
})

describe('Keystone through the pending table', () => {
  let rpc: MockRpc
  let engine: Engine
  const device = new FakeKeystone()

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET, baseFeePerGas: 0n })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null })
    await setUp(engine, rpc)
  })
  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('imports the account QR, shows the request as frames, takes the scanned answer and broadcasts', async () => {
    const imported = await engine.engine.hardware.keystoneImport({ parts: device.accountFrames(), count: 3 })
    expect(imported.xfp).toBe(device.xfp)
    expect(imported.addresses).toHaveLength(3)
    const row = imported.addresses[2]
    if (!row) throw new Error('no row')
    const acct = await engine.engine.accounts.addHardware({ kind: 'keystone', address: row.address, path: row.path, deviceId: imported.xfp, label: 'Keystone #2' })
    rpc.state.balances.set(acct.address.toLowerCase(), 5n * 10n ** 18n)

    const pendings: KeystonePending[][] = []
    const off = engine.host.events.subscribe((e) => {
      if (e.type === 'hardware.keystone') pendings.push(e.pending)
    })
    const { requestId } = await engine.engine.send.submit({ accountId: acct.id, chainId: TESTNET, token: 'native', to: TO, amount: '0.5' })
    const req = await approvalOn(engine, (r) => r.id === requestId)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    // After Sign, the engine waits with one request on the table.
    for (let i = 0; i < 100 && (await engine.engine.hardware.keystonePending()).length === 0; i++) await new Promise((res) => setTimeout(res, 10))
    const [pending] = await engine.engine.hardware.keystonePending()
    if (!pending) throw new Error('no pending keystone request')
    expect(pending).toMatchObject({ kind: 'transaction', address: acct.address, path: row.path })
    expect(pending.frames[0]?.startsWith('UR:ETH-SIGN-REQUEST/')).toBe(true)
    // A wrong answer (another request's id) is refused; the right one signs.
    const other = await device.answer(encodeSignRequest({ requestId: new Uint8Array(16).fill(1), signData: new Uint8Array([9]), dataType: 'personal_message', path: row.path, xfp: device.xfp }))
    await expect(engine.engine.hardware.keystoneSubmit({ id: pending.id, parts: other })).rejects.toThrow(/different request/)
    const answer = await device.answer(pending.frames)
    await engine.engine.hardware.keystoneSubmit({ id: pending.id, parts: answer })
    const { raw } = await firstRaw(rpc)
    expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toBe(acct.address)
    off()
    expect(pendings.at(-1)).toEqual([])
    expect(await engine.engine.hardware.keystonePending()).toEqual([])
  })
})

describe('remote sign: the phone asks the laptop', () => {
  let rpc: MockRpc
  let laptop: Engine
  let phone: Engine
  const relay = new MemoryRelay()
  const trezor = new FakeTrezorConnect()

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET, baseFeePerGas: 0n })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    const fetchImpl: typeof fetch = async () => new Response('', { status: 404 })
    laptop = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null, pricesUrl: null, relayFor: () => relay, trezor })
    phone = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null, pricesUrl: null, relayFor: () => relay })
    await setUp(laptop, rpc)
    await setUp(phone, rpc)
    await laptop.engine.sync.setDeviceLabel({ label: 'Laptop' })
    await phone.engine.sync.setDeviceLabel({ label: 'Pixel 8' })
    const { offer } = await laptop.engine.sync.createOffer({ relayUrl: RELAY })
    const { answer } = await phone.engine.sync.acceptOffer({ offer })
    await laptop.engine.sync.completeOffer({ answer })
    await laptop.engine.sync.confirm()
    await phone.engine.sync.confirm()
  })
  afterAll(async () => {
    laptop.dispose()
    phone.dispose()
    await rpc.close()
  })

  it('syncs the Trezor account to the phone as metadata the phone cannot sign', async () => {
    const path = pathFor('bip44', 0)
    await laptop.engine.accounts.addHardware({ kind: 'trezor', address: trezor.addressFor(path), path, label: 'Trezor' })
    await laptop.engine.sync.push()
    await phone.engine.sync.pull()
    const synced = (await phone.engine.accounts.list()).find((a) => a.kind === 'trezor')
    expect(synced?.label).toBe('Trezor · from Laptop')
    expect(synced?.hardware?.path).toBe(path)
    expect((await phone.engine.hardware.trezorStatus()).available).toBe(false)
  })

  it('routes the phone-built transaction to the laptop, which signs it through its own sheet; the phone broadcasts', async () => {
    const synced = (await phone.engine.accounts.list()).find((a) => a.kind === 'trezor')
    if (!synced) throw new Error('no synced account')
    rpc.state.balances.set(synced.address.toLowerCase(), 5n * 10n ** 18n)
    const { requestId } = await phone.engine.send.submit({ accountId: synced.id, chainId: TESTNET, token: 'native', to: TO, amount: '2' })
    const phoneReq = await approvalOn(phone, (r) => r.id === requestId)
    await phone.engine.approvals.decide({ id: phoneReq.id, approve: true })
    // The phone now waits; the laptop pulls the channel and finds the request.
    for (let i = 0; i < 100 && (await phone.engine.remote.list()).outgoing.length === 0; i++) await new Promise((res) => setTimeout(res, 10))
    expect((await phone.engine.remote.list()).outgoing).toHaveLength(1)
    let laptopReq: ApprovalRequest | null = null
    for (let i = 0; i < 100 && !laptopReq; i++) {
      await laptop.engine.sync.pull()
      laptopReq = laptop.approvals.list().find((r) => r.origin.startsWith('device:')) ?? null
      if (!laptopReq) await new Promise((res) => setTimeout(res, 20))
    }
    if (!laptopReq) throw new Error('the laptop never saw the request')
    expect(laptopReq.origin).toBe('device:Pixel 8')
    expect((await laptop.engine.remote.list()).incoming).toHaveLength(1)
    const payload = laptopReq.payload as { kind: string; assessment: { statements: Array<{ text: string }> } }
    expect(payload.kind).toBe('send_transaction')
    expect(payload.assessment.statements[0]?.text).toMatch(/^Send 2 ETN to/)
    await laptop.engine.approvals.decide({ id: laptopReq.id, approve: true })
    // The laptop signs (fake Trezor) and answers; the phone's poll picks it up and broadcasts.
    const { hash, raw } = await firstRaw(rpc)
    expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toBe(synced.address)
    expect(trezor.log.some((l) => l.startsWith('signTransaction:'))).toBe(true)
    for (let i = 0; i < 100 && (await phone.engine.remote.list()).outgoing.length > 0; i++) await new Promise((res) => setTimeout(res, 20))
    expect((await phone.engine.remote.list()).outgoing).toEqual([])
    const entry = (await phone.engine.activity.list({ accountId: synced.id })).find((e) => e.hash === hash)
    expect(entry?.category).toBe('SEND')
    // The laptop recorded nothing for it: the requester owns the record (§6).
    expect((await laptop.engine.activity.list({})).find((e) => e.hash === hash)).toBeUndefined()
  })
})
