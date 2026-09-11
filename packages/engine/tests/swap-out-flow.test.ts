/**
 * Swapping by exact output, end to end on the mock chain (§8.6).
 *
 * The wallet has only ever been able to answer "I am spending this much, what
 * do I get?". This is the other question — "I need exactly this much, what does
 * it cost?" — and the two things that invert with it are the two things that
 * can be silently wrong:
 *
 *  - slippage guards the INPUT now, so the guaranteed figure is a ceiling on
 *    what leaves the account, and the Permit2 permit has to be sized to that
 *    ceiling rather than to the estimate;
 *  - the wallet fee is grossed up, so `PAY_PORTION` still pays the pinned sink
 *    the tier's bips — the firewall's assertion is untouched — but it comes out
 *    of extra input instead of out of the exact amount the user asked for.
 *
 * `swap.quote` / `swap.execute` are called through the host rather than through
 * the typed contract, because `WalletEngine` does not describe the two new
 * arguments yet (the lines that would are in this change's notes). The engine's
 * client is a generic proxy, so the namespace answers either way.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { decodeUniversalRouter } from '@boltvault/security'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, maxUint256, parseAbiParameters, parseTransaction, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, parseApprovalPayload, resetMulticallCache, CANONICAL_MULTICALL3, type ApprovalRequest, type Engine, type SwapFlow } from '../src'
import { grossOutForExactOut, feeAmount } from '@boltvault/electroswap'
import type { SwapQuoteView } from '../src/namespaces/swap'

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

/** One whole ETN out — the "I need exactly this much" case, in the smallest units of an 18-decimal coin. */
const EXACT_OUT = 10n ** 18n
/** The mock pool's rate: 1 FIX (6 dp) buys 2 WETN-units (18 dp). */
const rateOutFor = (amountIn: bigint): bigint => amountIn * 2n * 10n ** 12n
const rateInFor = (amountOut: bigint): bigint => amountOut / (2n * 10n ** 12n)

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

