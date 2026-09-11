/**
 * `security.assess` / `security.policy` (master plan §2.4, §3.4).
 *
 * The properties worth holding on to are not "it returns some rules" but:
 * the preview is the SAME firewall the sheet runs, a dApp cannot reach it, it
 * leaks none of the context it reasoned over, and asking does not cost the
 * account anything — not a nonce, not an approval.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import type { Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, parseApprovalPayload, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420

const STRANGER = '0xcc00000000000000000000000000000000000002' as Hex
const CONTRACT = '0xfc00000000000000000000000000000000000004' as Hex

const offline: typeof fetch = async () => new Response('not found', { status: 404 })

describe('security.assess — the firewall, asked rather than raised', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: TESTNET })
    rpc.state.code.set(CONTRACT.toLowerCase(), '0x6080')
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: offline, staticsUrl: null, electroswapUrl: null })
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

  it('answers without creating an approval, and says out loud that it is advisory', async () => {
    const before = engine.approvals.list().length
    const view = await engine.engine.security.assess({ accountId, chainId: TESTNET, request: { kind: 'transaction', to: STRANGER, value: '0x1' } })
    expect(engine.approvals.list()).toHaveLength(before)
    expect(view.advisory).toBe(true)
    expect(view.origin).toBe('internal:preview')
    expect(view.rules.map((r) => r.code)).toContain('RECIPIENT_FIRST_TIME')
    expect(view.statements.length).toBeGreaterThan(0)
  })

  it('hands back the sheet’s own view and nothing else — no context, no transaction, no account', async () => {
    const view = await engine.engine.security.assess({ accountId, chainId: TESTNET, request: { kind: 'transaction', to: CONTRACT, data: '0xdeadbeef' } })
    /*
      The reply is whitelisted by a zod schema on the way out, and this is the
      assertion that keeps it that way. An assessment reasons over the user's
      own accounts, the address book, what this wallet has sent to, balances,
      contract facts and the scam lists; none of it may ride back out.
    */
    expect(Object.keys(view).sort()).toEqual(['advisory', 'changes', 'origin', 'presentation', 'rules', 'severity', 'simulatedAt', 'simulationMode', 'statements'])
  })

  it('is not reachable by a dApp content script, or by a paired device', async () => {
    const arg = { accountId, chainId: TESTNET, request: { kind: 'transaction', to: STRANGER, value: '0x1' } }
    for (const sender of ['content', 'device'] as const) {
      const res = await engine.host.dispatch({ v: 1, kind: 'request', id: 'r1', ns: 'security', method: 'assess', arg }, sender)
      expect(res.ok).toBe(false)
      if (!res.ok) expect(res.error.code).toBe('unauthorized')
    }
    const policy = await engine.host.dispatch({ v: 1, kind: 'request', id: 'r2', ns: 'security', method: 'policy' }, 'content')
    expect(policy.ok).toBe(false)
  })

  it('answers not_implemented for a method it does not have, rather than crashing', async () => {
    const res = await engine.host.dispatch({ v: 1, kind: 'request', id: 'r3', ns: 'security', method: 'overrule', arg: {} }, 'ui')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('not_implemented')
  })

  it('never comes back quieter than the sheet that follows it', async () => {
    const to = CONTRACT
    const value = '0x1'
    const preview = await engine.engine.security.assess({ accountId, chainId: TESTNET, request: { kind: 'transaction', to, value } })
    const { requestId } = await engine.provider.submitInternal({ kind: 'send_transaction', origin: 'internal:send', chainId: TESTNET, accountId, tx: { from: address, to, value }, clientRequestId: `cmp:${Date.now()}` })
    const request = engine.approvals.list().find((r) => r.id === requestId)
    const payload = parseApprovalPayload(request?.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction sheet')
    const rank = { info: 0, warn: 1, danger: 2, block: 3 } as const
    expect(rank[preview.severity]).toBeLessThanOrEqual(rank[payload.assessment.severity])
    expect(preview.rules.map((r) => r.code).sort()).toEqual(payload.assessment.rules.map((r) => r.code).sort())
    await engine.engine.approvals.decide({ id: requestId, approve: false })
  })

  it('does not spend a nonce to answer', async () => {
    /*
      Preparing a transaction reserves the next free nonce for the life of an
      approval. A recipient field that re-previews on every keystroke would
      have walked the account's nonce into the distance; the preview reads the
      pending nonce instead of claiming one.
    */
    const sheetNonce = async (): Promise<number> => {
      const { requestId } = await engine.provider.submitInternal({ kind: 'send_transaction', origin: 'internal:send', chainId: TESTNET, accountId, tx: { from: address, to: STRANGER, value: '0x1' }, clientRequestId: `nonce:${Math.random()}` })
      const payload = parseApprovalPayload(engine.approvals.list().find((r) => r.id === requestId)?.payload)
      if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction sheet')
      await engine.engine.approvals.decide({ id: requestId, approve: false })
      return payload.tx.nonce
    }
    const before = await sheetNonce()
    for (let i = 0; i < 3; i++) await engine.engine.security.assess({ accountId, chainId: TESTNET, request: { kind: 'transaction', to: STRANGER, value: '0x1' } })
    // Consecutive: the three previews in between claimed nothing.
    expect(await sheetNonce()).toBe(before + 1)
  })

  it('reads the spend policy the rules actually run on, and moves with it', async () => {
    const policy = await engine.engine.security.policy()
    expect(policy.largeSendPercent).toBe(10)
    expect(policy.steps.find((s) => s.severity === 'warn')?.delayMs).toBe(1500)
    expect(policy.steps.find((s) => s.severity === 'danger')?.typedConfirmation).toBe(true)
    expect(policy.steps.find((s) => s.severity === 'block')?.blocked).toBe(true)

    // A fifth of the balance: under the default tenth threshold it is a large
    // send, and at fifty percent it is not. The preview has to follow the
    // policy, not a constant of its own.
    const fifth = { kind: 'transaction' as const, to: STRANGER, value: `0x${(10n ** 18n / 5n).toString(16)}` }
    expect((await engine.engine.security.assess({ accountId, chainId: TESTNET, request: fifth })).rules.map((r) => r.code)).toContain('LARGE_SEND')
    await engine.engine.settings.set({ largeSendPercent: 50 })
    expect((await engine.engine.security.policy()).largeSendPercent).toBe(50)
    expect((await engine.engine.security.assess({ accountId, chainId: TESTNET, request: fifth })).rules.map((r) => r.code)).not.toContain('LARGE_SEND')
    await engine.engine.settings.set({ largeSendPercent: 10 })
  })

  it('refuses to preview for an account this vault does not hold', async () => {
    await expect(engine.engine.security.assess({ accountId: 'acc_nope', chainId: TESTNET, request: { kind: 'transaction', to: STRANGER, value: '0x1' } })).rejects.toThrow()
  })
})
