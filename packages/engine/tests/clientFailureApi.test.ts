/**
 * The client-failure reporter, and the four things it must never do.
 *
 * Every case here is a rule from §3.7 rather than a unit of behaviour: no
 * report without consent, no report without a key, no report of a user saying
 * no, and no Permit2 signature in anything that leaves the wallet. The last one
 * is the only defect in this file that would be unrecoverable in production — a
 * signature on a failed swap has an unspent nonce and a live deadline — so it
 * is asserted structurally, by decoding the bytes that were actually sent,
 * rather than by pattern-matching the hex.
 *
 * `schema` below MIRRORS `services/api/src/http/routes/clientFailure.ts`. That
 * repository is not in this workspace, so there is nothing to import and no
 * compiler to catch a drift; this is the same arrangement `apiAuth.test.ts`
 * uses for the MAC, and it has the same consequence. When the endpoint's schema
 * changes, this fails — which is the point, because the alternative is a report
 * that is quietly refused with a 204 and looks exactly like one that was never
 * sent.
 */
import { encodeSwap, type Hop } from '@boltvault/electroswap'
import { decodeUniversalRouter } from '@boltvault/security'
import { parseAbi, decodeFunctionData, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ClientFailures, clientFailuresFor, normalise, stripPermitSignatures, type ClientFailureDeps, type ClientFailureInput } from '../src/clientFailureApi'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { ActivityStore } from '../src/activityStore'
import { EngineError } from '../src/errors'
import { EventBus } from '../src/host'
import { FlowReceiptError, FlowStore, type FlowStepFailure } from '../src/namespaces/flows'
import { swapFailureReport, type SwapQuoteView } from '../src/namespaces/swap'
import type { ActivityEntry } from '../src/schema'

const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/)
const amount = z.string().regex(/^[0-9]{1,78}$/)
const nullableAmount = amount.nullable()
const taxProbe = z
  .object({
    status: z.enum(['measured', 'no-pair', 'pair-too-thin', 'probe-reverted', 'no-detector']),
    buyFeeBps: z.number().int().min(0).max(10_000).nullable(),
    sellFeeBps: z.number().int().min(0).max(10_000).nullable(),
    sellReverted: z.boolean().nullable(),
    externalTransferFailed: z.boolean().nullable(),
    feeTakenOnTransfer: z.boolean().nullable(),
  })
  .nullable()
const token = z.object({ address: z.union([address, z.literal('native')]), symbol: z.string().max(32), decimals: z.number().int().min(0).max(36) })
const hop = z.object({ protocol: z.enum(['v2', 'v3']), tokenIn: address, tokenOut: address, feeTier: z.number().int().nullable() })
const swapDetail = z.object({
  quote: z.object({
    id: z.string().max(64).nullable(),
    source: z.enum(['routing-api', 'client-fallback', 'onchain-mini-router', 'unknown']),
    cached: z.boolean().nullable(),
    blockNumber: z.string().max(32).nullable(),
    fallbackReason: z.string().max(256).nullable(),
  }),
  trade: z.object({ type: z.enum(['exact-in', 'exact-out']), tokenIn: token, tokenOut: token, amountIn: amount, slippageBips: z.number().int().min(0).max(10_000), taxBips: z.number().int().min(0).max(10_000).nullable() }),
  quoted: z.object({ amountOut: nullableAmount, minimumOut: nullableAmount, gasEstimate: nullableAmount, priceImpactPct: z.number().nullable() }),
  route: z.array(hop).max(12).nullable(),
  splits: z.number().int().min(1).max(8).nullable(),
  tax: z.object({ in: taxProbe, out: taxProbe }),
  fee: z.object({ bips: z.number().int().min(0).max(10_000), sink: address.nullable(), onInput: z.boolean() }).nullable(),
})
const detail = z.record(z.string().max(64), z.union([z.string().max(512), z.number(), z.boolean(), z.null()])).refine((d) => Object.keys(d).length <= 32, { message: 'at most 32 keys' })

