/**
 * ProviderService — dApp traffic (master plan §4.6, §3.3, §3.4).
 *
 * A content-script Port (or, later, a WebView / WalletConnect transport) is
 * served here: every request runs through `RpcFlow` with an `RpcContext`
 * backed by the engine. Anything that needs a human becomes an
 * `ApprovalRequest` whose payload carries the firewall's assessment; the
 * decision arrives from whichever surface rendered it (sign.html, the popup,
 * the mobile sheet). Signing happens here, with the key read from the vault
 * for the duration of one signature. Transactions are written to Activity
 * before broadcast. A re-sent request (worker restart) re-attaches to its
 * pending approval by `clientRequestId`, and a re-executed transaction is
 * re-signed with the same prepared fields, so the raw bytes — and the hash —
 * are identical.
 */
import { getChain, isElectroneumChainId, pollMs } from '@boltvault/chains'
import { ElectroSwapClient, fetchCollections } from '@boltvault/electroswap'
import { eip712Plan } from '@boltvault/hardware'
import type { Platform } from '@boltvault/platform'
import {
  RPC,
  RpcError,
  RpcFlow,
  hexChainId,
  isProviderPortMessage,
  type ApprovalIntent,
  type ProviderEvent,
  type RpcContext,
  type TxParams,
} from '@boltvault/protocol'
import {
  assess,
  clampNewContractDays,
  decodeCalldata,
  emptyContext,
  estimateSimulation,
  isFirstPartyOrigin,
  NO_SIMULATION,
  parseTypedData,
  decodeMessage,
  simulationFromTrace,
  type Assessment,
  type AssessmentContext,
  type ContractInfo,
  type SignRequest,
  type Simulation,
  type TraceFrame,
  untrusted,
} from '@boltvault/security'
import {
  keccak256,
  parseUnits,
  recoverAddress,
  recoverMessageAddress,
  recoverTransactionAddress,
  recoverTypedDataAddress,
  type Hex,
} from 'viem'
import { z } from 'zod'
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts'
import type { ActivityStore } from '../activityStore'
import {
  WatchAssetOptionsSchema,
  ConnectDecisionDataSchema,
  applyGasDecision,
  type ApprovalPayload,
  type AssessmentView,
  type PreparedTx,
} from '../approvalPayloads'
import { authHeaders } from '../apiAuth'
import { APPROVAL_TTL_MS, type ApprovalStore } from '../approvals'
import { EngineError } from '../errors'
import type { EventBus } from '../host'
import type { ActivityEntry, ApprovalRequest, AccountView, SimulationSnapshot } from '../schema'
import type { SettingsStore } from '../settingsStore'
import type { MessageChannelLike } from '../transport'
import type { ChainsService } from './chains'
import type { HardwareService } from './hardware'
import type { SitesService } from './sites'
import type { VaultManager } from './vault'

export interface ProviderDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly vault: VaultManager
  readonly sites: SitesService
  readonly chains: ChainsService
  readonly approvals: ApprovalStore
  readonly settings: SettingsStore
  readonly activity: ActivityStore
  /** Confirmed address-book entries join the lookalike reference set (§3.6). */
  readonly addressBook?: () => Promise<string[]>
  /** Token symbols/decimals for a chain, so statements read "2.5 FIX" not raw units. */
  readonly tokenInfo?: (
    chainId: number,
  ) => Promise<Record<string, { symbol: string; decimals: number; name?: string }>>
  /**
   * Primary names for the addresses a sheet is about to name, so a statement
   * reads "to bob.etn" instead of "to 0x2222…2222". Sanitised and bounded by
   * the names service, because `ctx.labels` is printed by `who()` in
   * explain.ts and by `label()` in rules.ts, and only one of those two wraps
   * what it is given. A thunk because the names service is built after this
   * one — it raises its own registration approvals through it — and because it
   * must only run while a sheet is being assessed.
   */
  readonly counterpartyNames?: (
    chainId: number,
    addresses: readonly string[],
  ) => Promise<ReadonlyArray<{ address: string; name: string | null }>>
  /** Put a new request in front of the user (the extension opens sign.html). Internal origins never call this. */
  readonly openApproval?: (request: ApprovalRequest) => void
  /**
   * This account's wallet fee on a chain — the sink and the tier's bips
   * (§8.6, §8.18).
   *
   * Two callers, one answer: `boltvault_feePolicy` hands it to ElectroSwap's
   * own site so the site encodes the same `PAY_PORTION` our Swap screen would,
   * and the firewall reads it back to say whose fee a sheet is showing. A thunk
   * for the same reason `counterpartyNames` is one — the holder service is
   * built after this one — and it must only run while a sheet or a first-party
   * request is being served.
   */
  readonly walletFeePolicy?: (
    chainId: number,
    accountId: string,
  ) => Promise<{ sink: Hex; bips: number; tier: string } | null>
  readonly clientVersion: string
  /** Signed statics: the scam-origin list for the firewall (§3.6). */
  readonly statics?: { scamOrigins(): readonly string[] }
  /** Device signers (Ledger over HID from the worker); absent in bodies without one. */
  readonly hardware?: HardwareService
  readonly fetch?: typeof fetch
  /**
   * The API's shared answer for a contract's deploy instant and whether its
   * source is verified (§3.4). Absent in a build with no API; an answer of null,
   * or one that knows neither fact, falls through to the explorer.
   */
  readonly contractFacts?: (
    chainId: number,
    address: Hex,
  ) => Promise<(ContractFactsAt & { newAfterDays?: number | null }) | null>
  /** Our own API, for the trace the public RPCs cannot do (§9.2). */
  readonly apiOrigin?: string
  /** The wallet key. `POST /api/wallet/trace` is key-gated; without one there is no preview off a self-hosted node. */
  readonly clientKey?: string
  /** Receipt polling cadence; defaults to the chain's block time. */
  readonly receiptPollMs?: number
  /** `wallet_watchAsset` (plan A3): the chain's word on a token for the sheet, and the add once approved. */
  readonly tokenMetadata?: (
    chainId: number,
    address: string,
  ) => Promise<{ name: string; symbol: string; decimals: number; hasCode: boolean }>
  readonly watchAsset?: (input: {
    chainId: number
    address: string
    origin: string
    claimed?: { symbol?: string; decimals?: number }
  }) => Promise<unknown>
}

export interface PortInfo {
  readonly tabId?: number
  readonly frameId?: number
  /** 'content' ports are verified by construction (the sender's URL); a WebView is the committed URL; WalletConnect only when Verify said VALID (§2.7 S9). */
  readonly kind?: 'content' | 'webview' | 'walletconnect'
  readonly verified?: boolean
  /**
   * What an attestation service said, where one spoke — `verified` is the one
   * bit, and this is the sentence behind it. "Nobody could tell" and "the
   * domain does not match" are different findings on the sheet (§5.3).
   */
  readonly verify?: 'valid' | 'invalid' | 'unknown'
}

/**
 * A dApp's `newHeads` subscription is served at the chain's own cadence, not a
 * flat five seconds. Telling a page about Ethereum three times a block is not
 * a better subscription, only a more expensive one.
 */

/** Seaport's `ItemType` for the two NFT standards; the offer side of a listing. */
const SEAPORT_ERC721 = 2
const SEAPORT_ERC1155 = 3

/** Neither age nor verification changes on the timescale of a signature. */
const CONTRACT_FACTS_TTL_MS = 6 * 60 * 60 * 1000
/** A floor moves, but not between two sheets. */
const FLOOR_TTL_MS = 5 * 60 * 1000
/** Hard ceiling on the explorer detour: a signature never waits on it. */
const EXPLORER_TIMEOUT_MS = 1_500
/** Same ceiling for the name detour, for the same reason: the short address is a fine answer. */
const NAME_BUDGET_MS = 1_500

/**
 * What an explorer or the API told us about a contract, in a form that does not
 * rot in a cache: the instant the code was deployed, never an age.
 *
 * An age cached for six hours is wrong by up to six hours, and the rule it
 * feeds cares about a seven-day boundary — so a contract cached at 6.9 days
 * still reads as 6.9 days tomorrow, and the warning silently stops firing at
 * exactly the wrong moment. The instant is a fact; the age is a calculation,
 * and it belongs at the point of use.
 */
export interface ContractFactsAt {
  /** Epoch milliseconds of the creation transaction, or null when unknown. */
  readonly deployedAt: number | null
  readonly verified: boolean | null
}

const UNKNOWN_CONTRACT_FACTS: ContractFactsAt = { deployedAt: null, verified: null }

/**
 * The chains on which these two facts can be obtained at all.
 *
 * Both sources are Electroneum's. The API serves Electroneum and its testnet
 * and rejects any other chain at validation; the explorer path speaks
 * Blockscout's v2 API, which of the chains in the registry only Electroneum's
 * explorer serves — the rest are Etherscan-family and answer that path with a
 * 404 or a page of HTML.
 *
 * So a lookup anywhere else was always going to come back unknown, having first
 * spent a doomed request and up to the whole deadline with a signing prompt
 * waiting on it. Unknown without leaving the device is the same answer, sooner.
 */
function contractFactsAnswerable(chainId: number): boolean {
  return isElectroneumChainId(chainId)
}

/** Blockscout v2, only the fields §3.4 asks for, all of them optional. */
const ExplorerAddressSchema = z.object({
  is_verified: z.boolean().nullable().optional(),
  creation_transaction_hash: z.string().nullable().optional(),
  creation_tx_hash: z.string().nullable().optional(),
})
const ExplorerTxSchema = z.object({ timestamp: z.string().nullable().optional() })

/**
 * A floor quoted as an ETN number into base units.
 *
 * `toFixed(18)` rather than the number itself because `String(1e-7)` is
 * exponential and `parseUnits` would refuse it; anything at or above 1e21
 * formats exponentially even so, and a floor that large is not a floor.
 */
/**
 * The preview, flattened for the history row (§3.4 step 7).
 *
 * Decimal strings throughout: the activity blob is JSON, and `JSON.stringify`
 * refuses bigint. Capped at twenty entries a side — a row is a record of what
 * the user was told, not a second copy of the trace.
 */
function snapshotOf(sim: Simulation | null): SimulationSnapshot | null {
  if (!sim) return null
  return {
    mode: sim.mode,
    ok: sim.ok,
    ...(sim.revertReason ? { revertReason: sim.revertReason.slice(0, 500) } : {}),
    ...(sim.gas !== undefined ? { gas: sim.gas.toString() } : {}),
    deltas: sim.deltas.slice(0, 20).map((d) => ({
      asset: d.asset,
      standard: d.standard,
      amount: d.amount.toString(),
      ...(d.tokenId !== undefined ? { tokenId: d.tokenId.toString() } : {}),
      ...(d.counterparty ? { counterparty: d.counterparty } : {}),
    })),
    approvals: sim.approvals.slice(0, 20).map((a) => ({
      token: a.token,
      spender: a.spender,
      amount: a.amount === 'all' ? 'all' : a.amount.toString(),
      standard: a.standard,
    })),
    ...(sim.note ? { note: sim.note.slice(0, 500) } : {}),
  }
}

function floorToWei(floorEtn: number | null): bigint | null {
  if (floorEtn === null || !Number.isFinite(floorEtn) || floorEtn <= 0 || floorEtn >= 1e21)
    return null
  try {
    return parseUnits(floorEtn.toFixed(18), 18)
  } catch {
    return null
  }
}

/**
 * A canonical fingerprint of what an approval asks to sign (§3.3).
 *
 * `approve()` re-attaches a re-sent request to a pending sheet by origin and
 * the page-supplied `clientRequestId` — both of which the page chooses and
 * neither of which says anything about the contents. A worker restart while a
 * sheet is open is a supported, tested path, so the window is real: without
 * this a site could move its session to another chain or another account,
 * re-send, and have the user's "yes" to one thing sign another. Everything the
 * sheet rendered goes into the digest, fee fields included — a re-send that
 * changes them is a different request, and the gas editor is the only door
 * that may change a price.
 */
function intentDigest(intent: ApprovalIntent): string {
  const from = 'from' in intent ? intent.from.toLowerCase() : ''
  const accountId = 'accountId' in intent ? intent.accountId : ''
  const params = (): string => {
    switch (intent.kind) {
      case 'connect':
      case 'switch_chain':
      case 'add_chain':
        return ''
      case 'watch_asset':
        return stableJson({ type: intent.type, options: intent.options })
      case 'sign_message':
        return intent.message.toLowerCase()
      case 'eth_sign':
        return intent.hash.toLowerCase()
      case 'sign_typed_data':
        return stableJson(
          typeof intent.typedData === 'string' ? safeJson(intent.typedData) : intent.typedData,
        )
      case 'send_transaction': {
        const t = intent.tx
        return stableJson({
          to: t.to?.toLowerCase() ?? null,
          value: t.value ?? null,
          data: t.data ?? null,
          nonce: t.nonce ?? null,
          gas: t.gas ?? null,
          gasPrice: t.gasPrice ?? null,
          maxFeePerGas: t.maxFeePerGas ?? null,
          maxPriorityFeePerGas: t.maxPriorityFeePerGas ?? null,
          signOnly: intent.signOnly === true,
          replaces: intent.replaces?.nonce ?? null,
        })
      }
    }
  }
  return [intent.kind, intent.chainId, accountId, from, params()].join('|')
}

/** JSON with object keys in a fixed order, so two equal requests digest alike. */
/**
 * Was this a refusal the person can simply undo?
 *
 * The narrow case, deliberately: the wrong button on a Ledger, which `settle`
 * already returns to `pending` so the very same request can be approved again.
 * Everything else — the wallet's own `RpcError` refusals, a device that cannot
 * do what was asked, a transport that broke — is a transaction that did not
 * happen and is recorded as one.
 */
function isRetryable(err: unknown): boolean {
  if (err instanceof RpcError) return false
  // A Ledger says so in its code; Trezor and the rest say so in words.
  if ((err as { code?: unknown } | null)?.code === 'rejected') return true
  return err instanceof Error && /\brejected\b|\bdenied\b|\bcancell?ed\b/i.test(err.message)
}

