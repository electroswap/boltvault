/**
 * The routing service as the first quote (master plan §8.6).
 *
 * `POST {origin}/routing/quote` is the AlphaRouter the site itself swaps
 * through, so it walks the whole pool graph rather than the mini-router's
 * sixteen fixed candidates. A pair whose liquidity sits somewhere the
 * candidate list never reaches gets the real price instead of a worse one —
 * and when it is unreachable, slow, or answers with something the wallet
 * cannot execute, `bestRoute` still quotes on chain exactly as it did before.
 * There is no degraded state to explain to anybody.
 *
 * Everything the service returns is parsed as untrusted input, because the
 * encoder is not a validator. `encodeSwap` refuses an empty hop list and
 * nothing else: a split route, or one mixing V2 and V3 hops, encodes without
 * complaint and then reverts on chain with the user's gas. So `parseQuote`
 * below is a gate rather than a cast — a route that does not survive it is
 * discarded in favour of the on-chain quote, which is never worse than
 * shipping calldata that cannot execute.
 */
import { V3_FEES, type Hop, type RouteQuote } from '@boltvault/electroswap'
import type { Hex } from 'viem'

/** ElectroSwap mounts the quoter under `/routing`; the path is `/quote` (the interface uses the same pair). */
export const DEFAULT_QUOTER_PATH = '/routing/quote'

/** Long enough for a cold route (measured 150–600 ms), short enough that a dead host costs one beat. */
const TIMEOUT_MS = 6_000
/** After a 429 the window is five minutes wide; stop asking for a minute rather than spending the rest of it. */
const RATE_LIMIT_BACKOFF_MS = 60_000
/**
 * Long enough to absorb `execute`'s opening re-quote and a token flipped back
 * and forth, short enough that the sign-time re-quote — which only happens
 * after eight seconds have passed — can never be served from it.
 */
const CACHE_MS = 4_000
const MAX_CACHED = 32
/** Three splits × three hops is the service's own ceiling; anything longer is a malformed answer. */
const MAX_HOPS = 4

const FEES: ReadonlySet<number> = new Set<number>(V3_FEES)

export interface QuoterDeps {
  readonly fetch: typeof fetch
  /** Absolute URL of `POST /quote` on the routing service. */
  readonly url: string
  readonly key: string
  readonly now: () => number
}

export interface QuoterInput {
  readonly chainId: number
  /** Wrapped, never `native`: the service prices pools, and the wallet wraps before it routes. */
  readonly tokenIn: Hex
  readonly tokenOut: Hex
  /**
   * The independent amount. Exact-in: what is spent. Exact-out: what must
   * land. Named `amountIn` because that is the field the service echoes as
   * `quote.amount` in both directions.
   */
  readonly amountIn: bigint
  readonly recipient: Hex
  /**
   * Which side is fixed. Exact-out omits MIXED (the encoder cannot express a
   * mixed exact-output path) and reads `quote.quote` as the required spend.
   */
  readonly tradeType?: 'EXACT_INPUT' | 'EXACT_OUTPUT'
}

export type QuoterOutcome =
  /**
   * `id` is the service's own `quoteId`, which it logs beside the quote it
   * served. It is the only thing that joins a failure report back to the half
   * of the story the server already has, so it is carried even though nothing
   * in the pricing path reads it.
   */
  | { readonly kind: 'route'; readonly quote: RouteQuote; readonly cached: boolean; readonly blockNumber: string | null; readonly id: string | null }
  /** Asked and got no usable answer. The caller quotes on chain; the reason is for the log, not the user. */
  | { readonly kind: 'none'; readonly reason: string }
  /**
   * Abandoned because a newer amount for the same pair replaced it.
   *
   * Distinct from `none` on purpose: `none` means "the service could not
   * answer, quote on chain instead", and doing that for a question nobody is
   * waiting for is the exact waste this exists to stop. The caller drops the
   * whole quote instead. Owner: "cancel in flight requests if the input/output
   * number is updated."
   */
  | { readonly kind: 'superseded' }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const addr = (v: unknown): Hex | null => (typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v) ? (v.toLowerCase() as Hex) : null)
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