/** The endpoint's schema, mirrored. See the note at the top of this file. */
const schema = z.object({
  client: z.enum(['extension-worker', 'extension-page', 'mobile', 'interface']),
  version: z.string().max(64),
  at: z.number().int().nonnegative(),
  chainId: z.number().int().positive(),
  operation: z.enum(['swap', 'bridge', 'limit-order', 'send', 'approve', 'wrap', 'nft', 'farm', 'launchpad', 'sync', 'other']),
  failure: z.object({
    stage: z.enum(['quote', 'approve', 'permit', 'sign', 'simulate', 'broadcast', 'receipt']),
    kind: z.enum(['revert', 'rejected', 'timeout', 'network', 'validation', 'unknown']),
    message: z.string().max(2_000),
    revertReason: z.string().max(256).nullable(),
    revertSelector: z.string().max(10).nullable(),
    txHash: z.string().max(66).nullable(),
    blockNumber: z.string().max(32).nullable(),
    gasUsed: nullableAmount,
  }),
  call: z
    .object({ to: address, value: amount, data: z.string().max(65_536).regex(/^0x([0-9a-fA-F]{2})*$/) })
    .nullable(),
  state: z
    .object({ account: address, balanceIn: nullableAmount, nativeBalance: nullableAmount, erc20Allowance: nullableAmount, permit2Amount: nullableAmount, permit2Expiration: z.number().int().nonnegative().nullable() })
    .nullable(),
  swap: swapDetail.nullable().optional(),
  detail: detail.nullable().optional(),
})

const URL_ = 'https://api.test/api/wallet/client-failure'
const KEY = 'e3b0c44298fc1c149afbf4c8996fb924'
const ACCOUNT = '0x3333333333333333333333333333333333333333' as Hex
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const WETN = '0x154c9fd7f006b92b6afa746098d8081a831dc1fc' as Hex
const UR = '0xf52321eb9ead6d57887f203df9036baf2f3765a9' as Hex
const PERMIT2 = '0xdd07fe6922d1aab4fe98c6533fa19037159500e7' as Hex
const SINK = '0x00000000000000000000000000000000000051ab' as Hex
const UR_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'])
/** A 65-byte value in the shape of a real signature, which is what must never come back out. */
const SIGNATURE = `0x${'ab'.repeat(65)}` as Hex

interface Sent {
  readonly url: string
  readonly body: string
  readonly headers: Record<string, string>
}

/** A reporter whose every send is recorded, and whose consent and clock the case controls. */
function reporter(over: Partial<ClientFailureDeps> = {}): { failures: ClientFailures; sent: Sent[] } {
  const sent: Sent[] = []
  const failures = new ClientFailures({
    fetch: (url, init) => {
      sent.push({ url: String(url), body: String(init?.body ?? ''), headers: (init?.headers ?? {}) as Record<string, string> })
      return Promise.resolve(new Response(null, { status: 204 }))
    },
    url: URL_,
    key: KEY,
    now: () => 1_700_000_000_000,
    client: 'extension-worker',
    version: '1.2.3',
    enabled: () => Promise.resolve(true),
    ...over,
  })
  return { failures, sent }
}

/** A complete, valid swap report: every case below starts from this and breaks one thing. */
function swapInput(over: Partial<ClientFailureInput> = {}): ClientFailureInput {
  return {
    chainId: 5201420,
    operation: 'swap',
    failure: { stage: 'broadcast', kind: 'revert', message: 'execution reverted: STF', revertReason: 'STF', revertSelector: null, txHash: null, blockNumber: null, gasUsed: null },
    call: null,
    state: { account: ACCOUNT, balanceIn: '1000000', nativeBalance: '5000000000000000000', erc20Allowance: '0', permit2Amount: '0', permit2Expiration: 0 },
    swap: {
      quote: { id: 'q-1', source: 'routing-api', cached: false, blockNumber: '1234', fallbackReason: null },
      trade: { type: 'exact-in', tokenIn: { address: TOKEN, symbol: 'FIX', decimals: 6 }, tokenOut: { address: 'native', symbol: 'ETN', decimals: 18 }, amountIn: '1000000', slippageBips: 50, taxBips: 0 },
      quoted: { amountOut: '2000000000000000000', minimumOut: '1990000000000000000', gasEstimate: '250000', priceImpactPct: 0.12 },
      route: [{ protocol: 'v3', tokenIn: TOKEN, tokenOut: WETN, feeTier: 3000 }],
      splits: 1,
      tax: { in: null, out: { status: 'measured', buyFeeBps: 0, sellFeeBps: 0, sellReverted: false, externalTransferFailed: false, feeTakenOnTransfer: false } },
      fee: { bips: 30, sink: SINK, onInput: false },
    },
    ...over,
  }
}

