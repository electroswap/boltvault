/**
 * M4 inside the engine, against the mock RPC: token universe + custom
 * tokens, the portfolio snapshot (chain quantities, persisted last-good),
 * Send through the internal approval path, allowances scan + revoke,
 * contacts as the lookalike reference set, and the inbound transfer scan.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { decodeFunctionData, encodeAbiParameters, maxUint256, pad, parseAbi, parseAbiParameters, parseTransaction, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, parseApprovalPayload, resetMulticallCache, CANONICAL_MULTICALL3, type ApprovalRequest, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const PERMIT2 = '0xDD07Fe6922d1Aab4fe98C6533fa19037159500E7' as Hex // testnet Permit2 (registry)
const FRIEND = '0x4444444444444444444444444444444444444444' as Hex
const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)', 'function transfer(address to, uint256 amount) returns (bool)'])

const LIST = { name: 'fixture', tokens: [{ chainId: TESTNET, address: TOKEN, name: 'Fixture Token', symbol: 'FIX', decimals: 6 }] }

function str(v: string): Hex {
  return encodeAbiParameters(parseAbiParameters('string'), [v])
}
function u(v: bigint): Hex {
  return encodeAbiParameters(parseAbiParameters('uint256'), [v])
}

/**
 * Poll until the activity row for `requestId` carries a broadcast hash.
 *
 * This used to be a flat `setTimeout(r, 50)`. Deciding an approval kicks off
 * sign → eth_sendRawTransaction → activity.update, which takes longer than
 * that whenever the machine is busy, so both assertions below passed alone and
 * failed under the full `pnpm -r test` run — leaving the only end-to-end check
 * that broadcast calldata matches the sheet silently absent in CI.
 */