/**
 * An error that does not mean the transaction failed to leave (ES-BV-002).
 *
 * Two shapes matter. A transport that broke — a timeout, a dropped socket, a
 * fetch that never returned — says nothing at all about what the node did with
 * the bytes it already had. And a node that answers "already known", "nonce
 * too low" or "replacement underpriced" is telling us it has *seen* this
 * transaction or one at the same number, which is the normal answer from the
 * second endpoint of a failover pair once the first one accepted it.
 *
 * Treating either as a failure is how the same send goes out twice.
 */
/**
 * The library's own names for "no answer came back" (ES-BV-063).
 *
 * These are the four ways a request ends without the node having said
 * anything: a deadline, an HTTP layer that never produced a JSON-RPC body, a
 * socket that closed, a websocket that failed. A node that answers with a
 * JSON-RPC error is not here — that is a decision, and it is read from the
 * node's own words below.
 */
const TRANSPORT_FAILURES: ReadonlySet<string> = new Set(['TimeoutError', 'HttpRequestError', 'SocketClosedError', 'WebSocketRequestError'])

/** An error and everything it wraps, innermost last. Bounded: a cycle cannot hang this. */
function causes(err: unknown): unknown[] {
  const out: unknown[] = []
  let at = err
  for (let i = 0; i < 8 && at !== null && typeof at === 'object'; i += 1) {
    out.push(at)
    at = (at as { cause?: unknown }).cause
  }
  return out
}

/**
 * What the node itself said, with nothing the library added around it.
 *
 * `message` is composed — the pinned library folds the endpoint URL and the
 * request body into it as meta lines — so matching words against it matches
 * the URL. `details` carries the node's message and `shortMessage` the
 * library's one-line classification; neither carries the endpoint. The whole
 * bug was that the bundled Avalanche endpoint is on a host with the word
 * "network" in it, so every definitive rejection on that chain read as a
 * transport failure.
 */
function nodeWords(err: unknown): string {
  const parts: string[] = []
  for (const e of causes(err)) {
    const o = e as { details?: unknown; shortMessage?: unknown; name?: unknown; message?: unknown }
    if (typeof o.details === 'string') parts.push(o.details)
    if (typeof o.shortMessage === 'string') parts.push(o.shortMessage)
    // A plain Error from a transport the library does not wrap has no composed
    // meta lines, so its message is the node's or the runtime's own words.
    else if (typeof o.message === 'string' && o.details === undefined && o.shortMessage === undefined) parts.push(o.message)
  }
  return parts.join(' \n ')
}

export function possiblySent(err: unknown): boolean {
  for (const e of causes(err)) {
    const name = (e as { name?: unknown }).name
    if (typeof name === 'string' && TRANSPORT_FAILURES.has(name)) return true
  }
  const said = nodeWords(err)
  // A transport that broke without the library naming it (a bare fetch, an
  // aborted request). Read only from words the node or the runtime wrote.
  if (/timed?\s*out|timeout|aborted|failed to fetch|socket|econn|fetch failed|load failed|network\s*(error|request failed)/i.test(said)) return true
  return (
    /already\s*known|alreadyknown|known\s*transaction|already\s*in\s*(the\s*)?(pool|mempool)|duplicate\s*transaction/i.test(
      said,
    ) ||
    /nonce\s*too\s*low|replacement\s*transaction\s*underpriced|transaction\s*underpriced/i.test(said)
  )
}

/** What to write on the row: the node's words, not the composed message with the endpoint in it. */
export function broadcastReason(err: unknown): string {
  const said = nodeWords(err).split('\n')[0]?.trim()
  if (said) return said.slice(0, 200)
  return err instanceof Error && err.message ? (err.message.split('\n')[0] ?? '').slice(0, 200) : 'broadcast failed'
}

/**
 * How long the wallet keeps asking the chain about a broadcast transaction
 * before it admits it does not know (ES-BV-049). Twenty minutes outlasts a
 * congested block or two on every chain the wallet speaks to; past that,
 * "unknown — check the explorer" is a more honest row than "pending".
 */
const WATCH_BUDGET_MS = 20 * 60 * 1000
/** Blocks past the receipt before the watcher re-reads it, so a reorg is caught. */
const CONFIRM_DEPTH = 2
/**
 * How long that second look is worth waiting for. Two minutes covers
 * `CONFIRM_DEPTH` blocks on every chain the wallet speaks to; past that the
 * head is not moving and there is nothing further to learn.
 */
const REORG_WINDOW_MS = 2 * 60 * 1000
/** A node may not report its own new transaction immediately; wait before calling it dropped. */
const DROP_GRACE_MS = 30_000
/**
 * How many `null` answers in a row before the row says the node has lost it
 * (ES-BV-064).
 *
 * One is not evidence. A failover pair whose nodes do not share a pool
 * answers `null` from the endpoint that never saw the bytes while the other
 * holds the transaction, and a row that says "dropped" on that basis invites
 * the user to send the same money again. Two consecutive misses, a poll apart,
 * is cheap and rules out the single unlucky read.
 */
const DROP_CONFIRMATIONS = 2

/** The transaction a speed-up or cancel is replacing (§8.12, ES-BV-025). */
export interface ReplacedTx {
  readonly nonce: number
  readonly hash: string | null
  readonly maxFeePerGas?: string | null
  readonly maxPriorityFeePerGas?: string | null
  readonly gasPrice?: string | null
}

/**
 * A trace frame, as far as anything here may assume (ES-BV-024).
 *
 * The response was cast to `TraceFrame` and walked, so a service that answered
 * with something else — a string where a log should be, a `calls` array of
 * nulls — reached `deltasFromTrace` as though it were a frame. Shape first,
 * and only the fields that are read.
 */
const TraceLogSchema: z.ZodType<unknown> = z.object({
  address: z.string(),
  topics: z.array(z.string()),
  data: z.string(),
})
const TraceFrameSchema: z.ZodType<unknown> = z.lazy(() =>
  z.object({
    type: z.string().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
    value: z.string().optional(),
    error: z.string().optional(),
    revertReason: z.string().optional(),
    gasUsed: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
    logs: z.array(TraceLogSchema).optional(),
    calls: z.array(TraceFrameSchema).optional(),
  }),
)

function parseTraceFrame(value: unknown): TraceFrame | null {
  const parsed = TraceFrameSchema.safeParse(value)
  return parsed.success ? (parsed.data as TraceFrame) : null
}

/**
 * A preview never talks the wallet out of a revert it already measured
 * (ES-BV-024).
 *
 * `simulationFromTrace` reports `ok: true` for any frame with no `error` on
 * it, and it was returned in place of the estimate — so a trace that came back
 * clean while the local `eth_estimateGas` had reverted produced a sheet with
 * no `SIM_FAILED` on it at all. The estimate is the check that matters; the
 * trace only ever adds detail to it.
 */
function withEstimate(
  simulation: Simulation,
  prepared: { tx: PreparedTx; estimateError: string | null },
): Simulation {
  if (!prepared.estimateError) return simulation
  return {
    ...simulation,
    ok: false,
    revertReason: simulation.revertReason ?? untrusted(prepared.estimateError, 200),
  }
}

/**
 * The largest request a page may put on the wire (ES-BV-020).
 *
 * Comfortably above the biggest honest payload — a 128 KiB calldata, a typed
 * message of the same order — and far below anything that troubles the
 * extension's storage quota.
 */
const MAX_PORT_MESSAGE_BYTES = 256 * 1024

function messageSize(raw: unknown): number {
  try {
    return JSON.stringify(raw)?.length ?? 0
  } catch {
    // A cycle cannot have come over a structured-clone boundary, but a message
    // this cannot measure is a message it will not pass on either.
    return Number.POSITIVE_INFINITY
  }
}

/** The tab a pending approval came from, where its payload names one. */
function payloadTabId(request: ApprovalRequest): number | undefined {
  const tabId = (request.payload as { tabId?: unknown } | null)?.tabId
  return typeof tabId === 'number' ? tabId : undefined
}