/** Real Universal Router calldata for a permit-carrying swap: the exact bytes a failed swap would hold. */
function permitCalldata(): Hex {
  const hops: Hop[] = [{ kind: 'v3', tokenIn: TOKEN, tokenOut: WETN, fee: 3000 }]
  return encodeSwap({
    route: { hops },
    amountIn: 1_000_000n,
    quotedOut: 2n * 10n ** 18n,
    slippageBips: 50,
    nativeIn: false,
    nativeOut: true,
    wrappedNative: WETN,
    recipient: ACCOUNT,
    fee: { sink: SINK, bips: 30 },
    permit: { token: TOKEN, amount: 1_000_000n, expiration: 1_800_000_000, nonce: 7, spender: UR, sigDeadline: 1_800_000_000n, signature: SIGNATURE },
    deadline: 1_800_000_000n,
    universalRouter: UR,
  }).data as Hex
}

/** The command list out of a Universal Router `execute`, which a re-encode must not disturb. */
function commandBytes(data: Hex): Hex {
  const [commands] = decodeFunctionData({ abi: UR_ABI, data }).args
  return commands
}

describe('what the reporter refuses to send', () => {
  it('sends nothing at all when diagnostics are off', async () => {
    const { failures, sent } = reporter({ enabled: () => Promise.resolve(false) })
    await failures.send(swapInput())
    expect(sent).toEqual([])
  })

  it('treats a settings document it cannot read as a no', async () => {
    const { failures, sent } = reporter({ enabled: () => Promise.reject(new Error('vault locked')) })
    await failures.send(swapInput())
    expect(sent).toEqual([])
  })

  it('is not built at all without a wallet key, because the route answers 401 without one', () => {
    const deps = { fetch, url: URL_, now: () => 0, client: 'mobile' as const, version: '1.2.3', enabled: () => Promise.resolve(true) }
    expect(clientFailuresFor(deps)).toBeUndefined()
    expect(clientFailuresFor({ ...deps, key: '' })).toBeUndefined()
    expect(clientFailuresFor({ ...deps, key: KEY })).toBeInstanceOf(ClientFailures)
  })

  it('never reports a user declining a sheet, whatever built the report', async () => {
    const { failures, sent } = reporter()
    await failures.send(swapInput({ failure: { stage: 'broadcast', kind: 'rejected', message: 'User rejected the request.', revertReason: null, revertSelector: null, txHash: null, blockNumber: null, gasUsed: null } }))
    expect(sent).toEqual([])
    // And the same refusal one layer down, so no future caller can route around it.
    expect(normalise({ ...swapInput({ failure: { stage: 'sign', kind: 'rejected', message: 'no', revertReason: null, revertSelector: null, txHash: null, blockNumber: null, gasUsed: null } }), client: 'mobile', version: '1', at: 0 })).toBeNull()
  })

  it('stops asking once the window is spent, and never retries a send', async () => {
    const { failures, sent } = reporter()
    for (let i = 0; i < 25; i++) await failures.send(swapInput())
    expect(sent.length).toBe(10)
  })

  it('resolves rather than rejecting when fetch does', async () => {
    const failures = new ClientFailures({
      fetch: () => Promise.reject(new Error('Failed to fetch')),
      url: URL_,
      key: KEY,
      now: () => 1,
      client: 'mobile',
      version: '1.2.3',
      enabled: () => Promise.resolve(true),
    })
    await expect(failures.send(swapInput())).resolves.toBeUndefined()
    // And the fire-and-forget entry point does not leave an unhandled rejection behind it.
    expect(failures.report(swapInput())).toBeUndefined()
  })
})

