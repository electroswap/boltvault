/**
 * M9 inside the engine: the in-app browser's virtual session (SAFE reads
 * answered without a sheet, non-http pages refused, events delivered), and
 * WalletConnect over the scripted kit — a proposal runs the Connect sheet
 * and approves the session with the right namespaces, a request signs
 * through the sheet with the chain aligned, an unverified peer gets
 * ORIGIN_UNVERIFIED, and a delete disconnects the site.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { FakeWalletKit } from '@boltvault/connect'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { hashMessage, recoverAddress, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type ApprovalRequest, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420

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

describe('external dApp transports', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  const kit = new FakeWalletKit()

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET, baseFeePerGas: 0n })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: kit })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    const words = created.mnemonic.split(' ')
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(TESTNET, rpc.url)
  })
  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('binds a WebView session to the channel nonce the host injected', async () => {
    /*
      A session id is not a secret and not proof of anything. The host mints a
      nonce, injects it into the document it watched commit, and hands it to
      `open`; anything that speaks for the session has to hand it back. Without
      this, guessing or reading a session id was enough to speak as the origin.
    */
    const channel = 'a'.repeat(32)
    const s = await engine.engine.dapps.open({ url: 'https://bound.example/', kind: 'webview', verified: true, channel })
    const withoutIt = await engine.engine.dapps.request({ sessionId: s.sessionId, id: 1, method: 'eth_chainId' })
    expect(withoutIt.error?.code).toBe(4900)
    const withTheWrongOne = await engine.engine.dapps.request({ sessionId: s.sessionId, channel: 'b'.repeat(32), id: 2, method: 'eth_chainId' })
    expect(withTheWrongOne.error?.code).toBe(4900)
    const proper = await engine.engine.dapps.request({ sessionId: s.sessionId, channel, id: 3, method: 'eth_chainId' })
    expect(proper.error).toBeUndefined()
    expect(proper.result).toBe('0xcb2e')
    await engine.engine.dapps.close({ sessionId: s.sessionId })
  })

  it('opens a WebView session on the committed origin, answers SAFE reads without a sheet, refuses non-http pages', async () => {
    /*
      `verified` used to default to true for any WebView session, which made
      the trust chip say the same thing for an HTTPS dApp and for a cleartext
      page an attacker had rewritten in flight. The caller states what it
      observed; the Browser screen passes `origin.startsWith('https://')`.
    */
    const s = await engine.engine.dapps.open({ url: 'https://app.electroswap.io/swap?x=1', kind: 'webview', verified: true })
    expect(s).toMatchObject({ origin: 'https://app.electroswap.io', kind: 'webview', verified: true })
    const unverified = await engine.engine.dapps.open({ url: 'http://plain.example/', kind: 'webview', verified: false })
    expect(unverified).toMatchObject({ kind: 'webview', verified: false })
    await engine.engine.dapps.close({ sessionId: unverified.sessionId })
    const chain = await engine.engine.dapps.request({ sessionId: s.sessionId, id: 1, method: 'eth_chainId', params: [] })
    expect(chain).toEqual({ result: '0xcb2e' })
    const accounts = await engine.engine.dapps.request({ sessionId: s.sessionId, id: 2, method: 'eth_accounts', params: [] })
    expect(accounts).toEqual({ result: [] })
    const blocked = await engine.engine.dapps.request({ sessionId: s.sessionId, id: 3, method: 'eth_sign', params: [address, '0x00'] })
    expect(blocked.error?.code).toBe(4200)
    await expect(engine.engine.dapps.open({ url: 'javascript:alert(1)', kind: 'webview' })).rejects.toThrow(/http/)
    await engine.engine.dapps.close({ sessionId: s.sessionId })
    expect(await engine.engine.dapps.request({ sessionId: s.sessionId, id: 4, method: 'eth_chainId' })).toEqual({ error: { code: 4900, message: 'The session is closed.' } })
    expect(await engine.engine.dapps.list()).toEqual([])
  })

  it('pairs, runs the Connect sheet for the proposal and approves the session with the home chain and the known optional chains', async () => {
    const status0 = await engine.engine.connect.status()
    expect(status0).toMatchObject({ available: true, proposals: [], sessions: [] })
    await engine.engine.connect.pair({ uri: 'wc:1234@2?relay-protocol=irn&symKey=ab' })
    const req = await approvalOn(engine, (r) => r.origin === 'https://app.electroswap.io' && r.kind === 'connect')
    expect((await engine.engine.connect.status()).proposals).toMatchObject([{ id: 1, name: 'ElectroSwap', origin: 'https://app.electroswap.io', verified: true, requiredChains: ['eip155:52014'] }])
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    for (let i = 0; i < 100 && kit.sessions.size === 0; i++) await new Promise((r) => setTimeout(r, 10))
    const session = [...kit.sessions.values()][0]
    expect(session?.chains).toEqual(['eip155:52014', 'eip155:1', 'eip155:8453'])
    expect(session?.accounts).toEqual([`eip155:52014:${address}`, `eip155:1:${address}`, `eip155:8453:${address}`])
    expect(kit.log).toContain('approve:1')
    const status = await engine.engine.connect.status()
    expect(status.sessions).toMatchObject([{ topic: session?.topic, name: 'ElectroSwap', origin: 'https://app.electroswap.io', chains: [52014, 1, 8453] }])
    expect(engine.sites.get('https://app.electroswap.io')?.connected).toBe(true)
  })

  it('signs a personal message for the session through the sheet, on the chain the request names', async () => {
    const topic = [...kit.sessions.keys()][0] ?? ''
    const answer = kit.simulateRequest({ topic, method: 'personal_sign', params: ['0x68656c6c6f', address], chainId: 'eip155:5201420' })
    const req = await approvalOn(engine, (r) => r.origin === 'https://app.electroswap.io' && r.kind === 'sign_message')
    expect(engine.sites.get('https://app.electroswap.io')?.chainId).toBe(TESTNET)
    const payload = req.payload as { assessment: { rules: Array<{ code: string }> } }
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('ORIGIN_UNVERIFIED')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const res = await answer
    if (!('result' in res)) throw new Error('expected a result')
    expect(await recoverAddress({ hash: hashMessage({ raw: '0x68656c6c6f' }), signature: res.result as Hex })).toBe(address)
  })

  /*
    The session-inheritance attack. Sessions live in one origin-keyed map
    shared by every transport, `RpcFlow.connect()` returns an existing one
    without raising a sheet, and an unverified WalletConnect peer used to be
    keyed by the origin it declared about itself. So a proposal claiming
    `app.electroswap.io` — the in-app browser's own home page, and therefore
    the origin most likely to already be connected — was handed the account
    and approved as a full signing session with nothing shown to the user.

    An unverified peer is now keyed by its own pairing topic, so it can never
    land on a session someone else established.
  */
  it('an unverified peer claiming a connected origin still has to ask', async () => {
    const claimed = 'https://app.electroswap.io'
    const impostor = new FakeWalletKit({ peer: { name: 'ElectroSwap', description: '', url: claimed, icons: [] }, verified: 'INVALID', required: ['eip155:52014'], optional: [] })
    const e2 = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: impostor })
    await e2.ready
    const created = await e2.engine.vault.create({ password: PASSWORD })
    await e2.chains.setRpc(TESTNET, rpc.url)
    try {
      // The victim connects that origin in the in-app browser, and approves it.
      const web = await e2.engine.dapps.open({ url: claimed, kind: 'webview' })
      const first = e2.engine.dapps.request({ sessionId: web.sessionId, id: 1, method: 'eth_requestAccounts', params: [] })
      const consent = await approvalOn(e2, (r) => r.kind === 'connect')
      await e2.engine.approvals.decide({ id: consent.id, approve: true, data: { accountId: created.accounts[0]?.id ?? '', chainId: TESTNET } })
      await first
      expect(e2.sites.get(claimed)?.connected).toBe(true)

      // Now the impostor pairs and proposes, claiming the very same origin.
      await e2.engine.connect.pair({ uri: 'wc:7777@2?relay-protocol=irn&symKey=ef' })
      const second = await approvalOn(e2, (r) => r.kind === 'connect')
      // A sheet was raised rather than the session being inherited silently...
      expect(second.id).not.toBe(consent.id)
      // ...and the peer's claim is not the identity it was given.
      const view = (await e2.engine.connect.status()).proposals[0]
      expect(view?.verified).toBe(false)
      expect(view?.origin).not.toBe(claimed)
      expect(view?.url).toBe(claimed) // still shown to the user, as a claim
    } finally {
      e2.dispose()
    }
  })

  it('marks an unverified peer on every signature and disconnects the site when the peer leaves', async () => {
    const topic = [...kit.sessions.keys()][0] ?? ''
    // A second kit-level proposal from an unverified peer: the firewall warns.
    const shady = new FakeWalletKit({ peer: { name: 'Free Mint', description: '', url: 'https://free-mint.xyz', icons: [] }, verified: 'INVALID', required: ['eip155:52014'], optional: [] })
    const engine2 = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: shady })
    await engine2.ready
    const created = await engine2.engine.vault.create({ password: PASSWORD })
    const quiz = await engine2.engine.vault.backupQuiz({ seedId: created.seedId })
    const words = created.mnemonic.split(' ')
    await engine2.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine2.chains.setRpc(TESTNET, rpc.url)
    try {
      await engine2.engine.connect.pair({ uri: 'wc:9999@2?relay-protocol=irn&symKey=cd' })
      const connect = await approvalOn(engine2, (r) => r.kind === 'connect')
      expect((await engine2.engine.connect.status()).proposals[0]?.verified).toBe(false)
      await engine2.engine.approvals.decide({ id: connect.id, approve: true })
      for (let i = 0; i < 100 && shady.sessions.size === 0; i++) await new Promise((r) => setTimeout(r, 10))
      const t2 = [...shady.sessions.keys()][0] ?? ''
      const answer = shady.simulateRequest({ topic: t2, method: 'personal_sign', params: ['0x01', created.accounts[0]?.address], chainId: 'eip155:5201420' })
      const sign = await approvalOn(engine2, (r) => r.kind === 'sign_message')
      const payload = sign.payload as { assessment: { rules: Array<{ code: string }>; severity: string } }
      expect(payload.assessment.rules.map((r) => r.code)).toContain('ORIGIN_UNVERIFIED')
      await engine2.engine.approvals.decide({ id: sign.id, approve: false })
      const res = await answer
      expect('error' in res && res.error.code).toBe(4001)
    } finally {
      engine2.dispose()
    }
    // The verified session on the first engine: the peer disconnects.
    kit.simulateDelete(topic)
    for (let i = 0; i < 100 && (await engine.engine.connect.status()).sessions.length > 0; i++) await new Promise((r) => setTimeout(r, 10))
    expect((await engine.engine.connect.status()).sessions).toEqual([])
    expect(engine.sites.get('https://app.electroswap.io')?.connected ?? false).toBe(false)
    expect(await engine.engine.dapps.list()).toEqual([])
  })
})
