/**
 * What this wallet knows about one of its own operations that did not work:
 * `POST {apiOrigin}/api/wallet/client-failure` (the schema lives in
 * `services/api`, `src/http/routes/clientFailure.ts`).
 *
 * The quoter logs every quote it serves. What it cannot see is what happened
 * next — whether the wallet used that quote or routed for itself, what it
 * encoded, and how the chain answered. A fallback that fails is invisible from
 * the server side: the only evidence is a user saying "it didn't work". This
 * closes that gap with structure rather than prose, so the useful parts of a
 * failure survive the trip.
 *
 * Deliberately generic. `operation` names what was being attempted and the
 * common fields — stage, kind, the calldata, the account's state — describe
 * almost any of them; a swap carries a typed block because its shape is worth
 * knowing in full. The next thing worth reporting needs a caller and nothing
 * else.
 *
 * Four rules, and none of them is decorative.
 *
 * **Consent.** A report carries the account address and its balances, which is
 * more personal than the stack trace `/api/wallet/crash` takes. It rides the
 * same opt-in — `settings.crashReports`, off by default — and `enabled()` is
 * checked on every single send rather than captured once, because a user who
 * turns diagnostics off means *now*.
 *
 * **Never a signature.** The Universal Router calldata for a permit-carrying
 * swap contains a live Permit2 signature, and a swap that *failed* has not
 * consumed its nonce, so the signature is still spendable until its deadline.
 * `stripPermitSignatures` blanks it before the body is built. The server strips
 * it again on arrival, structurally; that is defence in depth, not a reason for
 * the client to be careless — the client is the half that knows the layout.
 *
 * **Never a user rejection.** Someone declining a sheet is not a failure and is
 * not telemetry. `kind: 'rejected'` exists in the schema for the sake of
 * completeness; `send` refuses to file one.
 *
 * **Never make a failure worse.** Nothing here throws, nothing here is awaited
 * by the path it reports on, and nothing is retried: a swap that just reverted
 * must not also spend six seconds of the user's time, and a wallet in trouble
 * must not turn into a load generator. Same posture as `FeeLadders`, and for
 * the same reason.
 */
import { UR_COMMAND } from '@boltvault/security'
import {
  decodeAbiParameters,
  decodeFunctionData,
  encodeAbiParameters,
  encodeFunctionData,
  parseAbi,
  parseAbiParameters,
  type Hex,
} from 'viem'
import { authHeaders } from './apiAuth'

/** The path on the ElectroSwap API; `{apiOrigin}` in front of it. */
export const CLIENT_FAILURE_PATH = '/api/wallet/client-failure'

/*
  Bounds mirrored from the server's zod schema.

  They are duplicated rather than imported because `services/api` is a separate
  repository: there is no module to import, and a report that overruns one of
  these is dropped on arrival with a 204, which looks exactly like a report that
  was never sent. `normalise` clamps to them so a long revert string costs a
  truncation instead of the whole report. If the two ever drift, the tests in
  `tests/clientFailureApi.test.ts` — which mirror the schema itself — are what
  fails, rather than a silent hole in the logs.
*/
const MAX_VERSION = 64
const MAX_MESSAGE = 2_000
const MAX_REVERT_REASON = 256
const MAX_REVERT_SELECTOR = 10
const MAX_TX_HASH = 66
const MAX_BLOCK_NUMBER = 32
const MAX_QUOTE_ID = 64
const MAX_FALLBACK_REASON = 256
const MAX_SYMBOL = 32
const MAX_DECIMALS = 36
const MAX_BIPS = 10_000
const MAX_HOPS = 12
const MAX_SPLITS = 8
const MAX_DATA_CHARS = 65_536
const MAX_DETAIL_KEYS = 32
const MAX_DETAIL_KEY = 64
const MAX_DETAIL_VALUE = 512

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
/** Raw integer amounts as decimal strings, the way every wallet boundary in this codebase carries them. */
const DECIMAL = /^[0-9]{1,78}$/
const EVEN_HEX = /^0x([0-9a-fA-F]{2})*$/