describe('the Permit2 signature', () => {
  it('is in the calldata the swap actually sends', () => {
    const decoded = decodeUniversalRouter(permitCalldata())
    const permit = decoded?.commands.find((c) => c.type === 'PERMIT2_PERMIT')
    expect(permit && permit.type === 'PERMIT2_PERMIT' ? permit.signature : null).toBe(SIGNATURE)
  })

  it('is gone from what is sent, with the permit terms left behind', async () => {
    const { failures, sent } = reporter()
    await failures.send(swapInput({ call: { to: UR, value: '0', data: permitCalldata() } }))
    const body = JSON.parse(sent[0]?.body ?? '{}') as { call: { data: string } }
    // Not "the hex does not contain it": decode the command and look at the field.
    const permit = decodeUniversalRouter(body.call.data as Hex)?.commands.find((c) => c.type === 'PERMIT2_PERMIT')
    expect(permit?.type).toBe('PERMIT2_PERMIT')
    if (permit?.type !== 'PERMIT2_PERMIT') throw new Error('unreachable')
    expect(permit.signature).toBe('0x')
    // The terms are the debuggable part and have to survive intact.
    expect(permit.token.toLowerCase()).toBe(TOKEN)
    expect(permit.amount).toBe(1_000_000n)
    expect(permit.nonce).toBe(7)
    expect(permit.spender.toLowerCase()).toBe(UR)
    expect(body.call.data).not.toContain('ab'.repeat(65))
  })

  it('leaves calldata that is not a router call exactly as it was', () => {
    // An ERC-20 approve for Permit2: no `execute`, nothing to rewrite.
    const approve = '0x095ea7b3' + PERMIT2.slice(2).padStart(64, '0') + 'f'.repeat(64)
    expect(stripPermitSignatures(approve)).toBe(approve)
    expect(stripPermitSignatures('0x')).toBe('0x')
    expect(stripPermitSignatures('not hex at all')).toBe('not hex at all')
  })

  it('keeps the rest of the command list byte-for-byte', () => {
    const before = decodeUniversalRouter(permitCalldata())
    const after = decodeUniversalRouter(stripPermitSignatures(permitCalldata()) as Hex)
    expect(after?.commands.map((c) => c.type)).toEqual(before?.commands.map((c) => c.type))
    expect(after?.deadline).toBe(before?.deadline)
    // The command bytes themselves are re-encoded, so they have to come back identical.
    expect(commandBytes(stripPermitSignatures(permitCalldata()) as Hex)).toBe(commandBytes(permitCalldata()))
  })
})

