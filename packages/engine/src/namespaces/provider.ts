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
import { getChain, pollMs } from '@boltvault/chains'
import { ElectroSwapClient, fetchCollections } from '@boltvault/electroswap'
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
  emptyContext,
  estimateSimulation,
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
} from '@boltvault/security'
import {
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
  /** Put a new request in front of the user (the extension opens sign.html). Internal origins never call this. */
  readonly openApproval?: (request: ApprovalRequest) => void
  readonly clientVersion: string
  /** Signed statics: the scam-origin list for the firewall (§3.6). */
  readonly statics?: { scamOrigins(): readonly string[] }
  /** Device signers (Ledger over HID from the worker); absent in bodies without one. */
  readonly hardware?: HardwareService
  readonly fetch?: typeof fetch
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

const UNKNOWN_CONTRACT_FACTS = { ageDays: null, verified: null } as const

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
  if (floorEtn === null || !Number.isFinite(floorEtn) || floorEtn <= 0 || floorEtn >= 1e21) return null
  try {
    return parseUnits(floorEtn.toFixed(18), 18)
  } catch {
    return null
  }
}

export class ProviderService {
  private remote: RemoteSigner | null = null
  /** Origins whose transport could not vouch for them (WalletConnect without Verify). */
  private unverified = new Set<string>()
  /** Explorer answers by `chainId:address`; failures are cached too, so a dead explorer is asked once. */
  private readonly contractFactsCache = new Map<
    string,
    { at: number; facts: { ageDays: number | null; verified: boolean | null } }
  >()
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
      } else this.flow.chainChanged(change.origin, change.chainId)
    })
  }

  /** Serve one dApp channel. The origin comes from the transport, never from a message. */
  serve(channel: MessageChannelLike, origin: string, info: PortInfo = {}): () => void {
    if (info.verified === false) this.unverified.add(origin)
    else this.unverified.delete(origin)
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
      const clientRequestId = `${origin}#${raw.session ?? 'nosession'}#${raw.id}`
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
    })
    const stop = (): void => {
      offMessage()
      set.delete(onEvent)
      if (set.size === 0) this.ports.delete(origin)
    }
    const offDisconnect = channel.onDisconnect(stop)
    return () => {
      stop()
      offDisconnect()
    }
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
      const outcome = await d.approvals.waitFor(request.id)
      const view = payload as { assessment: AssessmentView }
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
        // Our refusal is final; a device's is not. See ApprovalStore.settle.
        await d.approvals.settle(
          request.id,
          false,
          err instanceof Error ? err.message : String(err),
          !blockedHere,
        )
        throw err
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
      if (e.status === 'pending' && e.hash) this.watch(e.chainId, e.id, e.hash as Hex)
  }

  dispose(): void {
    this.flow.dispose()
    for (const p of this.headPolls.values()) clearInterval(p.timer)
    this.headPolls.clear()
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
      session: async (origin) => {
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
      },
      executeSafe: (chainId, method, params) => d.chains.rpc(chainId, method, params),
      approve: (intent) => this.approve(intent),
      emit: (origin, event) => {
        for (const l of this.ports.get(origin) ?? []) l(event)
      },
      subscribeHeads: (origin, chainId, id) => this.subscribeHeads(origin, chainId, id),
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
    // Re-attach: a worker restart re-sends the request with the same client id.
    const existing = d.approvals.findPending(
      (r) =>
        r.origin === intent.origin &&
        (r.payload as { clientRequestId?: string } | null)?.clientRequestId ===
          intent.clientRequestId,
    )
    let request = existing
    if (!request) {
      // An already-permitted site only needs the vault unlocked, not a new Connect.
      if (intent.kind === 'connect') {
        const row = d.sites.registry.get(intent.origin)
        const status = await d.vault.status()
        if (row?.connected && status.unlocked) {
          const account = (await d.vault.accounts()).find((a) => a.id === row.accountId)
          if (account)
            return { accountId: account.id, addresses: [account.address], chainId: row.chainId }
        }
      }
      const payload = await this.payloadFor(intent)
      request = await d.approvals.create({
        kind: intent.kind === 'eth_sign' ? 'sign_message' : intent.kind,
        origin: intent.origin,
        accountId: 'accountId' in intent ? intent.accountId : null,
        chainId: intent.chainId,
        payload,
      })
      if (!intent.origin.startsWith('internal:')) d.openApproval?.(request)
    }
    const outcome = await d.approvals.waitFor(request.id)
    const payload = request.payload as { assessment?: AssessmentView } | null
    const blockedBy = payload?.assessment?.presentation.blocked
      ? payload.assessment.rules.filter((r) => r.severity === 'block').map((r) => r.code)
      : []
    // Defence in depth: a blocked assessment is never signed, whatever a UI page says (§3.4).
    // The dApp path settles the same way, blocked check included; see runInternal.
    const blockedHere = blockedBy.length > 0
    if (!outcome.approved) {
      /*
        A rejection still says why, when the wallet had already blocked it.

        `6cb688c` moved the blocked check inside the settle try and dropped the
        `rules` from this branch along the way — collateral, not intent: the page
        that was rejected is showing the same list, and a dApp that learns its
        payload tripped PERMIT2_SIGNATURE_TRANSFER can go and fix the payload.
        Nothing here is a secret, and `e2e/provider.spec.ts` has been asking for
        it since M3.
      */
      throw new RpcError(RPC.USER_REJECTED, 'User rejected the request.', blockedHere ? { rules: blockedBy } : undefined)
    }
    try {
      if (blockedHere)
        throw new RpcError(RPC.USER_REJECTED, 'User rejected the request.', { rules: blockedBy })
      const done = await this.execute(intent, request, outcome.data)
      await d.approvals.settle(request.id, true)
      return done
    } catch (err) {
      await d.approvals.settle(
        request.id,
        false,
        err instanceof Error ? err.message : String(err),
        !blockedHere,
      )
      throw err
    }
  }

  private async payloadFor(intent: ApprovalIntent): Promise<ApprovalPayload> {
    const d = this.deps
    switch (intent.kind) {
      case 'connect':
        return {
          kind: 'connect',
          requestedChainId: intent.chainId,
          reconnect: d.sites.registry.get(intent.origin)?.connected === true,
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
          options: intent.options,
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
        normaliseTypedData(typedJson)
        return {
          kind: 'sign_typed_data',
          from: intent.from,
          typedData: typedJson,
          version: intent.version,
          domainName: parsed?.domain.name ?? null,
          primaryType: parsed?.primaryType ?? 'unknown',
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
        const assessment = await this.assessment(
          intent.origin,
          intent.chainId,
          intent.tx.from,
          request,
          simulation,
          intent.expectedFee ?? null,
          intent.bridgeRecipient ?? null,
        )
        const perGas =
          prepared.tx.type === 'eip1559'
            ? BigInt(prepared.tx.maxFeePerGas ?? '0x0')
            : BigInt(prepared.tx.gasPrice ?? '0x0')
        const symbol = getChain(intent.chainId)?.nativeCurrency.symbol ?? 'ETH'
        return {
          kind: 'send_transaction',
          tx: prepared.tx,
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
    const referenced = new Set(
      [...sentTo, ...addressBook, ...own].map((a) => a.toLowerCase()),
    )
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
    if (request.kind === 'transaction' && request.tx.to && request.tx.data.startsWith('0xa9059cbb')) {
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
      now: d.platform.now(),
      // Our own swap must pay exactly what the schedule said (T10); anything else never sees the field.
      ...(origin === 'internal:swap' ? { expectedFee } : {}),
      ...(origin === 'internal:bridge' ? { bridgeRecipient } : {}),
      originBudget: this.originBudget(origin, activity),
      lastCopiedAddress: this.lastCopiedAddress(),
      originVerified: !this.unverified.has(origin),
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
    if (hit && now - hit.at < CONTRACT_FACTS_TTL_MS) return hit.facts
    const facts = await this.readExplorer(chainId, address).catch(() => UNKNOWN_CONTRACT_FACTS)
    this.contractFactsCache.set(key, { at: now, facts })
    return facts
  }

  private async readExplorer(
    chainId: number,
    address: Hex,
  ): Promise<{ ageDays: number | null; verified: boolean | null }> {
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
      let ageDays: number | null = null
      if (creation) {
        const txRes = await f(`${base}/api/v2/transactions/${creation}`, {
          signal: abort.signal,
          headers: { accept: 'application/json' },
        })
        if (txRes.ok) {
          const tx = ExplorerTxSchema.safeParse(await txRes.json())
          const at = tx.success && tx.data.timestamp ? Date.parse(tx.data.timestamp) : Number.NaN
          if (Number.isFinite(at))
            ageDays = Math.max(0, (this.deps.platform.now() - at) / 86_400_000)
        }
      }
      return { ageDays, verified }
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
        decoded.offer
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
      ...(key ? { authHeaders: (method: string, at: string) => authHeaders({ key, method, url: at, now: d.platform.now() }) } : {}),
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
                ...(prepared.tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: prepared.tx.maxPriorityFeePerGas } : {}),
                ...(prepared.tx.gasPrice ? { gasPrice: prepared.tx.gasPrice } : {}),
              },
              'latest',
              { tracer: 'callTracer', tracerConfig: { withLog: true } },
            ],
          }),
        })
        const json = (await res.json()) as { result?: TraceFrame; error?: { message?: string } }
        if (json.result) return simulationFromTrace(json.result, request.tx.from)
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
      const body = JSON.stringify({ chainId, from: prepared.tx.from, to, value: prepared.tx.value, data: prepared.tx.data, gas: prepared.tx.gas, nonce: `0x${prepared.tx.nonce.toString(16)}`, ...(prepared.tx.maxFeePerGas ? { maxFeePerGas: prepared.tx.maxFeePerGas } : {}), ...(prepared.tx.maxPriorityFeePerGas ? { maxPriorityFeePerGas: prepared.tx.maxPriorityFeePerGas } : {}), ...(prepared.tx.gasPrice ? { gasPrice: prepared.tx.gasPrice } : {}) })
      const res = await f(url, {
        method: 'POST',
        // A signature over this exact call, not the key (§9.1): a header lifted
        // out of devtools cannot be pointed at a different, more expensive trace.
        headers: { 'content-type': 'application/json', ...authHeaders({ key: d.clientKey, method: 'POST', url, body, now: d.platform.now() }) },
        body,
      })
      const json = (await res.json()) as {
        result?: TraceFrame
        error?: { code?: number; message?: string }
      }
      if (json.result) return simulationFromTrace(json.result, request.tx.from)
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
          `The preview service could not trace this: ${err.message}.`,
        )
    } catch {
      // Unreachable API: no preview, and no explanation worth showing either.
    }
    return null
  }

  // ---- transactions ---------------------------------------------------------------

  /** (chain:account) → the nonces this wallet has handed out but not yet seen on chain. */
  private readonly reservedNonces = new Map<string, Array<{ nonce: number; at: number }>>()

  private reserveNonce(chainId: number, from: Hex, onChain: number): number {
    const key = `${chainId}:${from.toLowerCase()}`
    const now = this.deps.platform.now()
    // An approval cannot outlive its TTL, so neither can its claim on a nonce.
    const live = (this.reservedNonces.get(key) ?? []).filter((r) => now - r.at < APPROVAL_TTL_MS && r.nonce >= onChain)
    const highest = live.reduce((m, r) => Math.max(m, r.nonce), onChain - 1)
    const nonce = Math.max(onChain, highest + 1)
    live.push({ nonce, at: now })
    this.reservedNonces.set(key, live)
    return nonce
  }

  private async prepare(
    chainId: number,
    tx: TxParams,
  ): Promise<{ tx: PreparedTx; estimateError: string | null }> {
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
    const nonce =
      tx.nonce !== undefined
        ? parseInt(tx.nonce, 16)
        : this.reserveNonce(chainId, tx.from, parseInt(String(await rpc('eth_getTransactionCount', [tx.from, 'pending'])), 16))
    let gas: bigint
    let estimateError: string | null = null
    if (tx.gas !== undefined) {
      gas = BigInt(tx.gas)
    } else {
      try {
        const est = BigInt(
          String(
            await rpc('eth_estimateGas', [{ from: tx.from, ...(to ? { to } : {}), value, data }]),
          ),
        )
        gas = (est * 12n) / 10n
      } catch (err) {
        estimateError = err instanceof Error ? err.message : String(err)
        gas = data === '0x' && to ? 21_000n : 500_000n
      }
    }
    const block = (await rpc('eth_getBlockByNumber', ['latest', false]).catch(() => null)) as {
      baseFeePerGas?: string
    } | null
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n
    let fees: Pick<PreparedTx, 'type' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'>
    if (tx.gasPrice !== undefined) {
      fees = { type: 'legacy', gasPrice: tx.gasPrice }
    } else if (baseFee > 0n || tx.maxFeePerGas !== undefined) {
      const tip =
        tx.maxPriorityFeePerGas !== undefined
          ? BigInt(tx.maxPriorityFeePerGas)
          : BigInt(String(await rpc('eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00')))
      const max = tx.maxFeePerGas !== undefined ? BigInt(tx.maxFeePerGas) : baseFee * 2n + tip
      fees = {
        type: 'eip1559',
        maxFeePerGas: `0x${max.toString(16)}`,
        maxPriorityFeePerGas: `0x${tip.toString(16)}`,
      }
    } else {
      const gasPrice = BigInt(String(await rpc('eth_gasPrice', [])))
      fees = { type: 'legacy', gasPrice: `0x${gasPrice.toString(16)}` }
    }
    return {
      tx: { from: tx.from, to, value, data, nonce, gas: `0x${gas.toString(16)}`, ...fees },
      estimateError,
    }
  }

  private async execute(
    intent: ApprovalIntent,
    request: ApprovalRequest,
    data: unknown,
  ): Promise<unknown> {
    const d = this.deps
    switch (intent.kind) {
      case 'connect': {
        const parsed = ConnectDecisionDataSchema.safeParse(data)
        const accounts = await d.vault.accounts()
        const account = parsed.success
          ? accounts.find((a) => a.id === parsed.data.accountId)
          : ((await d.vault.active()) ?? accounts[0])
        if (!account) throw new RpcError(RPC.UNAUTHORIZED, 'No account to connect.')
        const chainId =
          parsed.success && d.chains.known(parsed.data.chainId)
            ? parsed.data.chainId
            : intent.chainId
        return { accountId: account.id, addresses: [account.address], chainId }
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
          chainId: intent.chainId,
          address: opts.data.address,
          origin: intent.origin,
          claimed: {
            ...(opts.data.symbol ? { symbol: opts.data.symbol } : {}),
            ...(opts.data.decimals !== undefined ? { decimals: opts.data.decimals } : {}),
          },
        })
        return true
      }
      /*
        Every case below signs what the approval record holds, never what the
        live intent holds. The record is the object the sheet rendered and the
        firewall assessed; the intent can still be replaced after the sheet is
        up, because `approve()` re-attaches to a pending request by the
        page-supplied `clientRequestId`. Signing the intent would mean signing
        something the user was never shown (§3.3, §3.4).
      */
      case 'sign_message': {
        const payload = request.payload as Extract<ApprovalPayload, { kind: 'sign_message' }>
        const account = await this.signer(intent.accountId)
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
        const account = await this.signer(intent.accountId)
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
        const account = await this.signer(intent.accountId)
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
        if (intent.signOnly) return this.signOnly(intent, payload.tx)
        return this.broadcast(intent, request, payload.tx, payload.assessment)
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
  private async signOnly(
    intent: Extract<ApprovalIntent, { kind: 'send_transaction' }>,
    tx: PreparedTx,
  ): Promise<Hex> {
    const account = await this.signer(intent.accountId)
    const serialized = await account.signTransaction(toSerializable(intent.chainId, tx))
    ProviderService.assertSignedBy(
      await recoverTransactionAddress({ serializedTransaction: serialized as never }),
      account.address,
      'transaction',
    )
    return serialized
  }

  private async broadcast(
    intent: Extract<ApprovalIntent, { kind: 'send_transaction' }>,
    request: ApprovalRequest,
    tx: PreparedTx,
    assessment: AssessmentView,
  ): Promise<Hex> {
    const d = this.deps
    // Already broadcast before a restart? The write-ahead entry carries the hash.
    const prior = (
      await d.activity.list({ chainId: intent.chainId }).catch(() => [] as ActivityEntry[])
    ).find((e) => e.id === request.id)
    if (prior?.hash) return prior.hash as Hex
    const snapshot = this.takeSnapshot(ProviderService.snapshotKey(intent.chainId, tx))
    const entry: ActivityEntry = {
      id: request.id,
      hash: null,
      chainId: intent.chainId,
      accountId: intent.accountId,
      to: tx.to,
      value: BigInt(tx.value).toString(),
      nonce: tx.nonce,
      // Kept so a stuck transaction can be re-sent at the same nonce with a
      // higher fee; without it Speed up has nothing to repeat (§8.12).
      ...(tx.data && tx.data !== '0x' ? { data: tx.data } : {}),
      submittedAt: d.platform.now(),
      origin: intent.origin,
      category: categoryFor(assessment, tx, intent.origin),
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
    }
    // Write-ahead (§3.4 step 7): the row exists before the signature, so a device refusal or a lost worker still leaves a trace.
    if (!prior) await d.activity.append(entry)
    let raw: Hex
    try {
      const account = await this.signer(intent.accountId)
      /*
        The queue may have moved while the sheet was open. Re-signing with a
        new nonce here would sign something the user never saw, so the request
        fails instead and can be raised again with a current one.
      */
      const pending = parseInt(String(await d.chains.rpc(intent.chainId, 'eth_getTransactionCount', [tx.from, 'pending'])), 16)
      if (Number.isFinite(pending) && pending > tx.nonce)
        throw new RpcError(RPC.INTERNAL, 'This transaction\u2019s place in the queue was taken while the sheet was open. Ask again.')
      raw = await account.signTransaction(toSerializable(intent.chainId, tx))
      // Before it can be broadcast, it has to have come from the account we asked.
      ProviderService.assertSignedBy(
        await recoverTransactionAddress({ serializedTransaction: raw as never }),
        account.address,
        'transaction',
      )
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'signing failed'
      await d.activity
        .update(request.id, { status: 'failed', statements: [...entry.statements, reason] })
        .catch(() => undefined)
      throw err instanceof RpcError ? err : new RpcError(RPC.INTERNAL, reason)
    }
    try {
      const sent = (await d.chains.rpc(intent.chainId, 'eth_sendRawTransaction', [raw])) as string
      await d.activity.update(request.id, { hash: sent })
      this.watch(intent.chainId, request.id, sent as Hex)
      return sent as Hex
    } catch (err) {
      await d.activity.update(request.id, { status: 'failed' }).catch(() => undefined)
      throw new RpcError(RPC.INTERNAL, err instanceof Error ? err.message : 'broadcast failed')
    }
  }

  /** Poll for the receipt at the chain's cadence; Activity moves pending → confirmed/failed. */
  private watch(chainId: number, id: string, hash: Hex): void {
    const d = this.deps
    /*
      A receipt is worth asking for about once a block, and never faster than
      the wallet polls anything else — `blockTimeMs` alone had this asking
      Arbitrum every 250 ms, a hundred and twenty times, for one transaction.
    */
    const every = d.receiptPollMs ?? pollMs(chainId, 'foreground')
    let attempts = 0
    const tick = async (): Promise<void> => {
      attempts += 1
      const receipt = (await d.chains
        .rpc(chainId, 'eth_getTransactionReceipt', [hash])
        .catch(() => null)) as { status?: string; blockNumber?: string } | null
      if (receipt?.blockNumber) {
        await d.activity
          .update(id, {
            status: receipt.status === '0x1' ? 'confirmed' : 'failed',
            blockNumber: parseInt(receipt.blockNumber, 16),
          })
          .catch(() => undefined)
        return
      }
      if (attempts < 120) setTimeout(() => void tick(), every)
    }
    setTimeout(() => void tick(), every)
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
    throw new EngineError('invalid_argument', `typed data domain field ${field} is not a plain integer`)
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
