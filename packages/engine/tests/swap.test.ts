/**
 * M5 inside the engine, against the mock RPC on the testnet addresses: the
 * holder tier from a schedule contract, a quote through the mini-router with
 * the three fee lines, and the approve → permit → swap flow through three
 * internal sheets, ending in a Universal Router call whose PAY_PORTION pays
 * the configured sink at the schedule's bips (T10).
 *
 * The last block covers the other price this wallet can get: ElectroSwap's
 * routing service (§8.6). The engine under test in every case above carries no
 * wallet key, so it builds no `Quoter` at all and never asks — which is what
 * keeps this suite off the network — and the service's cases each build their
 * own engine on the same mock chain.
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
/** An intermediate the mock chain has no pool for; only the service ever names it. */
const MID = '0x6666666666666666666666666666666666666666' as Hex

const LIST = { name: 'fixture', tokens: [{ chainId: TESTNET, address: TOKEN, name: 'Fixture Token', symbol: 'FIX', decimals: 6 }] }
const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

/** Where the extra engines' routing service lives; nothing listens, the injected fetch answers. */
const ROUTING_URL = 'https://routing.test/routing/quote'
/** 1 FIX in, and what the mock QuoterV2 answers for it: the price to beat. */
const ONE_FIX = 1_000_000n
const ONCHAIN_OUT = 2n * 10n ** 18n
/** An output the given number of bips below what the wallet can prove for itself. */
const shortBy = (bips: bigint): bigint => (ONCHAIN_OUT * (10_000n - bips)) / 10_000n