describe('the body that goes on the wire', () => {
  it('is a report the endpoint accepts', async () => {
    const { failures, sent } = reporter()
    await failures.send(swapInput({ call: { to: UR, value: '0', data: permitCalldata() } }))
    expect(schema.safeParse(JSON.parse(sent[0]?.body ?? '{}')).success).toBe(true)
  })

  it('stamps the body, version and time rather than trusting a caller for them', async () => {
    const { failures, sent } = reporter({ client: 'mobile', version: '9.9.9', now: () => 1_234_567 })
    await failures.send(swapInput())
    expect(JSON.parse(sent[0]?.body ?? '{}')).toMatchObject({ client: 'mobile', version: '9.9.9', at: 1_234_567 })
  })

  it('signs the request and never sends the key itself', async () => {
    const { failures, sent } = reporter()
    await failures.send(swapInput())
    const headers = sent[0]?.headers ?? {}
    expect(headers['X-BoltVault-Auth']).toMatch(/^v1\.[0-9a-f]{8}\.\d+\./)
    expect(JSON.stringify(headers)).not.toContain(KEY)
  })

  it('clamps what it can and refuses what it cannot', () => {
    const long = normalise({ ...swapInput({ failure: { stage: 'receipt', kind: 'revert', message: 'x'.repeat(5_000), revertReason: 'y'.repeat(900), revertSelector: null, txHash: null, blockNumber: null, gasUsed: null } }), client: 'mobile', version: 'v'.repeat(200), at: 1 })
    expect(long?.failure.message.length).toBe(2_000)
    expect(long?.failure.revertReason?.length).toBe(256)
    expect(long?.version.length).toBe(64)
    expect(schema.safeParse(long).success).toBe(true)
    // A chain id the schema cannot accept is a report the endpoint would drop.
    expect(normalise({ ...swapInput({ chainId: 0 }), client: 'mobile', version: '1', at: 1 })).toBeNull()
  })

  it('drops a field the endpoint would refuse rather than the whole report', () => {
    const bad = normalise({
      ...swapInput({ call: { to: 'not-an-address', value: '0', data: '0x1234' }, state: { account: 'nope', balanceIn: null, nativeBalance: null, erc20Allowance: null, permit2Amount: null, permit2Expiration: null } }),
      client: 'mobile',
      version: '1',
      at: 1,
    })
    expect(bad?.call).toBeNull()
    expect(bad?.state).toBeNull()
    // The stage and the message are what a report is for; they survive.
    expect(bad?.failure.stage).toBe('broadcast')
    expect(schema.safeParse(bad).success).toBe(true)
  })

  it('nulls a swap block it cannot vouch for, because a malformed one costs the envelope too', () => {
    const input = swapInput()
    const broken = normalise({ ...input, swap: { ...input.swap!, trade: { ...input.swap!.trade, amountIn: 'lots' } }, client: 'mobile', version: '1', at: 1 })
    expect(broken?.swap).toBeNull()
    expect(schema.safeParse(broken).success).toBe(true)
  })
})

describe('the generic envelope', () => {
  it('carries an operation with no typed block on `detail` alone', async () => {
    const { failures, sent } = reporter()
    await failures.send({
      chainId: 52014,
      operation: 'sync',
      failure: { stage: 'broadcast', kind: 'network', message: 'the relay closed the connection', revertReason: null, revertSelector: null, txHash: null, blockNumber: null, gasUsed: null },
      call: null,
      state: null,
      detail: { peerDeviceId: 'dev-2', attempt: 3, resumed: false, lastError: null },
    })
    const body = JSON.parse(sent[0]?.body ?? '{}') as Record<string, unknown>
    expect(schema.safeParse(body).success).toBe(true)
    expect(body['swap']).toBeUndefined()
    expect(body['detail']).toEqual({ peerDeviceId: 'dev-2', attempt: 3, resumed: false, lastError: null })
  })

  it('bounds `detail` on every axis a log cares about', () => {
    // `long` and `nan` first: the key cap truncates, so a value that needs
    // clamping has to be inside the window for this to prove anything.
    const wide: Record<string, string | number | boolean | null> = { long: 'z'.repeat(2_000), nan: Number.NaN }
    for (let i = 0; i < 60; i++) wide[`k${String(i)}`] = 'v'
    const out = normalise({
      chainId: 52014,
      operation: 'other',
      failure: { stage: 'quote', kind: 'unknown', message: 'x', revertReason: null, revertSelector: null, txHash: null, blockNumber: null, gasUsed: null },
      call: null,
      state: null,
      detail: wide,
      client: 'mobile',
      version: '1',
      at: 1,
    })
    expect(Object.keys(out?.detail ?? {}).length).toBeLessThanOrEqual(32)
    expect(out?.detail?.['long']).toBe('z'.repeat(512))
    // JSON cannot carry NaN and the schema does not take it; null is the only honest answer.
    expect(out?.detail?.['nan']).toBeNull()
    expect(schema.safeParse(out).success).toBe(true)
  })
})

