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

  /*
    ATT-BV-022. The site session used to follow whatever chain the peer named,
    as long as the wallet knew it — no comparison against the namespaces the
    session was actually approved for, and none of the once-per-chain consent
    an injected origin gets. A peer approved for Electroneum could name
    `eip155:1` on its next request and sign on Ethereum instead.
  */
  it('refuses a request on a chain this session was never approved for', async () => {
    const topic = [...kit.sessions.keys()][0] ?? ''
    const before = engine.sites.get('https://app.electroswap.io')?.chainId
    // The session holds 52014, 1 and 8453; the testnet is not among them.
    const res = await kit.simulateRequest({ topic, method: 'personal_sign', params: ['0x68656c6c6f', address], chainId: 'eip155:5201420' })
    expect('error' in res && res.error.code).toBe(5100)
    expect(engine.sites.get('https://app.electroswap.io')?.chainId).toBe(before)
    // …and one that is not a chain at all gets the same answer.
    const nonsense = await kit.simulateRequest({ topic, method: 'personal_sign', params: ['0x68656c6c6f', address], chainId: 'solana:mainnet' })
    expect('error' in nonsense && nonsense.error.code).toBe(5100)
  })

  it('signs a personal message for the session through the sheet, on a chain it was approved for', async () => {
    const topic = [...kit.sessions.keys()][0] ?? ''
    const answer = kit.simulateRequest({ topic, method: 'personal_sign', params: ['0x68656c6c6f', address], chainId: 'eip155:52014' })
    const req = await approvalOn(engine, (r) => r.origin === 'https://app.electroswap.io' && r.kind === 'sign_message')
    expect(engine.sites.get('https://app.electroswap.io')?.chainId).toBe(52014)
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

  /*
    ATT-BV-023. Verify answers two different questions — whether the metadata
    matches the domain it was registered from (`validation`) and whether that
    domain is on Reown's malicious list (`isScam`) — and only the first was
    parsed. `INVALID` and a flagged scam both arrived as "unverified", which is
    `warn` and a second and a half of waiting. The peer's own claimed URL was
    never screened at all, because the firewall origin is synthetic for
    anything but a VALID proposal.
  */
  it('refuses a proposal Verify has flagged as a scam, without asking', async () => {
    const flagged = new FakeWalletKit({ peer: { name: 'Free Mint', description: '', url: 'https://free-mint.xyz', icons: [] }, verified: 'UNKNOWN', isScam: true, required: ['eip155:52014'], optional: [] })
    const e = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: flagged })
    await e.ready
    await e.engine.vault.create({ password: PASSWORD })
    try {
      await e.engine.connect.pair({ uri: 'wc:5555@2?relay-protocol=irn&symKey=aa' })
      await new Promise((r) => setTimeout(r, 30))
      // No sheet, no session — and the peer was told, with the reason code.
      expect(e.approvals.list()).toEqual([])
      expect((await e.engine.connect.status()).sessions).toEqual([])
      expect(flagged.log.some((l) => l.startsWith('reject:'))).toBe(true)
    } finally {
      e.dispose()
    }
  })

  it('puts a danger finding on a peer whose domain Verify actively disagrees with', async () => {
    const lying = new FakeWalletKit({ peer: { name: 'ElectroSwap', description: '', url: 'https://app.electroswap.io', icons: [] }, verified: 'INVALID', required: ['eip155:52014'], optional: [] })
    const e = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: lying })
    await e.ready
    const created = await e.engine.vault.create({ password: PASSWORD })
    const quiz = await e.engine.vault.backupQuiz({ seedId: created.seedId })
    const words = created.mnemonic.split(' ')
    await e.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await e.chains.setRpc(TESTNET, rpc.url)
    try {
      await e.engine.connect.pair({ uri: 'wc:6666@2?relay-protocol=irn&symKey=bb' })
      const connect = await approvalOn(e, (r) => r.kind === 'connect')
      await e.engine.approvals.decide({ id: connect.id, approve: true })
      for (let i = 0; i < 100 && lying.sessions.size === 0; i++) await new Promise((r) => setTimeout(r, 10))
      const topic = [...lying.sessions.keys()][0] ?? ''
      const answer = lying.simulateRequest({ topic, method: 'personal_sign', params: ['0x01', created.accounts[0]?.address], chainId: 'eip155:52014' })
      const sign = await approvalOn(e, (r) => r.kind === 'sign_message')
      const payload = sign.payload as { assessment: { rules: Array<{ code: string }>; severity: string } }
      // "Nobody could tell" and "the domain does not match" are no longer the
      // same sentence at the same severity.
      expect(payload.assessment.rules.map((r) => r.code)).toContain('ORIGIN_VERIFY_MISMATCH')
      expect(payload.assessment.severity).toBe('danger')
      await e.engine.approvals.decide({ id: sign.id, approve: false })
      await answer
    } finally {
      e.dispose()
    }
  })

  /*
    ATT-BV-024. `onProposal` runs `eth_requestAccounts` through the virtual
    session and `RpcFlow.connect()` answered from any existing session for that
    origin — so a Verify-VALID pairing URI for an origin already connected in
    the in-app browser completed with no sheet at all, handing the peer the
    address and a second live session under a first-party name.
  */
  it('asks again for a pairing on an origin that is already connected', async () => {
    // The suite's own `kit` peer is VALID for app.electroswap.io, and the
    // earlier test connected it. A second pairing must still raise a sheet.
    expect(engine.sites.get('https://app.electroswap.io')?.connected).toBe(true)
    const before = engine.approvals.list().length
    await engine.engine.connect.pair({ uri: 'wc:4321@2?relay-protocol=irn&symKey=cc' })
    const second = await approvalOn(engine, (r) => r.kind === 'connect')
    expect(engine.approvals.list().length).toBeGreaterThan(before)
    const payload = second.payload as { kind: string; reconnect: boolean }
    // …and it is not the auto-approved "you were already here" kind of sheet.
    expect(payload.reconnect).toBe(false)
    await engine.engine.approvals.decide({ id: second.id, approve: false })
  })

  /*
    ATT-BV-025. `init()` re-opened every session the kit still held on
    `https://<topic>.walletconnect.invalid`, because the restored session
    carries no Verify result. But Verify said something once — at pairing — and
    that is what was written down. Without it the real site row was orphaned
    and every signature the session made after a restart carried
    ORIGIN_UNVERIFIED: every restart, for every live session.
  */
  it('comes back on the origin it was paired on, not a synthetic one', async () => {
    const platform = createMemoryPlatform()
    const peer = new FakeWalletKit()
    const first = createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: peer })
    await first.ready
    await first.engine.vault.create({ password: PASSWORD })
    await first.chains.setRpc(TESTNET, rpc.url)
    await first.engine.connect.pair({ uri: 'wc:8888@2?relay-protocol=irn&symKey=dd' })
    const connect = await approvalOn(first, (r) => r.kind === 'connect')
    await first.engine.approvals.decide({ id: connect.id, approve: true })
    for (let i = 0; i < 100 && peer.sessions.size === 0; i++) await new Promise((r) => setTimeout(r, 10))
    expect((await first.engine.connect.status()).sessions[0]?.origin).toBe('https://app.electroswap.io')
    first.dispose()

    // The app came back. The kit still holds the session; so does the wallet.
    const again = createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: peer })
    await again.ready
    await again.engine.vault.unlock({ password: PASSWORD })
    try {
      const restored = await (async () => {
        for (let i = 0; i < 100; i++) {
          const found = (await again.engine.connect.status()).sessions[0]
          if (found) return found
          await new Promise((r) => setTimeout(r, 10))
        }
        return null
      })()
      expect(restored?.origin).toBe('https://app.electroswap.io')
      expect(restored?.origin).not.toMatch(/walletconnect\.invalid/)
    } finally {
      again.dispose()
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
      const answer = shady.simulateRequest({ topic: t2, method: 'personal_sign', params: ['0x01', created.accounts[0]?.address], chainId: 'eip155:52014' })
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