function bigintOf(v: unknown): bigint | null {
  if (typeof v !== 'string' || !/^\d+$/.test(v)) return null
  try {
    return BigInt(v)
  } catch {
    return null
  }
}

/** Endpoint of a hop, either side. The service nests the token object; only its address matters here. */
function hopToken(v: unknown): Hex | null {
  return isRecord(v) ? addr(v['address']) : null
}

/**
 * One split's hop list, or null.
 *
 * The service tags V3 with `type: 'v3-pool'` and V2 with `'v2-pool'`, having
 * discriminated on `fee !== undefined` when it built the response. The tag is
 * trusted for what it is and nothing more: a V3 hop still has to name a fee
 * tier that exists, because `execute` encodes `h.fee` straight into the packed
 * path and a tier with no pool behind it is a revert.
 */
function parseHops(raw: readonly unknown[]): readonly Hop[] | null {
  const hops: Hop[] = []
  for (const entry of raw) {
    if (!isRecord(entry)) return null
    const tokenIn = hopToken(entry['tokenIn'])
    const tokenOut = hopToken(entry['tokenOut'])
    if (!tokenIn || !tokenOut || same(tokenIn, tokenOut)) return null
    if (entry['type'] === 'v3-pool') {
      const fee = Number(entry['fee'])
      if (!Number.isInteger(fee) || !FEES.has(fee)) return null
      hops.push({ kind: 'v3', tokenIn, tokenOut, fee })
    } else if (entry['type'] === 'v2-pool') {
      hops.push({ kind: 'v2', tokenIn, tokenOut })
    } else {
      return null
    }
  }
  return hops
}

function kindOf(hops: readonly Hop[]): 'v2' | 'v3' | 'mixed' {
  const kinds = new Set(hops.map((h) => h.kind))
  return kinds.size === 1 ? (hops[0]?.kind ?? 'v3') : 'mixed'
}

/** One hop, named the way the mini-router names it. */
const hopLabel = (h: Hop): string => (h.kind === 'v3' ? `V3 ${h.fee / 10_000}%` : 'V2')

/** The mini-router's vocabulary, so the Swap screen reads the same whichever router answered. */
function labelFor(hops: readonly Hop[]): string {
  switch (kindOf(hops)) {
    case 'v2':
      return hops.length === 1 ? 'V2' : 'V2 via'
    case 'v3':
      return `V3 ${hops.map((h) => `${(h.kind === 'v3' ? h.fee : 0) / 10_000}%`).join(' → ')}`
    // A mixed route has no single protocol to name, so each hop names itself.
    default:
      return hops.map(hopLabel).join(' → ')
  }
}