/*
  A quote in the shape `execute` hands to the reporter: priced, with the
  diagnostics rider that carries the account state and the routing service's own
  answer. Nothing here is drawn on a screen; it exists so a revert can be
  reproduced.
*/
const quoteView: SwapQuoteView = {
  tradeType: 'exactIn',
  maximumInRaw: '0',
  chainId: 5201420,
  tokenIn: TOKEN,
  tokenOut: 'native',
  symbolIn: 'FIX',
  symbolOut: 'ETN',
  decimalsIn: 6,
  decimalsOut: 18,
  amountInRaw: '1000000',
  balanceInRaw: '5000000',
  amountOutRaw: '2000000000000000000',
  receiveRaw: '1994000000000000000',
  minimumOutRaw: '1984030000000000000',
  rate: 2,
  priceImpactPct: 0.12,
  slippageBips: 50,
  taxBips: 0,
  taxUnknown: false,
  fee: { bips: 30, tier: 1, name: 'Dyno', amountRaw: '6000000000000000', sink: SINK, source: 'config', nextTierAt: null, nextTierBips: null, onInput: false },
  route: { label: 'V3 0.3%', hops: [{ kind: 'v3', tokenIn: TOKEN, tokenOut: WETN, fee: 3000 }], source: 'api' },
  gasEstimate: '290000',
  steps: ['approve', 'permit', 'swap'],
  quotedAt: 1_700_000_000_000,
  ok: true,
  problems: [],
  maxSpendableRaw: '5000000',
  diagnostics: {
    provenance: { id: 'q-7', cached: false, blockNumber: '99', fallbackReason: null },
    account: { account: ACCOUNT, balanceIn: '5000000', nativeBalance: '5000000000000000000', erc20Allowance: '0', permit2Amount: '0', permit2Expiration: 0 },
    tax: { in: null, out: { buyFeeBps: 0, sellFeeBps: 0, sellReverted: false, externalTransferFailed: false, feeTakenOnTransfer: false }, detector: true },
  },
}

const failed = (over: Partial<FlowStepFailure>): FlowStepFailure => ({ step: 'swap', index: 2, phase: 'run', error: new Error('boom'), rejected: false, requestId: 'req-1', hash: null, ...over })

/** A reverted receipt's activity row, which is where the block number comes from. */
const revertedRow = (): ActivityEntry => ({
  id: 'req-1',
  hash: `0x${'11'.repeat(32)}`,
  chainId: 5201420,
  accountId: 'acct-1',
  to: UR,
  value: '0',
  nonce: 4,
  submittedAt: 1_700_000_000_000,
  origin: 'internal:swap',
  category: 'SWAP',
  statements: [],
  riskCodes: [],
  status: 'failed',
  blockNumber: 5_551_212,
})