export type FailureClient = 'extension-worker' | 'extension-page' | 'mobile' | 'interface'
/** What the user was trying to do. Add to this list rather than inventing a second endpoint. */
export type FailureOperation =
  | 'swap'
  | 'bridge'
  | 'limit-order'
  | 'send'
  | 'approve'
  | 'wrap'
  | 'nft'
  | 'farm'
  | 'launchpad'
  | 'sync'
  | 'other'
/** Where in the attempt it stopped. `quote` and `simulate` precede any signature; the rest follow one. */
export type FailureStage =
  'quote' | 'approve' | 'permit' | 'sign' | 'simulate' | 'broadcast' | 'receipt'
export type FailureKind = 'revert' | 'rejected' | 'timeout' | 'network' | 'validation' | 'unknown'
export type QuoteSource = 'routing-api' | 'client-fallback' | 'onchain-mini-router' | 'unknown'
/** What the fee-on-transfer detector said about one side, including that it could not say. */
/** Mirrors the endpoint's own enum. `not-answered` is the call failing, which is not a statement about the token. */
export type TaxProbeStatus =
  'measured' | 'no-pair' | 'pair-too-thin' | 'probe-reverted' | 'not-answered' | 'no-detector'

export interface FailureTaxProbe {
  readonly status: TaxProbeStatus
  readonly buyFeeBps: number | null
  readonly sellFeeBps: number | null
  readonly sellReverted: boolean | null
  readonly externalTransferFailed: boolean | null
  readonly feeTakenOnTransfer: boolean | null
}

export interface FailureToken {
  /** A contract address, or the literal `'native'`. */
  readonly address: string
  readonly symbol: string
  readonly decimals: number
}

export interface FailureHop {
  readonly protocol: 'v2' | 'v3'
  readonly tokenIn: string
  readonly tokenOut: string
  /** Null on a V2 hop, which has no tier. */
  readonly feeTier: number | null
}

/** The swap-shaped part of a swap failure. Absent for any other operation. */
export interface SwapFailureDetail {
  readonly quote: {
    /** The quoter's own `quoteId`, which is what joins this report to its half of the story. */
    readonly id: string | null
    readonly source: QuoteSource
    readonly cached: boolean | null
    readonly blockNumber: string | null
    /** Why the routing service was not used, when it was not. */
    readonly fallbackReason: string | null
  }
  readonly trade: {
    readonly type: 'exact-in' | 'exact-out'
    readonly tokenIn: FailureToken
    readonly tokenOut: FailureToken
    readonly amountIn: string
    readonly slippageBips: number
    /** Extra slippage the wallet folded in for a transfer tax, if any. */
    readonly taxBips: number | null
  }
  /** What the quote promised, so a bad quote can be told from a bad execution. */
  readonly quoted: {
    readonly amountOut: string | null
    readonly minimumOut: string | null
    readonly gasEstimate: string | null
    readonly priceImpactPct: number | null
  }
  /** The path as encoded. Null when the failure happened before there was one. */
  readonly route: readonly FailureHop[] | null
  readonly splits: number | null
  readonly tax: { readonly in: FailureTaxProbe | null; readonly out: FailureTaxProbe | null }
  readonly fee: {
    readonly bips: number
    readonly sink: string | null
    /** True when the fee came out of the input because the output could not pass through the router's custody. */
    readonly onInput: boolean
  } | null
}

/** Scalars only: these values reach a log, and a nested object would let a caller decide how much of the disk it takes. */
export type FailureDetailValue = string | number | boolean | null