function stableJson(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null'
  if (Array.isArray(v)) return `[${v.map(stableJson).join(',')}]`
  const o = v as Record<string, unknown>
  return `{${Object.keys(o)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableJson(o[k])}`)
    .join(',')}}`
}

export class ProviderService {
  private remote: RemoteSigner | null = null
  /** Origins whose transport could not vouch for them (WalletConnect without Verify). */
  /** `clientRequestId` → the port that is asking, while it is asking. */
  private readonly senders = new Map<string, PortInfo>()
  private unverified = new Set<string>()
  /** What an attestation service said about an origin, and over which transport. */
  private readonly verdicts = new Map<
    string,
    { verify: 'valid' | 'invalid' | 'unknown'; kind: 'content' | 'webview' | 'walletconnect' }
  >()
  /** Explorer answers by `chainId:address`; failures are cached too, so a dead explorer is asked once. */
  private readonly contractFactsCache = new Map<string, { at: number; facts: ContractFactsAt }>()
  /**
   * The "very new" threshold the service last served, in days.
   *
   * Global policy, so it is held once rather than copied into every cached
   * contract — and it is remembered rather than re-asked, because the answer it
   * qualifies is itself cached for hours. Null until a lookup has carried one,
   * which is what the bundled default is for.
   */
  private servedNewContractDays: number | null = null
  /** Collection floors in base units by `chainId:address`; `null` means the index has none. */
  private readonly floorCache = new Map<string, { at: number; wei: bigint | null }>()
  private marketClient: ElectroSwapClient | null = null
  /**
   * The preview each pending approval was shown with, by request id (§3.4
   * step 7). It lives beside the approval rather than inside its payload
   * because the payload is the object the sheet renders, and this is for the
   * history row. A worker restart loses it; the row is then simply written
   * without a snapshot, which is what the optional field is for.
   */
  private readonly snapshots = new Map<string, { at: number; snapshot: SimulationSnapshot }>()

  /** Remote sign is wired after construction: it needs the provider and the provider needs it. */
  setRemote(remote: RemoteSigner): void {
    this.remote = remote
  }

  private readonly flow: RpcFlow
  private readonly ports = new Map<string, Set<(event: ProviderEvent) => void>>()
  private readonly headPolls = new Map<
    number,
    { timer: ReturnType<typeof setInterval>; subs: Map<string, { origin: string; id: Hex }> }
  >()

  constructor(private readonly deps: ProviderDeps) {
    this.flow = new RpcFlow(this.context())
    deps.sites.onChange((change) => {
      if (change.kind === 'disconnected') {
        void this.flow.disconnected(change.origin)
        void deps.approvals.rejectAll((r) => r.origin === change.origin)
      } else if (change.kind === 'account') void this.reseat(change.origin, change.accountId)
      else this.flow.chainChanged(change.origin, change.chainId)
    })
  }

  /**
   * The user moved a site to another account (Settings › Connected sites).
   *
   * The address is resolved here rather than handed in by the screen: the
   * addresses a dApp is given are the vault's word, never the UI's. The event
   * goes to the ports of this origin alone (§4.6) — the Home tab's seat and
   * every other site's session are untouched — and an account that has since
   * gone yields an empty array, which is the honest thing to tell a page.
   */
  private async reseat(origin: string, accountId: string): Promise<void> {
    const account = (await this.deps.vault.accounts().catch(() => [])).find(
      (a) => a.id === accountId,
    )
    const addresses = account ? [account.address] : []
    this.flow.accountsChanged(origin, addresses)
    await this.deps.sites.noteExposed(origin, addresses).catch(() => undefined)
  }

  /** Serve one dApp channel. The origin comes from the transport, never from a message. */
  serve(channel: MessageChannelLike, origin: string, info: PortInfo = {}): () => void {
    if (info.verified === false) this.unverified.add(origin)
    else this.unverified.delete(origin)
    if (info.verify || info.kind)
      this.verdicts.set(origin, {
        verify: info.verify ?? (info.verified === false ? 'unknown' : 'valid'),
        kind: info.kind ?? 'content',
      })
    const onEvent = (event: ProviderEvent): void => {
      try {
        channel.post({ kind: 'event', event: event.event, payload: event.payload })
      } catch {
        // gone
      }
    }
    const set = this.ports.get(origin) ?? new Set()
    set.add(onEvent)
    this.ports.set(origin, set)
    const offMessage = channel.onMessage((raw) => {
      if (!isProviderPortMessage(raw) || raw.kind !== 'request') return
      /*
        One bound at the door (ES-BV-020).

        Everything past this point — the intent, the approval payload, session
        storage — was sized by whatever the page sent. Each individual field is
        bounded in `RpcFlow.intent`, and this is the backstop for the shapes
        nobody has thought of yet: a hundred parameters, a deeply nested
        object, a method that takes none of them and got a megabyte anyway.
      */
      const size = messageSize(raw)
      if (size > MAX_PORT_MESSAGE_BYTES) {
        try {
          channel.post({
            kind: 'response',
            id: raw.id,
            error: new RpcError(RPC.INVALID_PARAMS, 'That request is too large.').toPayload(),
          })
        } catch {
          // gone
        }
        return
      }
      const clientRequestId = `${origin}#${raw.session ?? 'nosession'}#${raw.id}`
      /*
        Which tab is asking, for as long as it is asking. The approval payload
        copies it so the host can decline to throw a focused window over the
        user's work on behalf of a tab three windows back.
      */
      if (info.tabId !== undefined || info.frameId !== undefined)
        this.senders.set(clientRequestId, info)
      void this.flow
        .request(origin, raw.method, raw.params, clientRequestId)
        .then((result) => channel.post({ kind: 'response', id: raw.id, result: result ?? null }))
        .catch((err: unknown) => {
          const e = RpcError.from(err)
          try {
            channel.post({ kind: 'response', id: raw.id, error: e.toPayload() })
          } catch {
            // gone
          }
        })
        .finally(() => this.senders.delete(clientRequestId))
    })
    const stop = (): void => {
      offMessage()
      set.delete(onEvent)
      if (set.size > 0) return
      this.ports.delete(origin)
      /*
        The tab is gone; so is everything that was waiting on it (ES-BV-019,
        ES-BV-017).

        A sheet raised by a page that has since closed can still be approved —
        and approving it broadcasts to nobody while the origin lock is held for
        the full five minutes, so the site cannot be used again in a new tab
        until the lock expires. The per-origin subscriptions and the chain
        state this flow was holding go with it.
      */
      void this.deps.approvals
        .rejectAll(
          (r) =>
            r.origin === origin &&
            r.status === 'pending' &&
            (info.tabId === undefined || payloadTabId(r) === info.tabId),
        )
        .catch(() => undefined)
      this.flow.forgetOrigin(origin)
    }
    const offDisconnect = channel.onDisconnect(stop)
    return () => {
      stop()
      offDisconnect()
    }
  }

  /**
   * Does a connect for this origin have to put a sheet in front of somebody,
   * even when the origin is already connected?
   *
   * Over WalletConnect, yes. A proposal ran `eth_requestAccounts` through the
   * virtual session and `RpcFlow.connect()` answered from the existing
   * session — so scanning a pairing URI for an origin the user had already
   * connected in the in-app browser completed silently, handing the peer the
   * address and a second live session under a first-party name. One extra tap
   * per pairing is the whole cost.
   */
  alwaysPrompt(origin: string): boolean {
    return this.verdicts.get(origin)?.kind === 'walletconnect'
  }

  isPending(origin: string): boolean {
    return this.flow.isPending(origin)
  }

  /**
   * Our own surfaces (Send, Revoke, later Swap): create the approval and return
   * its id at once; the sheet decides; execution runs here and lands in Activity.
   */
  async submitInternal(
    intent: Extract<ApprovalIntent, { kind: 'send_transaction' }>,
  ): Promise<{ requestId: string }> {
    const { requestId } = await this.runInternal(intent)
    return { requestId }
  }

  /**
   * The same for flows that need the outcome (Swap: the permit signature feeds
   * the router call): `result` resolves with the hash or signature once the
   * sheet approved and the step executed, and rejects on Reject or a block.
   */
  async runInternal(
    intent: Extract<
      ApprovalIntent,
      { kind: 'send_transaction' | 'sign_typed_data' | 'sign_message' }
    >,
  ): Promise<{ requestId: string; result: Promise<unknown> }> {
    if (!intent.origin.startsWith('internal:') && !intent.origin.startsWith('device:'))
      throw new EngineError(
        'invalid_argument',
        'runInternal is for internal and paired-device origins',
      )
    const d = this.deps
    const payload = await this.payloadFor(intent)
    const request = await d.approvals.create({
      kind: intent.kind,
      origin: intent.origin,
      accountId: intent.accountId,
      chainId: intent.chainId,
      payload,
    })
    const result = (async () => {
      const view = payload as { assessment: AssessmentView }
      // The same wait-again loop the dApp path uses; see `approve()`.
      for (;;) {
        const outcome = await d.approvals.waitFor(request.id)
        if (!outcome.approved) throw new EngineError('rejected', 'User rejected the request.')
        /*
        Tell the store what the signer got. `decide` is holding its promise
        open on this, so the approving screen stays up — showing "confirm on
        your Ledger" — until the device answers, and a refusal returns the
        request to pending so it can simply be approved again rather than
        being lost.

        Everything after the yes sits inside this try, the blocked check
        included: any path that does not settle leaves `decide` waiting for an
        answer that never comes, and the screen hanging with it.
      */
        let blockedHere = false
        try {
          // Defence in depth: a blocked assessment is never signed, whatever a UI page says (§3.4).
          if (view.assessment.presentation.blocked) {
            blockedHere = true
            throw new EngineError('rejected', 'User rejected the request.')
          }
          const done = await this.execute(intent, request, outcome.data)
          await d.approvals.settle(request.id, true)
          return done
        } catch (err) {
          const retryable = !blockedHere && isRetryable(err)
          if (!retryable) {
            const held = ProviderService.reservationOf(request)
            if (held) this.releaseNonce(held.chainId, held.from, held.nonce)
          }
          // Our refusal is final; a device's is not. See ApprovalStore.settle.
          await d.approvals.settle(
            request.id,
            false,
            err instanceof Error ? err.message : String(err),
            !blockedHere,
          )
          if (retryable && d.approvals.get(request.id)?.status === 'pending') continue
          throw err
        }
      }
    })()
    // A broadcast failure is already recorded in Activity as failed; nobody has to await this.
    result.catch(() => undefined)
    return { requestId: request.id, result }
  }

  /** After unlock: keep watching transactions that were pending when the worker last stopped. */
  async resumeWatchers(): Promise<void> {
    const entries = await this.deps.activity.list({}).catch(() => [] as ActivityEntry[])
    for (const e of entries)
      // No reservation to give back: `reservedNonces` is in-memory and a worker
      // that restarted has none (ES-BV-064).
      if (e.status === 'pending' && e.hash) this.watch(e.chainId, e.id, e.hash as Hex)
  }

  dispose(): void {
    this.flow.dispose()
    for (const p of this.headPolls.values()) clearInterval(p.timer)
    this.headPolls.clear()
    for (const timer of this.watching.values()) if (timer) clearTimeout(timer)
    this.watching.clear()
  }

  // ---- RpcContext -----------------------------------------------------------------

  private context(): RpcContext {
    const d = this.deps
    return {
      sites: d.sites.registry,
      now: () => d.platform.now(),
      clientVersion: d.clientVersion,
      settings: {
        get ethSignEnabled() {
          return ethSignEnabledSync
        },
      },
      knownChain: (chainId) => d.chains.known(chainId),
      alwaysPrompt: (origin) => this.alwaysPrompt(origin),
      session: (origin) => this.sessionFor(origin),
      executeSafe: (chainId, method, params) => d.chains.rpc(chainId, method, params),
      approve: (intent) => this.approve(intent),
      /*
        A page revoking its own permissions goes through the engine's door
        (ES-BV-018), so the change listeners that reject the origin's pending
        approvals and refresh Settings actually fire. `ctx.sites` is the raw
        registry, which only writes the row.
      */
      revoke: (origin) => d.sites.disconnect(origin),
      emit: (origin, event) => {
        for (const l of this.ports.get(origin) ?? []) l(event)
      },
      subscribeHeads: (origin, chainId, id) => this.subscribeHeads(origin, chainId, id),
      feePolicy: (origin, chainId) => this.feePolicyFor(origin, chainId),
    }
  }

  /** The account a connected origin is seated on, or null while locked, disconnected or re-seated away. */
  private async sessionFor(
    origin: string,
  ): Promise<{ accountId: string; addresses: readonly string[] } | null> {
    const d = this.deps
    const row = d.sites.registry.get(origin)
    if (!row?.connected) return null
    const status = await d.vault.status()
    if (!status.unlocked) return null
    const account = (await d.vault.accounts()).find((a) => a.id === row.accountId)
    if (!account) {
      await d.sites.disconnect(origin)
      return null
    }
    return { accountId: account.id, addresses: [account.address] }
  }

  /**
   * The fee policy an origin may read (§8.6). Only ElectroSwap's own sites,
   * and only once connected — the flow has already required the session, and
   * `isFirstPartyOrigin` requires https, so a cleartext page an attacker can
   * rewrite never gets an answer to encode with.
   *
   * Everything else, including a failure to read the tier, is `null`. A site
   * that cannot learn the fee encodes none, which costs us the fee on that
   * swap; the alternative — guessing a tier — would overcharge someone.
   */
  /** `{ walletFee }` for a first-party sheet, or `{}` so the context key stays absent for everyone else. */
  private async walletFeeFor(
    origin: string,
    chainId: number,
  ): Promise<{ walletFee?: { sink: Hex; bips: number; tier: string } }> {
    const policy = await this.feePolicyFor(origin, chainId)
    return policy ? { walletFee: policy } : {}
  }

  private async feePolicyFor(
    origin: string,
    chainId: number,
  ): Promise<{ sink: Hex; bips: number; tier: string } | null> {
    if (!isFirstPartyOrigin(origin)) return null
    const policy = this.deps.walletFeePolicy
    if (!policy) return null
    const session = await this.sessionFor(origin)
    if (!session) return null
    try {
      return await policy(chainId, session.accountId)
    } catch {
      return null
    }
  }

  /** Settings are async; the flow reads a mirror kept current by the settings event. */
  private ethSignMirror = false

  async init(): Promise<void> {
    const s = await this.deps.settings.get()
    ethSignEnabledSync = s.ethSignEnabled
    this.ethSignMirror = s.ethSignEnabled
    this.deps.bus.subscribe((e) => {
      if (e.type === 'settings.changed') {
        ethSignEnabledSync = e.settings.ethSignEnabled
        this.ethSignMirror = e.settings.ethSignEnabled
      }
    })
  }

  private subscribeHeads(origin: string, chainId: number, id: Hex): () => void {
    let poll = this.headPolls.get(chainId)
    if (!poll) {
      const subs = new Map<string, { origin: string; id: Hex }>()
      const timer = setInterval(
        () => {
          void this.deps.chains.head(chainId).then(
            (head) => {
              for (const s of subs.values()) {
                for (const l of this.ports.get(s.origin) ?? []) {
                  l({
                    event: 'message',
                    payload: {
                      type: 'eth_subscription',
                      data: {
                        subscription: s.id,
                        result: { number: `0x${BigInt(head.blockNumber).toString(16)}` },
                      },
                    },
                  })
                }
              }
            },
            () => undefined,
          )
        },
        pollMs(chainId, 'foreground'),
      )
      poll = { timer, subs }
      this.headPolls.set(chainId, poll)
    }
    const key = `${origin}:${id}`
    poll.subs.set(key, { origin, id })
    return () => {
      const p = this.headPolls.get(chainId)
      if (!p) return
      p.subs.delete(key)
      if (p.subs.size === 0) {
        clearInterval(p.timer)
        this.headPolls.delete(chainId)
      }
    }
  }

  // ---- approvals -------------------------------------------------------------------

  private async approve(intent: ApprovalIntent): Promise<unknown> {
    const d = this.deps
    const digest = intentDigest(intent)
    // Re-attach: a worker restart re-sends the request with the same client id.
    const existing = d.approvals.findPending(
      (r) =>
        r.origin === intent.origin &&
        (r.payload as { clientRequestId?: string } | null)?.clientRequestId ===
          intent.clientRequestId,
    )
    /*
      …but only when it is the same request. The client id is the page's own
      string and the sheet is already up, so adopting a pending request without
      checking would let a site re-send different bytes, a different chain or a
      different account under a sheet the user is reading. A mismatch is
      refused outright and the pending request is left exactly as it was, for
      the person to finish or reject on its own terms.
    */
    if (existing) {
      const stored = (existing.payload as { intentDigest?: string } | null)?.intentDigest ?? ''
      const wantedAccount = 'accountId' in intent ? intent.accountId : null
      if (
        stored !== digest ||
        existing.chainId !== intent.chainId ||
        existing.accountId !== wantedAccount
      )
        throw new RpcError(
          RPC.RESOURCE_UNAVAILABLE,
          'A different request from this site is already waiting. Finish it first.',
        )
    }
    let request = existing
    if (!request) {
      // An already-permitted site only needs the vault unlocked, not a new Connect.
      // Except over WalletConnect: see `alwaysPrompt`.
      if (intent.kind === 'connect' && !this.alwaysPrompt(intent.origin)) {
        const row = d.sites.registry.get(intent.origin)
        const status = await d.vault.status()
        if (row?.connected && status.unlocked) {
          const account = (await d.vault.accounts()).find((a) => a.id === row.accountId)
          if (account)
            return { accountId: account.id, addresses: [account.address], chainId: row.chainId }
        }
      }
      const from = this.senders.get(intent.clientRequestId)
      const payload = {
        ...(await this.payloadFor(intent)),
        intentDigest: digest,
        ...(from?.tabId !== undefined ? { tabId: from.tabId } : {}),
        ...(from?.frameId !== undefined ? { frameId: from.frameId } : {}),
      }
      request = await d.approvals.create({
        kind: intent.kind === 'eth_sign' ? 'sign_message' : intent.kind,
        origin: intent.origin,
        accountId: 'accountId' in intent ? intent.accountId : null,
        chainId: intent.chainId,
        payload,
      })
      if (!intent.origin.startsWith('internal:')) d.openApproval?.(request)
    }
    const payload = request.payload as { assessment?: AssessmentView } | null
    const blockedBy = payload?.assessment?.presentation.blocked
      ? payload.assessment.rules.filter((r) => r.severity === 'block').map((r) => r.code)
      : []
    // Defence in depth: a blocked assessment is never signed, whatever a UI page says (§3.4).
    // The dApp path settles the same way, blocked check included; see runInternal.
    const blockedHere = blockedBy.length > 0
    /*
      Approved, refused, approved again.

      `ApprovalStore.settle` returns a device refusal to `pending` precisely so
      "the same request can simply be approved again" — but nothing was waiting
      for the second yes, because the signer awaited the decision once and left.
      The request sat pending until it expired and the person's retry did
      nothing. So the wait is a loop, bounded by the approval's own TTL: each
      turn needs a fresh human decision, and an expiry resolves it as a refusal.
    */
    for (;;) {
      const outcome = await d.approvals.waitFor(request.id)
      if (!outcome.approved) {
        // Whatever place in the queue this sheet was holding goes back.
        const held = ProviderService.reservationOf(request)
        if (held) this.releaseNonce(held.chainId, held.from, held.nonce)
        /*
        A rejection still says why, when the wallet had already blocked it.

        `6cb688c` moved the blocked check inside the settle try and dropped the
        `rules` from this branch along the way — collateral, not intent: the page
        that was rejected is showing the same list, and a dApp that learns its
        payload tripped PERMIT2_SIGNATURE_TRANSFER can go and fix the payload.
        Nothing here is a secret, and `e2e/provider.spec.ts` has been asking for
        it since M3.
      */
        throw new RpcError(
          RPC.USER_REJECTED,
          'User rejected the request.',
          blockedHere ? { rules: blockedBy } : undefined,
        )
      }
      try {
        if (blockedHere)
          throw new RpcError(RPC.USER_REJECTED, 'User rejected the request.', { rules: blockedBy })
        const done = await this.execute(intent, request, outcome.data)
        await d.approvals.settle(request.id, true)
        return done
      } catch (err) {
        const retryable = !blockedHere && isRetryable(err)
        /*
        A signature that cannot be retried is finished with its nonce. One that
        can — a device refusal, which `settle` returns to `pending` — keeps it,
        because the same request is about to ask for the same place again.
      */
        if (!retryable) {
          const held = ProviderService.reservationOf(request)
          if (held) this.releaseNonce(held.chainId, held.from, held.nonce)
        }
        await d.approvals.settle(
          request.id,
          false,
          err instanceof Error ? err.message : String(err),
          !blockedHere,
        )
        if (retryable && d.approvals.get(request.id)?.status === 'pending') continue
        throw err
      }
    }
  }

  private async payloadFor(intent: ApprovalIntent): Promise<ApprovalPayload> {
    const d = this.deps
    switch (intent.kind) {
      case 'connect':
        return {
          kind: 'connect',
          requestedChainId: intent.chainId,
          // `reconnect` is what the sheet auto-approves after an unlock. A
          // pairing is never that, whatever the origin already holds.
          reconnect:
            !this.alwaysPrompt(intent.origin) &&
            d.sites.registry.get(intent.origin)?.connected === true,
          firstTime: d.sites.registry.isFirstTime(intent.origin),
          clientRequestId: intent.clientRequestId,
        }
      case 'switch_chain':
        return {
          kind: 'switch_chain',
          chainId: intent.chainId,
          clientRequestId: intent.clientRequestId,
        }
      case 'add_chain':
        return {
          kind: 'add_chain',
          chainId: intent.chainId,
          clientRequestId: intent.clientRequestId,
        }
      case 'watch_asset': {
        const opts =
          intent.type === 'ERC20' ? WatchAssetOptionsSchema.safeParse(intent.options) : null
        const address = opts?.success ? opts.data.address : null
        let onChain: { name: string; symbol: string; decimals: number } | null = null
        if (address && d.tokenMetadata) {
          try {
            const m = await d.tokenMetadata(intent.chainId, address)
            if (m.hasCode) onChain = { name: m.name, symbol: m.symbol, decimals: m.decimals }
          } catch {
            onChain = null
          }
        }
        const symbol = opts?.success ? (opts.data.symbol ?? null) : null
        const decimals = opts?.success ? (opts.data.decimals ?? null) : null
        const mismatch =
          onChain !== null &&
          ((symbol !== null && symbol.toUpperCase() !== onChain.symbol.toUpperCase()) ||
            (decimals !== null && decimals !== onChain.decimals))
        return {
          kind: 'watch_asset',
          type: intent.type,
          address,
          symbol,
          decimals,
          onChain,
          mismatch,
          clientRequestId: intent.clientRequestId,
        }
      }
      case 'sign_message': {
        const assessment = await this.assessment(
          intent.origin,
          intent.chainId,
          intent.from,
          { kind: 'message', from: intent.from, message: intent.message },
          null,
        )
        return {
          kind: 'sign_message',
          from: intent.from,
          message: intent.message,
          text: decodeMessage(intent.message).text,
          assessment: toView(assessment, this.deps.platform.now()),
          clientRequestId: intent.clientRequestId,
        }
      }
      case 'eth_sign': {
        const assessment = await this.assessment(
          intent.origin,
          intent.chainId,
          intent.from,
          { kind: 'eth_sign', from: intent.from, hash: intent.hash },
          null,
        )
        return {
          kind: 'eth_sign',
          from: intent.from,
          hash: intent.hash,
          assessment: toView(assessment, this.deps.platform.now()),
          clientRequestId: intent.clientRequestId,
        }
      }
      case 'sign_typed_data': {
        const parsed = parseTypedData(intent.typedData)
        const assessment = await this.assessment(
          intent.origin,
          intent.chainId,
          intent.from,
          { kind: 'typed_data', from: intent.from, typedData: intent.typedData },
          null,
        )
        const typedJson =
          typeof intent.typedData === 'string' ? safeJson(intent.typedData) : intent.typedData
        /*
          Reject anything the signer could not read strictly, here rather than
          at signing time. Failing later would put a sheet in front of the user
          for something that can never be signed, and — because an approval
          survives a failed execution so a device refusal can be retried — would
          leave that sheet pending for good.
        */
        const normalised = normaliseTypedData(typedJson)
        /*
          Can a Ledger be shown this, or only its hash (ES-BV-006)?

          The device's app version is the sheet's other half and comes from the
          preflight; this half is about the message, and it is knowable here
          without a device in the room. `eip712Plan` throws for anything the
          Ethereum app cannot be told about, so building it is the check.
        */
        let deviceFields = true
        try {
          const t = normalised as { types: Record<string, Array<{ name: string; type: string }>>; primaryType: string; domain?: Record<string, unknown>; message: Record<string, unknown> }
          eip712Plan({ types: { EIP712Domain: t.types.EIP712Domain ?? [], ...t.types }, primaryType: t.primaryType, domain: t.domain ?? {}, message: t.message })
        } catch {
          deviceFields = false
        }
        return {
          kind: 'sign_typed_data',
          from: intent.from,
          typedData: typedJson,
          version: intent.version,
          deviceFields,
          /*
            Both come from the thing being signed (ES-BV-038). The decoder caps
            their length but leaves the characters alone, and these two are
            rendered on the domain plate without going through the sanitiser
            the statements use — so a domain name carrying U+202E reorders the
            line it sits on.
          */
          domainName: parsed?.domain.name ? untrusted(parsed.domain.name, 64) : null,
          primaryType: untrusted(parsed?.primaryType ?? 'unknown', 64),
          assessment: toView(assessment, this.deps.platform.now()),
          clientRequestId: intent.clientRequestId,
        }
      }
      case 'send_transaction': {
        const prepared = await this.prepare(intent.chainId, intent.tx)
        const request: SignRequest = {
          kind: 'transaction',
          tx: {
            from: prepared.tx.from as Hex,
            to: prepared.tx.to as Hex | null,
            value: BigInt(prepared.tx.value),
            data: prepared.tx.data as Hex,
            chainId: intent.chainId,
            gas: BigInt(prepared.tx.gas),
            ...(intent.tx.authorizationList
              ? { authorizationList: intent.tx.authorizationList }
              : {}),
          },
        }
        const simulation = await this.simulate(intent.chainId, prepared, request)
        // §3.4 step 7: the history row must be able to show the preview the user was shown.
        this.rememberSnapshot(ProviderService.snapshotKey(intent.chainId, prepared.tx), simulation)
        /*
          What the site chose for itself, so the firewall can say so. Only the
          fields it actually set: a price the wallet worked out has nothing to
          answer for, and neither has a nonce the wallet reserved.
        */
        const theirPerGas = intent.tx.gasPrice ?? intent.tx.maxFeePerGas
        const nodePerGas = prepared.tx.nodePerGas ? BigInt(prepared.tx.nodePerGas) : 0n
        const supplied: AssessmentContext['supplied'] = {
          ...(theirPerGas !== undefined && nodePerGas > 0n
            ? {
                perGas: {
                  theirs: BigInt(theirPerGas),
                  node: nodePerGas,
                  gasLimit: BigInt(prepared.tx.gas),
                },
              }
            : {}),
          /*
            A replacement deliberately sits on a used number, so saying "this
            uses a used number" about a speed-up the user just pressed is noise
            that trains people past the warning (ES-BV-025).
          */
          ...(intent.tx.nonce !== undefined &&
          intent.replaces?.nonce !== parseInt(intent.tx.nonce, 16)
            ? { nonce: { theirs: parseInt(intent.tx.nonce, 16), next: prepared.nextNonce } }
            : {}),
        }
        const assessment = await this.assessment(
          intent.origin,
          intent.chainId,
          intent.tx.from,
          request,
          simulation,
          intent.expectedFee ?? null,
          intent.bridgeRecipient ?? null,
          Object.keys(supplied).length > 0 ? supplied : null,
        )
        const perGas =
          prepared.tx.type === 'eip1559'
            ? BigInt(prepared.tx.maxFeePerGas ?? '0x0')
            : BigInt(prepared.tx.gasPrice ?? '0x0')
        const symbol = getChain(intent.chainId)?.nativeCurrency.symbol ?? 'ETH'
        return {
          kind: 'send_transaction',
          tx: prepared.tx,
          ...(intent.signOnly ? { signOnly: true as const } : {}),
          ...(intent.replaces ? { replaces: intent.replaces } : {}),
          fee: {
            gasLimit: BigInt(prepared.tx.gas).toString(),
            maxTotalWei: (perGas * BigInt(prepared.tx.gas)).toString(),
            symbol,
          },
          assessment: toView(assessment, this.deps.platform.now()),
          clientRequestId: intent.clientRequestId,
        }
      }
    }
  }

  // ---- firewall -------------------------------------------------------------------

  private async assessment(
    origin: string,
    chainId: number,
    account: Hex,
    request: SignRequest,
    simulation: Simulation | null,
    expectedFee: { sink: Hex; bips: number } | null = null,
    bridgeRecipient: {
      hasCodeOnOrigin: boolean
      hasCodeOnDestination: boolean | null
    } | null = null,
    /** Fee and nonce the requester named itself, when it named them (§3.4). */
    supplied: AssessmentContext['supplied'] = null,
  ): Promise<Assessment> {
    const d = this.deps
    const settings = await d.settings.get()
    const accounts = await d.vault.accounts()
    const activity = await d.activity.list({ chainId }).catch(() => [] as ActivityEntry[])
    const sentTo = activity.filter((e) => e.category !== 'RECEIVE' && e.to).map((e) => e.to as Hex)
    const addressBook = d.addressBook ? await d.addressBook().catch(() => [] as string[]) : []
    const own = accounts.map((a) => a.address as Hex)
    /*
      Addresses that have only ever sent to this account, never been sent to.

      `RECIPIENT_POISON_SOURCE` reads this and it was read off the wrong field:
      a RECEIVE row's `to` is the user's own account, so the set was either
      empty or the user's own addresses, and the rule could not fire. The
      counterparty is `from`, which is what the schema documents it as.

      A duster plants a lookalike by sending a tiny amount; the address then
      appears in history and looks familiar. It is deliberately kept out of the
      lookalike reference set — §3.6 explains why including it would invert the
      attack — but choosing one as a recipient is worth saying out loud, and
      anything the user has actually sent to, saved, or owns is not a duster.
    */
    const referenced = new Set([...sentTo, ...addressBook, ...own].map((a) => a.toLowerCase()))
    const inboundOnly = [
      ...new Set(
        activity
          .filter((e) => e.category === 'RECEIVE' && e.from)
          .map((e) => (e.from as string).toLowerCase())
          .filter((a) => !referenced.has(a)),
      ),
    ] as Hex[]
    const contracts: Record<string, ContractInfo> = {}
    const balances: Record<string, bigint> = {}
    const probe: Hex[] = []
    if (request.kind === 'transaction' && request.tx.to) probe.push(request.tx.to)
    /*
      …and whatever the call is actually about, when the decoder names it
      separately: a launchpad pool, a bridge router, a farm, a marketplace.
      `newContract` reads `context.contracts` for the age and the verified
      flag, so a target nobody probed is a target the rule cannot judge.
    */
    if (request.kind === 'transaction') {
      const inner = decodeCalldata({
        chainId,
        to: request.tx.to,
        data: request.tx.data,
        value: request.tx.value,
      })
      const named =
        inner && 'to' in inner
          ? null
          : inner?.kind === 'launchpad'
            ? inner.pool
            : inner?.kind === 'limit_order'
              ? inner.manager
              : inner?.kind === 'farm_deposit' || inner?.kind === 'farm_withdraw'
                ? inner.farm
                : inner?.kind === 'seaport_fulfill'
                  ? inner.marketplace
                  : inner?.kind === 'dividends'
                    ? inner.distributor
                    : inner?.kind === 'nft_mint'
                      ? inner.minter
                      : inner?.kind === 'bridge'
                        ? inner.router
                        : inner?.kind === 'universal_router'
                          ? inner.router
                          : null
      if (named && !probe.some((a) => a.toLowerCase() === named.toLowerCase())) probe.push(named)
    }
    if (request.kind === 'typed_data') {
      const parsed = parseTypedData(request.typedData)
      const dec = parsed?.decoded
      if (dec && 'spender' in dec) probe.push(dec.spender)
    }
    for (const address of probe) {
      const code = (await d.chains
        .rpc(chainId, 'eth_getCode', [address, 'latest'])
        .catch(() => '0x')) as string
      const hasCode = typeof code === 'string' && code.length > 2
      /*
        `NEW_CONTRACT` wants the code's age and whether its source is published
        (§3.4), and neither is on the chain — only an explorer has them. The
        lookup is therefore bounded and fail-soft: cached per address, capped
        by a short deadline, and every failure answers "unknown", which the
        rule reads as nothing to say. A signature never waits on an explorer.
      */
      contracts[address.toLowerCase()] = hasCode
        ? { hasCode, ...(await this.contractFacts(chainId, address)) }
        : { hasCode }
    }
    if (request.kind === 'transaction' && request.tx.value > 0n) {
      const bal = (await d.chains
        .rpc(chainId, 'eth_getBalance', [account, 'latest'])
        .catch(() => null)) as string | null
      if (bal) balances['native'] = BigInt(bal)
    }
    /*
      The token's balance, for a token transfer.

      `LARGE_SEND` compares the amount against the balance of the asset being
      moved, and only the native balance was ever read — so the step-up worked
      for ETN and silently never fired for any token. `balanceOf(address)` is
      one `eth_call`; the selector is spelled out to avoid pulling an ABI into
      this file.
    */
    if (
      request.kind === 'transaction' &&
      request.tx.to &&
      request.tx.data.startsWith('0xa9059cbb')
    ) {
      const token = request.tx.to.toLowerCase()
      const callData = `0x70a08231${account.slice(2).toLowerCase().padStart(64, '0')}` as Hex
      const raw = (await d.chains
        .rpc(chainId, 'eth_call', [{ to: request.tx.to, data: callData }, 'latest'])
        .catch(() => null)) as string | null
      if (raw && raw.length > 2) {
        try {
          balances[token] = BigInt(raw)
        } catch {
          // a contract that answers something that is not a number tells us nothing
        }
      }
    }
    const tokens = d.tokenInfo
      ? await d
          .tokenInfo(chainId)
          .catch(() => ({}) as Record<string, { symbol: string; decimals: number; name?: string }>)
      : {}
    const labels: Record<string, string> = {}
    for (const [addr, info] of Object.entries(tokens)) labels[addr] = info.symbol
    await this.nameCounterparties(chainId, request, contracts, labels)
    const context: AssessmentContext = emptyContext({
      sentTo,
      inboundOnly,
      addressBook: addressBook as Hex[],
      tokens,
      labels,
      own,
      firstTimeOrigin: d.sites.registry.isFirstTime(origin),
      contracts,
      balances,
      nftFloors: await this.nftFloors(chainId, request),
      ethSignEnabled: settings.ethSignEnabled,
      /*
        Clamped, not trusted. A served threshold may make the wallet more careful
        and never less: a zero from a compromised or misconfigured service would
        switch the new-contract warning off, and that is the one failure a user
        has no way of noticing. Same shape as the fee ladder's ceiling.
      */
      newContractAfterDays: clampNewContractDays(this.servedNewContractDays),
      /*
        Settings › Spending, in token units (§3.4 point 6).

        The threshold used to be a tenth of the balance written into the rule
        with no setting behind it, and `sendWhitelist` was stored and read by
        nothing. Both arrive here now, and the rules do the rest. Nothing in
        this object is a fiat amount: a price feed must never be what decides
        whether a signature needs a second factor.
      */
      spendPolicy: {
        largeSendPercent: settings.largeSendPercent,
        allowList: settings.sendAllowList as Hex[],
        allowListOnly: settings.sendWhitelist,
      },
      now: d.platform.now(),
      // Our own swap must pay exactly what the schedule said (T10); anything else never sees the field.
      ...(origin === 'internal:swap' ? { expectedFee } : {}),
      /*
        What we would have charged, for a sheet ElectroSwap's own site raised
        (§8.6). It lets the statement name the fee and the rung instead of an
        anonymous address, and lets `walletFeeOvercharge` see a site charging
        above the rung.

        Only first-party origins, so this is one cached tier read on sheets
        raised by one site — not a chain call on every dApp signature. It is a
        reading and never an assertion: a failure answers null, the sheet says
        nothing about a wallet fee, and nothing is blocked for want of it.
      */
      ...(await this.walletFeeFor(origin, chainId)),
      ...(origin === 'internal:bridge' ? { bridgeRecipient } : {}),
      ...(supplied ? { supplied } : {}),
      originBudget: this.originBudget(origin, activity),
      lastCopiedAddress: this.lastCopiedAddress(),
      // The chain's own coin, so the primary statement names an asset rather
      // than the word "native" (§8.14 Networks).
      nativeSymbol: getChain(chainId)?.nativeCurrency.symbol ?? null,
      originVerified: !this.unverified.has(origin),
      ...(this.verdicts.get(origin)
        ? { originVerify: this.verdicts.get(origin)?.verify ?? null }
        : {}),
      scamOrigins: d.statics?.scamOrigins() ?? [],
    })
    return assess({ origin, chainId, account, request, context, simulation })
  }

  /**
   * What the origin may still spend (§4.6 `budget`, §3.4 `VALUE_EXCEEDS_BUDGET`).
   *
   * "Spent" is read off the history rather than a counter: the write-ahead row
   * exists before the signature does (§3.4 step 7), so the log is the one
   * record that cannot drift from what was actually sent, and a failed
   * transaction — which moved nothing — does not count against the cap. The
   * rows are the chain's, which is the right scope: a session is on one chain.
   */
  private originBudget(
    origin: string,
    activity: readonly ActivityEntry[],
  ): { limit: bigint; spent: bigint } | null {
    const budget = this.deps.sites.registry.get(origin)?.budget
    if (budget === undefined) return null
    let limit: bigint
    try {
      limit = BigInt(budget)
    } catch {
      return null
    }
    let spent = 0n
    for (const e of activity) {
      if (e.origin !== origin || e.status === 'failed') continue
      try {
        spent += BigInt(e.value)
      } catch {
        // a row whose value cannot be read is not evidence of a spend
      }
    }
    return { limit, spent }
  }

  /**
   * A name where the sheet would otherwise print six nibbles and four.
   *
   * `who()` reads `ctx.labels` before anything else, so one entry here names a
   * counterparty in every statement the sheet makes — while the address block
   * below the statements still shows all forty characters to check against,
   * which is the §3.6 safeguard this must not weaken.
   *
   * Only the addresses this request actually names are asked about: the `to`
   * of a plain send, and the recipient inside an ERC-20 transfer, which sits in
   * the calldata rather than in `to`. Asking about the history instead would be
   * one resolver round trip per row, for a sheet that prints none of them.
   *
   * Contracts are left out — §8.1 is explicit that a name is never shown for
   * one, and the code read a few lines above already says which addresses those
   * are, so the caller that "knows what it is labelling" is this one. A spender
   * is a contract by definition and is not asked about at all.
   *
   * Budgeted like the price read in `portfolio.snapshot`: a signature must
   * never wait on somebody else's resolver, so a slow answer is simply no
   * answer and the short address stands.
   */
  private async nameCounterparties(
    chainId: number,
    request: SignRequest,
    contracts: Record<string, ContractInfo>,
    labels: Record<string, string>,
  ): Promise<void> {
    const ask = this.deps.counterpartyNames
    if (!ask) return
    const wanted = new Set<string>()
    if (
      request.kind === 'transaction' &&
      request.tx.to &&
      contracts[request.tx.to.toLowerCase()]?.hasCode !== true
    )
      wanted.add(request.tx.to.toLowerCase())
    /*
      transfer(address,uint256): the recipient is the low 20 bytes of the first
      word. Read off the calldata rather than decoded, because `to` here is the
      token contract and the person being paid is never in `probe` — the
      commonest send in the wallet would otherwise be the one case with no name.
    */
    if (
      request.kind === 'transaction' &&
      request.tx.data.startsWith('0xa9059cbb') &&
      request.tx.data.length >= 74
    )
      wanted.add(`0x${request.tx.data.slice(34, 74)}`.toLowerCase())
    const addresses = [...wanted].filter((a) => labels[a] === undefined)
    if (addresses.length === 0) return
    const none: ReadonlyArray<{ address: string; name: string | null }> = []
    const named = await Promise.race([
      ask(chainId, addresses).catch(() => none),
      new Promise<ReadonlyArray<{ address: string; name: string | null }>>((resolve) =>
        setTimeout(() => resolve(none), NAME_BUDGET_MS),
      ),
    ])
    for (const { address, name } of named) if (name !== null) labels[address.toLowerCase()] ??= name
  }

  /** The §3.6 clipboard record, typed for the firewall. */
  private lastCopiedAddress(): { address: Hex; at: number } | null {
    const copied = this.deps.sites.lastCopiedAddress()
    return copied ? { address: copied.address as Hex, at: copied.at } : null
  }

  /**
   * A contract's age and whether its source is published — what `NEW_CONTRACT`
   * needs and the chain cannot say (§3.4).
   *
   * Cached for hours because neither fact changes on the timescale of a
   * signature, and failures are cached too: an explorer that is down must not
   * be asked again on every sheet. Nothing here can block a signature — the
   * deadline is short, every path answers `null` ("unknown"), and the rule
   * reads unknown as nothing to say.
   *
   * Only the contract address leaves, never the user's (§3.8). The shape is
   * Blockscout's v2 API, which is what Electroneum runs; an explorer that
   * answers something else simply stays unknown.
   */
  private async contractFacts(
    chainId: number,
    address: Hex,
  ): Promise<{ ageDays: number | null; verified: boolean | null }> {
    const key = `${chainId}:${address.toLowerCase()}`
    const now = this.deps.platform.now()
    const hit = this.contractFactsCache.get(key)
    const facts =
      hit && now - hit.at < CONTRACT_FACTS_TTL_MS
        ? hit.facts
        : await this.lookUpContract(chainId, address)
    if (!hit || now - hit.at >= CONTRACT_FACTS_TTL_MS)
      this.contractFactsCache.set(key, { at: now, facts })
    // Derived on every read, never stored: see `ContractFactsAt`.
    return { ageDays: this.ageDaysOf(facts.deployedAt), verified: facts.verified }
  }

  /** Epoch milliseconds to whole-and-fractional days, against this device's clock. */
  private ageDaysOf(deployedAt: number | null): number | null {
    if (deployedAt === null) return null
    return Math.max(0, (this.deps.platform.now() - deployedAt) / 86_400_000)
  }

  /**
   * The API first, the explorer second.
   *
   * The API answers from a shared cache, so the same contract is not fetched
   * once per wallet, and it is the only source the web interface can reach —
   * one lookup, one answer, both surfaces. It is also the only one that can
   * ever know about a contract the explorer has not indexed.
   *
   * The explorer stays as the fallback because the API is Electroneum-only and
   * can be unreachable, and because a wallet that cannot answer this question
   * silently stops warning about new contracts. Both paths answer "unknown" on
   * failure, which the rule reads as nothing to say.
   */
  private async lookUpContract(chainId: number, address: Hex): Promise<ContractFactsAt> {
    // Nobody can answer for this chain, so do not ask anybody (§3.4).
    if (!contractFactsAnswerable(chainId)) return UNKNOWN_CONTRACT_FACTS
    const fromApi = await this.deps.contractFacts?.(chainId, address).catch(() => null)
    if (typeof fromApi?.newAfterDays === 'number') this.servedNewContractDays = fromApi.newAfterDays
    if (fromApi && (fromApi.deployedAt !== null || fromApi.verified !== null))
      return { deployedAt: fromApi.deployedAt, verified: fromApi.verified }
    return this.readExplorer(chainId, address).catch(() => UNKNOWN_CONTRACT_FACTS)
  }

  private async readExplorer(chainId: number, address: Hex): Promise<ContractFactsAt> {
    const base = getChain(chainId)?.explorer?.url?.replace(/\/+$/, '')
    if (!base) return UNKNOWN_CONTRACT_FACTS
    const f = this.deps.fetch ?? globalThis.fetch
    const abort = new AbortController()
    const deadline = setTimeout(() => abort.abort(), EXPLORER_TIMEOUT_MS)
    try {
      const res = await f(`${base}/api/v2/addresses/${address}`, {
        signal: abort.signal,
        headers: { accept: 'application/json' },
      })
      if (!res.ok) return UNKNOWN_CONTRACT_FACTS
      const info = ExplorerAddressSchema.safeParse(await res.json())
      if (!info.success) return UNKNOWN_CONTRACT_FACTS
      const verified = info.data.is_verified ?? null
      // Blockscout renamed this field; both spellings are in the wild.
      const creation = info.data.creation_transaction_hash ?? info.data.creation_tx_hash ?? null
      let deployedAt: number | null = null
      if (creation) {
        const txRes = await f(`${base}/api/v2/transactions/${creation}`, {
          signal: abort.signal,
          headers: { accept: 'application/json' },
        })
        if (txRes.ok) {
          const tx = ExplorerTxSchema.safeParse(await txRes.json())
          const at = tx.success && tx.data.timestamp ? Date.parse(tx.data.timestamp) : Number.NaN
          if (Number.isFinite(at)) deployedAt = at
        }
      }
      return { deployedAt, verified }
    } finally {
      clearTimeout(deadline)
    }
  }

  /**
   * Collection floors for a Seaport order, so `SEAPORT_UNDERPRICED` has
   * something to call a listing cheap against (§3.4).
   *
   * Only for a Seaport typed-data request, only for the collections that order
   * actually offers, and only on Electroneum — the floors come from
   * ElectroSwap's own marketplace index, which is the only marketplace this
   * wallet knows. Cached, and fail-soft: no floor means no finding, never a
   * blocked signature. Only the collection address leaves (§3.8).
   */
  private async nftFloors(chainId: number, request: SignRequest): Promise<Record<string, bigint>> {
    if (request.kind !== 'typed_data') return {}
    if (chainId !== 52014 && chainId !== 5201420) return {}
    const decoded = parseTypedData(request.typedData)?.decoded
    if (!decoded || decoded.kind !== 'seaport_order') return {}
    const collections = [
      ...new Set(
        // Every leaf of a bulk tree, so the floor check covers the orders the
        // signature authorises rather than only the one it shows first.
        decoded.orders
          .flatMap((o) => o.offer)
          .filter((o) => o.itemType === SEAPORT_ERC721 || o.itemType === SEAPORT_ERC1155)
          .map((o) => o.token.toLowerCase()),
      ),
    ]
    if (!collections.length) return {}
    const now = this.deps.platform.now()
    const out: Record<string, bigint> = {}
    const wanted: string[] = []
    for (const address of collections) {
      const hit = this.floorCache.get(`${chainId}:${address}`)
      if (hit && now - hit.at < FLOOR_TTL_MS) {
        if (hit.wei !== null) out[address] = hit.wei
      } else wanted.push(address)
    }
    if (!wanted.length) return out
    const client = this.market()
    if (!client) return out
    try {
      const rows = await fetchCollections(client, chainId, { addresses: wanted }, wanted.length)
      const seen = new Set<string>()
      for (const row of rows) {
        const address = row.address.toLowerCase()
        seen.add(address)
        const wei = floorToWei(row.floorEtn)
        this.floorCache.set(`${chainId}:${address}`, { at: now, wei })
        if (wei !== null) out[address] = wei
      }
      // A collection the index does not know has no floor; remember that too.
      for (const address of wanted)
        if (!seen.has(address)) this.floorCache.set(`${chainId}:${address}`, { at: now, wei: null })
    } catch {
      // The marketplace index is not reachable: the order is simply assessed without a floor.
    }
    return out
  }

  /**
   * Keyed by the prepared transaction rather than the approval id, because the
   * preview is produced before the approval exists and belongs to exactly
   * these bytes at exactly this nonce.
   */
  private static snapshotKey(chainId: number, tx: PreparedTx): string {
    return `${chainId}:${tx.from.toLowerCase()}:${tx.nonce}:${tx.to ?? ''}:${tx.value}:${tx.data}`
  }

  private rememberSnapshot(key: string, simulation: Simulation | null): void {
    const snapshot = snapshotOf(simulation)
    if (!snapshot) return
    const now = this.deps.platform.now()
    // An approval that is never decided expires; its snapshot must not outlive it.
    for (const [k, v] of this.snapshots) if (now - v.at > APPROVAL_TTL_MS) this.snapshots.delete(k)
    this.snapshots.set(key, { at: now, snapshot })
  }

  private takeSnapshot(key: string): SimulationSnapshot | null {
    const hit = this.snapshots.get(key)
    if (!hit) return null
    this.snapshots.delete(key)
    return hit.snapshot
  }

  /** ElectroSwap's GraphQL, built once. The same endpoint the trace route sits beside (§9.2). */
  private market(): ElectroSwapClient | null {
    if (this.marketClient) return this.marketClient
    const d = this.deps
    if (!d.apiOrigin) return null
    const url = `${d.apiOrigin.replace(/\/+$/, '')}/graphql`
    const key = d.clientKey
    this.marketClient = new ElectroSwapClient({
      url,
      fetchImpl: d.fetch ?? globalThis.fetch,
      // The API verifies the signature over an EMPTY body on this route (see create.ts).
      ...(key
        ? {
            authHeaders: (method: string, at: string) =>
              authHeaders({ key, method, url: at, now: d.platform.now() }),
          }
        : {}),
    })
    return this.marketClient
  }

  /**
   * What this transaction moves, before it is signed.
   *
   * Two sources, tried in order. A `trace` URL pinned on the chain is somebody
   * running their own node with the debug namespace, and it wins — a developer
   * pointing the wallet at a local geth should get their own trace. Otherwise
   * our API's `POST /api/wallet/trace`, which is the only way this works on
   * Electroneum: `etn-sc` is a custom port carrying the debug namespace and no
   * public RPC on the network has it, but that node is deliberately not on the
   * internet, so the API fronts one validated `debug_traceCall` — never a
   * general `debug_*` passthrough.
   *
   * Failure never blocks a signature. Everything here falls through to the gas
   * estimate, which is still a real revert check; the difference is only whether
   * the sheet can also say what moves, and `note` carries the reason when a
   * tracer was reached and could not answer.
   */
  private async simulate(
    chainId: number,
    prepared: { tx: PreparedTx; estimateError: string | null },
    request: SignRequest,
  ): Promise<Simulation> {
    const d = this.deps
    if (request.kind !== 'transaction') return NO_SIMULATION
    const traceUrl = await d.chains.traceUrl(chainId)
    if (traceUrl) {
      const f = d.fetch ?? globalThis.fetch
      try {
        const res = await f(traceUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'debug_traceCall',
            params: [
              /*
                The traced call is the transaction, fields and all.

                `nonce` and the fee fields were left out, so the node simulated
                a slightly different call from the one about to be broadcast —
                and a contract that reads `tx.gasprice`, or behaves differently
                at a particular nonce, previews as one thing and executes as
                another. They cost nothing to include.
              */
              {
                from: prepared.tx.from,
                to: prepared.tx.to,
                value: prepared.tx.value,
                data: prepared.tx.data,
                gas: prepared.tx.gas,
                nonce: `0x${prepared.tx.nonce.toString(16)}`,
                ...(prepared.tx.maxFeePerGas ? { maxFeePerGas: prepared.tx.maxFeePerGas } : {}),
                ...(prepared.tx.maxPriorityFeePerGas
                  ? { maxPriorityFeePerGas: prepared.tx.maxPriorityFeePerGas }
                  : {}),
                ...(prepared.tx.gasPrice ? { gasPrice: prepared.tx.gasPrice } : {}),
              },
              'latest',
              { tracer: 'callTracer', tracerConfig: { withLog: true } },
            ],
          }),
        })
        const json = (await res.json()) as { result?: unknown; error?: { message?: string } }
        const frame = parseTraceFrame(json.result)
        if (frame) return withEstimate(simulationFromTrace(frame, request.tx.from), prepared)
      } catch {
        // fall through to the API, then to the estimate
      }
    }
    const viaApi = await this.traceViaApi(chainId, prepared, request)
    if (viaApi) return viaApi
    return estimateSimulation(BigInt(prepared.tx.gas), prepared.estimateError)
  }

  /** One trace through our own API. Null when there is nothing to say beyond the estimate. */
  private async traceViaApi(
    chainId: number,
    prepared: { tx: PreparedTx; estimateError: string | null },
    request: SignRequest & { kind: 'transaction' },
  ): Promise<Simulation | null> {
    const d = this.deps
    // The route is key-gated, and a build with no key has no business asking.
    if (!d.apiOrigin || !d.clientKey) return null
    /*
      The preview is opt-out.

      Getting one means posting the signing address and the full calldata of
      every dApp transaction to ElectroSwap's API — before anything is signed,
      and whether or not the transaction is ever sent. That is the price of
      seeing what a transaction moves on a chain whose public RPCs cannot
      trace, and it is a price worth paying by default; it is not one to charge
      silently. Turned off, the local gas-estimate check still catches a
      revert.
    */
    if ((await d.settings.get()).txPreview === 'off') return null
    // A deploy has no `to`, which the route requires — and a trace of a
    // constructor would not tell the signer anything the code does not.
    const to = prepared.tx.to
    if (!to) return null
    const f = d.fetch ?? globalThis.fetch
    try {
      const url = `${d.apiOrigin}/api/wallet/trace`
      // Same fields as the direct trace above: the preview must describe the transaction that will be sent.
      const body = JSON.stringify({
        chainId,
        from: prepared.tx.from,
        to,
        value: prepared.tx.value,
        data: prepared.tx.data,
        gas: prepared.tx.gas,
        nonce: `0x${prepared.tx.nonce.toString(16)}`,
        ...(prepared.tx.maxFeePerGas ? { maxFeePerGas: prepared.tx.maxFeePerGas } : {}),
        ...(prepared.tx.maxPriorityFeePerGas
          ? { maxPriorityFeePerGas: prepared.tx.maxPriorityFeePerGas }
          : {}),
        ...(prepared.tx.gasPrice ? { gasPrice: prepared.tx.gasPrice } : {}),
      })
      const res = await f(url, {
        method: 'POST',
        // A signature over this exact call, not the key (§9.1): a header lifted
        // out of devtools cannot be pointed at a different, more expensive trace.
        headers: {
          'content-type': 'application/json',
          ...authHeaders({ key: d.clientKey, method: 'POST', url, body, now: d.platform.now() }),
        },
        body,
      })
      const json = (await res.json()) as {
        result?: unknown
        error?: { code?: number; message?: string }
      }
      const frame = parseTraceFrame(json.result)
      if (frame) return withEstimate(simulationFromTrace(frame, request.tx.from), prepared)
      /*
        -32002 is "tracing is not enabled" — the one case the plain message is
        for. Anything else is a tracer that exists and could not answer this
        call (busy, timed out, the node refused), and the signer deserves that
        sentence rather than being told the network cannot do it.
      */
      const err = json.error
      if (err && err.code !== -32002 && err.message)
        return estimateSimulation(
          BigInt(prepared.tx.gas),
          prepared.estimateError,
          // The service's own words, rendered on the sheet: bounded and
          // stripped like every other remote string (ES-BV-024).
          `The preview service could not trace this: ${untrusted(err.message, 200)}.`,
        )
    } catch {
      // Unreachable API: no preview, and no explanation worth showing either.
    }
    return null
  }

  // ---- transactions ---------------------------------------------------------------

  /** (chain:account) → the nonces this wallet has handed out but not yet seen on chain. */
  /**
   * Activity rows with a live receipt watcher, and the timer each is waiting
   * on. A map rather than a set so `dispose()` can end them: a watcher that
   * outlives its engine keeps a poll running against a chain nobody is
   * listening to any more.
   */
  private readonly watching = new Map<string, ReturnType<typeof setTimeout> | null>()
  private readonly reservedNonces = new Map<string, Array<{ nonce: number; at: number }>>()

  /**
   * Give a reserved nonce back (§3.4).
   *
   * Reservations were pruned only by age or by the chain moving past them, so
   * rejecting a sheet held its number for the full five minutes: the next send
   * took N+1 and sat behind a hole that nothing would ever fill, showing
   * "pending" until the reservation expired and the user re-sent. Electroneum
   * has no speed-up path, so there was nothing the person could do about it.
   */
  private releaseNonce(chainId: number, from: Hex, nonce: number): void {
    const key = `${chainId}:${from.toLowerCase()}`
    const live = this.reservedNonces.get(key)
    if (!live) return
    const i = live.findIndex((r) => r.nonce === nonce)
    if (i >= 0) live.splice(i, 1)
    if (live.length === 0) this.reservedNonces.delete(key)
  }

  /** The nonce an approval is holding, when it is holding one. */
  private static reservationOf(
    request: ApprovalRequest,
  ): { chainId: number; from: Hex; nonce: number } | null {
    const payload = request.payload as {
      kind?: string
      tx?: { from?: string; nonce?: number }
    } | null
    if (payload?.kind !== 'send_transaction' || !payload.tx || request.chainId === null) return null
    const { from, nonce } = payload.tx
    if (typeof from !== 'string' || typeof nonce !== 'number') return null
    return { chainId: request.chainId, from: from as Hex, nonce }
  }

  /**
   * Is there a number below this one that neither the chain nor this wallet
   * accounts for? That is a transaction which will sit in the pool for ever.
   */
  private nonceHole(chainId: number, from: Hex, pending: number, nonce: number): boolean {
    if (nonce <= pending) return false
    const held = new Set(
      (this.reservedNonces.get(`${chainId}:${from.toLowerCase()}`) ?? []).map((r) => r.nonce),
    )
    for (let n = pending; n < nonce; n++) if (!held.has(n)) return true
    return false
  }

  private reserveNonce(chainId: number, from: Hex, onChain: number): number {
    const key = `${chainId}:${from.toLowerCase()}`
    const now = this.deps.platform.now()
    // An approval cannot outlive its TTL, so neither can its claim on a nonce.
    const live = (this.reservedNonces.get(key) ?? []).filter(
      (r) => now - r.at < APPROVAL_TTL_MS && r.nonce >= onChain,
    )
    const highest = live.reduce((m, r) => Math.max(m, r.nonce), onChain - 1)
    const nonce = Math.max(onChain, highest + 1)
    live.push({ nonce, at: now })
    this.reservedNonces.set(key, live)
    return nonce
  }

  private async prepare(
    chainId: number,
    tx: TxParams,
  ): Promise<{ tx: PreparedTx; estimateError: string | null; nextNonce: number }> {
    const rpc = (method: string, params: readonly unknown[]): Promise<unknown> =>
      this.deps.chains.rpc(chainId, method, params)
    const value = tx.value ?? '0x0'
    const data = tx.data ?? '0x'
    const to = tx.to ?? null
    /*
      A nonce nobody else in this wallet is already holding.

      `eth_getTransactionCount(pending)` only counts what the node has seen. Two
      approvals prepared before either is broadcast — a dApp asking twice, or a
      send raised while a swap sheet is open — both read the same number, and
      the second transaction to arrive replaces the first at the same nonce.
      One of them silently never happens, and which one is a race.

      Reservations are held per (chain, account) for the approval's lifetime and
      pruned by age, so a request that is abandoned or expires gives its number
      back without needing a settle hook.
    */
    const pendingCount = parseInt(
      String(await rpc('eth_getTransactionCount', [tx.from, 'pending'])),
      16,
    )
    const nextNonce = Number.isFinite(pendingCount) ? pendingCount : 0
    /*
      A supplied nonce is honoured — replacement flows need one — but it is no
      longer silent. `nonceNotNext` says so on the sheet when it is not this
      account's next free number, because a nonce above the pending count sits
      in the pool as a gap and executes whenever later sends fill it in.
    */
    const nonce =
      tx.nonce !== undefined
        ? parseInt(tx.nonce, 16)
        : this.reserveNonce(chainId, tx.from, nextNonce)
    let gas: bigint
    let estimateError: string | null = null
    /*
      The revert check runs whether or not a limit was supplied.

      `eth_estimateGas` is two things at once: a size, and the only cheap proof
      that the call does not revert. Skipping it because `tx.gas` was given
      dropped the second along with the first, and `SIM_INCOMPLETE` then told
      the user "only the revert check ran" about a check that had not. The
      supplied limit is still what gets signed; the estimate only decides
      whether the sheet may claim the call goes through.
    */
    try {
      const est = BigInt(
        String(
          await rpc('eth_estimateGas', [{ from: tx.from, ...(to ? { to } : {}), value, data }]),
        ),
      )
      gas = tx.gas !== undefined ? BigInt(tx.gas) : (est * 12n) / 10n
    } catch (err) {
      estimateError = err instanceof Error ? err.message : String(err)
      gas = tx.gas !== undefined ? BigInt(tx.gas) : data === '0x' && to ? 21_000n : 500_000n
    }
    const block = (await rpc('eth_getBlockByNumber', ['latest', false]).catch(() => null)) as {
      baseFeePerGas?: string
    } | null
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n
    let fees: Pick<PreparedTx, 'type' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'>
    /*
      What the node itself would charge, worked out even when the request names
      a price. It is what the fee editor's band is anchored on and what
      `feeExcessive` compares against; without it, a dApp's number was both the
      price and the yardstick for judging the price.
    */
    let nodePerGas = 0n
    if (tx.gasPrice !== undefined) {
      fees = { type: 'legacy', gasPrice: tx.gasPrice }
      nodePerGas = BigInt(String(await rpc('eth_gasPrice', []).catch(() => '0x0')))
    } else if (baseFee > 0n || tx.maxFeePerGas !== undefined) {
      const nodeTip = BigInt(
        String(await rpc('eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00')),
      )
      const tip = tx.maxPriorityFeePerGas !== undefined ? BigInt(tx.maxPriorityFeePerGas) : nodeTip
      const max = tx.maxFeePerGas !== undefined ? BigInt(tx.maxFeePerGas) : baseFee * 2n + tip
      nodePerGas = baseFee * 2n + nodeTip
      fees = {
        type: 'eip1559',
        maxFeePerGas: `0x${max.toString(16)}`,
        maxPriorityFeePerGas: `0x${tip.toString(16)}`,
      }
    } else {
      const gasPrice = BigInt(String(await rpc('eth_gasPrice', [])))
      nodePerGas = gasPrice
      fees = { type: 'legacy', gasPrice: `0x${gasPrice.toString(16)}` }
    }
    return {
      tx: {
        from: tx.from,
        to,
        value,
        data,
        nonce,
        gas: `0x${gas.toString(16)}`,
        ...fees,
        ...(nodePerGas > 0n ? { nodePerGas: `0x${nodePerGas.toString(16)}` } : {}),
      },
      estimateError,
      nextNonce,
    }
  }

  private async execute(
    intent: ApprovalIntent,
    request: ApprovalRequest,
    data: unknown,
  ): Promise<unknown> {
    const d = this.deps
    /*
      Who, where and on whose behalf come from the record, never from the live
      intent. The record is what the sheet rendered and the firewall assessed;
      the intent can still be replaced after the sheet is up, because a re-sent
      request re-attaches to a pending one. `approve()` now refuses a re-attach
      that does not match, and this is the second half of the same guarantee:
      even if one slipped through, the signature would still be taken on the
      approved chain, for the approved account, in the approved origin's name.
    */
    const chainId = request.chainId ?? intent.chainId
    const accountId = request.accountId ?? ('accountId' in intent ? intent.accountId : '')
    const origin = request.origin
    switch (intent.kind) {
      case 'connect': {
        const parsed = ConnectDecisionDataSchema.safeParse(data)
        const accounts = await d.vault.accounts()
        const account = parsed.success
          ? accounts.find((a) => a.id === parsed.data.accountId)
          : ((await d.vault.active()) ?? accounts[0])
        if (!account) throw new RpcError(RPC.UNAUTHORIZED, 'No account to connect.')
        const connectChainId =
          parsed.success && d.chains.known(parsed.data.chainId) ? parsed.data.chainId : chainId
        return { accountId: account.id, addresses: [account.address], chainId: connectChainId }
      }
      case 'switch_chain':
      case 'add_chain':
        return null
      case 'watch_asset': {
        const opts =
          intent.type === 'ERC20' ? WatchAssetOptionsSchema.safeParse(intent.options) : null
        if (!opts?.success)
          throw new RpcError(
            RPC.INVALID_PARAMS,
            'wallet_watchAsset needs an ERC20 with a contract address.',
          )
        await d.watchAsset?.({
          chainId,
          address: opts.data.address,
          origin,
          claimed: {
            ...(opts.data.symbol ? { symbol: opts.data.symbol } : {}),
            ...(opts.data.decimals !== undefined ? { decimals: opts.data.decimals } : {}),
          },
        })
        return true
      }
      // Every case below signs the bytes the approval record holds, for the
      // account and on the chain it names (§3.3, §3.4).
      case 'sign_message': {
        const payload = request.payload as Extract<ApprovalPayload, { kind: 'sign_message' }>
        const account = await this.signer(accountId)
        const message = { raw: payload.message as Hex }
        const signature = await account.signMessage({ message })
        ProviderService.assertSignedBy(
          await recoverMessageAddress({ message, signature }),
          account.address,
          'message',
        )
        return signature
      }
      case 'eth_sign': {
        const payload = request.payload as Extract<ApprovalPayload, { kind: 'eth_sign' }>
        const account = await this.signer(accountId)
        // A device never signs a raw hash (§4.6: eth_sign is 4200 for hardware accounts).
        if (!account.sign)
          throw new RpcError(RPC.UNSUPPORTED_METHOD, 'This account cannot sign a raw hash.')
        const signature = await account.sign({ hash: payload.hash as Hex })
        ProviderService.assertSignedBy(
          await recoverAddress({ hash: payload.hash as Hex, signature }),
          account.address,
          'message',
        )
        return signature
      }
      case 'sign_typed_data': {
        const payload = request.payload as Extract<ApprovalPayload, { kind: 'sign_typed_data' }>
        const account = await this.signer(accountId)
        const typed = normaliseTypedData(
          typeof payload.typedData === 'string' ? safeJson(payload.typedData) : payload.typedData,
        )
        const signature = await account.signTypedData(typed as never)
        // Recovered against the very object that was signed, not a re-derivation of it.
        ProviderService.assertSignedBy(
          await recoverTypedDataAddress({
            ...(typed as Record<string, unknown>),
            signature,
          } as never),
          account.address,
          'message',
        )
        return signature
      }
      case 'send_transaction': {
        const payload = request.payload as Extract<ApprovalPayload, { kind: 'send_transaction' }>
        /*
          The sheet may change the price of gas and nothing else. It is clamped
          and filtered here rather than trusted, because this is the last point
          before a signature: a decision payload carrying `to`, `value`, `data`
          or `nonce` must not be able to reach the signer through this door.
          `prepare` runs before the approval exists, so a choice made on the
          sheet can only arrive this way.
        */
        const fee = applyGasDecision(payload.tx, data)
        const tx = fee ? { ...payload.tx, ...fee } : payload.tx
        // Sign-and-return versus broadcast is a property of the approved
        // request, not of whatever re-sent it.
        if (payload.signOnly === true) return this.signOnly(chainId, accountId, tx)
        return this.broadcast(
          { chainId, accountId, origin, replaces: payload.replaces ?? null },
          request,
          tx,
          payload.assessment,
        )
      }
    }
  }

  private async signer(accountId: string): Promise<LocalAccount> {
    const pk = await this.deps.vault.privateKeyFor(accountId)
    if (pk) return privateKeyToAccount(pk)
    // Hardware accounts: the device signs; the engine only moves bytes (§3.3).
    const account = (await this.deps.vault.accounts()).find((a) => a.id === accountId)
    if (account && this.deps.hardware) {
      try {
        const device = await this.deps.hardware.signerFor(account)
        if (device) return device
      } catch (err) {
        throw new RpcError(
          RPC.INTERNAL,
          err instanceof Error ? err.message : 'The device did not answer.',
        )
      }
    }
    // Not signable here: a paired device that can may (§6, §8.16).
    if (account && this.remote) {
      const far = await this.remote.signerFor(account)
      if (far) return far
    }
    throw new RpcError(RPC.UNAUTHORIZED, 'This account cannot sign here.')
  }

  /*
    Every signature this engine hands back is recovered against the address it
    was asked for, first.

    Nothing else checks it. A device that answers the wrong request, a path
    that selects the wrong account, a transport that swaps bytes in flight, a
    device picked by a model-level id when two are plugged in — all of them end
    with a valid signature from the wrong key, and without this the wallet
    broadcasts it and the funds leave an account the user never chose. It is
    one `recover` per signature, and it turns a whole class of silent failures
    into a loud one.
  */
  private static assertSignedBy(got: string, expected: string, what: string): void {
    if (got.toLowerCase() === expected.toLowerCase()) return
    throw new RpcError(
      RPC.INTERNAL,
      `The ${what} was signed by a different account than the one selected. Check that the right device is connected and the right account is chosen.`,
    )
  }

  /** Remote sign, the signing side: the prepared fields exactly as the requester sent them, signed and returned raw (§6). */
  private async signOnly(chainId: number, accountId: string, tx: PreparedTx): Promise<Hex> {
    const account = await this.signer(accountId)
    const serialized = await account.signTransaction(toSerializable(chainId, tx))
    ProviderService.assertSignedBy(
      await recoverTransactionAddress({ serializedTransaction: serialized as never }),
      account.address,
      'transaction',
    )
    return serialized
  }

  private async broadcast(
    /** Chain, account and origin as the approved record names them — never the live intent's. */
    bound: {
      readonly chainId: number
      readonly accountId: string
      readonly origin: string
      readonly replaces?: ReplacedTx | null
    },
    request: ApprovalRequest,
    tx: PreparedTx,
    assessment: AssessmentView,
  ): Promise<Hex> {
    const d = this.deps
    const { chainId, accountId, origin } = bound
    const replaces = bound.replaces ?? null
    // Already broadcast before a restart? The write-ahead entry carries the hash.
    const rows = await d.activity.list({ chainId: chainId }).catch(() => [] as ActivityEntry[])
    const prior = rows.find((e) => e.id === request.id)
    if (prior?.hash) return prior.hash as Hex
    /*
      One unresolved transaction per number (ES-BV-002).

      A row that is `pending` with a hash on it may well be on the chain, so
      signing a second transaction at the same nonce is either a replacement —
      which says so — or the double spend this finding is about. The in-memory
      nonce reservation does not survive a restart; the rows do.
    */
    if (!replaces) {
      /*
        `dropped` belongs here too (ES-BV-064).

        "Dropped" is what the wallet writes when the node it asked did not know
        the hash, and the node it asked is not always the node that took the
        bytes. Until the chain has moved past the number, that transaction may
        still be in somebody's pool, and a fresh send at the same nonce would
        leave two different transactions racing for one slot with the user
        unable to say which one they will get. A replacement — speed up or
        cancel — is the way past it, and says so.
      */
      const clash = rows.find(
        (e) =>
          e.id !== request.id &&
          e.accountId === accountId &&
          e.nonce === tx.nonce &&
          (e.status === 'pending' || e.status === 'unknown' || e.status === 'dropped'),
      )
      // Once the chain has used the number there is nothing left to race.
      const settledOnChain =
        clash === undefined
          ? false
          : await d.chains
              .rpc(chainId, 'eth_getTransactionCount', [tx.from, 'latest'])
              .then((n) => {
                const mined = parseInt(String(n), 16)
                return Number.isFinite(mined) && mined > tx.nonce
              })
              .catch(() => false)
      if (clash && !settledOnChain)
        throw new RpcError(
          RPC.INTERNAL,
          'There is already an unresolved transaction at this position in the queue. Wait for it to settle, or speed it up, before sending another.',
        )
    }
    const snapshot = this.takeSnapshot(ProviderService.snapshotKey(chainId, tx))
    const entry: ActivityEntry = {
      id: request.id,
      hash: null,
      chainId: chainId,
      accountId: accountId,
      to: tx.to,
      value: BigInt(tx.value).toString(),
      nonce: tx.nonce,
      // Kept so a stuck transaction can be re-sent at the same nonce with a
      // higher fee; without it Speed up has nothing to repeat (§8.12).
      ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {}),
      submittedAt: d.platform.now(),
      origin: origin,
      category: categoryFor(assessment, tx, origin),
      statements: assessment.statements.map((s) => s.text),
      riskCodes: assessment.rules.map((r) => r.code),
      status: 'pending',
      blockNumber: null,
      /*
        §3.4 step 7 asks for the simulation snapshot beside the statements and
        the risk codes, "so Activity can show what the user was told". Only the
        mode ever crossed into the approval payload, so the row could say a
        preview happened but never what it said.
      */
      ...(snapshot ? { simulation: snapshot } : {}),
      // What a later speed-up has to beat (ES-BV-025).
      fees: {
        ...(tx.maxFeePerGas ? { maxFeePerGas: tx.maxFeePerGas } : {}),
        ...(tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: tx.maxPriorityFeePerGas } : {}),
        ...(tx.gasPrice ? { gasPrice: tx.gasPrice } : {}),
      },
    }
    // Write-ahead (§3.4 step 7): the row exists before the signature, so a device refusal or a lost worker still leaves a trace.
    if (!prior) await d.activity.append(entry)
    let raw: Hex
    try {
      const account = await this.signer(accountId)
      /*
        The queue may have moved while the sheet was open. Re-signing with a
        new nonce here would sign something the user never saw, so the request
        fails instead and can be raised again with a current one.
      */
      const pending = parseInt(
        String(await d.chains.rpc(chainId, 'eth_getTransactionCount', [tx.from, 'pending'])),
        16,
      )
      /*
        A replacement is *meant* to sit on a number the pool already holds
        (ES-BV-025). While the original waits there the pending count reads
        `nonce + 1`, so the plain "your place was taken" test fired on every
        speed-up and cancel and neither could ever reach the node. For a
        replacement the number has to still be un-mined, which is exactly
        `pending === nonce + 1`; anything higher means the original (or
        something else) already settled and there is nothing left to replace.
      */
      const ceiling = replaces ? tx.nonce + 1 : tx.nonce
      if (Number.isFinite(pending) && pending > ceiling)
        throw new RpcError(
          RPC.INTERNAL,
          replaces
            ? 'That transaction already settled, so there is nothing left to replace.'
            : 'This transaction\u2019s place in the queue was taken while the sheet was open. Ask again.',
        )
      /*
        …and a hole below it is just as bad. Broadcasting behind a gap that
        nothing will ever fill leaves a transaction that says "pending" and
        does not mine, which is the shape a stale reservation used to produce.

        "Behind the pending count" is not the test, though: a node takes a
        moment to report what it has just accepted, so a second send moments
        after the first would be refused for a gap this wallet is itself about
        to fill. What is refused is a gap nothing holds — a number below this
        one that no live reservation of ours accounts for.
      */
      if (
        !replaces &&
        Number.isFinite(pending) &&
        this.nonceHole(chainId, tx.from as Hex, pending, tx.nonce)
      )
        throw new RpcError(
          RPC.INTERNAL,
          'This transaction would wait behind one that was never sent. Ask again.',
        )
      raw = await account.signTransaction(toSerializable(chainId, tx))
      // Before it can be broadcast, it has to have come from the account we asked.
      ProviderService.assertSignedBy(
        await recoverTransactionAddress({ serializedTransaction: raw as never }),
        account.address,
        'transaction',
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'signing failed'
      /*
        A mis-pressed reject on a Ledger is not a failed transaction.

        `settle(…, retryable)` returns such a request to `pending` so the same
        approval can be signed again — but the row was marked `failed` for any
        signing error at all, the successful retry found the write-ahead entry
        and skipped the append, and the hash update did not reset the status.
        The row then read `failed` with a hash on it, and `resumeWatchers`
        (which re-watches `pending` rows only) would not pick it up after a
        restart, so a confirmed transaction stayed recorded as failed forever.
      */
      const retryable = isRetryable(err)
      await d.activity
        .update(request.id, {
          ...(retryable ? {} : { status: 'failed' as const }),
          statements: [...entry.statements, reason],
        })
        .catch(() => undefined)
      /*
        A device refusal goes back up as itself. Wrapping it in an `RpcError`
        told the caller "the wallet refused", which is how a mis-pressed reject
        came to be final: the retry loop reads an `RpcError` as our own,
        unrepeatable answer. The port boundary converts whatever reaches it for
        the dApp, so nothing downstream loses an error shape it needs.
      */
      throw err instanceof RpcError || retryable ? err : new RpcError(RPC.INTERNAL, reason)
    }
    /*
      The hash exists before the send, not after it (ES-BV-002).

      A signed transaction's hash is `keccak256` of its own bytes — the node
      does not assign it, it only agrees. Writing it first means every error
      from here on is about *delivery*, and there is always a hash to ask the
      chain about. Before this the row carried `hash: null` and any error at
      all wrote `failed`, so a response lost at the ten-second timeout after
      the node had already accepted the bytes told the user nothing happened.
      They sent again, and both mined.
    */
    const localHash = keccak256(raw)
    await d.activity.update(request.id, { hash: localHash, status: 'pending' }).catch(() => undefined)
    try {
      const sent = (await d.chains.rpc(chainId, 'eth_sendRawTransaction', [raw])) as string
      const hash = /^0x[0-9a-fA-F]{64}$/.test(String(sent)) ? (sent as Hex) : localHash
      // `status` back to pending along with the hash: a retry after a refusal
      // is a transaction that happened, whatever the last attempt wrote.
      await d.activity.update(request.id, { hash, status: 'pending' })
      await this.markReplaced(replaces)
      this.watch(chainId, request.id, hash, { from: tx.from as Hex, nonce: tx.nonce })
      return hash
    } catch (err) {
      const reason = broadcastReason(err)
      /*
        Three answers, not two.

        "Possibly sent" is a transport that broke after the bytes left, or a
        node that says it has seen this transaction before — which is what the
        second endpoint of a failover pair says once the first one accepted it.
        None of those mean the transaction did not happen, so the row stays
        `pending` with its hash, the nonce reservation stays held, and the
        watcher decides from the chain. Only an answer that names the bytes as
        invalid is final, and even then the node is asked whether it knows the
        hash before anything is written off.
      */
      if (possiblySent(err)) {
        await d.activity
          .update(request.id, { status: 'pending', statements: [...entry.statements, reason] })
          .catch(() => undefined)
        this.watch(chainId, request.id, localHash, { from: tx.from as Hex, nonce: tx.nonce })
        return localHash
      }
      if (await this.nodeKnows(chainId, localHash)) {
        await d.activity
          .update(request.id, { status: 'pending', statements: [...entry.statements, reason] })
          .catch(() => undefined)
        this.watch(chainId, request.id, localHash, { from: tx.from as Hex, nonce: tx.nonce })
        return localHash
      }
      // Definitively refused: say why on the row, the way a signing error does.
      await d.activity
        .update(request.id, { status: 'failed', statements: [...entry.statements, reason] })
        .catch(() => undefined)
      throw new RpcError(RPC.INTERNAL, reason)
    }
  }

  /** The row a successful replacement supersedes stops saying "pending". */
  private async markReplaced(replaces: ReplacedTx | null): Promise<void> {
    if (!replaces?.hash) return
    const rows = await this.deps.activity.list({}).catch(() => [] as ActivityEntry[])
    const old = rows.find((e) => e.hash === replaces.hash)
    if (old && old.status === 'pending')
      await this.deps.activity.update(old.id, { status: 'replaced' }).catch(() => undefined)
  }

  /** Does the node have this transaction, whatever it said about the send? */
  private async nodeKnows(chainId: number, hash: Hex): Promise<boolean> {
    for (let i = 0; i < 3; i += 1) {
      const known = await this.deps.chains
        .rpc(chainId, 'eth_getTransactionByHash', [hash])
        .catch(() => null)
      if (known) return true
    }
    return false
  }

  /**
   * Follow a broadcast transaction to a settled row (ES-BV-049).
   *
   * Three things the fixed 120-poll loop could not say. A transaction the node
   * has forgotten — evicted, or replaced by one of ours at the same nonce —
   * left the row `pending` forever; it is now `dropped`. A receipt was taken
   * as final on sight, so a row could read `confirmed` for a block that was
   * then reorganised away; the receipt is re-read `CONFIRM_DEPTH` blocks later
   * before the row settles. And running out of attempts said nothing at all;
   * it now says `unknown`, which is a state the user can act on.
   *
   * The budget is wall-clock rather than a count, so the answer does not
   * depend on how fast the chain's poll cadence happens to be.
   */
  private watch(chainId: number, id: string, hash: Hex, held: { from: Hex; nonce: number } | null = null): void {
    const d = this.deps
    // One watcher per row: a retry, a resume and a re-broadcast all land here.
    if (this.watching.has(id)) return
    /*
      A receipt is worth asking for about once a block, and never faster than
      the wallet polls anything else — `blockTimeMs` alone had this asking
      Arbitrum every 250 ms, a hundred and twenty times, for one transaction.
    */
    const every = d.receiptPollMs ?? pollMs(chainId, 'foreground')
    const started = d.platform.now()
    // Every timer this watcher owns, so `dispose()` can end it and a settled
    // row leaves nothing running behind it.
    const arm = (fn: () => void, ms: number): void => {
      if (!this.watching.has(id)) return
      const timer = setTimeout(() => {
        this.watching.set(id, null)
        fn()
      }, ms)
      this.watching.set(id, timer)
    }
    const stop = (): void => {
      const timer = this.watching.get(id)
      if (timer) clearTimeout(timer)
      this.watching.delete(id)
    }
    this.watching.set(id, null)
    const settle = async (patch: Partial<ActivityEntry>): Promise<void> => {
      stop()
      await d.activity.update(id, patch).catch(() => undefined)
    }
    const receiptOf = async (): Promise<{ status?: string; blockNumber?: string } | null> =>
      (await d.chains.rpc(chainId, 'eth_getTransactionReceipt', [hash]).catch(() => null)) as {
        status?: string
        blockNumber?: string
      } | null
    /*
      A receipt is a claim about one branch of the chain.

      The row settles on the first one, because making people stare at
      "pending" for two more blocks to guard against something that almost
      never happens is the wrong trade. But the watcher does not stop there:
      for a short window after, once the head has moved `CONFIRM_DEPTH` blocks
      past the receipt, it asks again — and a receipt that has vanished puts
      the row back to `pending` and resumes the search. That is the half a
      single read could not do. The window is bounded: a chain whose head does
      not move is not one this can learn anything more from.
    */
    const recheckAtDepth = async (block: number, since: number): Promise<void> => {
      if (d.platform.now() - since >= REORG_WINDOW_MS) {
        stop()
        return
      }
      const head = await d.chains.head(chainId).catch(() => null)
      if (!head || Number(head.blockNumber) < block + CONFIRM_DEPTH) {
        arm(() => void recheckAtDepth(block, since), every)
        return
      }
      const again = await receiptOf()
      if (again?.blockNumber) {
        await settle({
          status: again.status === '0x1' ? 'confirmed' : 'failed',
          blockNumber: parseInt(again.blockNumber, 16),
        })
        return
      }
      // It was there and now it is not: the branch it sat on is gone.
      await d.activity.update(id, { status: 'pending', blockNumber: null }).catch(() => undefined)
      arm(() => void tick(), every)
    }
    let misses = 0
    const tick = async (): Promise<void> => {
      const receipt = await receiptOf()
      if (receipt?.blockNumber) {
        const block = parseInt(receipt.blockNumber, 16)
        await d.activity
          .update(id, {
            status: receipt.status === '0x1' ? 'confirmed' : 'failed',
            blockNumber: block,
          })
          .catch(() => undefined)
        arm(() => void recheckAtDepth(block, d.platform.now()), every)
        return
      }
      /*
        No receipt. Does the node still have it at all? A `null` answer to
        `eth_getTransactionByHash` after the transaction has had time to
        propagate means it is gone from the pool — evicted for price, or
        replaced by a speed-up at the same nonce — and the row should say so
        rather than sit on "pending" until the user gives up on it.
      */
      const waited = d.platform.now() - started
      const known = await d.chains
        .rpc(chainId, 'eth_getTransactionByHash', [hash])
        .catch(() => undefined)
      /*
        A `null` is a miss, not a verdict (ES-BV-064).

        The endpoint that answers this poll is not necessarily the one that
        accepted the bytes, so a single `null` from a failover pair whose nodes
        do not share a pool says nothing. Misses have to arrive consecutively:
        anything else — a receipt, a hit, a read that failed — resets the
        count.
      */
      if (known === null) misses += 1
      else if (known !== undefined) misses = 0
      if (misses >= DROP_CONFIRMATIONS && waited > DROP_GRACE_MS) {
        /*
          Give the number back. A re-send then lands on the same nonce, and
          only one transaction at a nonce can ever mine; holding the
          reservation is what used to push the re-send to `nonce + 1`, where
          both could.
        */
        if (held) this.releaseNonce(chainId, held.from, held.nonce)
        await settle({ status: 'dropped' })
        return
      }
      if (waited >= WATCH_BUDGET_MS) {
        await settle({ status: 'unknown' })
        return
      }
      arm(() => void tick(), every)
    }
    arm(() => void tick(), every)
  }
}

