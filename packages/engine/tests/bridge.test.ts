/**
 * M7 inside the engine, against two mock chains: Electroneum (origin, the
 * synthetic USDC router) and Base (destination mailbox). Corridors verify by
 * standard, a quote carries the router's gas payment and the destination
 * code check, the flow signs one transferRemote through the sheet, and the
 * watcher follows DispatchId → ProcessId to "delivered". Also `.eth` names
 * from any chain, and other-chain display prices that never see the account.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { DISPATCH_ID_TOPIC, PROCESS_ID_TOPIC, TOKEN_ROUTER_ABI, hyperlaneChain } from '@boltvault/electroswap'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { decodeFunctionData, encodeAbiParameters, parseAbiParameters, parseTransaction, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, parseApprovalPayload, resetMulticallCache, CANONICAL_MULTICALL3, GeckoTerminalPrices, type ApprovalRequest, type BridgeStatus, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ETN = 52014
const BASE = 8453
const USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e' as Hex
const USDT = '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7' as Hex
const CONTRACT = '0x7777777777777777777777777777777777777777' as Hex
const ETN_MAILBOX = hyperlaneChain(ETN)?.mailbox ?? ('0x' as Hex)
const BASE_MAILBOX = hyperlaneChain(BASE)?.mailbox ?? ('0x' as Hex)
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])
const addr = (a: Hex): Hex => encodeAbiParameters(parseAbiParameters('address'), [a])
const domains = (ids: number[]): Hex => encodeAbiParameters(parseAbiParameters('uint32[]'), [ids])

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

function waitTransfer(engine: Engine, id: string, state: BridgeStatus['state']): Promise<BridgeStatus> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`transfer ${id} never reached ${state}`)), 8_000)
    const off = engine.host.events.subscribe((e) => {
      if (e.type !== 'bridge.changed') return
      const hit = e.transfers.find((x) => x.id === id && x.state === state)
      if (hit) {
        clearTimeout(timer)
        off()
        resolve(hit)
      }
    })
  })
}

describe('the Hyperlane bridge on two mock chains', () => {
  let origin: MockRpc
  let dest: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  let dispatched: Hex | null = null
  const destLogFilters: unknown[] = []

  beforeAll(async () => {
    resetMulticallCache()
    origin = await startMockRpc({ chainId: ETN, baseFeePerGas: 0n })
    dest = await startMockRpc({ chainId: BASE })
    for (const rpc of [origin, dest]) rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    origin.state.code.set(USDC.toLowerCase(), '0x6080')
    origin.state.code.set(USDT.toLowerCase(), '0x6080')
    origin.state.code.set(CONTRACT.toLowerCase(), '0x6080')
    // The USDC synthetic: the pinned mailbox, Ethereum/Base/Avalanche enrolled, 500 USDC held, 0.001 ETN gas quote.
    origin.state.calls.set(USDC.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0xd5438eae') return addr(ETN_MAILBOX) // mailbox()
      if (sel === '0x440df4f4') return domains([1, BASE, 43114]) // domains()
      if (sel === '0x70a08231') return u(500_000_000n) // balanceOf
      if (sel === '0xdd62ed3e') return u(0n) // allowance
      if (sel === '0x313ce567') return u(6n)
      if (sel === '0xf2ed8c53') return u(10n ** 15n) // quoteGasPayment(uint32)
      return '0x'
    })
    // The USDT synthetic reports a foreign mailbox: its corridor must switch off.
    origin.state.calls.set(USDT.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0xd5438eae') return addr('0x9999999999999999999999999999999999999999')
      if (sel === '0x440df4f4') return domains([1])
      if (sel === '0x70a08231') return u(0n)
      if (sel === '0xdd62ed3e') return u(0n)
      if (sel === '0xf2ed8c53') return u(10n ** 15n)
      return '0x'
    })
    // Once mined, the origin receipt carries the mailbox's DispatchId log.
    const baseReceipt = (hash: string): { blockNumber: bigint; from: string; to: string | null; status: 0 | 1 } | null => {
      const t = origin.state.transactions.get(hash)
      return t && t.blockNumber !== null ? { blockNumber: t.blockNumber, from: t.from, to: t.to, status: t.status } : null
    }
    origin.state.methods.set('eth_getTransactionReceipt', (params) => {
      const hash = String(params[0])
      const t = baseReceipt(hash)
      if (!t) return null
      dispatched = `0x${'ab'.repeat(32)}`
      const hex = (n: bigint): string => `0x${n.toString(16)}`
      return { transactionHash: hash, blockNumber: hex(t.blockNumber), blockHash: `0x${'cd'.repeat(32)}`, from: t.from, to: t.to, status: t.status === 1 ? '0x1' : '0x0', gasUsed: hex(120_000n), effectiveGasPrice: hex(origin.state.gasPrice), logs: [{ address: ETN_MAILBOX, topics: [DISPATCH_ID_TOPIC, dispatched], data: '0x', blockNumber: hex(t.blockNumber), transactionHash: hash, logIndex: '0x0' }], logsBloom: `0x${'00'.repeat(256)}`, cumulativeGasUsed: hex(120_000n), type: '0x0' }
    })
    // The destination mailbox answers ProcessId for exactly the message id it is asked about.
    dest.state.methods.set('eth_getLogs', (params) => {
      destLogFilters.push(params[0])
      const f = params[0] as { address: string; topics: [string, string] }
      if (f.address.toLowerCase() !== BASE_MAILBOX.toLowerCase() || f.topics[0] !== PROCESS_ID_TOPIC || f.topics[1] !== dispatched) return []
      return [{ address: BASE_MAILBOX, topics: [PROCESS_ID_TOPIC, dispatched], data: '0x', blockNumber: '0x1', transactionHash: `0x${'de'.repeat(32)}`, logIndex: '0x0' }]
    })
    const fetchImpl: typeof fetch = async () => new Response('not found', { status: 404 })
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null, pricesUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    const words = created.mnemonic.split(' ')
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(ETN, origin.url)
    await engine.chains.setRpc(BASE, dest.url)
    origin.state.balances.set(address.toLowerCase(), 5n * 10n ** 18n)
  })

  afterAll(async () => {
    engine.dispose()
    await origin.close()
    await dest.close()
  })

  it('offers the corridors from Electroneum, verified by standard, and switches off a router with the wrong mailbox', async () => {
    // Avalanche is off by default (plan A4: Electroneum, Ethereum, BSC and Base); the corridor appears once the chain is on.
    await engine.engine.settings.set({ enabledChains: [1, 56, 8453, 43114] })
    const routes = await engine.engine.bridge.routes({ fromChainId: ETN })
    expect(routes.map((r) => `${r.symbol}:${r.toChainId}:${r.verified}`)).toEqual(['USDC:1:true', 'USDC:8453:true', 'USDC:43114:true', 'USDT:1:false'])
    expect(routes[3]?.reason).toMatch(/mailbox/)
    expect(routes.every((r) => r.standard === 'synthetic' && r.router.toLowerCase() === r.token.toLowerCase())).toBe(true)
    const usdcOnly = await engine.engine.bridge.routes({ fromChainId: ETN, token: USDC.toLowerCase() })
    expect(usdcOnly).toHaveLength(3)
    // A disabled destination chain is left out (Settings › Networks).
    await engine.engine.settings.set({ enabledChains: [1] })
    expect((await engine.engine.bridge.routes({ fromChainId: ETN })).map((r) => r.toChainId)).toEqual([1, 1])
    await engine.engine.settings.set({ enabledChains: [1, 8453, 43114] })
  })

  it('quotes the interchain gas from the router, defaults the recipient to you, and refuses a contract with no code on the destination', async () => {
    const q = await engine.engine.bridge.quote({ accountId, fromChainId: ETN, toChainId: BASE, token: USDC, amount: '100' })
    expect(q).toMatchObject({ ok: true, symbol: 'USDC', decimals: 6, amountRaw: '100000000', balanceRaw: '500000000', recipient: address, gasQuoteWei: (10n ** 15n).toString(), feeSymbol: 'ETN', etaMinutes: 5, steps: ['submit'], recipientCode: { origin: false, destination: false } })
    expect(BigInt(q.txFeeWei)).toBeGreaterThan(0n)
    const much = await engine.engine.bridge.quote({ accountId, fromChainId: ETN, toChainId: BASE, token: USDC, amount: '600' })
    expect(much.ok).toBe(false)
    expect(much.problems.join(' ')).toMatch(/Not enough USDC/)
    const off = await engine.engine.bridge.quote({ accountId, fromChainId: ETN, toChainId: 1, token: USDT, amount: '1' })
    expect(off.problems.join(' ')).toMatch(/switched off/)
    const stuck = await engine.engine.bridge.quote({ accountId, fromChainId: ETN, toChainId: BASE, token: USDC, amount: '1', recipient: CONTRACT })
    expect(stuck.recipientCode).toEqual({ origin: true, destination: false })
    expect(stuck.ok).toBe(false)
    expect(stuck.problems.join(' ')).toMatch(/contract here but nothing on the destination/)
    const none = await engine.engine.bridge.quote({ accountId, fromChainId: ETN, toChainId: 56, token: USDC, amount: '1' })
    expect(none.problems[0]).toMatch(/No Hyperlane corridor/)
  })

  it('bridges through one sheet: transferRemote with the gas quote as value, then DispatchId → ProcessId → delivered, recorded as BRIDGE', async () => {
    const r = await engine.engine.bridge.execute({ accountId, fromChainId: ETN, toChainId: BASE, token: USDC, amount: '100' })
    expect(r.requestId).toBeTruthy()
    const req = await approvalById(engine, r.requestId ?? '')
    const payload = payloadOf(req)
    if (!('assessment' in payload)) throw new Error('not a signing request')
    expect(payload.assessment.statements.map((s) => s.text)).toEqual([`Bridge 100 USDC to Base for ${address.slice(0, 6)}…${address.slice(-4)}`, 'Pays 0.001 ETN of interchain gas to Hyperlane'])
    // No trace RPC on the mock chain: the no-simulation floor is `warn` (§3.4), never a block for an EOA recipient.
    expect(['info', 'warn']).toContain(payload.assessment.severity)
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('RECIPIENT_NO_CODE_ON_DEST')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    // The signed transaction is transferRemote(8453, bytes32(me), 100e6) to the synthetic, carrying the gas quote.
    let raw: Hex | undefined
    for (let i = 0; i < 100 && !raw; i++) {
      raw = [...origin.state.transactions.values()][0]?.raw
      if (!raw) await new Promise((res) => setTimeout(res, 20))
    }
    if (!raw) throw new Error('nothing was broadcast')
    const parsed = parseTransaction(raw)
    expect(parsed.to?.toLowerCase()).toBe(USDC.toLowerCase())
    expect(parsed.value).toBe(10n ** 15n)
    const call = decodeFunctionData({ abi: TOKEN_ROUTER_ABI, data: parsed.data ?? '0x' })
    expect(call.functionName).toBe('transferRemote')
    expect(call.args).toEqual([BASE, `0x000000000000000000000000${address.slice(2).toLowerCase()}`, 100_000_000n])
    const hash = [...origin.state.transactions.keys()][0] ?? ''
    origin.advanceBlocks()
    const delivered = await waitTransfer(engine, hash, 'delivered')
    expect(delivered).toMatchObject({ fromChainId: ETN, toChainId: BASE, symbol: 'USDC', amountRaw: '100000000', messageId: dispatched, destinationHash: `0x${'de'.repeat(32)}`, recipient: address })
    // The watcher asked the destination mailbox for exactly this message, in a bounded window.
    const filter = destLogFilters[0] as { fromBlock: string; toBlock: string; address: string; topics: string[] }
    expect(filter.address.toLowerCase()).toBe(BASE_MAILBOX.toLowerCase())
    expect(filter.topics).toEqual([PROCESS_ID_TOPIC, dispatched])
    expect(BigInt(filter.toBlock) - BigInt(filter.fromBlock)).toBeLessThanOrEqual(5_000n)
    const list = await engine.engine.bridge.list({ accountId })
    expect(list.map((x) => x.state)).toEqual(['delivered'])
    expect(await engine.engine.bridge.status({ id: hash })).toMatchObject({ state: 'delivered' })
    const activity = await engine.engine.activity.list({ accountId, chainId: ETN })
    expect(activity.find((e) => e.hash === hash)?.category).toBe('BRIDGE')
  })

  it('resolves .eth through Ethereum and .etn through Electroneum from any chain, never on the testnet', () => {
    expect(engine.names.chainFor(BASE, 'vitalik.eth')).toBe(1)
    expect(engine.names.chainFor(1, 'nakamoto.etn')).toBe(ETN)
    expect(engine.names.chainFor(ETN, 'nakamoto.etn')).toBe(ETN)
    expect(engine.names.chainFor(5201420, 'nakamoto.etn')).toBeNull()
    expect(engine.names.chainFor(BASE, address)).toBeNull()
    expect(engine.names.chainFor(BASE, '.eth')).toBeNull()
    expect(engine.names.isName(BASE, 'vitalik.eth')).toBe(true)
  })
})

describe('display prices off Electroneum', () => {
  it('asks GeckoTerminal by token address only, caches the answer, and backs off on 429', async () => {
    const urls: string[] = []
    let status = 200
    const fetchImpl: typeof fetch = async (input) => {
      urls.push(String(input))
      if (status !== 200) return new Response('slow down', { status })
      return new Response(JSON.stringify({ data: [{ attributes: { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', price_usd: '2500.5' } }, { attributes: { address: '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', price_usd: '1.0' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    let now = 1_000_000
    const prices = new GeckoTerminalPrices(fetchImpl, () => now, 'https://gecko.test/api/v2')
    const first = await prices.prices(1, ['native', '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'])
    expect(first.get('native')?.price).toBe(2500.5)
    expect(first.get('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48')?.price).toBe(1)
    expect(urls).toHaveLength(1)
    expect(urls[0]).toMatch(/^https:\/\/gecko\.test\/api\/v2\/networks\/eth\/tokens\/multi\//)
    expect(urls[0]).not.toMatch(/0x3333/) // never an account
    // Within the cache window nothing is fetched again.
    now += 30_000
    await prices.prices(1, ['native'])
    expect(urls).toHaveLength(1)
    // Past it, a 429 leaves the rows unpriced and starts a cooldown.
    now += 150_000
    status = 429
    const cooled = await prices.prices(1, ['native'])
    expect(cooled.size).toBe(0)
    expect(urls).toHaveLength(2)
    await prices.prices(1, ['native'])
    expect(urls).toHaveLength(2)
    // Electroneum is never asked here.
    expect((await prices.prices(52014, ['native'])).size).toBe(0)
  })

  it('signs requests to our own proxy, sends the key itself nowhere, and credentials the public feed not at all', async () => {
    const sent: Array<{ host: string; key: string | null; auth: string | null }> = []
    const fetchImpl: typeof fetch = async (input, init) => {
      const headers = new Headers(init?.headers as HeadersInit)
      sent.push({ host: new URL(String(input)).host, key: headers.get('x-boltvault-key'), auth: headers.get('x-boltvault-auth') })
      return new Response(JSON.stringify({ data: [] }), { status: 200, headers: { 'content-type': 'application/json' } })
    }
    const key = 'a-client-identifier-not-a-secret'
    /*
      Our proxy: a per-request signature says which client is calling, which is
      what the key was for. The key does not travel (§9.1) — it used to, and a
      credential visible in devtools is a credential anyone can reuse.
    */
    await new GeckoTerminalPrices(fetchImpl, () => 1, 'https://electroswap.io/api/wallet/prices', key).prices(1, ['native'])
    expect(sent.at(-1)?.host).toBe('electroswap.io')
    expect(sent.at(-1)?.key).toBeNull()
    expect(sent.at(-1)?.auth).toMatch(/^v1\.[0-9a-f]{8}\./)
    // And it is bound to this request, so it cannot be lifted onto another one.
    expect(sent.at(-1)?.auth).not.toContain(key)
    /*
      The public feed: nothing, ever. Handing GeckoTerminal an identifier that
      every install shares would tell a third party which requests are ours and
      buy us nothing — the whole point of the proxy is that they see neither
      our users nor us.
    */
    await new GeckoTerminalPrices(fetchImpl, () => 1, undefined, key).prices(1, ['native'])
    expect(sent.at(-1)).toEqual({ host: 'api.geckoterminal.com', key: null, auth: null })
  })

  it('keeps the logo it is given, and only asks once about a token it has no price for', async () => {
    const asked: string[][] = []
    const fetchImpl: typeof fetch = async (input) => {
      const chunk = (String(input).split('/multi/')[1] ?? '').split(',')
      asked.push(chunk)
      // WETH answers with a logo; the second address is simply not in the reply.
      return new Response(
        JSON.stringify({ data: [{ attributes: { address: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', price_usd: '2500.5', image_url: 'https://coin-images.example/weth.png' } }] }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      )
    }
    let now = 1_000_000
    const prices = new GeckoTerminalPrices(fetchImpl, () => now, 'https://gecko.test/api/v2')
    const unknown = '0x1111111111111111111111111111111111111111'

    const first = await prices.prices(1, ['native', unknown])
    expect(first.get('native')?.price).toBe(2500.5)
    expect(first.get('native')?.logoUri).toBe('https://coin-images.example/weth.png')
    expect(first.has(unknown)).toBe(false)
    expect(asked).toHaveLength(1)

    /*
      Past the price TTL the unknown token is still not asked about again.
      Only answered rows used to be cached, so the long tail of any wallet was
      re-requested on every block — which is what spent the minute's calls and
      brought back the 429 that left every chain unpriced.
    */
    now += 2 * 60_000
    const second = await prices.prices(1, [unknown])
    expect(second.size).toBe(0)
    expect(asked).toHaveLength(1)
  })
})