describe('swapping by exact output', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  const balances = new Map<string, bigint>()
  const allowances = new Map<string, bigint>()
  const permitNonce = 0

  const quote = async (arg: Record<string, unknown>): Promise<SwapQuoteView> => (await engine.host.invoke('swap', 'quote', { accountId, chainId: TESTNET, ...arg }, 'ui')) as SwapQuoteView
  const execute = async (arg: Record<string, unknown>): Promise<{ flowId: string }> => (await engine.host.invoke('swap', 'execute', { accountId, chainId: TESTNET, ...arg }, 'ui')) as { flowId: string }

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
    // 25,000 DYNO at 1 BOLT-eq each: Magneto, the middle rung of the testnet ladder — 30 bips.
    rpc.state.calls.set(DYNO.toLowerCase(), () => u(25_000n * 10n ** 18n))
    rpc.state.calls.set(PERMIT2.toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint160, uint48, uint48'), [0n, 0, permitNonce]))
    rpc.state.calls.set(QUOTER.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      // Both tuples are static and identically laid out, so the amount is word 2 and the fee word 3 either way.
      const amount = BigInt(`0x${data.slice(10 + 64 * 2, 10 + 64 * 3)}`)
      const fee = Number(BigInt(`0x${data.slice(10 + 64 * 3, 10 + 64 * 4)}`))
      if (sel === '0xc6a5026a') {
        if (fee !== 3000) throw new Error('no pool')
        return encodeAbiParameters(parseAbiParameters('uint256, uint160, uint32, uint256'), [rateOutFor(amount), 0n, 0, 90_000n])
      }
      // quoteExactOutputSingle: the same pool, asked the other way round.
      if (sel === '0xbd21704a') {
        if (fee !== 3000) throw new Error('no pool')
        return encodeAbiParameters(parseAbiParameters('uint256, uint160, uint32, uint256'), [rateInFor(amount), 0n, 0, 90_000n])
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
    const words = created.mnemonic.split(' ')
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(TESTNET, rpc.url)
    await engine.engine.holder.configure({ chainId: TESTNET, sink: SINK, schedule: null })
    rpc.state.balances.set(address.toLowerCase(), 5n * 10n ** 18n)
    balances.set(address.toLowerCase(), 12_500_000n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('says which amount you fixed, and refuses a request that says neither', async () => {
    await expect(engine.host.invoke('swap', 'quote', { accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native' }, 'ui')).rejects.toThrow(/which amount you fixed/i)
    await expect(engine.host.invoke('swap', 'quote', { accountId, chainId: TESTNET, tokenIn: TOKEN, tokenOut: 'native', tradeType: 'exactOut' }, 'ui')).rejects.toThrow(/which amount you fixed/i)
  })

  it('quotes the cost of an exact amount, with the fee taken off the top', async () => {
    const q = await quote({ tokenIn: TOKEN, tokenOut: 'native', amountOut: '1', tradeType: 'exactOut' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.tradeType).toBe('exactOut')
    expect(q.fee.bips).toBe(30)

    // What the user asked for is what they are promised — the floor IS the ask.
    expect(q.receiveRaw).toBe(EXACT_OUT.toString())
    expect(q.minimumOutRaw).toBe(EXACT_OUT.toString())

    // The router buys a little more than that, so PAY_PORTION does not eat into it.
    const gross = grossOutForExactOut(EXACT_OUT, 30)
    expect(q.amountOutRaw).toBe(gross.toString())
    expect(q.fee.amountRaw).toBe(feeAmount(gross, 30).toString())
    expect(gross - feeAmount(gross, 30)).toBeGreaterThanOrEqual(EXACT_OUT)

    // And the guaranteed figure is now a ceiling on what leaves the account.
    expect(q.amountInRaw).toBe(rateInFor(gross).toString())
    expect(BigInt(q.maximumInRaw)).toBeGreaterThan(BigInt(q.amountInRaw))
    expect(q.maximumInRaw).toBe(((BigInt(q.amountInRaw) * (10_000n + BigInt(q.slippageBips))) / 10_000n).toString())
    expect(q.steps).toEqual(['approve', 'permit', 'swap'])
  })

  /*
    The exact-in quote has to keep meaning exactly what it meant, including the
    field that only exists for the other direction: a caller that never sets
    `tradeType` must see a quote it can read the old way.
  */
  it('leaves an exact-in quote alone, with no ceiling to speak of', async () => {
    const q = await quote({ tokenIn: TOKEN, tokenOut: 'native', amountIn: '1' })
    expect(q.tradeType).toBe('exactIn')
    expect(q.maximumInRaw).toBe('0')
    expect(q.amountOutRaw).toBe(rateOutFor(1_000_000n).toString())
    expect(BigInt(q.minimumOutRaw)).toBeLessThan(BigInt(q.receiveRaw))
  })

  it('will not quote an exact amount of nothing', async () => {
    const q = await quote({ tokenIn: TOKEN, tokenOut: 'native', amountOut: '0', tradeType: 'exactOut' })
    expect(q.ok).toBe(false)
    expect(q.problems.join(' ')).toMatch(/above zero/i)
  })

  it('measures affordability against the ceiling, not the estimate', async () => {
    const q = await quote({ tokenIn: TOKEN, tokenOut: 'native', amountOut: '1', tradeType: 'exactOut' })
    const ceiling = BigInt(q.maximumInRaw)
    // A balance that covers the estimate but not the ceiling is not enough: the
    // router may need anything up to the ceiling, and finding out at signing
    // time costs the user three signatures and a revert.
    balances.set(address.toLowerCase(), ceiling - 1n)
    try {
      const short = await quote({ tokenIn: TOKEN, tokenOut: 'native', amountOut: '1', tradeType: 'exactOut' })
      expect(short.ok).toBe(false)
      expect(short.problems.join(' ')).toMatch(/Not enough FIX/)
    } finally {
      balances.set(address.toLowerCase(), 12_500_000n)
    }
  })

  it('runs the flow and signs a V3_SWAP_EXACT_OUT that still pays the pinned sink at the tier bips', async () => {
    const q = await quote({ tokenIn: TOKEN, tokenOut: 'native', amountOut: '1', tradeType: 'exactOut' })
    const ceiling = BigInt(q.maximumInRaw)
    const { flowId } = await execute({ tokenIn: TOKEN, tokenOut: 'native', amountOut: '1', tradeType: 'exactOut' })

    let flow = await waitStep(engine, flowId, 0, 'signing')
    const approveReq = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    expect(approveReq.origin).toBe('internal:swap:approve')
    await engine.engine.approvals.decide({ id: approveReq.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(1)
    allowances.set(PERMIT2.toLowerCase(), maxUint256)
    rpc.advanceBlocks()

    flow = await waitStep(engine, flowId, 1, 'signing')
    const permitReq = await approvalById(engine, flow.steps[1]?.requestId ?? '')
    await engine.engine.approvals.decide({ id: permitReq.id, approve: true })

    flow = await waitStep(engine, flowId, 2, 'signing')
    const swapReq = await approvalById(engine, flow.steps[2]?.requestId ?? '')
    const swapPayload = payloadOf(swapReq)
    if (swapPayload.kind !== 'send_transaction') throw new Error('unreachable')
    // The firewall's fee assertion reads exactly what it reads for an exact-in swap.
    expect(swapPayload.assessment.presentation.blocked).toBe(false)
    expect(swapPayload.assessment.rules.map((r) => r.code)).not.toContain('FEE_SINK_MISMATCH')
    expect(swapPayload.assessment.rules.map((r) => r.code)).not.toContain('FEE_TIER_MISMATCH')
    await engine.engine.approvals.decide({ id: swapReq.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(2)
    rpc.advanceBlocks()
    flow = await waitStep(engine, flowId, 2, 'confirmed')
    expect(flow.status).toBe('done')

    const raw = [...rpc.state.transactions.values()][1]?.raw as Hex
    const ur = decodeUniversalRouter(parseTransaction(raw).data as Hex)
    expect(ur?.commands.map((c) => c.type)).toEqual(['PERMIT2_PERMIT', 'V3_SWAP_EXACT_OUT', 'PAY_PORTION', 'UNWRAP_WETH'])

    const swap = ur?.commands.find((c) => c.type === 'V3_SWAP_EXACT_OUT')
    if (swap?.type !== 'V3_SWAP_EXACT_OUT') throw new Error('unreachable')
    // The decoder shares one tuple with the exact-in shape, so in this direction
    // its `amountIn` is the amount bought and its `amountOut` is the ceiling.
    expect(swap.amountIn).toBe(grossOutForExactOut(EXACT_OUT, 30))
    expect(swap.amountOut).toBe(ceiling)
    // V3 walks an exact-output path backwards: the token asked for comes first.
    expect(swap.path.toLowerCase().startsWith(`0x${WETN.slice(2).toLowerCase()}`)).toBe(true)

    const pay = ur?.commands.find((c) => c.type === 'PAY_PORTION')
    expect(pay?.type === 'PAY_PORTION' && pay.recipient.toLowerCase() === SINK.toLowerCase() && pay.bips === 30n && pay.token.toLowerCase() === WETN.toLowerCase()).toBe(true)

    // The delivered figure is the exact amount, not a floor under it.
    const unwrap = ur?.commands.find((c) => c.type === 'UNWRAP_WETH')
    expect(unwrap?.type === 'UNWRAP_WETH' && unwrap.recipient.toLowerCase() === address.toLowerCase() && unwrap.amount === EXACT_OUT).toBe(true)

    // And the permit covers the ceiling. Sized to the estimate, the router would
    // be unable to pull the last percent and the swap would revert — after three
    // signatures the user had already given.
    const permit = ur?.commands.find((c) => c.type === 'PERMIT2_PERMIT')
    expect(permit?.type === 'PERMIT2_PERMIT' && permit.amount === ceiling).toBe(true)
  })
})