describe('a failed swap step, as a report', () => {
  it('names the stage the swap step had reached, which the error alone does not say', () => {
    const requote = swapFailureReport({ failure: failed({}), quote: quoteView, chainId: 5201420, stage: 'quote', call: null })
    expect(requote.failure).toMatchObject({ stage: 'quote', kind: 'unknown' })
    const encoding = swapFailureReport({ failure: failed({ error: new EngineError('invalid_argument', 'That route came back without a fee tier. Start the swap again to re-price it.') }), quote: quoteView, chainId: 5201420, stage: 'sign', call: null })
    expect(encoding.failure).toMatchObject({ stage: 'sign', kind: 'validation' })
  })

  it('reads a validation refusal off the error code rather than guessing from the words', () => {
    const moved = swapFailureReport({
      failure: failed({ error: new EngineError('invalid_argument', 'The price moved by 1.20% while this swap was being set up, which is more than your slippage allows. Start it again to see the new price.') }),
      quote: quoteView,
      chainId: 5201420,
      stage: 'quote',
      call: null,
    })
    expect(moved.failure.kind).toBe('validation')
    expect(moved.failure.message).toContain('1.20%')
  })

  it('files a reverted approve as the approve, not as an anonymous receipt', () => {
    const report = swapFailureReport({
      failure: failed({ step: 'approve', index: 0, phase: 'receipt', error: new FlowReceiptError('The network refused this step.', revertedRow()), hash: `0x${'11'.repeat(32)}` }),
      quote: quoteView,
      chainId: 5201420,
      stage: 'broadcast',
      call: { to: UR, value: '0', data: '0x1234' },
    })
    expect(report.failure).toMatchObject({ stage: 'approve', kind: 'revert', blockNumber: '5551212', txHash: `0x${'11'.repeat(32)}` })
    // Only the swap step's bytes are worth replaying, and a permit's must never be kept.
    expect(report.call).toBeNull()
  })

  it('tells a receipt that never came from one that came back against us', () => {
    const lost = swapFailureReport({ failure: failed({ phase: 'receipt', error: new FlowReceiptError('The network did not confirm this step in time.', null) }), quote: quoteView, chainId: 5201420, stage: 'broadcast', call: null })
    expect(lost.failure).toMatchObject({ stage: 'receipt', kind: 'timeout' })
  })

  it('pulls the revert reason out of what the node said', () => {
    const report = swapFailureReport({ failure: failed({ phase: 'result', error: new Error('execution reverted: TRANSFER_FROM_FAILED') }), quote: quoteView, chainId: 5201420, stage: 'broadcast', call: null })
    expect(report.failure).toMatchObject({ stage: 'broadcast', kind: 'revert', revertReason: 'TRANSFER_FROM_FAILED' })
  })

  it('keeps a custom-error selector when the revert carried four bytes and no words', () => {
    const report = swapFailureReport({ failure: failed({ phase: 'result', error: new Error('reverted with data 0xdeadbeef') }), quote: quoteView, chainId: 5201420, stage: 'broadcast', call: null })
    expect(report.failure.revertSelector).toBe('0xdeadbeef')
  })

  it('never files a user declining a sheet', async () => {
    const failure = failed({ step: 'permit', index: 1, phase: 'result', error: new EngineError('rejected', 'User rejected the request.'), rejected: true })
    const report = swapFailureReport({ failure, quote: quoteView, chainId: 5201420, stage: 'broadcast', call: null })
    expect(report.failure.kind).toBe('rejected')
    const { failures, sent } = reporter()
    await failures.send(report)
    expect(sent).toEqual([])
  })

  it('carries the quote provenance, the route and the account state, and the endpoint accepts all of it', async () => {
    const report = swapFailureReport({ failure: failed({ phase: 'result', error: new Error('execution reverted: TRANSFER_FROM_FAILED') }), quote: quoteView, chainId: 5201420, stage: 'broadcast', call: { to: UR, value: '0', data: permitCalldata() } })
    expect(report.swap?.quote).toEqual({ id: 'q-7', source: 'routing-api', cached: false, blockNumber: '99', fallbackReason: null })
    expect(report.swap?.route).toEqual([{ protocol: 'v3', tokenIn: TOKEN, tokenOut: WETN, feeTier: 3000 }])
    expect(report.swap?.splits).toBe(1)
    expect(report.state?.account).toBe(ACCOUNT)
    const { failures, sent } = reporter()
    await failures.send(report)
    expect(schema.safeParse(JSON.parse(sent[0]?.body ?? '{}')).success).toBe(true)
  })

  /*
    Each way of not getting an answer keeps its own name.

    These were all one value once, which meant the report said `probe-reverted`
    for a token that simply has no V2 pair against the base — the commonest and
    least interesting case — and sent anybody reading the log after a defect that
    was not there. The statuses are the whole reason this field is not a boolean.
  */
  it('reports which kind of unanswered probe it was, and `no-detector` for a chain with none', () => {
    const blank = { buyFeeBps: null, sellFeeBps: null, sellReverted: null, externalTransferFailed: null, feeTakenOnTransfer: null }
    for (const reason of ['no-pair', 'pair-too-thin', 'probe-reverted', 'not-answered'] as const) {
      const report = swapFailureReport({ failure: failed({}), quote: { ...quoteView, diagnostics: { ...quoteView.diagnostics!, tax: { in: { unavailable: true, reason }, out: null, detector: true } } }, chainId: 5201420, stage: 'quote', call: null })
      expect(report.swap?.tax).toEqual({ in: { status: reason, ...blank }, out: null })
    }
    // No detector on the chain at all is a different fact from any of them.
    const none = swapFailureReport({ failure: failed({}), quote: { ...quoteView, diagnostics: { ...quoteView.diagnostics!, tax: { in: null, out: null, detector: false } } }, chainId: 5201420, stage: 'quote', call: null })
    expect(none.swap?.tax.in?.status).toBe('no-detector')
  })

  it('survives a quote with no diagnostics rather than refusing to report', () => {
    const bare: SwapQuoteView = { ...quoteView }
    delete (bare as { diagnostics?: unknown }).diagnostics
    const report = swapFailureReport({ failure: failed({}), quote: bare, chainId: 5201420, stage: 'quote', call: null })
    expect(report.state).toBeNull()
    expect(report.swap?.quote.id).toBeNull()
    expect(schema.safeParse({ ...report, client: 'mobile', version: '1', at: 1 }).success).toBe(true)
  })
})

