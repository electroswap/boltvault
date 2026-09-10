/**
 * M5 inside the engine, against the mock RPC on the testnet addresses: the
 * holder tier from a schedule contract, a quote through the mini-router with
 * the three fee lines, and the approve → permit → swap flow through three
 * internal sheets, ending in a Universal Router call whose PAY_PORTION pays
 * the configured sink at the schedule's bips (T10).
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { decodeUniversalRouter, UR_COMMAND } from '@boltvault/security'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, maxUint256, parseAbiParameters, parseTransaction, recoverTypedDataAddress, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, parseApprovalPayload, resetMulticallCache, CANONICAL_MULTICALL3, type ApprovalRequest, type Engine, type SwapFlow } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const WETN = '0x154c9fD7F006b92b6afa746098d8081A831DC1FC' as Hex
const PERMIT2 = '0xDD07Fe6922d1Aab4fe98C6533fa19037159500E7' as Hex
const UR = '0xF52321EB9eAd6D57887F203Df9036baf2f3765A9' as Hex
const QUOTER = '0x945ec22FFc3f88aeD031C1C4d051B82282736B41' as Hex
const V2_ROUTER = '0x5410F10a5E214AF03EA601Ca8C76b665A786BCe1' as Hex
const DYNO = '0x162D5a58096b63D89D83e0C66b4731A6CC8b10aF' as Hex
const SINK = '0x00000000000000000000000000000000000051ab' as Hex

const LIST = { name: 'fixture', tokens: [{ chainId: TESTNET, address: TOKEN, name: 'Fixture Token', symbol: 'FIX', decimals: 6 }] }
const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

function payloadOf(req: ApprovalRequest): NonNullable<ReturnType<typeof parseApprovalPayload>> {
  const p = parseApprovalPayload(req.payload)
  if (!p) throw new Error('unparseable payload')
  return p
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

/** Resolve once the flow's step `index` reaches `status` (or the flow stops running). */
function waitStep(engine: Engine, flowId: string, index: number, status: SwapFlow['steps'][number]['status']): Promise<SwapFlow> {
  const now = engine.swap.flow(flowId)
  if (now && (now.steps[index]?.status === status || now.status !== 'running')) return Promise.resolve(now)
  return new Promise((resolve) => {
    const off = engine.host.events.subscribe((e) => {
      if (e.type !== 'swap.progress' || e.flow.id !== flowId) return
      if (e.flow.steps[index]?.status === status || e.flow.status !== 'running') {
        off()
        resolve(e.flow)
      }
    })
  })
}