/** The parsed body, or a reason it cannot be used. Exported for the tests, which own the sharp cases. */
export function parseQuote(body: unknown, input: QuoterInput): QuoterOutcome {
  if (!isRecord(body)) return { kind: 'none', reason: 'not an object' }
  // A no-route is HTTP 200 with `{state:'Not found'}` — the status line says nothing.
  if (typeof body['state'] === 'string') return { kind: 'none', reason: `state ${body['state']}` }
  const quote = body['quote']
  if (!isRecord(quote)) return { kind: 'none', reason: 'no quote' }
  /*
    The amount has to come back unchanged.

    `type` is not validated by the service: anything that is not the literal
    string 'EXACT_INPUT' is silently treated as EXACT_OUTPUT, and the response
    names no trade type, so a typo here would be undetectable from the payload
    — the wallet would read an input amount as an output and size the swap
    backwards. The echoed `amount` is the one field that tells them apart, and
    it also catches a cache key collision, which is a live risk: the service's
    key is the tuple (type, tokenIn, tokenOut, amount) and nothing else.
  */
  if (quote['amount'] !== input.amountIn.toString()) return { kind: 'none', reason: 'amount echo mismatch' }
  const amountOut = bigintOf(quote['quote'])
  if (amountOut === null || amountOut <= 0n) return { kind: 'none', reason: 'no output' }
  const splits = quote['route']
  if (!Array.isArray(splits)) return { kind: 'none', reason: 'no route' }
  /*
    A split route is a correct answer the wallet cannot act on. `encodeSwap`
    emits one command carrying one path; there is nowhere to put a second leg,
    and encoding only the first would swap a fraction of the input and sweep the
    rest. The request asks for `maxSplits: 1`; this is the check that does not
    depend on the service honouring it.
  */
  if (splits.length !== 1) return { kind: 'none', reason: `${String(splits.length)} splits` }
  const raw: unknown = splits[0]
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_HOPS) return { kind: 'none', reason: 'bad hop list' }
  const hops = parseHops(raw)
  if (!hops || hops.length === 0) return { kind: 'none', reason: 'bad hop' }
  // The path has to start where the money is, end where the user wants it, and join up in between.
  if (!same(hops[0]?.tokenIn ?? '', input.tokenIn)) return { kind: 'none', reason: 'wrong tokenIn' }
  if (!same(hops[hops.length - 1]?.tokenOut ?? '', input.tokenOut)) return { kind: 'none', reason: 'wrong tokenOut' }
  for (let i = 1; i < hops.length; i++) if (!same(hops[i - 1]?.tokenOut ?? '', hops[i]?.tokenIn ?? '')) return { kind: 'none', reason: 'broken path' }
  /*
    Exact-out cannot encode a mixed path: working backwards through protocol
    boundaries has no `CONTRACT_BALANCE` equivalent. A served mixed route is
    a correct answer the wallet cannot sign, so it is discarded and the
    mini-router prices a V2/V3 path instead.
  */
  if ((input.tradeType ?? 'EXACT_INPUT') === 'EXACT_OUTPUT' && kindOf(hops) === 'mixed') {
    return { kind: 'none', reason: 'mixed exact-out' }
  }

  const gas = bigintOf(quote['gasUseEstimate'])
  return {
    kind: 'route',
    quote: {
      candidate: { route: { hops }, kind: kindOf(hops), label: labelFor(hops) },
      amountOut,
      // The service's own estimate when it gave one; otherwise the mini-router's per-hop figure.
      gasEstimate: gas !== null && gas > 0n ? gas : 150_000n * BigInt(hops.length),
    },
    cached: body['cached'] === true,
    blockNumber: typeof quote['blockNumber'] === 'string' ? quote['blockNumber'] : null,
    id: typeof body['quoteId'] === 'string' ? body['quoteId'] : null,
  }
}

/**
 * The routing service, asked politely.
 *
 * The service allows thirty requests per five minutes per (key, address), and
 * the Swap screen re-quotes on a 250 ms debounce while someone types an
 * amount, so the budget is real. Identical questions in flight share one
 * answer, a recent answer is reused for a few seconds, and a 429 stops the
 * asking for a minute instead of spending the rest of the window discovering
 * it is still rate limited. None of that can starve the wallet: every path
 * that declines to ask returns `none`, and `none` means quote on chain.
 */
export class Quoter {
  private readonly inflight = new Map<string, Promise<QuoterOutcome>>()
  private readonly recent = new Map<string, { at: number; outcome: QuoterOutcome }>()
  /**
   * The request currently in flight for each pair, so a new amount can stop it.
   *
   * Keyed by the pair rather than the whole question: typing "1", "12", "123"
   * asks three different questions about the same two tokens, and only the last
   * one has anybody waiting for it. The debounce upstream stops most of these
   * from starting at all; this stops the ones that did.
   */
  private readonly pending = new Map<string, { key: string; abort: AbortController }>()
  private blockedUntil = 0

  constructor(private readonly deps: QuoterDeps) {}