async function settled(engine: Engine, accountId: string, requestId: string, ms = 10_000): Promise<{ hash: string; category: string }> {
  const deadline = Date.now() + ms
  for (;;) {
    const entry = (await engine.engine.activity.list({ accountId })).find((e) => e.id === requestId)
    if (entry && typeof entry.hash === 'string') return { hash: entry.hash, category: entry.category }
    if (Date.now() > deadline) throw new Error(`no broadcast hash for ${requestId} within ${ms}ms (status ${entry?.status ?? 'absent'})`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

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

describe('money on the testnet mock', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  const balances = new Map<string, bigint>()
  const allowances = new Map<string, bigint>()

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    rpc.state.code.set(TOKEN.toLowerCase(), '0x6080')
    rpc.state.code.set(PERMIT2.toLowerCase(), '0x6080')
    rpc.state.calls.set(TOKEN.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str('Fixture Token')
      if (sel === '0x95d89b41') return str('FIX')
      if (sel === '0x313ce567') return u(6n)
      if (sel === '0x70a08231') return u(balances.get(`0x${data.slice(34, 74)}`.toLowerCase()) ?? 0n)
      if (sel === '0xdd62ed3e') return u(allowances.get(`0x${data.slice(98, 138)}`.toLowerCase()) ?? 0n)
      return '0x'
    })
    rpc.state.calls.set(PERMIT2.toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint160, uint48, uint48'), [0n, 0, 0]))
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('tokenlist.json')) return new Response(JSON.stringify(LIST), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('not found', { status: 404 })
    }
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 5n * 10n ** 18n)
    balances.set(address.toLowerCase(), 12_500_000n)
    allowances.set(PERMIT2.toLowerCase(), maxUint256)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('builds the universe from native + the pinned list and verifies custom tokens on chain', async () => {
    const u = await engine.engine.tokens.universe({ chainId: TESTNET })
    expect(u.map((t) => t.symbol)).toEqual(['ETN', 'FIX'])
    await expect(engine.engine.tokens.addCustom({ chainId: TESTNET, address: FRIEND })).rejects.toMatchObject({ code: 'invalid_argument' })
    const meta = await engine.engine.tokens.metadata({ chainId: TESTNET, address: TOKEN })
    expect(meta).toMatchObject({ symbol: 'FIX', decimals: 6, hasCode: true })
  })

  it('reads quantities from the chain and persists a last-good snapshot', async () => {
    const fresh = await engine.engine.portfolio.refresh({ accountId, chainIds: [TESTNET] })
    expect(fresh.stale).toBe(false)
    expect(fresh.rows.map((r) => [r.symbol, r.quantity])).toEqual([
      ['ETN', '5'],
      ['FIX', '12.5'],
    ])
    expect(fresh.total).toBeNull() // no display prices without the API
    expect(fresh.unpricedCount).toBe(2)
    const again = await engine.engine.portfolio.snapshot({ accountId, chainIds: [TESTNET] })
    expect(again.stale).toBe(true)
    expect(again.rows).toHaveLength(2)
  })

  it('quotes a send honestly and routes it through the internal approval to the chain', async () => {
    const bad = await engine.engine.send.quote({ accountId, chainId: TESTNET, token: 'native', to: 'nobody', amount: '1' })
    expect(bad.ok).toBe(false)
    expect(bad.problems[0]).toMatch(/full address or a name/)
    const tooMuch = await engine.engine.send.quote({ accountId, chainId: TESTNET, token: 'native', to: FRIEND, amount: '6' })
    expect(tooMuch.problems[0]).toMatch(/Not enough/)
    const quote = await engine.engine.send.quote({ accountId, chainId: TESTNET, token: TOKEN, to: FRIEND, amount: '2.5' })
    expect(quote).toMatchObject({ ok: true, to: FRIEND, symbol: 'FIX', amountRaw: '2500000' })

    const { requestId } = await engine.engine.send.submit({ accountId, chainId: TESTNET, token: TOKEN, to: FRIEND, amount: '2.5' })
    const req = await approvalById(engine, requestId)
    expect(req.id).toBe(requestId)
    expect(req.origin).toBe('internal:send')
    const payload = parseApprovalPayload(req.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction')
    expect(payload.assessment.statements[0]?.text).toMatch(/^Send 2.5 FIX to/)
    expect(payload.assessment.rules.map((r) => r.code)).toContain('RECIPIENT_FIRST_TIME')
    await engine.engine.approvals.decide({ id: requestId, approve: true })
    const entry = await settled(engine, accountId, requestId)
    expect(entry.hash).toMatch(/^0x/)
    expect(entry.category).toBe('SEND')
    const raw = rpc.state.transactions.get(entry.hash)?.raw
    const tx = parseTransaction(raw as Hex)
    expect(tx.to?.toLowerCase()).toBe(TOKEN.toLowerCase())
    const decoded = decodeFunctionData({ abi: ERC20, data: tx.data as Hex })
    expect(decoded.functionName).toBe('transfer')
    expect(decoded.args).toEqual([FRIEND, 2_500_000n])
  })

  /*
    `eth_getTransactionCount(pending)` only counts what the node has seen, so
    two approvals raised before either is broadcast both read the same number —
    and the second to arrive replaces the first at that nonce. One of them
    silently never happens, and which one is a race. The wallet hands out its
    own, above anything it has already reserved.
  */
  it('gives two unsettled approvals consecutive nonces', async () => {
    const one = await engine.engine.send.submit({ accountId, chainId: TESTNET, token: 'native', to: FRIEND, amount: '0.1' })
    const two = await engine.engine.send.submit({ accountId, chainId: TESTNET, token: 'native', to: FRIEND, amount: '0.2' })
    const p1 = parseApprovalPayload((await approvalById(engine, one.requestId)).payload)
    const p2 = parseApprovalPayload((await approvalById(engine, two.requestId)).payload)
    if (p1?.kind !== 'send_transaction' || p2?.kind !== 'send_transaction') throw new Error('expected transactions')
    expect(p2.tx.nonce).toBe(p1.tx.nonce + 1)
    await engine.engine.approvals.decide({ id: one.requestId, approve: false })
    await engine.engine.approvals.decide({ id: two.requestId, approve: false })
  })

  it('finds the unlimited Permit2 allowance and revokes it through the sheet', async () => {
    const rows = await engine.engine.allowances.scan({ accountId, chainId: TESTNET, logs: false })
    const permit = rows.find((r) => r.spender.toLowerCase() === PERMIT2.toLowerCase() && r.standard === 'erc20')
    expect(permit).toMatchObject({ token: TOKEN, tokenSymbol: 'FIX', spenderName: 'Permit2', known: true, amount: 'unlimited' })
    expect((await engine.engine.allowances.cached({ accountId, chainId: TESTNET })).rows).toHaveLength(rows.length)
    const { requestId } = await engine.engine.allowances.revoke({ accountId, chainId: TESTNET, token: TOKEN, spender: PERMIT2, standard: 'erc20' })
    const req = await approvalById(engine, requestId)
    expect(req.origin).toBe('internal:approvals')
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind === 'send_transaction' && payload.assessment.statements[0]?.text).toMatch(/^Revoke Permit2/)
    await engine.engine.approvals.decide({ id: requestId, approve: true })
    const entry = await settled(engine, accountId, requestId)
    expect(entry.category).toBe('REVOKE')
    const tx = parseTransaction(rpc.state.transactions.get(entry.hash)?.raw as Hex)
    const decoded = decodeFunctionData({ abi: ERC20, data: tx.data as Hex })
    expect(decoded.args).toEqual([PERMIT2, 0n])
  })

  it('contacts join the lookalike reference set: a poisoned address is blocked', async () => {
    const mum = '0x5555aaaa55555555555555555555555555555555' as Hex
    const poison = '0x5555bbbb55555555555555555555555555555555' as Hex
    await engine.engine.contacts.add({ address: mum, label: 'Mum' })
    expect((await engine.engine.contacts.list()).map((c) => c.label)).toEqual(['Mum'])
    const { requestId } = await engine.engine.send.submit({ accountId, chainId: TESTNET, token: 'native', to: poison, amount: '0.1' })
    const req = await approvalById(engine, requestId)
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind === 'send_transaction' && payload.assessment.presentation.blocked).toBe(true)
    expect(payload?.kind === 'send_transaction' && payload.assessment.rules.map((r) => r.code)).toContain('RECIPIENT_LOOKALIKE')
    await engine.engine.approvals.decide({ id: requestId, approve: false })
  })

  it('finds inbound transfers with a bounded log scan', async () => {
    const TRANSFER = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
    rpc.state.methods.set('eth_getLogs', (params) => {
      const f = params[0] as { fromBlock: string; toBlock: string; topics?: unknown[] }
      const to = (f.topics?.[2] as string | undefined)?.toLowerCase()
      if (to !== pad(address, { size: 32 }).toLowerCase()) return []
      const from = BigInt(f.fromBlock)
      const target = 999_990n
      if (target < from || target > BigInt(f.toBlock)) return []
      return [{ address: TOKEN, topics: [TRANSFER, pad(FRIEND, { size: 32 }), pad(address, { size: 32 })], data: u(7_000_000n), transactionHash: `0x${'ee'.repeat(32)}`, blockNumber: '0xf423a', logIndex: '0x2' }]
    })
    const res = await engine.engine.activityScan.scan({ accountId, chainId: TESTNET })
    expect(res.added).toBe(1)
    const entry = (await engine.engine.activity.list({ accountId })).find((e) => e.category === 'RECEIVE')
    expect(entry).toMatchObject({ token: TOKEN, from: FRIEND, value: '7000000', status: 'confirmed', blockNumber: 999_994 })
    expect(entry?.statements[0]).toBe(`Received FIX from ${FRIEND.slice(0, 6)}…${FRIEND.slice(-4)}`)
    // A second scan is idempotent.
    expect((await engine.engine.activityScan.scan({ accountId, chainId: TESTNET })).added).toBe(0)
  })

  it('names: the testnet has no resolver, so names do not resolve and addresses stay bare', async () => {
    expect(await engine.engine.names.resolve({ chainId: TESTNET, name: 'nakamoto.etn' })).toEqual({ address: null })
    expect(await engine.engine.names.lookup({ chainId: TESTNET, addresses: [address] })).toEqual([{ address, name: null, verified: false }])
  })
})