/** What remote sign (§6) offers the signing router — declared here so the two never import each other. */
export interface RemoteSigner {
  signerFor(account: AccountView): Promise<LocalAccount | null>
}

let ethSignEnabledSync = false

function toSerializable(
  chainId: number,
  tx: PreparedTx,
): Parameters<LocalAccount['signTransaction']>[0] {
  return {
    chainId,
    to: (tx.to as Hex | null) ?? undefined,
    value: BigInt(tx.value),
    data: tx.data as Hex,
    nonce: tx.nonce,
    gas: BigInt(tx.gas),
    ...(tx.type === 'eip1559'
      ? {
          type: 'eip1559' as const,
          maxFeePerGas: BigInt(tx.maxFeePerGas ?? '0x0'),
          maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas ?? '0x0'),
        }
      : { type: 'legacy' as const, gasPrice: BigInt(tx.gasPrice ?? '0x0') }),
  }
}

function toView(a: Assessment, now = 0): AssessmentView {
  return {
    simulatedAt: now,
    severity: a.severity,
    rules: a.rules.map((r) => ({
      code: r.code,
      severity: r.severity,
      title: r.title,
      detail: r.detail,
      ...(r.lookalikeOf ? { lookalikeOf: r.lookalikeOf } : {}),
    })),
    statements: a.statements.map((s) => ({ text: s.text, tone: s.tone })),
    changes: a.changes.map((s) => ({ text: s.text, tone: s.tone })),
    presentation: a.presentation,
    simulationMode: a.simulation?.mode ?? 'none',
  }
}

