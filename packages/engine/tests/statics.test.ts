/**
 * Signed statics in the engine (master plan §3.7): flags and the scam list
 * are accepted only signed by the key the engine was given, never rolled
 * back, kept as last-good across a restart; the swap kill-switch and a
 * corridor kill-switch bite; a scam origin is blocked on any signature; the
 * minimum-version flag raises the update plate for the right body.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { signStatic, staticKeyPair } from '@boltvault/core'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type Engine, type ApprovalRequest } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const keys = staticKeyPair(new Uint8Array(32).fill(5))
const wrongKeys = staticKeyPair(new Uint8Array(32).fill(6))
const enc = (v: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(v))

/** A static host: `/wallet/<name>` and `/wallet/<name>.sig`, signed with whichever key the test says. */
function staticHost(files: Record<string, { body: unknown; key?: string; unsigned?: boolean }>): typeof fetch {
  return async (input) => {
    const url = String(input)
    const m = /\/wallet\/([a-z-]+\.json)(\.sig)?$/.exec(url)
    if (!m) return new Response('not found', { status: 404 })
    const f = files[m[1] ?? '']
    if (!f) return new Response('not found', { status: 404 })
    const bytes = enc(f.body)
    if (m[2]) return f.unsigned ? new Response('', { status: 404 }) : new Response(signStatic(bytes, f.key ?? keys.privateKeyHex), { status: 200 })
    return new Response(JSON.stringify(f.body), { status: 200, headers: { 'content-type': 'application/json' } })
  }
}