  async route(input: QuoterInput): Promise<QuoterOutcome> {
    const now = this.deps.now()
    if (now < this.blockedUntil) return { kind: 'none', reason: 'rate limited' }
    const pair = `${String(input.chainId)}|${input.tokenIn.toLowerCase()}|${input.tokenOut.toLowerCase()}`
    const type = input.tradeType ?? 'EXACT_INPUT'
    const key = `${pair}|${type}|${input.amountIn.toString()}`
    const hit = this.recent.get(key)
    if (hit && now - hit.at < CACHE_MS) return hit.outcome
    const running = this.inflight.get(key)
    if (running) return running
    /*
      A new amount for this pair replaces whatever was asked about it last.

      The old request has nobody waiting for it — the screen threw its result
      away the moment the field changed — so it is stopped rather than left to
      hold a connection open on a phone radio for the rest of its timeout.
      Asking about the same amount again is NOT a supersession: that is the
      `inflight` share above, which returns the request already running.
    */
    const previous = this.pending.get(pair)
    if (previous && previous.key !== key) previous.abort.abort()
    const abort = new AbortController()
    this.pending.set(pair, { key, abort })
    const run = this.ask(input, abort.signal).then((outcome) => {
      // A superseded answer is not an answer: caching it would serve it to the
      // next person who asks this exact question.
      if (outcome.kind !== 'superseded') {
        if (this.recent.size >= MAX_CACHED) this.recent.clear()
        this.recent.set(key, { at: this.deps.now(), outcome })
      }
      return outcome
    })
    this.inflight.set(key, run)
    try {
      return await run
    } finally {
      this.inflight.delete(key)
      if (this.pending.get(pair)?.key === key) this.pending.delete(pair)
    }
  }

  private async ask(input: QuoterInput, signal: AbortSignal): Promise<QuoterOutcome> {
    try {
      /*
        `configs` is mandatory and `configs[0].recipient` is read unguarded, so
        omitting it is a 500 rather than a 400. The service uses the address for
        its own log line only — it does not enter the quote — but it has to be
        there.

        `protocols` is only read at the top level. The interface nests it under
        `configs[0]`, where it is silently ignored and the router falls back to
        this same set. MIXED is asked for deliberately: `encodeSwap` emits one
        command per contiguous same-protocol run, so a route that crosses
        protocols is executable, and refusing to ask for one would leave
        liquidity on the table for no reason. `maxSplits` is different — a split
        route genuinely has no encoding, so the request caps it at one.
      */
      const type = input.tradeType ?? 'EXACT_INPUT'
      /*
        MIXED is executable exact-in (`encodeSwap` emits one command per
        contiguous protocol run) and a revert exact-out (`encodeSwapExactOut`
        refuses a mixed path). Asking for it in the exact-out direction would
        be asking for a price the wallet cannot honour.
      */
      const protocols = type === 'EXACT_OUTPUT' ? ['V2', 'V3'] : ['V2', 'V3', 'MIXED']
      const body = JSON.stringify({
        tokenInChainId: input.chainId,
        tokenOutChainId: input.chainId,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        amount: input.amountIn.toString(),
        type,
        protocols,
        maxSplits: 1,
        configs: [{ recipient: input.recipient }],
      })
      /*
        The plain key, not a signature.

        Every other call the wallet makes sends a per-request MAC and never the
        key itself (§9.1, `apiAuth`). The routing service predates that: it does
        a constant-time compare of the presented key against its own list and
        does not read `X-BoltVault-Auth` at all. Sending the key here is
        therefore the only thing that works — and it is what the key is for, a
        client identifier that every install ships, which buys rate-limit
        standing rather than trust. Without it the origin check refuses an
        extension outright as a phishing site.
      */
      const response = await this.deps.fetch(this.deps.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json', 'x-boltvault-key': this.deps.key },
        body,
        // ACAO is `*` on this service, which is incompatible with sending credentials.
        credentials: 'omit',
        // Either reason to stop: the service taking too long, or nobody wanting the answer any more.
        signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
      })
      if (response.status === 429) {
        this.blockedUntil = this.deps.now() + RATE_LIMIT_BACKOFF_MS
        return { kind: 'none', reason: 'rate limited' }
      }
      if (!response.ok) return { kind: 'none', reason: `http ${String(response.status)}` }
      return parseQuote(await response.json(), input)
    } catch (error) {
      // Aborted by a newer amount, not by the clock: the caller drops the quote
      // rather than falling back to the chain for a question nobody asked.
      if (signal.aborted) return { kind: 'superseded' }
      return { kind: 'none', reason: error instanceof Error ? error.name : 'failed' }
    }
  }
}