function categoryFor(
  assessment: AssessmentView,
  tx: PreparedTx,
  origin: string,
): ActivityEntry['category'] {
  const first = assessment.statements[0]?.text ?? ''
  if (origin === 'internal:limit' || origin === 'internal:limit:cancel') return 'LIMIT'
  if (origin === 'internal:swap') return 'SWAP'
  if (origin === 'internal:bridge') return 'BRIDGE'
  if (origin === 'internal:farm:deposit') return 'FARM_DEPOSIT'
  if (origin === 'internal:farm:withdraw') return 'FARM_WITHDRAW'
  if (origin === 'internal:farm:collect') return 'FARM_COLLECT'
  if (origin.startsWith('internal:launchpad')) return 'LAUNCHPAD'
  if (origin === 'internal:legends:claim') return 'DIVIDEND_CLAIM'
  if (origin.startsWith('internal:nft') || origin === 'internal:legends:register') return 'NFT'
  if (/^Allow /.test(first)) return 'APPROVE'
  if (/^Revoke /.test(first)) return 'REVOKE'
  if (/^Send /.test(first) || (tx.data === '0x' && tx.to)) return 'SEND'
  if (/^Swap /.test(first)) return 'SWAP'
  return 'DAPP'
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    throw new EngineError('invalid_argument', 'typed data is not valid JSON')
  }
}