export interface ClientFailureReport {
  readonly client: FailureClient
  readonly version: string
  readonly at: number
  readonly chainId: number
  readonly operation: FailureOperation
  readonly failure: {
    readonly stage: FailureStage
    readonly kind: FailureKind
    /** Free text, scrubbed on arrival exactly as a crash report is. */
    readonly message: string
    readonly revertReason: string | null
    /** A four-byte custom-error selector, when the revert carried one rather than a string. */
    readonly revertSelector: string | null
    readonly txHash: string | null
    readonly blockNumber: string | null
    readonly gasUsed: string | null
  }
  /** The bytes, so the attempt can be replayed on a fork. Signatures are stripped before this leaves the wallet. */
  readonly call: { readonly to: string; readonly value: string; readonly data: string } | null
  /*
    The account, and what it held at the time.

    A revert cannot be reproduced without them — most failures are an allowance
    or a balance, not a contract bug — and asking the user for them is the thing
    this endpoint exists to stop doing. It is also the most personal field here,
    which is why none of this is sent unless diagnostics are on.
  */
  readonly state: {
    readonly account: string
    readonly balanceIn: string | null
    readonly nativeBalance: string | null
    readonly erc20Allowance: string | null
    readonly permit2Amount: string | null
    readonly permit2Expiration: number | null
  } | null
  /** Present for `operation: 'swap'`; absent otherwise. */
  readonly swap?: SwapFailureDetail | null
  /** Anything an operation without a typed block of its own needs to say. */
  readonly detail?: Readonly<Record<string, FailureDetailValue>> | null
}

/** The envelope minus the three fields the reporter stamps for itself. */
export type ClientFailureInput = Omit<ClientFailureReport, 'client' | 'version' | 'at'>

const UR_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
])
const PERMIT_SINGLE = parseAbiParameters(
  '((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit, bytes signature',
)
const PERMIT_BATCH = parseAbiParameters(
  '((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permit, bytes signature',
)
/** The two commands whose input carries a signature, from the pinned table in @boltvault/security. */
const SIGNATURE_BEARING: ReadonlySet<number> = new Set<number>([
  UR_COMMAND.PERMIT2_PERMIT,
  UR_COMMAND.PERMIT2_PERMIT_BATCH,
])

/**
 * Blank the signature out of every permit command, keeping the rest.
 *
 * The token, amount, expiration, nonce and spender are the debuggable part —
 * "the permit was for 100 and the swap wanted 101" is the whole answer to a
 * class of failures — and the signature is the part that must never be written
 * down. It is bound to one token, amount and nonce, but a failed swap did not
 * consume that nonce, so the signature stays spendable until its deadline.
 *
 * Anything that does not decode as a Universal Router `execute` comes back
 * unchanged: it is some other call (an ERC-20 approve, say), and this has no
 * business rewriting it.
 */
export function stripPermitSignatures(data: string): string {
  let decoded: { functionName: string; args: readonly unknown[] }
  try {
    decoded = decodeFunctionData({ abi: UR_ABI, data: data as Hex }) as {
      functionName: string
      args: readonly unknown[]
    }
  } catch {
    return data
  }
  if (decoded.functionName !== 'execute') return data
  const [commandsHex, inputs, deadline] = decoded.args as [Hex, readonly Hex[], bigint]
  const bytes = commandsHex.slice(2).match(/.{2}/g) ?? []
  /*
    0x3f, the mask @boltvault/security pins from the router SDK: bit 7 is the
    allow-revert flag and bit 6 is unallocated. The server masks 0x7f, which
    agrees on every command that exists today and would miss one carrying bit 6.
    Erring wider only ever strips more, which is the safe direction to be wrong
    in when the thing being stripped is a live signature.
  */
  const carrying = bytes
    .map((b, i) => ({ command: Number.parseInt(b, 16) & 0x3f, i }))
    .filter(({ command }) => SIGNATURE_BEARING.has(command))
  if (carrying.length === 0) return data
  const next = [...inputs]
  for (const { command, i } of carrying) {
    const input = inputs[i]
    if (input === undefined) continue
    next[i] = blankSignature(command, input)
  }
  return encodeFunctionData({
    abi: UR_ABI,
    functionName: 'execute',
    args: [commandsHex, next, deadline],
  })
}

/** Keep the permit's terms, drop its signature. An input that will not decode is dropped whole rather than guessed at. */
function blankSignature(command: number, input: Hex): Hex {
  try {
    if (command === UR_COMMAND.PERMIT2_PERMIT_BATCH) {
      const [permit] = decodeAbiParameters(PERMIT_BATCH, input)
      return encodeAbiParameters(PERMIT_BATCH, [permit, '0x'])
    }
    const [permit] = decodeAbiParameters(PERMIT_SINGLE, input)
    return encodeAbiParameters(PERMIT_SINGLE, [permit, '0x'])
  } catch {
    return '0x'
  }
}