describe('the flow names the step that failed', () => {
  /** A store with a real activity log, because `waitReceipt` reads one. Nothing here unlocks a vault. */
  function store(): FlowStore {
    const bus = new EventBus()
    const platform = createMemoryPlatform()
    return new FlowStore({ platform, bus, activity: new ActivityStore(platform, bus, () => Promise.resolve(new Uint8Array(32))) })
  }

  function deferred(): { promise: Promise<FlowStepFailure>; resolve: (f: FlowStepFailure) => void } {
    let resolve: (f: FlowStepFailure) => void = () => undefined
    const promise = new Promise<FlowStepFailure>((r) => {
      resolve = r
    })
    return { promise, resolve }
  }

  it('reports a step that threw before there was a sheet, and still fails the flow', async () => {
    const seen: FlowStepFailure[] = []
    const flow = await store().start({
      kind: 'swap',
      accountId: 'acct-1',
      chainId: 5201420,
      quote: null,
      steps: [{ step: 'swap', run: () => Promise.reject(new EngineError('invalid_argument', 'the quote changed')) }],
      onFailed: (f) => seen.push(f),
    })
    expect(seen.map((f) => [f.step, f.phase, f.rejected])).toEqual([['swap', 'run', false]])
    expect(flow.status).toBe('failed')
    expect(flow.error).toBe('the quote changed')
  })

  it('reports a sheet that came back against the step, and marks a rejection as one', async () => {
    const { promise, resolve } = deferred()
    await store().start({
      kind: 'swap',
      accountId: 'acct-1',
      chainId: 5201420,
      quote: null,
      steps: [{ step: 'permit', run: () => Promise.resolve({ requestId: 'req-1', result: Promise.reject(new EngineError('rejected', 'User rejected the request.')) }) }],
      onFailed: resolve,
    })
    const failure = await promise
    expect(failure).toMatchObject({ step: 'permit', phase: 'result', rejected: true, requestId: 'req-1' })
  })

  it('hands the reverted receipt its activity row, which is where the block number is', async () => {
    const bus = new EventBus()
    const platform = createMemoryPlatform()
    const activity = new ActivityStore(platform, bus, () => Promise.resolve(new Uint8Array(32)))
    const flows = new FlowStore({ platform, bus, activity })
    const hash = `0x${'22'.repeat(32)}`
    const { promise, resolve } = deferred()
    await flows.start({
      kind: 'swap',
      accountId: 'acct-1',
      chainId: 5201420,
      quote: null,
      steps: [{ step: 'swap', waitReceipt: true, run: () => Promise.resolve({ requestId: 'req-1', result: Promise.resolve(hash) }) }],
      onFailed: resolve,
    })
    await activity.append({ ...revertedRow(), id: 'req-1', hash })
    const failure = await promise
    expect(failure).toMatchObject({ step: 'swap', phase: 'receipt', hash })
    expect(failure.error instanceof FlowReceiptError ? failure.error.entry?.blockNumber : null).toBe(5_551_212)
  })

  it('is not broken by a listener that throws, because the flow has already failed once', async () => {
    const flow = await store().start({
      kind: 'swap',
      accountId: 'acct-1',
      chainId: 5201420,
      quote: null,
      steps: [{ step: 'swap', run: () => Promise.reject(new Error('no route')) }],
      onFailed: () => {
        throw new Error('a reporter that throws is the bug this guards')
      },
    })
    expect(flow.status).toBe('failed')
    expect(flow.error).toBe('no route')
  })
})