async function approvalOn(engine: Engine, predicate: (r: ApprovalRequest) => boolean, timeoutMs = 6_000): Promise<ApprovalRequest> {
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

describe('signed flags and the scam list', () => {
  let rpc: MockRpc
  let files: Record<string, { body: unknown; key?: string; unsigned?: boolean }>
  const platform = createMemoryPlatform()

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET, baseFeePerGas: 0n })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
  })
  afterAll(async () => {
    await rpc.close()
  })

  const boot = (fetchImpl: typeof fetch, clientVersion = 'BoltVault/0.1.0'): Engine => createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null, pricesUrl: null, staticsUrl: 'https://static.test/wallet', staticsPublicKey: keys.publicKeyHex, clientVersion, body: 'extension' })

  it('takes signed files, refuses unsigned, wrong-key and older ones, and keeps last-good across a restart', async () => {
    files = { 'flags.json': { body: { v: 1, issuedAt: 100, disabled: { swap: true }, notice: 'Swaps paused for the router upgrade.' } }, 'scam-origins.json': { body: { v: 1, issuedAt: 100, origins: ['https://free-mint.xyz'] } } }
    const engine = boot(staticHost(files))
    await engine.ready
    expect(await engine.statics.refresh()).toEqual({ flags: 'updated', scam: 'updated' })
    let view = await engine.engine.flags.get()
    expect(view.flags.disabled.swap).toBe(true)
    expect(view.flags.notice).toBe('Swaps paused for the router upgrade.')
    expect(view.scamOriginsCount).toBe(1)
    expect(view.updateRequired).toBe(false)
    // Unsigned: refused, the held file stays.
    files['flags.json'] = { body: { v: 1, issuedAt: 200, disabled: {} }, unsigned: true }
    expect((await engine.statics.refresh()).flags).toBe('refused')
    expect((await engine.engine.flags.get()).flags.disabled.swap).toBe(true)
    // Wrong key: refused.
    files['flags.json'] = { body: { v: 1, issuedAt: 200, disabled: {} }, key: wrongKeys.privateKeyHex }
    expect((await engine.statics.refresh()).flags).toBe('refused')
    // Older than held: refused (anti-rollback).
    files['flags.json'] = { body: { v: 1, issuedAt: 50, disabled: {} } }
    expect((await engine.statics.refresh()).flags).toBe('refused')
    // Newer and signed: taken.
    files['flags.json'] = { body: { v: 1, issuedAt: 300, disabled: {}, minVersion: { extension: '0.2.0' } } }
    expect((await engine.statics.refresh()).flags).toBe('updated')
    view = await engine.engine.flags.get()
    expect(view.flags.disabled.swap).toBeUndefined()
    expect(view.updateRequired).toBe(true)
    expect(view.minVersion).toBe('0.2.0')
    engine.dispose()
    // A restart on the same storage starts from the held files before any network.
    const again = boot(async () => new Response('', { status: 500 }))
    await again.ready
    const held = await again.engine.flags.get()
    expect(held.flags.issuedAt).toBe(300)
    expect(held.scamOriginsCount).toBe(1)
    expect((await again.engine.flags.get()).updateRequired).toBe(true)
    again.dispose()
    // The phone body is not held to the extension's minimum.
    const phone = createEngine({ platform, kdf: KDF, fetch: async () => new Response('', { status: 500 }), electroswapUrl: null, pricesUrl: null, staticsUrl: null, staticsPublicKey: keys.publicKeyHex, clientVersion: 'BoltVault/0.1.0', body: 'mobile' })
    await phone.ready
    expect((await phone.engine.flags.get()).updateRequired).toBe(false)
    phone.dispose()
  })

  /*
    ATT-BV-020. `statics.isDisabled` accepted six features and only `swap` and
    `bridge` ever called it, so four of the six documented emergency controls
    did nothing at all: ops could publish `limit: disabled` during an incident
    and the wallet would go on placing orders. Hiding a screen is not the
    control either — every namespace is callable from any UI page — so the
    check is at the top of each verb that starts a flow, and this asserts one
    verb per feature.
  */
  it('switches off limit orders, the launchpad, the marketplace and farms', async () => {
    const fresh = createMemoryPlatform()
    const host = staticHost({ 'flags.json': { body: { v: 1, issuedAt: 1, disabled: { limit: true, launchpad: true, nft: true, farms: true } } } })
    const engine = createEngine({ platform: fresh, kdf: KDF, receiptPollMs: 20, fetch: host, electroswapUrl: null, pricesUrl: null, staticsUrl: 'https://static.test/wallet', staticsPublicKey: keys.publicKeyHex })
    await engine.ready
    await engine.statics.refresh()
    const created = await engine.engine.vault.create({ password: PASSWORD })
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    const words = created.mnemonic.split(' ')
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(TESTNET, rpc.url)
    const accountId = created.accounts[0]?.id ?? ''
    const off = /switched off/
    try {
      const TOKEN = '0x1111111111111111111111111111111111111111'
      await expect(engine.engine.limit.place({ accountId, chainId: TESTNET, tokenIn: 'native', tokenOut: TOKEN, amountIn: '1', minOut: '1', durationSeconds: 86_400 })).rejects.toThrow(off)
      await expect(engine.engine.launchpad.contribute({ accountId, chainId: TESTNET, pool: TOKEN, amountEtn: '1' })).rejects.toThrow(off)
      await expect(engine.engine.nft.buy({ accountId, chainId: TESTNET, address: TOKEN, tokenId: '1' })).rejects.toThrow(off)
      await expect(engine.engine.farm.deposit({ accountId, chainId: TESTNET, farmId: 1, amount0: '1' })).rejects.toThrow(off)
      await expect(engine.engine.legends.mint({ accountId, chainId: TESTNET, count: 1 })).rejects.toThrow(off)
    } finally {
      engine.dispose()
    }
  })

  it('switches off swaps and a bridge corridor, and blocks a listed origin on any signature', async () => {
    const fresh = createMemoryPlatform()
    const host = staticHost({ 'flags.json': { body: { v: 1, issuedAt: 1, disabled: { swap: true, bridgeCorridors: ['52014:8453:USDC'] } } }, 'scam-origins.json': { body: { v: 1, issuedAt: 1, origins: ['free-mint.xyz'] } } })
    const engine = createEngine({ platform: fresh, kdf: KDF, receiptPollMs: 20, fetch: host, electroswapUrl: null, pricesUrl: null, staticsUrl: 'https://static.test/wallet', staticsPublicKey: keys.publicKeyHex })
    await engine.ready
    await engine.statics.refresh()
    const created = await engine.engine.vault.create({ password: PASSWORD })
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    const words = created.mnemonic.split(' ')
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(TESTNET, rpc.url)
    const accountId = created.accounts[0]?.id ?? ''
    const address = created.accounts[0]?.address ?? ''
    // Swap: the quote says why, execute refuses.
    const q = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: 'native', tokenOut: '0x1111111111111111111111111111111111111111', amountIn: '1' })
    expect(q.ok).toBe(false)
    expect(q.problems.join(' ')).toMatch(/switched off/)
    await expect(engine.engine.swap.execute({ accountId, chainId: TESTNET, tokenIn: 'native', tokenOut: '0x1111111111111111111111111111111111111111', amountIn: '1' })).rejects.toThrow(/switched off/)
    // Bridge: only the named corridor is off (verification itself would need the chain; the flag wins regardless).
    const routes = await engine.engine.bridge.routes({ fromChainId: 52014 })
    const base = routes.find((r) => r.toChainId === 8453 && r.symbol === 'USDC')
    expect(base?.verified).toBe(false)
    expect(base?.reason).toMatch(/signed flag/)
    // Scam list: a signature for the listed origin is blocked by ORIGIN_SCAM.
    const s = await engine.engine.dapps.open({ url: 'https://app.free-mint.xyz/claim', kind: 'webview' })
    const answer = engine.engine.dapps.request({ sessionId: s.sessionId, id: 1, method: 'eth_requestAccounts', params: [] })
    const connect = await approvalOn(engine, (r) => r.kind === 'connect')
    await engine.engine.approvals.decide({ id: connect.id, approve: true })
    await answer
    const signing = engine.engine.dapps.request({ sessionId: s.sessionId, id: 2, method: 'personal_sign', params: ['0x01', address] })
    const req = await approvalOn(engine, (r) => r.kind === 'sign_message')
    const payload = req.payload as { assessment: { severity: string; rules: Array<{ code: string }>; presentation: { blocked: boolean } } }
    expect(payload.assessment.rules.map((r) => r.code)).toContain('ORIGIN_SCAM')
    expect(payload.assessment.presentation.blocked).toBe(true)
    // Even an approve from a UI cannot sign a blocked request (§3.4).
    await engine.engine.approvals.decide({ id: req.id, approve: true }).catch(() => undefined)
    const res = await signing
    expect(res.error?.code).toBe(4001)
    engine.dispose()
  })
})