const clamp = (v: string, max: number): string => (v.length > max ? v.slice(0, max) : v)
const clampOrNull = (v: string | null, max: number): string | null =>
  v === null ? null : clamp(v, max)
const addressOrNull = (v: string | null): string | null =>
  v !== null && ADDRESS.test(v) ? v : null
const amountOrNull = (v: string | null): string | null => (v !== null && DECIMAL.test(v) ? v : null)
const intIn = (v: number, lo: number, hi: number): number =>
  Number.isInteger(v) ? Math.min(Math.max(v, lo), hi) : lo
const intInOrNull = (v: number | null, lo: number, hi: number): number | null =>
  v === null || !Number.isInteger(v) ? null : Math.min(Math.max(v, lo), hi)
const finiteOrNull = (v: number | null): number | null =>
  v !== null && Number.isFinite(v) ? v : null
const bipsOrNull = (v: number | null): number | null => intInOrNull(v, 0, MAX_BIPS)

function tokenOrNull(t: FailureToken): FailureToken | null {
  if (t.address !== 'native' && !ADDRESS.test(t.address)) return null
  return {
    address: t.address,
    symbol: clamp(t.symbol, MAX_SYMBOL),
    decimals: intIn(t.decimals, 0, MAX_DECIMALS),
  }
}

function probeOrNull(p: FailureTaxProbe | null): FailureTaxProbe | null {
  if (p === null) return null
  return {
    status: p.status,
    buyFeeBps: bipsOrNull(p.buyFeeBps),
    sellFeeBps: bipsOrNull(p.sellFeeBps),
    sellReverted: p.sellReverted,
    externalTransferFailed: p.externalTransferFailed,
    feeTakenOnTransfer: p.feeTakenOnTransfer,
  }
}

/**
 * The swap block, or null when it cannot be made to fit.
 *
 * Null rather than dropping the whole report: an envelope still says which
 * stage failed and how, and the server refuses a report whose *any* part is
 * malformed — so a swap block the wallet cannot vouch for would cost the stage
 * and the message too.
 */
function swapOrNull(s: SwapFailureDetail): SwapFailureDetail | null {
  const tokenIn = tokenOrNull(s.trade.tokenIn)
  const tokenOut = tokenOrNull(s.trade.tokenOut)
  const amountIn = amountOrNull(s.trade.amountIn)
  if (!tokenIn || !tokenOut || amountIn === null) return null
  let route: FailureHop[] | null = null
  if (s.route !== null) {
    route = []
    for (const hop of s.route.slice(0, MAX_HOPS)) {
      if (!ADDRESS.test(hop.tokenIn) || !ADDRESS.test(hop.tokenOut)) return null
      route.push({
        protocol: hop.protocol,
        tokenIn: hop.tokenIn,
        tokenOut: hop.tokenOut,
        feeTier: hop.feeTier === null || !Number.isInteger(hop.feeTier) ? null : hop.feeTier,
      })
    }
  }
  return {
    quote: {
      id: clampOrNull(s.quote.id, MAX_QUOTE_ID),
      source: s.quote.source,
      cached: s.quote.cached,
      blockNumber: clampOrNull(s.quote.blockNumber, MAX_BLOCK_NUMBER),
      fallbackReason: clampOrNull(s.quote.fallbackReason, MAX_FALLBACK_REASON),
    },
    trade: {
      type: s.trade.type,
      tokenIn,
      tokenOut,
      amountIn,
      slippageBips: intIn(s.trade.slippageBips, 0, MAX_BIPS),
      taxBips: bipsOrNull(s.trade.taxBips),
    },
    quoted: {
      amountOut: amountOrNull(s.quoted.amountOut),
      minimumOut: amountOrNull(s.quoted.minimumOut),
      gasEstimate: amountOrNull(s.quoted.gasEstimate),
      priceImpactPct: finiteOrNull(s.quoted.priceImpactPct),
    },
    route,
    splits: intInOrNull(s.splits, 1, MAX_SPLITS),
    tax: { in: probeOrNull(s.tax.in), out: probeOrNull(s.tax.out) },
    fee:
      s.fee === null
        ? null
        : {
            bips: intIn(s.fee.bips, 0, MAX_BIPS),
            sink: addressOrNull(s.fee.sink),
            onInput: s.fee.onInput,
          },
  }
}