describe('swap on the testnet mock', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  const balances = new Map<string, bigint>()
  const allowances = new Map<string, bigint>()
  let permitNonce = 0
  let dynoBalance = 25_000n * 10n ** 18n

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    for (const a of [TOKEN, WETN, PERMIT2, UR, QUOTER, V2_ROUTER, DYNO, SINK]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    rpc.state.calls.set(TOKEN.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str('Fixture Token')
      if (sel === '0x95d89b41') return str('FIX')
      if (sel === '0x313ce567') return u(6n)
      if (sel === '0x70a08231') return u(balances.get(`0x${data.slice(34, 74)}`.toLowerCase()) ?? 0n)
      if (sel === '0xdd62ed3e') return u(allowances.get(`0x${data.slice(98, 138)}`.toLowerCase()) ?? 0n)
      return '0x'
    })
    rpc.state.calls.set(WETN.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str('Wrapped ETN')
      if (sel === '0x95d89b41') return str('WETN')
      if (sel === '0x313ce567') return u(18n)
      if (sel === '0x70a08231') return u(0n)
      return '0x'
    })
    // 25,000 DYNO at 1 BOLT-eq each puts this account on Magneto, the middle rung
    // of the testnet ladder in fees.json — tier 2, 30 bips, Turbine next at 50k.
    // Mutable, because a tier moving mid-flow is now a balance moving.
    rpc.state.calls.set(DYNO.toLowerCase(), () => u(dynoBalance))
    rpc.state.calls.set(PERMIT2.toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint160, uint48, uint48'), [0n, 0, permitNonce]))
    // The V3 quoter answers the 0.3 % pool at 1 FIX = 2 WETN-units (scaled by decimals); everything else fails to quote.
    rpc.state.calls.set(QUOTER.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0xc6a5026a') {
        // quoteExactInputSingle((tokenIn, tokenOut, amountIn, fee, sqrtPriceLimitX96))
        const amountIn = BigInt(`0x${data.slice(10 + 64 * 2, 10 + 64 * 3)}`)
        const fee = Number(BigInt(`0x${data.slice(10 + 64 * 3, 10 + 64 * 4)}`))
        if (fee !== 3000) throw new Error('no pool')
        return encodeAbiParameters(parseAbiParameters('uint256, uint160, uint32, uint256'), [amountIn * 2n * 10n ** 12n, 0n, 0, 90_000n])
      }
      throw new Error('no route')
    })
    rpc.state.calls.set(V2_ROUTER.toLowerCase(), () => {
      throw new Error('no pair')
    })
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('tokenlist.json')) return new Response(JSON.stringify(LIST), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('not found', { status: 404 })
    }
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    const seedId = created.seedId
    const quiz = await engine.engine.vault.backupQuiz({ seedId })
    const words = created.mnemonic.split(' ')
    await engine.engine.vault.confirmBackup({ seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 5n * 10n ** 18n)
    balances.set(address.toLowerCase(), 12_500_000n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('knows the tier from the shipped ladder, but will not swap without a recipient', async () => {
    const tier = await engine.engine.holder.tier({ accountId, chainId: TESTNET })
    // The ladder needs no contract, so the tier is known even here; what is
    // missing is somewhere to pay, and that is what stops the swap.
    expect(tier).toMatchObject({ bips: 30, tier: 2, name: 'Magneto', source: 'config', sink: null })
    const q = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
    expect(q.ok).toBe(false)
    // The words, not just the refusal: this is the line the owner reads when a
    // chain has no recipient, and it used to name a sink contract that no
    // longer exists anywhere in the wallet.
    expect(q.problems.join(' ')).toMatch(/no fee address is set/i)
    expect(q.problems.join(' ')).not.toMatch(/sink/i)
  })

  it('pays the configured recipient at the ladder\u2019s bips once one is set', async () => {
    await engine.engine.holder.configure({ chainId: TESTNET, sink: SINK, schedule: null })
    const tier = await engine.engine.holder.tier({ accountId, chainId: TESTNET })
    expect(tier).toMatchObject({ bips: 30, tier: 2, name: 'Magneto', source: 'config', sink: SINK, nextTierAt: (50_000n * 10n ** 18n).toString(), nextTierBips: 20, nextTierName: 'Turbine' })
    const schedule = await engine.engine.holder.schedule({ chainId: TESTNET })
    expect(schedule.source).toBe('config')
    expect(schedule.tiers.map((t) => t.bips)).toEqual([40, 30, 20])
    expect(schedule.tiers.map((t) => t.name)).toEqual(['Charge', 'Magneto', 'Turbine'])
  })

  it('quotes through the mini-router with the three fee lines and the steps a fresh token needs', async () => {
    const q = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.route.label).toBe('V3 0.3%')
    expect(q.amountOutRaw).toBe((2n * 10n ** 18n).toString())
    expect(q.fee).toMatchObject({ bips: 30, tier: 2, name: 'Magneto', sink: SINK, source: 'config' })
    expect(BigInt(q.fee.amountRaw)).toBe((2n * 10n ** 18n * 30n) / 10_000n)
    expect(BigInt(q.receiveRaw)).toBe(2n * 10n ** 18n - BigInt(q.fee.amountRaw))
    expect(BigInt(q.minimumOutRaw)).toBeLessThan(BigInt(q.receiveRaw))
    expect(q.steps).toEqual(['approve', 'permit', 'swap'])
    expect(q.rate).toBeCloseTo(2, 6)
    // ETN in needs only the swap.
    const native = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: 'native', tokenOut: TOKEN, amountIn: '0.5' })
    expect(native.steps).toEqual(['swap'])
  })

  it('runs approve → permit → swap through three sheets and pays the sink at the tier bips', async () => {
    const { flowId } = await engine.engine.swap.execute({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
    // 1. Allow Permit2 (unlimited by default: exactApprovals is true in DEFAULT_SETTINGS → exact here).
    let flow = await waitStep(engine, flowId, 0, 'signing')
    const approveReq = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    expect(approveReq.origin).toBe('internal:swap:approve')
    const approvePayload = payloadOf(approveReq)
    expect(approvePayload.kind === 'send_transaction' && approvePayload.assessment.statements[0]?.text).toMatch(/^Allow Permit2 to move/)
    await engine.engine.approvals.decide({ id: approveReq.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(1)
    allowances.set(PERMIT2.toLowerCase(), maxUint256)
    rpc.advanceBlocks()
    // 2. The exact PermitSingle for the router.
    flow = await waitStep(engine, flowId, 1, 'signing')
    expect(flow.steps[0]?.status).toBe('confirmed')
    const permitReq = await approvalById(engine, flow.steps[1]?.requestId ?? '')
    expect(permitReq.origin).toBe('internal:swap:permit')
    const permitPayload = payloadOf(permitReq)
    expect(permitPayload.kind).toBe('sign_typed_data')
    expect(permitPayload.kind === 'sign_typed_data' && permitPayload.primaryType).toBe('PermitSingle')
    expect(permitPayload.kind === 'sign_typed_data' && permitPayload.assessment.severity).toBe('info')
    await engine.engine.approvals.decide({ id: permitReq.id, approve: true })
    // 3. The swap itself: PAY_PORTION to the sink at 30 bips, then unwrap to the user.
    flow = await waitStep(engine, flowId, 2, 'signing')
    const swapReq = await approvalById(engine, flow.steps[2]?.requestId ?? '')
    expect(swapReq.origin).toBe('internal:swap')
    const swapPayload = payloadOf(swapReq)
    expect(swapPayload.kind).toBe('send_transaction')
    if (swapPayload.kind !== 'send_transaction') throw new Error('unreachable')
    expect(swapPayload.assessment.presentation.blocked).toBe(false)
    expect(swapPayload.assessment.rules.map((r) => r.code)).not.toContain('FEE_SINK_MISMATCH')
    expect(swapPayload.assessment.rules.map((r) => r.code)).not.toContain('FEE_TIER_MISMATCH')
    expect(swapPayload.tx.to?.toLowerCase()).toBe(UR.toLowerCase())
    await engine.engine.approvals.decide({ id: swapReq.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(2)
    rpc.advanceBlocks()
    flow = await waitStep(engine, flowId, 2, 'confirmed')
    expect(flow.status).toBe('done')
    expect(flow.hash).toMatch(/^0x[0-9a-f]{64}$/)

    const raw = [...rpc.state.transactions.values()][1]?.raw as Hex
    const parsed = parseTransaction(raw)
    expect(parsed.to?.toLowerCase()).toBe(UR.toLowerCase())
    const ur = decodeUniversalRouter(parsed.data as Hex)
    expect(ur?.commands.map((c) => c.type)).toEqual(['PERMIT2_PERMIT', 'V3_SWAP_EXACT_IN', 'PAY_PORTION', 'UNWRAP_WETH'])
    const pay = ur?.commands.find((c) => c.type === 'PAY_PORTION')
    expect(pay?.type === 'PAY_PORTION' && pay.recipient.toLowerCase() === SINK.toLowerCase() && pay.bips === 30n && pay.token.toLowerCase() === WETN.toLowerCase()).toBe(true)
    const unwrap = ur?.commands.find((c) => c.type === 'UNWRAP_WETH')
    expect(unwrap?.type === 'UNWRAP_WETH' && unwrap.recipient.toLowerCase() === address.toLowerCase()).toBe(true)
    // The permit inside the call was signed by the account for the router as spender.
    const permit = ur?.commands.find((c) => c.type === 'PERMIT2_PERMIT')
    expect(permit?.type === 'PERMIT2_PERMIT' && permit.spender.toLowerCase() === UR.toLowerCase() && permit.amount === 1_000_000n).toBe(true)
    if (permit?.type !== 'PERMIT2_PERMIT') throw new Error('unreachable')
    const signer = await recoverTypedDataAddress({
      domain: { name: 'Permit2', chainId: TESTNET, verifyingContract: PERMIT2 },
      types: { PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }], PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }] },
      primaryType: 'PermitSingle',
      message: { details: { token: permit.token, amount: permit.amount, expiration: permit.expiration, nonce: permit.nonce }, spender: permit.spender, sigDeadline: permit.sigDeadline },
      signature: permit.signature,
    })
    expect(signer.toLowerCase()).toBe(address.toLowerCase())
    expect(UR_COMMAND.PAY_PORTION).toBe(0x06)

    const activity = await engine.engine.activity.list({ chainId: TESTNET })
    expect(activity.find((e) => e.id === swapReq.id)?.category).toBe('SWAP')
    expect(activity.find((e) => e.id === approveReq.id)?.category).toBe('APPROVE')
  })

  it('re-quotes at sign time when the tier moved, so the encoded bips are never stale', async () => {
    permitNonce = 1
    allowances.set(PERMIT2.toLowerCase(), maxUint256)
    const first = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
    expect(first.fee.bips).toBe(30)
    const { flowId } = await engine.engine.swap.execute({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
    // Permit first (the allowance is in place), then the holding drops out of the
    // tier before the swap step builds — the ladder is fixed, the score is not.
    let flow = await waitStep(engine, flowId, 0, 'signing')
    expect(flow.steps.map((s) => s.step)).toEqual(['permit', 'swap'])
    dynoBalance = 0n
    await engine.engine.approvals.decide({ id: flow.steps[0]?.requestId ?? '', approve: true })
    flow = await waitStep(engine, flowId, 1, 'signing')
    expect(flow.quote?.fee.bips).toBe(50)
    const req = await approvalById(engine, flow.steps[1]?.requestId ?? '')
    const payload = payloadOf(req)
    if (payload.kind !== 'send_transaction') throw new Error('unreachable')
    expect(payload.assessment.presentation.blocked).toBe(false)
    const ur = decodeUniversalRouter(payload.tx.data as Hex)
    const pay = ur?.commands.find((c) => c.type === 'PAY_PORTION')
    expect(pay?.type === 'PAY_PORTION' && pay.bips === 50n).toBe(true)
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    flow = await waitStep(engine, flowId, 1, 'rejected')
    expect(flow.status).toBe('rejected')
  })

  it('a swap the sheet rejects never broadcasts', async () => {
    const before = rpc.state.transactions.size
    const { flowId } = await engine.engine.swap.execute({ accountId, chainId: TESTNET, tokenIn: 'native', tokenOut: TOKEN, amountIn: '0.1' })
    const flow = await waitStep(engine, flowId, 0, 'signing')
    await engine.engine.approvals.decide({ id: flow.steps[0]?.requestId ?? '', approve: false })
    const done = await waitStep(engine, flowId, 0, 'rejected')
    expect(done.status).toBe('rejected')
    expect(rpc.state.transactions.size).toBe(before)
  })
})
