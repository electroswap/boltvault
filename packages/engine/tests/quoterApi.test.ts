/**
 * ElectroSwap's routing service, read as untrusted input (§8.6).
 *
 * `parseQuote` is the only gate between a JSON body off the network and
 * calldata the user signs. `encodeSwap` refuses an empty hop list and nothing
 * else — it partitions a mixed route rather than refusing it now — so a split
 * route, a V3 hop naming a fee tier with no pool behind it, or a path that does
 * not start where the money is would all encode into something that reverts on
 * chain with the user's gas. Every body below is one the real service can
 * produce — including the 200 that says `{state:'Not found'}`, which is how "no
 * route" arrives.
 *
 * The `Quoter` cases are about the network rather than the payload: the service
 * allows thirty requests per five minutes and the Swap screen re-quotes on a
 * debounce, so the dedupe, the short cache and the 429 backoff are load-bearing
 * — and every one of them has to fail towards `none`, because `none` is what
 * makes the wallet quote on chain instead.
 */
import { V3_FEES, candidates, type QuoteAddresses } from '@boltvault/electroswap'
import { getAddress, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { DEFAULT_QUOTER_PATH, Quoter, parseQuote, type QuoterInput, type QuoterOutcome } from '../src/quoterApi'

const ETN = 52014
const FIX = '0x1111111111111111111111111111111111111111' as Hex
const WETN = '0x154c9fd7f006b92b6afa746098d8081a831dc1fc' as Hex
const MID = '0x2222222222222222222222222222222222222222' as Hex
const MID2 = '0x4444444444444444444444444444444444444444' as Hex
const MID3 = '0x5555555555555555555555555555555555555555' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex
const AMOUNT = 1_000_000n
const OUT = 3_500_000_000_000_000_000n

const input: QuoterInput = { chainId: ETN, tokenIn: FIX, tokenOut: WETN, amountIn: AMOUNT, recipient: ME }

/** The service nests the whole token object on both sides of a hop; only the address is read. */
const tok = (address: Hex): Record<string, unknown> => ({ address, symbol: 'T', decimals: 18, chainId: ETN })
/** `fee` is a decimal string in the response, not a number. */
const v3 = (tokenIn: Hex, tokenOut: Hex, fee: unknown = '3000'): Record<string, unknown> => ({ type: 'v3-pool', tokenIn: tok(tokenIn), tokenOut: tok(tokenOut), fee, liquidity: '8124511', sqrtRatioX96: '79228162514264337593543950336', tickCurrent: 0 })
/** A V2 hop carries reserves and no `fee` field at all. */
const v2 = (tokenIn: Hex, tokenOut: Hex): Record<string, unknown> => ({ type: 'v2-pool', tokenIn: tok(tokenIn), tokenOut: tok(tokenOut), reserve0: '4000000', reserve1: '8000000' })

/** A 200 body in the shape of the recorded fixtures; `route` is an array of splits. */
function served(route: readonly unknown[], quote: Record<string, unknown> = {}, top: Record<string, unknown> = {}): unknown {
  return {
    routing: 'CLASSIC',
    quote: { blockNumber: '1234567', amount: AMOUNT.toString(), quote: OUT.toString(), gasUseEstimate: '180000', route, routeString: '[V3] 100.00% = FIX -- 0.3% --> WETN', ...quote },
    allQuotes: [],
    quoteId: '4b1f7a2c-0c2f-4a21-9a5e-6f0a7c1d2e33',
    cached: false,
    ...top,
  }
}

/** The parsed route, or a failure naming the reason the body was refused. */
function routed(body: unknown, against: QuoterInput = input): Extract<QuoterOutcome, { kind: 'route' }> {
  const outcome = parseQuote(body, against)
  // `parseQuote` never returns 'superseded' — that is decided by the caller, not
  // by the body — but the union it shares says it might, so narrow before reading.
  if (outcome.kind !== 'route')
    throw new Error(`expected a route, got: ${outcome.kind === 'none' ? outcome.reason : outcome.kind}`)
  return outcome
}

describe('parseQuote accepts what the wallet can execute', () => {
  it('reads a single-split V3 route into the mini-router’s shape', () => {
    const out = routed(served([[v3(FIX, WETN, '3000')]]))
    expect(out.quote.candidate.kind).toBe('v3')
    expect(out.quote.candidate.route.hops).toEqual([{ kind: 'v3', tokenIn: FIX, tokenOut: WETN, fee: 3000 }])
    expect(out.quote.amountOut).toBe(OUT)
    expect(out.quote.gasEstimate).toBe(180_000n)
    expect(out.blockNumber).toBe('1234567')
    expect(out.cached).toBe(false)
  })

  it('reads a single-split V2 route, which names no fee anywhere', () => {
    const out = routed(served([[v2(FIX, WETN)]]))
    expect(out.quote.candidate.kind).toBe('v2')
    expect(out.quote.candidate.route.hops).toEqual([{ kind: 'v2', tokenIn: FIX, tokenOut: WETN }])
    expect(out.quote.amountOut).toBe(OUT)
  })

  it('accepts every fee tier that exists, for every hop of a multi-hop path', () => {
    for (const fee of V3_FEES) {
      const out = routed(served([[v3(FIX, WETN, String(fee))]]))
      expect(out.quote.candidate.route.hops).toEqual([{ kind: 'v3', tokenIn: FIX, tokenOut: WETN, fee }])
    }
    const two = routed(served([[v3(FIX, MID, '500'), v3(MID, WETN, '10000')]]))
    expect(two.quote.candidate.route.hops.map((h) => (h.kind === 'v3' ? h.fee : 0))).toEqual([500, 10_000])
  })

  it('takes the service’s gas figure, and falls back to a per-hop estimate when it gives none', () => {
    expect(routed(served([[v3(FIX, WETN)]], { gasUseEstimate: '210000' })).quote.gasEstimate).toBe(210_000n)
    // Absent and '0' are the same fact — no usable estimate — and neither may
    // reach the quote as a zero gas budget.
    expect(routed(served([[v3(FIX, WETN)]], { gasUseEstimate: undefined })).quote.gasEstimate).toBe(150_000n)
    expect(routed(served([[v3(FIX, WETN)]], { gasUseEstimate: '0' })).quote.gasEstimate).toBe(150_000n)
    expect(routed(served([[v3(FIX, MID, '500'), v3(MID, WETN)]], { gasUseEstimate: '0' })).quote.gasEstimate).toBe(300_000n)
  })

  /*
    The service checksums every address it echoes, and the wallet's own token
    addresses are lowercase. Comparing them as strings would refuse every real
    answer, so the match is case-insensitive in both directions and the hops
    come out in one casing.
  */
  it('matches checksummed addresses against a lowercase request, and lowercases what it keeps', () => {
    const out = routed(served([[v3(getAddress(FIX), getAddress(MID), '500'), v3(getAddress(MID), getAddress(WETN), '3000')]]))
    expect(out.quote.candidate.route.hops).toEqual([
      { kind: 'v3', tokenIn: FIX, tokenOut: MID, fee: 500 },
      { kind: 'v3', tokenIn: MID, tokenOut: WETN, fee: 3000 },
    ])
    // And the other way round: a checksummed request against the lowercase body.
    expect(routed(served([[v3(FIX, WETN)]]), { ...input, tokenIn: getAddress(FIX), tokenOut: getAddress(WETN) }).quote.amountOut).toBe(OUT)
  })

  it('carries the cache flag and the block number through, and says null when there is no block', () => {
    expect(routed(served([[v3(FIX, WETN)]], {}, { cached: true })).cached).toBe(true)
    expect(routed(served([[v3(FIX, WETN)]], { blockNumber: undefined })).blockNumber).toBeNull()
    // A number rather than a string is not the string the caller is promised.
    expect(routed(served([[v3(FIX, WETN)]], { blockNumber: 1_234_567 })).blockNumber).toBeNull()
  })

  /*
    The label is read by the Swap screen, which must not change wording
    depending on which router answered — so the vocabulary is the mini-router's
    own, asserted here against `candidates()` rather than against a copy of it.
  */
  it('labels a route in the mini-router’s vocabulary, so the screen reads identically either way', () => {
    const addresses: QuoteAddresses = { quoterV2: MID, mixedRouteQuoter: null, v2Router02: MID, bases: [MID] }
    const onChain = new Set(candidates(FIX, WETN, addresses).map((c) => c.label))
    const labels = {
      v2Direct: routed(served([[v2(FIX, WETN)]])).quote.candidate.label,
      v2Via: routed(served([[v2(FIX, MID), v2(MID, WETN)]])).quote.candidate.label,
      v3Direct: routed(served([[v3(FIX, WETN, '3000')]])).quote.candidate.label,
      v3Via: routed(served([[v3(FIX, MID, '500'), v3(MID, WETN, '3000')]])).quote.candidate.label,
    }
    expect(labels).toEqual({ v2Direct: 'V2', v2Via: 'V2 via', v3Direct: 'V3 0.3%', v3Via: 'V3 0.05% → 0.3%' })
    for (const label of Object.values(labels)) expect(onChain.has(label)).toBe(true)
    expect(routed(served([[v3(FIX, WETN, '100')]])).quote.candidate.label).toBe('V3 0.01%')
    expect(routed(served([[v3(FIX, WETN, '10000')]])).quote.candidate.label).toBe('V3 1%')
  })
})

describe('parseQuote refuses everything else', () => {
  it('a body that is not an object', () => {
    expect(parseQuote(null, input)).toEqual({ kind: 'none', reason: 'not an object' })
    expect(parseQuote('CLASSIC', input).kind).toBe('none')
    expect(parseQuote(42, input).kind).toBe('none')
    // An array is an object to `typeof`, and is not a response.
    expect(parseQuote([served([[v3(FIX, WETN)]])], input).kind).toBe('none')
  })

  /* The status line lies: no route and unknown token both come back as a 200. */
  it('the 200 that says {state: "Not found"}', () => {
    expect(parseQuote({ state: 'Not found' }, input)).toEqual({ kind: 'none', reason: 'state Not found' })
  })

  it('a body carrying no quote at all', () => {
    expect(parseQuote({ routing: 'CLASSIC', allQuotes: [], quoteId: 'q' }, input)).toEqual({ kind: 'none', reason: 'no quote' })
    expect(parseQuote(served([[v3(FIX, WETN)]], {}, { quote: 'none' }), input).kind).toBe('none')
  })

  /*
    The echoed amount is the only thing in the response that can catch two
    different mistakes. The service silently treats any `type` that is not the
    literal 'EXACT_INPUT' as EXACT_OUTPUT and names no trade type in its answer,
    so a wrong type would come back looking like a valid quote with the input
    and output the wrong way round. The same check catches a cache-key
    collision, the key being (type, tokenIn, tokenOut, amount) and nothing else.
  */
  it('an amount that does not come back unchanged', () => {
    expect(parseQuote(served([[v3(FIX, WETN)]], { amount: (AMOUNT + 1n).toString() }), input)).toEqual({ kind: 'none', reason: 'amount echo mismatch' })
    expect(parseQuote(served([[v3(FIX, WETN)]], { amount: undefined }), input).kind).toBe('none')
    // The same string, as a number: the service sends decimal strings.
    expect(parseQuote(served([[v3(FIX, WETN)]], { amount: Number(AMOUNT) }), input).kind).toBe('none')
  })

  it('an output that is missing, not a number, or zero', () => {
    expect(parseQuote(served([[v3(FIX, WETN)]], { quote: undefined }), input)).toEqual({ kind: 'none', reason: 'no output' })
    expect(parseQuote(served([[v3(FIX, WETN)]], { quote: '3.5e18' }), input).kind).toBe('none')
    expect(parseQuote(served([[v3(FIX, WETN)]], { quote: OUT }), input).kind).toBe('none')
    expect(parseQuote(served([[v3(FIX, WETN)]], { quote: '0' }), input).kind).toBe('none')
  })

  it('a route that is missing or is not an array of splits', () => {
    expect(parseQuote(served([[v3(FIX, WETN)]], { route: undefined }), input)).toEqual({ kind: 'none', reason: 'no route' })
    expect(parseQuote(served([[v3(FIX, WETN)]], { route: '[V3] 100.00%' }), input).kind).toBe('none')
  })

  /*
    A split route is a correct answer to a question the wallet cannot act on:
    `encodeSwap` emits one command carrying one path, so there is nowhere to put
    the second leg, and encoding only the first would swap a fraction of the
    input and sweep the rest. The request asks for `maxSplits: 1`; this is the
    belt to that braces.
  */
  it('two splits, each of which is a route the encoder has no room for', () => {
    expect(parseQuote(served([[v3(FIX, WETN, '3000')], [v3(FIX, WETN, '500')]]), input)).toEqual({ kind: 'none', reason: '2 splits' })
    expect(parseQuote(served([]), input)).toEqual({ kind: 'none', reason: '0 splits' })
  })

  it('a hop list that is empty, too long, or not a list', () => {
    expect(parseQuote(served([[]]), input)).toEqual({ kind: 'none', reason: 'bad hop list' })
    expect(parseQuote(served([{ type: 'v3-pool' }]), input).kind).toBe('none')
    const five = [v3(FIX, MID, '500'), v3(MID, MID2, '500'), v3(MID2, MID3, '500'), v3(MID3, MID, '500'), v3(MID, WETN, '500')]
    expect(parseQuote(served([five]), input)).toEqual({ kind: 'none', reason: 'bad hop list' })
    // Four is the service's own ceiling and is accepted.
    expect(routed(served([five.slice(0, 3).concat([v3(MID3, WETN, '500')])])).quote.candidate.route.hops).toHaveLength(4)
  })

  it('a hop whose type is not one of the two the wallet can encode', () => {
    expect(parseQuote(served([[{ ...v3(FIX, WETN), type: 'v4-pool' }]]), input)).toEqual({ kind: 'none', reason: 'bad hop' })
    expect(parseQuote(served([[{ ...v3(FIX, WETN), type: undefined }]]), input).kind).toBe('none')
    expect(parseQuote(served([[{ ...v2(FIX, WETN), type: 'v2-pair' }]]), input).kind).toBe('none')
  })

  /*
    A V3 hop has to name a fee tier that exists: `execute` encodes `h.fee`
    straight into the packed path, and a tier with no pool behind it is a
    revert. 250 and 2500 are the tiers other deployments use and ElectroSwap
    does not.
  */
  it('a V3 hop whose fee is missing, not a number, or a tier with no pool behind it', () => {
    // No `fee` key at all, which is what a V2 hop mislabelled as V3 would look like.
    expect(parseQuote(served([[{ type: 'v3-pool', tokenIn: tok(FIX), tokenOut: tok(WETN) }]]), input)).toEqual({ kind: 'none', reason: 'bad hop' })
    expect(parseQuote(served([[v3(FIX, WETN, null)]]), input).kind).toBe('none')
    expect(parseQuote(served([[v3(FIX, WETN, 'low')]]), input).kind).toBe('none')
    expect(parseQuote(served([[v3(FIX, WETN, '')]]), input).kind).toBe('none')
    expect(parseQuote(served([[v3(FIX, WETN, '3000.5')]]), input).kind).toBe('none')
    for (const fee of ['250', '2500', '400', '8388608']) expect(parseQuote(served([[v3(FIX, WETN, fee)]]), input).kind).toBe('none')
    // A V2 hop carrying a bogus fee is still a V2 hop; the tag decides.
    expect(routed(served([[{ ...v2(FIX, WETN), fee: '250' }]])).quote.candidate.kind).toBe('v2')
  })

  /*
    A mixed route is accepted now, because the encoder can express one.

    `encodeSwap` emits one command per contiguous same-protocol run of the
    route, so a V3 hop followed by a V2 hop is two Universal Router commands
    chained through the router — not a single packed path marking the V2 hop
    with the `0x800000` MixedRouteQuoter sentinel that the router does not read.
    That sentinel was the reason for the refusal: it addressed a V3 pool at fee
    tier 8388608 that does not exist, so the calldata was well formed and
    reverted on chain with the user's gas. With the encoder partitioning, the
    request asks for MIXED on purpose and this is the parse that has to keep up.
  */
  it('a route mixing a V2 and a V3 hop, which the encoder now partitions instead of refusing', () => {
    const v3ThenV2 = routed(served([[v3(FIX, MID, '3000'), v2(MID, WETN)]]))
    expect(v3ThenV2.quote.candidate.kind).toBe('mixed')
    expect(v3ThenV2.quote.candidate.route.hops).toEqual([
      { kind: 'v3', tokenIn: FIX, tokenOut: MID, fee: 3000 },
      { kind: 'v2', tokenIn: MID, tokenOut: WETN },
    ])
    const v2ThenV3 = routed(served([[v2(FIX, MID), v3(MID, WETN, '500')]]))
    expect(v2ThenV3.quote.candidate.kind).toBe('mixed')
    expect(v2ThenV3.quote.candidate.route.hops).toEqual([
      { kind: 'v2', tokenIn: FIX, tokenOut: MID },
      { kind: 'v3', tokenIn: MID, tokenOut: WETN, fee: 500 },
    ])
    /*
      A mixed route has no single protocol to name, so each hop names itself, in
      order — the same words the mini-router's own mixed candidates carry, so the
      Swap screen does not change wording depending on which router answered.
    */
    expect(v3ThenV2.quote.candidate.label).toBe('V3 0.3% → V2')
    expect(v2ThenV3.quote.candidate.label).toBe('V2 → V3 0.05%')
    const mixedAddresses: QuoteAddresses = { quoterV2: MID, mixedRouteQuoter: MID2, v2Router02: MID, bases: [MID] }
    const onChain = new Set(candidates(FIX, WETN, mixedAddresses, { mixed: true }).map((c) => c.label))
    expect(onChain.has('V3 0.3% → V2')).toBe(true)
    expect(onChain.has('V2 → V3 0.3%')).toBe(true)
    // Three hops, two runs: the kind is about mixing, not about length.
    const three = routed(served([[v2(FIX, MID), v3(MID, MID2, '500'), v3(MID2, WETN, '3000')]]))
    expect(three.quote.candidate.kind).toBe('mixed')
    expect(parseQuote(served([[v3(FIX, MID, '3000'), v2(MID, WETN)]]), { ...input, tradeType: 'EXACT_OUTPUT' })).toEqual({
      kind: 'none',
      reason: 'mixed exact-out',
    })
    expect(routed(served([[v3(FIX, WETN)]]), { ...input, tradeType: 'EXACT_OUTPUT' }).quote.amountOut).toBe(OUT)
    expect(three.quote.candidate.label).toBe('V2 → V3 0.05% → V3 0.3%')
    // And a single-protocol route is labelled exactly as it was.
    expect(routed(served([[v3(FIX, MID, '500'), v3(MID, WETN, '3000')]])).quote.candidate.label).toBe('V3 0.05% → 0.3%')
    expect(routed(served([[v2(FIX, MID), v2(MID, WETN)]])).quote.candidate.label).toBe('V2 via')
  })

  it('a route that does not start at the token being sold', () => {
    expect(parseQuote(served([[v3(MID, WETN, '3000')]]), input)).toEqual({ kind: 'none', reason: 'wrong tokenIn' })
  })

  it('a route that does not end at the token being bought', () => {
    expect(parseQuote(served([[v3(FIX, MID, '3000')]]), input)).toEqual({ kind: 'none', reason: 'wrong tokenOut' })
  })

  it('a two-hop route whose middle does not join up', () => {
    expect(parseQuote(served([[v3(FIX, MID, '500'), v3(MID2, WETN, '3000')]]), input)).toEqual({ kind: 'none', reason: 'broken path' })
  })

  it('a hop whose endpoints are not addresses, or are the same token twice', () => {
    expect(parseQuote(served([[{ ...v3(FIX, WETN), tokenIn: tok('0x1111' as Hex) }]]), input)).toEqual({ kind: 'none', reason: 'bad hop' })
    expect(parseQuote(served([[{ ...v3(FIX, WETN), tokenOut: { address: `0x${'z'.repeat(40)}` } }]]), input).kind).toBe('none')
    expect(parseQuote(served([[{ ...v3(FIX, WETN), tokenIn: FIX }]]), input).kind).toBe('none')
    expect(parseQuote(served([[{ ...v3(FIX, WETN), tokenOut: null }]]), input).kind).toBe('none')
    expect(parseQuote(served([[v3(FIX, FIX)]]), { ...input, tokenOut: FIX }).kind).toBe('none')
  })
})

const QUOTER_URL = `https://electroswap.io${DEFAULT_QUOTER_PATH}`
const KEY = 'test-wallet-key'
const NOW = 1_780_000_000_000

interface Harness {
  readonly quoter: Quoter
  readonly clock: { now: number }
  readonly calls: ReadonlyArray<{ url: string; init: RequestInit | undefined }>
}

type Serve = (call: number, init: RequestInit | undefined) => Response | Promise<Response>

function harness(serve: Serve): Harness {
  const clock = { now: NOW }
  const calls: Array<{ url: string; init: RequestInit | undefined }> = []
  const fetchImpl: typeof fetch = async (url, init) => {
    calls.push({ url: String(url), init })
    return serve(calls.length, init)
  }
  return { quoter: new Quoter({ fetch: fetchImpl, url: QUOTER_URL, key: KEY, now: () => clock.now }), clock, calls }
}

const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A direct V3 pool, echoing whatever amount was asked for. */
const pool: Serve = (_call, init) => {
  const sent = JSON.parse(String(init?.body ?? '{}')) as { amount?: string }
  return json(served([[v3(FIX, WETN, '3000')]], { amount: sent.amount ?? '' }))
}

describe('Quoter.route around the network', () => {
  it('asks for one unsplit EXACT_INPUT on V2, V3 and MIXED, with the key and the recipient the service reads unguarded', async () => {
    const h = harness(pool)
    expect((await h.quoter.route(input)).kind).toBe('route')
    expect(h.calls).toHaveLength(1)
    const call = h.calls[0]
    if (!call) throw new Error('unreachable')
    expect(DEFAULT_QUOTER_PATH).toBe('/routing/quote')
    expect(call.url).toBe(QUOTER_URL)
    expect(call.init?.method).toBe('POST')
    const headers = new Headers(call.init?.headers)
    expect(headers.get('content-type')).toBe('application/json')
    // The plain key, not a MAC: this service compares it against its own list
    // and does not read X-BoltVault-Auth at all.
    expect(headers.get('x-boltvault-key')).toBe(KEY)
    const sent = JSON.parse(String(call.init?.body ?? '{}')) as { type?: unknown; tokenInChainId?: unknown; tokenOutChainId?: unknown; tokenIn?: unknown; tokenOut?: unknown; amount?: unknown; protocols?: unknown; maxSplits?: unknown; configs?: ReadonlyArray<{ recipient?: unknown }> }
    /*
      'EXACT_INPUT' verbatim. Anything else — including a misspelling — is
      silently read as EXACT_OUTPUT, and the response says nothing about which
      it answered, so the wallet would size the swap backwards.
    */
    expect(sent.type).toBe('EXACT_INPUT')
    expect(sent.tokenInChainId).toBe(ETN)
    expect(sent.tokenOutChainId).toBe(ETN)
    expect(sent.tokenIn).toBe(FIX)
    expect(sent.tokenOut).toBe(WETN)
    expect(sent.amount).toBe(AMOUNT.toString())
    /*
      MIXED is asked for now: `encodeSwap` emits one command per contiguous
      same-protocol run, so a route crossing protocols is executable and leaving
      it out of the protocol set would give up liquidity for nothing.

      `maxSplits` is the opposite bargain and has not moved. A split route
      genuinely has no encoding — one command carries one path, so there is
      nowhere to put the second leg — and encoding only the first would swap a
      fraction of the input and sweep the rest.
    */
    expect(sent.protocols).toEqual(['V2', 'V3', 'MIXED'])
    expect(sent.maxSplits).toBe(1)
    /*
      `configs` is not cosmetic: the service reads `req.body.configs[0].recipient`
      unguarded, so omitting the array is a 500 rather than a 400.
    */
    expect(sent.configs?.length).toBeGreaterThan(0)
    expect(sent.configs?.[0]?.recipient).toBe(ME)
  })

  it('asks EXACT_OUTPUT without MIXED, which the encoder cannot honour in that direction', async () => {
    const h = harness(pool)
    expect((await h.quoter.route({ ...input, tradeType: 'EXACT_OUTPUT' })).kind).toBe('route')
    const sent = JSON.parse(String(h.calls[0]?.init?.body ?? '{}')) as { type?: unknown; protocols?: unknown }
    expect(sent.type).toBe('EXACT_OUTPUT')
    expect(sent.protocols).toEqual(['V2', 'V3'])
  })

  it('a refusal is an answer of none, never a throw', async () => {
    const refusals: ReadonlyArray<{ status: number; body: unknown }> = [
      { status: 400, body: { state: 'Unsupported chain' } },
      { status: 401, body: { status: 'Unauthorized' } },
      { status: 500, body: { state: 'Error' } },
    ]
    for (const refusal of refusals) {
      const h = harness(() => json(refusal.body, refusal.status))
      await expect(h.quoter.route(input)).resolves.toEqual({ kind: 'none', reason: `http ${String(refusal.status)}` })
    }
  })

  it('a fetch that rejects, or a 200 that is not JSON, is also just none', async () => {
    const down = harness(() => Promise.reject(new Error('network down')))
    expect((await down.quoter.route(input)).kind).toBe('none')
    // A proxy's HTML error page under a 200 is the same class of event.
    const html = harness(() => new Response('<html>502</html>', { status: 200, headers: { 'content-type': 'text/html' } }))
    expect((await html.quoter.route(input)).kind).toBe('none')
  })

  /*
    The allowance is thirty requests per five minutes, so spending the rest of a
    window discovering it is still rate limited costs the quotes that come after
    it. A minute of silence is cheap: every call that declines to ask returns
    `none`, and `none` means quote on chain.
  */
  it('a 429 stops the asking for a minute, then asks again', async () => {
    const h = harness((call, init) => (call === 1 ? json({ status: 'Rate limit reached' }, 429) : pool(call, init)))
    expect(await h.quoter.route(input)).toEqual({ kind: 'none', reason: 'rate limited' })
    h.clock.now += 30_000
    expect((await h.quoter.route(input)).kind).toBe('none')
    expect(h.calls).toHaveLength(1)
    h.clock.now += 30_000
    expect((await h.quoter.route(input)).kind).toBe('route')
    expect(h.calls).toHaveLength(2)
  })

  it('two identical questions in flight share one request', async () => {
    let release: (r: Response) => void = () => undefined
    const h = harness(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve
        }),
    )
    const first = h.quoter.route(input)
    const second = h.quoter.route(input)
    release(json(served([[v3(FIX, WETN, '3000')]])))
    const [a, b] = await Promise.all([first, second])
    expect(a.kind).toBe('route')
    // One request, one answer, handed to both askers.
    expect(b).toEqual(a)
    expect(h.calls).toHaveLength(1)
  })

  /*
    Typing "1", then "12", asks two questions about the same pair and only wants
    the answer to the second. The first is stopped rather than left to hold a
    connection open, and it comes back as `superseded` — which the caller reads
    as "drop this quote", not as "the service failed, go and quote on chain".
  */
  it('a new amount for the same pair aborts the request still in flight for it', async () => {
    const aborted: boolean[] = []
    const h = harness(
      (call, init) =>
        new Promise<Response>((resolve, reject) => {
          const signal = init?.signal
          signal?.addEventListener('abort', () => {
            aborted[call - 1] = true
            reject(new DOMException('aborted', 'AbortError'))
          })
          // The second question answers; the first is never given one. The body
          // has to echo the amount actually asked about, or `parseQuote` refuses it.
          if (call === 2)
            resolve(json(served([[v3(FIX, WETN, '3000')]], { amount: (AMOUNT + 1n).toString() })))
        }),
    )
    const first = h.quoter.route(input)
    const second = h.quoter.route({ ...input, amountIn: input.amountIn + 1n })
    const [a, b] = await Promise.all([first, second])
    expect(a).toEqual({ kind: 'superseded' })
    expect(aborted[0]).toBe(true)
    expect(b.kind).toBe('route')
    expect(h.calls).toHaveLength(2)
  })

  it('does not cache a superseded answer as this question\u2019s answer', async () => {
    const h = harness(
      (call, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          if (call === 2)
            resolve(json(served([[v3(FIX, WETN, '3000')]], { amount: (AMOUNT + 1n).toString() })))
          if (call === 3) resolve(json(served([[v3(FIX, WETN, '3000')]])))
        }),
    )
    const first = h.quoter.route(input)
    await h.quoter.route({ ...input, amountIn: input.amountIn + 1n })
    expect(await first).toEqual({ kind: 'superseded' })
    // Asking the original question again must reach the service, not replay the
    // abandonment as though it were what the service said.
    const again = await h.quoter.route(input)
    expect(again.kind).toBe('route')
    expect(h.calls).toHaveLength(3)
  })

  /* Supersession is per pair: asking about a different pair cancels nothing. */
  it('a question about another pair does not abort the one in flight', async () => {
    const h = harness(
      (call, init) =>
        new Promise<Response>((resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
          // Answer the second first, so the first is still in flight when it lands.
          if (call === 2) resolve(json(served([[v3(FIX, MID, '3000')]])))
          else setTimeout(() => resolve(json(served([[v3(FIX, WETN, '3000')]]))), 5)
        }),
    )
    const first = h.quoter.route(input)
    const other = await h.quoter.route({ ...input, tokenOut: MID })
    expect(other.kind).toBe('route')
    // The FIX→WETN question was never touched by the FIX→MID one.
    expect((await first).kind).toBe('route')
  })

  it('a repeat a moment later comes from the short cache; one a few seconds later is asked again', async () => {
    const h = harness(pool)
    expect((await h.quoter.route(input)).kind).toBe('route')
    h.clock.now += 100
    expect((await h.quoter.route(input)).kind).toBe('route')
    expect(h.calls).toHaveLength(1)
    /*
      Four seconds, not more: `execute` re-quotes at sign time only once eight
      seconds have passed, and that re-quote is the one that becomes calldata —
      it must never be served from this cache.
    */
    h.clock.now += 5_000
    expect((await h.quoter.route(input)).kind).toBe('route')
    expect(h.calls).toHaveLength(2)
  })

  it('a different amount is a different question and is always asked', async () => {
    const h = harness(pool)
    expect((await h.quoter.route(input)).kind).toBe('route')
    expect((await h.quoter.route({ ...input, amountIn: AMOUNT + 1n })).kind).toBe('route')
    expect(h.calls).toHaveLength(2)
    const amounts = h.calls.map((c) => (JSON.parse(String(c.init?.body ?? '{}')) as { amount?: string }).amount)
    expect(amounts).toEqual([AMOUNT.toString(), (AMOUNT + 1n).toString()])
  })
})