function detailOrNull(
  d: Readonly<Record<string, FailureDetailValue>>,
): Record<string, FailureDetailValue> {
  const out: Record<string, FailureDetailValue> = {}
  for (const [key, value] of Object.entries(d).slice(0, MAX_DETAIL_KEYS)) {
    if (typeof value === 'string') out[clamp(key, MAX_DETAIL_KEY)] = clamp(value, MAX_DETAIL_VALUE)
    else if (typeof value === 'number')
      out[clamp(key, MAX_DETAIL_KEY)] = Number.isFinite(value) ? value : null
    else out[clamp(key, MAX_DETAIL_KEY)] = value
  }
  return out
}

/**
 * Bring a report inside the server's bounds, or say it cannot be.
 *
 * Every field the schema bounds is clamped here rather than at the call sites,
 * so a caller can hand over whatever it has and a two-kilobyte revert string
 * costs a truncation instead of the entire report. The few things that cannot
 * be clamped into validity — a chain id of zero, an account that is not an
 * address — return null, because a report the server will refuse is one the
 * wallet should not have spent a request on.
 *
 * Exported for the tests, which check it against a mirror of the real schema.
 */
export function normalise(report: ClientFailureReport): ClientFailureReport | null {
  if (!Number.isInteger(report.chainId) || report.chainId <= 0) return null
  if (!Number.isInteger(report.at) || report.at < 0) return null
  /*
    A rejection never travels, whatever built it.

    The swap path already drops these before they get here; this is the backstop
    that makes "the wallet does not report user rejections" a property of the
    reporter rather than a habit of its callers.
  */
  if (report.failure.kind === 'rejected') return null
  const state =
    report.state === null || !ADDRESS.test(report.state.account)
      ? null
      : {
          account: report.state.account,
          balanceIn: amountOrNull(report.state.balanceIn),
          nativeBalance: amountOrNull(report.state.nativeBalance),
          erc20Allowance: amountOrNull(report.state.erc20Allowance),
          permit2Amount: amountOrNull(report.state.permit2Amount),
          permit2Expiration:
            report.state.permit2Expiration === null ||
            !Number.isInteger(report.state.permit2Expiration) ||
            report.state.permit2Expiration < 0
              ? null
              : report.state.permit2Expiration,
        }
  const callTo = report.call === null ? null : addressOrNull(report.call.to)
  const callValue = report.call === null ? null : amountOrNull(report.call.value)
  const call =
    report.call === null ||
    callTo === null ||
    callValue === null ||
    !EVEN_HEX.test(report.call.data) ||
    report.call.data.length > MAX_DATA_CHARS
      ? null
      : { to: callTo, value: callValue, data: report.call.data }
  return {
    client: report.client,
    version: clamp(report.version, MAX_VERSION),
    at: report.at,
    chainId: report.chainId,
    operation: report.operation,
    failure: {
      stage: report.failure.stage,
      kind: report.failure.kind,
      message: clamp(report.failure.message, MAX_MESSAGE),
      revertReason: clampOrNull(report.failure.revertReason, MAX_REVERT_REASON),
      revertSelector: clampOrNull(report.failure.revertSelector, MAX_REVERT_SELECTOR),
      txHash: clampOrNull(report.failure.txHash, MAX_TX_HASH),
      blockNumber: clampOrNull(report.failure.blockNumber, MAX_BLOCK_NUMBER),
      gasUsed: amountOrNull(report.failure.gasUsed),
    },
    call,
    state,
    ...(report.swap === undefined
      ? {}
      : { swap: report.swap === null ? null : swapOrNull(report.swap) }),
    ...(report.detail === undefined
      ? {}
      : { detail: report.detail === null ? null : detailOrNull(report.detail) }),
  }
}