/** dApps send uint values as decimal strings; viem's hashing wants bigints. Walks the declared types. */
export function normaliseTypedData(input: unknown): unknown {
  if (!input || typeof input !== 'object')
    throw new EngineError('invalid_argument', 'typed data must be an object')
  const t = input as {
    types?: Record<string, Array<{ name: string; type: string }>>
    primaryType?: string
    domain?: Record<string, unknown>
    message?: Record<string, unknown>
  }
  if (!t.types || !t.primaryType || !t.message)
    throw new EngineError('invalid_argument', 'typed data needs types, primaryType and message')
  const types = t.types
  const convert = (typeName: string, value: unknown): unknown => {
    const arrayMatch = /^(.*)\[(\d*)\]$/.exec(typeName)
    if (arrayMatch && Array.isArray(value)) return value.map((v) => convert(arrayMatch[1] ?? '', v))
    if (/^u?int\d*$/.test(typeName)) {
      if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|-?\d+)$/.test(value)) return BigInt(value)
      if (typeof value === 'number') return BigInt(value)
      return value
    }
    const fields = types[typeName]
    if (fields && value && typeof value === 'object') {
      const out: Record<string, unknown> = {}
      for (const f of fields)
        out[f.name] = convert(f.type, (value as Record<string, unknown>)[f.name])
      return out
    }
    return value
  }
  /*
    The domain's numbers must be read by exactly the grammar the firewall's
    decoder uses (`packages/security/src/decode.ts`), because the rule that
    compares `domain.chainId` to the session reads it there and the signature
    is produced from here. `BigInt(String(x))` is looser than that grammar —
    it accepts " 1", "\n1" and "+1" — so a domain could be signed for a chain
    the decoder had recorded as absent, and TYPED_DATA_DOMAIN_MISMATCH would
    never fire. Fail closed instead: a domain number we cannot read strictly is
    a rejected request, not a silently signed one.
  */
  const strictBig = (field: string, value: unknown): bigint => {
    if (typeof value === 'bigint') return value
    if (typeof value === 'number' && Number.isSafeInteger(value)) return BigInt(value)
    if (typeof value === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(value)) return BigInt(value)
    throw new EngineError(
      'invalid_argument',
      `typed data domain field ${field} is not a plain integer`,
    )
  }
  const domainFields = types['EIP712Domain']
  const domain: Record<string, unknown> = { ...(t.domain ?? {}) }
  if (domain['chainId'] !== undefined) domain['chainId'] = strictBig('chainId', domain['chainId'])
  if (domainFields)
    for (const f of domainFields)
      if (/^u?int/.test(f.type) && domain[f.name] !== undefined)
        domain[f.name] = strictBig(f.name, domain[f.name])
  const { EIP712Domain: _omit, ...rest } = types
  return {
    domain,
    types: rest,
    primaryType: t.primaryType,
    message: convert(t.primaryType, t.message),
  }
}

export { hexChainId }