const tokenRef = (address: Hex): Record<string, unknown> => ({ address, symbol: 'T', decimals: 18, chainId: TESTNET })
const v3hop = (tokenIn: Hex, tokenOut: Hex, fee = '3000'): Record<string, unknown> => ({ type: 'v3-pool', tokenIn: tokenRef(tokenIn), tokenOut: tokenRef(tokenOut), fee, liquidity: '1', sqrtRatioX96: '1', tickCurrent: 0 })
/** The other shape the service returns, which carries reserves and names no fee. */
const v2hop = (tokenIn: Hex, tokenOut: Hex): Record<string, unknown> => ({ type: 'v2-pool', tokenIn: tokenRef(tokenIn), tokenOut: tokenRef(tokenOut), reserve0: '4000000', reserve1: '8000000' })
const jsonBody = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
/** A 200 in the routing service's own shape, for `amountIn` FIX. */
const routingQuote = (route: readonly unknown[], amountOut: bigint, amountIn = ONE_FIX): Response =>
  jsonBody({ routing: 'CLASSIC', quote: { blockNumber: '1', amount: amountIn.toString(), quote: amountOut.toString(), gasUseEstimate: '180000', route, routeString: '' }, allQuotes: [], quoteId: 'q-1', cached: false })

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
  /** Every URL this engine asked for, so "never asked the routing service" is assertable. */
  const fetched: string[] = []
  /*
    Every quoting call the mock chain saw, so "which candidates were priced" is a
    fact rather than an absence. `kind` is the call, not the candidate:
    `quoteExactInput` takes a packed path and is only ever made for a multi-hop
    V3 route, so its presence is what separates the full candidate search from
    the five direct pools.
  */
  interface QuoteCall {
    readonly kind: 'v2' | 'v3-single' | 'v3-path'
    readonly amountIn: bigint
    readonly fee: number | null
  }
  const quoted: QuoteCall[] = []
  const forgetQuotes = (): void => {
    quoted.length = 0
  }
  const atFullSize = (): QuoteCall[] => quoted.filter((c) => c.amountIn === ONE_FIX)
  const atProbeSize = (): QuoteCall[] => quoted.filter((c) => c.amountIn === ONE_FIX / 1000n)
  /** Off for the one case where the mini-router has no answer and the service is the only price. */
  let poolsOnChain = true
  /** Extra engines built by the routing-service cases, disposed with this one. */
  const extras: Engine[] = []

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
        quoted.push({ kind: 'v3-single', amountIn, fee })
        if (!poolsOnChain) throw new Error('no pool')
        if (fee !== 3000) throw new Error('no pool')
        return encodeAbiParameters(parseAbiParameters('uint256, uint160, uint32, uint256'), [amountIn * 2n * 10n ** 12n, 0n, 0, 90_000n])
      }
      // quoteExactInput(bytes path, uint256 amountIn): the head is (offset, amountIn).
      if (sel === '0xcdca1753') quoted.push({ kind: 'v3-path', amountIn: BigInt(`0x${data.slice(10 + 64, 10 + 64 * 2)}`), fee: null })
      throw new Error('no route')
    })
    rpc.state.calls.set(V2_ROUTER.toLowerCase(), ({ data }) => {
      // getAmountsOut(uint256 amountIn, address[] path).
      if (data.slice(0, 10) === '0xd06ca61f') quoted.push({ kind: 'v2', amountIn: BigInt(`0x${data.slice(10, 10 + 64)}`), fee: null })
      throw new Error('no pair')
    })
    const fetchImpl: typeof fetch = async (input) => {
      fetched.push(String(input))
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
    for (const extra of extras) extra.dispose()
    engine.dispose()
    await rpc.close()
  })

  /*
    Testnet has no fee recipient in `fees.json`, and that used to refuse the swap.

    On mainnet it still does — a fee destination that can change underneath the
    user is one an attacker can change, so the recipient is a build constant and
    a chain naming none has in-wallet swap switched off. Testnet is not that
    bargain: there is no revenue to protect on a chain whose funds are valueless,
    so refusing there protected nothing and broke the one thing testnet is for.
    It swaps fee-free instead.
  */
  it('knows the tier from the shipped ladder, and swaps fee-free because testnet names no recipient', async () => {
    const tier = await engine.engine.holder.tier({ accountId, chainId: TESTNET })
    // The ladder needs no contract, so the tier is known even here; what is
    // missing is somewhere to pay.
    expect(tier).toMatchObject({ bips: 30, tier: 2, name: 'Magneto', source: 'config', sink: null })
    const q = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.problems).toEqual([])
    // The rung is still named — the ladder is real here, it just costs nothing.
    expect(q.fee).toMatchObject({ bips: 0, tier: 2, name: 'Magneto', sink: null, source: 'config' })
    expect(BigInt(q.fee.amountRaw)).toBe(0n)
    // Nothing comes off the top, so the whole output is the user's.
    expect(q.receiveRaw).toBe(q.amountOutRaw)
    // The words, not just the absence of a refusal: this is the line the owner
    // reads when a MAINNET chain has no recipient, and it must not appear here.
    expect(q.problems.join(' ')).not.toMatch(/no fee address is set/i)
  })

  it('encodes that swap with no PAY_PORTION at all, and the firewall accepts the absence', async () => {
    /*
      ETN in needs only the swap step, so this reaches the sheet without an
      approve or a permit and is rejected before anything broadcasts — the later
      cases count transactions on this same mock chain.
    */
    const before = rpc.state.transactions.size
    const { flowId } = await engine.engine.swap.execute({ accountId, chainId: TESTNET, tokenIn: 'native', tokenOut: TOKEN, amountIn: '0.1' })
    let flow = await waitStep(engine, flowId, 0, 'signing')
    expect(flow.steps.map((s) => s.step)).toEqual(['swap'])
    expect(flow.quote?.fee.bips).toBe(0)
    const req = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    expect(req.origin).toBe('internal:swap')
    const payload = payloadOf(req)
    if (payload.kind !== 'send_transaction') throw new Error('unreachable')
    const ur = decodeUniversalRouter(payload.tx.data as Hex)
    // PAY_PORTION reverts on zero bips, so a fee-free swap must not carry one —
    // and with no fee to take, the router has no reason to custody the output
    // either, so the swap pays the user directly and there is no SWEEP.
    expect(ur?.commands.map((c) => c.type)).toEqual(['WRAP_ETH', 'V3_SWAP_EXACT_IN'])
    expect(ur?.commands.some((c) => c.type === 'PAY_PORTION')).toBe(false)
    /*
      `feeSinkRules` has a zero-bips branch that requires the ABSENCE of a
      portion exactly as firmly as it requires a correct one otherwise, and this
      is the path that reaches it: `expectedFee` arrives as `{ sink: 0x0…0,
      bips: 0 }`, so a portion appearing here would block rather than pass.
    */
    expect(payload.assessment.presentation.blocked).toBe(false)
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('FEE_SINK_MISMATCH')
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('FEE_TIER_MISMATCH')
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    flow = await waitStep(engine, flowId, 0, 'rejected')
    expect(flow.status).toBe('rejected')
    expect(rpc.state.transactions.size).toBe(before)
  })

  /*
    The mainnet half of the gate, from the only angle the harness can reach it.

    `swap.quote` refuses any chain that is not one of the two Electroneum ones,
    and mainnet's recipient is named in `fees.json`, so there is no way from
    inside the wallet to produce a non-testnet ETN chain with a null recipient —
    which is the point. `holder.configure` exists for a chain the config leaves
    open and refuses one it names, so the wording above cannot be reached on
    mainnet by any runtime message. (The same sentence on the firewall side —
    `feeSinkRules` with no `expectedFee` — is pinned in
    `packages/security/tests/rules.test.ts`.)
  */
  it('cannot have the mainnet recipient removed at runtime, which is why testnet is the only exception', async () => {
    await expect(engine.engine.holder.configure({ chainId: 52014, sink: null, schedule: null })).rejects.toThrow(/set in the build/i)
    expect((await engine.engine.holder.schedule({ chainId: 52014 })).sink).toBeTruthy()
    // And the config leaves testnet open, which is what let the case above set one.
    expect((await engine.engine.holder.schedule({ chainId: TESTNET })).sink).toBeNull()
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

  /**
   * ElectroSwap's routing service as the first price (§8.6).
   *
   * It is asked first and the mini-router runs only if it could not answer —
   * the fifteen simulated swaps of a full candidate search are the wallet's
   * largest single draw on an RPC endpoint, re-run on a 250 ms debounce while
   * somebody types an amount, and spending them to check an answer already in
   * hand buys a comparison rather than a price.
   *
   * Nothing corroborates the served price, deliberately. The routing logic is
   * meant to be one implementation shared by the wallet, the interface and the
   * service, so a second opinion computed only in the wallet would be a second
   * implementation — and a pool the service cannot see is a defect to fix where
   * the pools are chosen, not to paper over per client.
   */
  describe('the routing service', () => {
    /**
     * A second engine on the same mock chain, with a wallet key — which is what
     * makes `createEngine` build a `Quoter` at all — and a fetch that answers
     * `ROUTING_URL` with `serve`.
     */
    const withQuoter = async (opts: { serve?: () => Response; quoterUrl?: string | null } = {}): Promise<{ quote: () => Promise<Awaited<ReturnType<Engine['engine']['swap']['quote']>>>; asked: string[]; posted: { url: string; body: string }[]; extra: Engine; accountId: string; owner: Hex }> => {
      const asked: string[] = []
      /** Bodies as well as URLs, so a failure report can be read rather than merely counted. */
      const posted: { url: string; body: string }[] = []
      const fetchImpl: typeof fetch = async (target, init) => {
        const url = String(target)
        asked.push(url)
        if (init?.method === 'POST') posted.push({ url, body: String(init.body ?? '') })
        if (url.includes('tokenlist.json')) return new Response(JSON.stringify(LIST), { status: 200, headers: { 'content-type': 'application/json' } })
        if (url === ROUTING_URL && opts.serve) return opts.serve()
        return new Response('not found', { status: 404 })
      }
      const extra = createEngine({
        platform: createMemoryPlatform(),
        kdf: KDF,
        receiptPollMs: 20,
        fetch: fetchImpl,
        electroswapUrl: null,
        pricesUrl: null,
        staticsUrl: null,
        clientKey: 'test-wallet-key',
        quoterUrl: opts.quoterUrl === undefined ? ROUTING_URL : opts.quoterUrl,
      })
      extras.push(extra)
      await extra.ready
      const created = await extra.engine.vault.create({ password: PASSWORD })
      const words = created.mnemonic.split(' ')
      const quiz = await extra.engine.vault.backupQuiz({ seedId: created.seedId })
      await extra.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
      await extra.chains.setRpc(TESTNET, rpc.url)
      const owner = created.accounts[0]?.address as Hex
      rpc.state.balances.set(owner.toLowerCase(), 5n * 10n ** 18n)
      balances.set(owner.toLowerCase(), 12_500_000n)
      const accountId = created.accounts[0]?.id ?? ''
      return { quote: () => extra.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' }), asked, posted, extra, accountId, owner }
    }

    /*
      This is the test that keeps every other test in this file off the network:
      a build with no wallet key has nothing to present to the service — its
      origin check refuses an extension outright — so no `Quoter` is built and
      no request is made.
    */
    it('is never asked by a build that ships no wallet key', async () => {
      const q = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
      expect(q.route.source).toBe('onchain')
      expect(q.amountOutRaw).toBe(ONCHAIN_OUT.toString())
      // This engine's fetch is recorded and did run — it served the token list —
      // so an empty list of quote requests is a fact rather than an absence.
      expect(fetched.some((url) => url.includes('tokenlist.json'))).toBe(true)
      expect(fetched.filter((url) => /quote/i.test(url))).toEqual([])
    })

    it('prices the trade when it answers with a route the wallet can execute', async () => {
      // Ten per cent above what the chain's own quoter says, so the figure in the
      // quote can only have come from the service.
      const apiOut = (ONCHAIN_OUT * 11_000n) / 10_000n
      const { quote, asked } = await withQuoter({ serve: () => routingQuote([[v3hop(TOKEN, WETN, '3000')]], apiOut) })
      const q = await quote()
      expect(q.route.source).toBe('api')
      expect(q.amountOutRaw).toBe(apiOut.toString())
      expect(q.route.label).toBe('V3 0.3%')
      expect(q.route.hops).toEqual([{ kind: 'v3', tokenIn: TOKEN.toLowerCase(), tokenOut: WETN.toLowerCase(), fee: 3000 }])
      expect(asked).toContain(ROUTING_URL)
    })

    /*
      The headline case for the feature: a pair whose liquidity sits somewhere
      the mini-router's fixed candidates never reach. Before the service was
      asked, this quote was "No route on ElectroSwap for this pair."
    */
    it('is the whole price when the mini-router finds no route at all', async () => {
      const apiOut = 4n * 10n ** 18n
      const { quote } = await withQuoter({ serve: () => routingQuote([[v3hop(TOKEN, WETN, '500')]], apiOut) })
      poolsOnChain = false
      try {
        const q = await quote()
        expect(q.route.source).toBe('api')
        expect(q.amountOutRaw).toBe(apiOut.toString())
        expect(q.problems.join(' ')).not.toMatch(/no route/i)
      } finally {
        poolsOnChain = true
      }
    })

    /*
      The budget, which is the whole point of asking the service first.

      A full candidate search is fifteen simulated swaps here — five direct plus
      five through each of the two bases — and none of them run when the service
      answers. The only thing the chain is asked is the impact probe, on the
      winning route at a thousandth of the size.
    */
    it('does not ask the chain to price the trade at all when the service answers', async () => {
      // Ten per cent above what the chain's own quoter says, so the figure in the
      // quote can only have come from the service.
      const apiOut = (ONCHAIN_OUT * 11_000n) / 10_000n
      const { quote } = await withQuoter({ serve: () => routingQuote([[v3hop(TOKEN, WETN, '3000')]], apiOut) })
      forgetQuotes()
      const q = await quote()
      expect(q.route.source).toBe('api')
      expect(q.amountOutRaw).toBe(apiOut.toString())
      expect(atFullSize()).toEqual([])
      expect(atProbeSize()).toEqual([{ kind: 'v3-single', amountIn: ONE_FIX / 1000n, fee: 3000 }])
      expect(quoted).toHaveLength(1)
    })

    /*
      What the wallet gives up by not checking, recorded so it is a decision and
      not a surprise.

      The service prices from a pool list (`GET /api/pools/3`) rather than from
      the chain, so a pool missing from that list is missing at every size. On
      2026-09-11 the list held eleven V3 pools and named only the 0.3 % WETN/BOLT
      pool, and the service answered WETN→BOLT with a V2 route paying
      1297115670894749461 while the 0.05 % pool beside it paid
      1332394001904452715 — though only at sizes small enough for a pool that
      thin to matter. The wallet takes the served answer anyway, because the fix
      belongs where the pools are chosen: a second opinion computed only here
      would be a second routing implementation, and one shared brain is the
      point. This test is the tripwire for that decision changing by accident.
    */
    it('takes the served price even when a pool it could quote itself would pay more', async () => {
      const { quote } = await withQuoter({ serve: () => routingQuote([[v2hop(TOKEN, WETN)]], shortBy(264n)) })
      const q = await quote()
      expect(q.route.source).toBe('api')
      expect(q.amountOutRaw).toBe(shortBy(264n).toString())
      expect(q.route.label).toBe('V2')
      expect(atFullSize()).toEqual([])
    })

    /*
      A multi-hop win, of the kind fifteen fixed candidates cannot reach, is the
      reason the service is asked at all.
    */
    it('takes a multi-hop route the mini-router has no candidate for', async () => {
      const multi = await withQuoter({ serve: () => routingQuote([[v3hop(TOKEN, MID, '500'), v3hop(MID, WETN, '3000')]], ONCHAIN_OUT * 2n) })
      const q = await multi.quote()
      expect(q.route.source).toBe('api')
      expect(q.amountOutRaw).toBe((ONCHAIN_OUT * 2n).toString())
      expect(q.route.hops).toHaveLength(2)
      /*
        The impact probe cannot price that route on this mock chain — there is no
        pool behind the packed path — and the quote is still usable. A probe that
        could not answer decorates nothing; it never refuses the swap.
      */
      expect(q.ok, q.problems.join(' ')).toBe(true)
      expect(q.priceImpactPct).toBeNull()
    })

    /*
      The impact probe follows the winner.

      It used to be a second `bestRoute` at a thousandth of the trade — fifteen
      more simulated swaps on every keystroke, to produce one number to divide
      into another. Quoting the route that actually won is one call, and it is
      the more honest comparison: price impact means "what did going this big
      through THIS path cost", not "what might some other path have charged for a
      dust trade".
    */
    it('probes the winning route for the impact figure, not the candidate set again', async () => {
      forgetQuotes()
      const q = await engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
      expect(q.route.source).toBe('onchain')
      expect(q.route.label).toBe('V3 0.3%')
      // No service to answer, so the full search does run: five direct plus five
      // through each of the two bases the testnet addresses leave available.
      expect(atFullSize()).toHaveLength(15)
      expect(atFullSize().some((c) => c.kind === 'v3-path')).toBe(true)
      // And exactly one call at the probe size, for the path that won.
      expect(atProbeSize()).toEqual([{ kind: 'v3-single', amountIn: ONE_FIX / 1000n, fee: 3000 }])
      expect(q.priceImpactPct).not.toBeNull()
    })

    /*
      Three ways of not answering, one outcome. The split route is the sharp one:
      it is a perfectly good quote at a better price that `encodeSwap` has no
      room to express, so taking its number would show a price the wallet cannot
      honour.
    */
    it('falls back to the chain on a 500, on a 200 that says "Not found", and on a split route', async () => {
      const refusals: ReadonlyArray<() => Response> = [
        () => jsonBody({ state: 'Error' }, 500),
        () => jsonBody({ state: 'Not found' }),
        () => routingQuote([[v3hop(TOKEN, WETN, '3000')], [v3hop(TOKEN, WETN, '500')]], 9n * 10n ** 18n),
      ]
      for (const serve of refusals) {
        const { quote, asked } = await withQuoter({ serve })
        const q = await quote()
        expect(asked).toContain(ROUTING_URL)
        expect(q.route.source).toBe('onchain')
        expect(q.amountOutRaw).toBe(ONCHAIN_OUT.toString())
        expect(q.route.label).toBe('V3 0.3%')
      }
    })

    it('is not asked at all when the build turns it off, key or no key', async () => {
      const { quote, asked } = await withQuoter({ quoterUrl: null, serve: () => routingQuote([[v3hop(TOKEN, WETN, '3000')]], 9n * 10n ** 18n) })
      const q = await quote()
      expect(q.route.source).toBe('onchain')
      expect(q.amountOutRaw).toBe(ONCHAIN_OUT.toString())
      expect(asked.some((url) => url.includes('tokenlist.json'))).toBe(true)
      expect(asked.filter((url) => /quote/i.test(url))).toEqual([])
    })

    /**
     * A swap that reverted on chain, reported — and not reported (§3.7).
     *
     * The keyed engines above are the only ones in this file that build a
     * reporter at all, which is why this case lives here: without a wallet key
     * the route answers 401, so there is nothing to ask and `createEngine`
     * builds nothing. What is left to prove is the part no unit test can reach —
     * that the consent toggle in the settings document is actually the thing
     * wired to it, and that a reverted receipt reaches the endpoint with the
     * stage and the account state a reader would need to reproduce it.
     */
    it('reports a swap whose receipt came back reverted, and says nothing at all while diagnostics are off', async () => {
      const h = await withQuoter()
      const reports = (): { url: string; body: string }[] => h.posted.filter((entry) => entry.url.includes('/api/wallet/client-failure'))
      /** One native-in swap — a single sheet, no permit — taken by the chain and then failed. */
      const revertOne = async (): Promise<void> => {
        const { flowId } = await h.extra.engine.swap.execute({ accountId: h.accountId, chainId: TESTNET, tokenIn: 'native', tokenOut: TOKEN, amountIn: '0.1' })
        const flow = await waitStep(h.extra, flowId, 0, 'signing')
        const before = rpc.state.transactions.size
        await h.extra.engine.approvals.decide({ id: flow.steps[0]?.requestId ?? '', approve: true })
        await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(before + 1)
        // Status 0: mined, and against us. This is the failure the endpoint exists for.
        for (const t of rpc.state.transactions.values()) if (t.blockNumber === null) t.status = 0
        rpc.advanceBlocks()
        /*
          The step is patched failed and the flow a tick later, so the event this
          waits on can arrive between the two. Assert the step, then let the flow
          catch up.
        */
        expect((await waitStep(h.extra, flowId, 0, 'failed')).steps[0]?.status).toBe('failed')
        await expect.poll(() => h.extra.swap.flow(flowId)?.status, { timeout: 10_000 }).toBe('failed')
      }

      await revertOne()
      // `crashReports` is off in the defaults, so this revert is nobody's business.
      await expect.poll(() => h.posted.length, { timeout: 2_000 }).toBeGreaterThan(0)
      expect(reports()).toEqual([])

      await h.extra.engine.settings.set({ crashReports: true })
      await revertOne()
      await expect.poll(() => reports().length, { timeout: 10_000 }).toBe(1)
      const report = JSON.parse(reports()[0]?.body ?? '{}') as {
        client: string
        operation: string
        failure: { stage: string; kind: string; blockNumber: string | null }
        state: { account: string; nativeBalance: string | null } | null
        swap: { trade: { tokenIn: { address: string }; tokenOut: { address: string } }; quote: { source: string } } | null
        call: { to: string; data: string } | null
      }
      expect(report).toMatchObject({ client: 'extension-worker', operation: 'swap', failure: { stage: 'receipt', kind: 'revert' } })
      // The block the revert landed in, which is what makes it replayable.
      expect(report.failure.blockNumber).toMatch(/^\d+$/)
      expect(report.state?.account.toLowerCase()).toBe(h.owner.toLowerCase())
      expect(report.swap?.trade.tokenIn.address).toBe('native')
      expect(report.swap?.trade.tokenOut.address.toLowerCase()).toBe(TOKEN.toLowerCase())
      expect(report.swap?.quote.source).toBe('onchain-mini-router')
      // The bytes are the swap's own, and a native-in swap carries no permit to strip.
      expect(report.call?.to.toLowerCase()).toBe(UR.toLowerCase())
      expect(decodeUniversalRouter(report.call?.data as Hex)?.commands.some((c) => c.type === 'PERMIT2_PERMIT')).toBe(false)
    })
  })
})