export interface ClientFailureDeps {
  readonly fetch: typeof fetch
  /** Absolute URL of `POST /api/wallet/client-failure`. */
  readonly url: string
  /**
   * The wallet key (§9.1). Required, not optional: the route answers 401
   * without a signature, so a keyless build has nothing to say and should not
   * construct a reporter at all.
   */
  readonly key: string
  readonly now: () => number
  readonly client: FailureClient
  readonly version: string
  /**
   * Diagnostics are on. Asked on every send rather than captured once, because
   * a user who turns the toggle off means from now, not from next launch.
   */
  readonly enabled: () => Promise<boolean>
}

/** The same six seconds `prices.ts` and `feeLadder.ts` use; a dead host costs one beat, in the background. */
const TIMEOUT_MS = 6_000
/**
 * The route allows thirty a minute for the whole install. This is well under
 * it, so one screen retrying in a loop cannot spend the budget a genuinely
 * interesting failure would have needed — and there is no retry here at all: a
 * report that did not arrive is gone, which is the correct trade for something
 * the user did not ask for.
 */
const MAX_PER_WINDOW = 10
const WINDOW_MS = 60_000

export class ClientFailures {
  private readonly sentAt: number[] = []

  constructor(private readonly deps: ClientFailureDeps) {}

  /**
   * File a report, eventually, if it is allowed and worth filing.
   *
   * Returns `void` rather than a promise on purpose: there is no caller that
   * should be able to await this, and the one thing a failure reporter must
   * never do is add a second failure to the first.
   */
  report(input: ClientFailureInput): void {
    void this.send(input)
  }

  /** The body of `report`, separated so the tests can await what the wallet deliberately does not. */
  async send(input: ClientFailureInput): Promise<void> {
    try {
      // Declining a sheet is a decision, not a defect. Checked before consent so
      // a rejection does not even read the settings document.
      if (input.failure.kind === 'rejected') return
      if (!(await this.deps.enabled())) return
      const now = this.deps.now()
      while (this.sentAt.length > 0 && now - (this.sentAt[0] as number) > WINDOW_MS)
        this.sentAt.shift()
      if (this.sentAt.length >= MAX_PER_WINDOW) return
      const report = normalise({
        ...input,
        client: this.deps.client,
        version: this.deps.version,
        at: now,
      })
      if (!report) return
      /*
        The signature comes out here, at the last possible moment, so no path
        into this class can forget to do it — including ones written later. It
        is a no-op on calldata that carries no permit.
      */
      const body = JSON.stringify(
        report.call === null
          ? report
          : { ...report, call: { ...report.call, data: stripPermitSignatures(report.call.data) } },
      )
      this.sentAt.push(now)
      // The key never travels; a per-request signature does (§9.1, `apiAuth`).
      await this.deps.fetch(this.deps.url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...authHeaders({ key: this.deps.key, method: 'POST', url: this.deps.url, body, now }),
        },
        body,
        /*
          The extension's worker can be torn down the moment a flow stops
          reporting progress, which is exactly when this fires. `keepalive` is
          what `crash.ts` uses for the same reason.
        */
        keepalive: true,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      })
    } catch {
      // The route answers 204 to everything and there is nothing to retry. A
      // reporter that threw here would turn one failure into two.
    }
  }
}

/**
 * The reporter for this build, or nothing at all.
 *
 * Without a key there is nothing to ask: the route answers 401 to an unsigned
 * request, so a keyless build would spend a request per failure to be told so —
 * the same gate `FeeLadders` and `Quoter` are behind, for the same reason.
 *
 * `undefined` rather than a reporter that quietly does nothing, so the absence
 * is visible at every call site: `SwapDeps.failures` is optional for exactly
 * this reason, and a dependency that is present but inert is the kind of thing
 * that gets debugged twice.
 */
export function clientFailuresFor(
  deps: Omit<ClientFailureDeps, 'key'> & { readonly key?: string | undefined },
): ClientFailures | undefined {
  return deps.key ? new ClientFailures({ ...deps, key: deps.key }) : undefined
}
