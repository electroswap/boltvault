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
import { getChain } from '@boltvault/chains'
import type { Platform } from '@boltvault/platform'
import { RPC, RpcError, RpcFlow, hexChainId, isProviderPortMessage, type ApprovalIntent, type ProviderEvent, type RpcContext, type TxParams } from '@boltvault/protocol'
import { assess, emptyContext, estimateSimulation, NO_SIMULATION, parseTypedData, decodeMessage, simulationFromTrace, type Assessment, type AssessmentContext, type SignRequest, type Simulation, type TraceFrame } from '@boltvault/security'
import type { Hex } from 'viem'
import { privateKeyToAccount, type LocalAccount } from 'viem/accounts'
import type { ActivityStore } from '../activityStore'
import { WatchAssetOptionsSchema, ConnectDecisionDataSchema, type ApprovalPayload, type AssessmentView, type PreparedTx } from '../approvalPayloads'
import type { ApprovalStore } from '../approvals'
import { EngineError } from '../errors'
import type { EventBus } from '../host'
import type { ActivityEntry, ApprovalRequest, AccountView } from '../schema'
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
  readonly tokenInfo?: (chainId: number) => Promise<Record<string, { symbol: string; decimals: number; name?: string }>>
  /** Put a new request in front of the user (the extension opens sign.html). Internal origins never call this. */
  readonly openApproval?: (request: ApprovalRequest) => void
  readonly clientVersion: string
  /** Signed statics: the scam-origin list for the firewall (§3.6). */
  readonly statics?: { scamOrigins(): readonly string[] }
  /** Device signers (Ledger over HID from the worker); absent in bodies without one. */
  readonly hardware?: HardwareService
  readonly fetch?: typeof fetch
  /** Receipt polling cadence; defaults to the chain's block time. */
  readonly receiptPollMs?: number
  /** `wallet_watchAsset` (plan A3): the chain's word on a token for the sheet, and the add once approved. */
  readonly tokenMetadata?: (chainId: number, address: string) => Promise<{ name: string; symbol: string; decimals: number; hasCode: boolean }>
  readonly watchAsset?: (input: { chainId: number; address: string; origin: string; claimed?: { symbol?: string; decimals?: number } }) => Promise<unknown>
}

export interface PortInfo {
  readonly tabId?: number
  readonly frameId?: number
  /** 'content' ports are verified by construction (the sender's URL); a WebView is the committed URL; WalletConnect only when Verify said VALID (§2.7 S9). */
  readonly kind?: 'content' | 'webview' | 'walletconnect'
  readonly verified?: boolean
}

const HEAD_POLL_MS = 5_000

export class ProviderService {
  private remote: RemoteSigner | null = null
  /** Origins whose transport could not vouch for them (WalletConnect without Verify). */
  private unverified = new Set<string>()

  /** Remote sign is wired after construction: it needs the provider and the provider needs it. */
  setRemote(remote: RemoteSigner): void {
    this.remote = remote
  }

  private readonly flow: RpcFlow
  private readonly ports = new Map<string, Set<(event: ProviderEvent) => void>>()
  private readonly headPolls = new Map<number, { timer: ReturnType<typeof setInterval>; subs: Map<string, { origin: string; id: Hex }> }>()

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
  async submitInternal(intent: Extract<ApprovalIntent, { kind: 'send_transaction' }>): Promise<{ requestId: string }> {
    const { requestId } = await this.runInternal(intent)
    return { requestId }
  }

  /**
   * The same for flows that need the outcome (Swap: the permit signature feeds
   * the router call): `result` resolves with the hash or signature once the
   * sheet approved and the step executed, and rejects on Reject or a block.
   */
  async runInternal(intent: Extract<ApprovalIntent, { kind: 'send_transaction' | 'sign_typed_data' | 'sign_message' }>): Promise<{ requestId: string; result: Promise<unknown> }> {
    if (!intent.origin.startsWith('internal:') && !intent.origin.startsWith('device:')) throw new EngineError('invalid_argument', 'runInternal is for internal and paired-device origins')
    const d = this.deps
    const payload = await this.payloadFor(intent)
    const request = await d.approvals.create({ kind: intent.kind, origin: intent.origin, accountId: intent.accountId, chainId: intent.chainId, payload })
    const result = (async () => {
      const outcome = await d.approvals.waitFor(request.id)
      const view = payload as { assessment: AssessmentView }
      // Defence in depth: a blocked assessment is never signed, whatever a UI page says (§3.4).
      if (!outcome.approved || view.assessment.presentation.blocked) throw new EngineError('rejected', 'User rejected the request.')
      return this.execute(intent, request, outcome.data)
    })()
    // A broadcast failure is already recorded in Activity as failed; nobody has to await this.
    result.catch(() => undefined)
    return { requestId: request.id, result }
  }

  /** After unlock: keep watching transactions that were pending when the worker last stopped. */
  async resumeWatchers(): Promise<void> {
    const entries = await this.deps.activity.list({}).catch(() => [] as ActivityEntry[])
    for (const e of entries) if (e.status === 'pending' && e.hash) this.watch(e.chainId, e.id, e.hash as Hex)
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
      const timer = setInterval(() => {
        void this.deps.chains.head(chainId).then((head) => {
          for (const s of subs.values()) {
            for (const l of this.ports.get(s.origin) ?? []) {
              l({ event: 'message', payload: { type: 'eth_subscription', data: { subscription: s.id, result: { number: `0x${BigInt(head.blockNumber).toString(16)}` } } } })
            }
          }
        }, () => undefined)
      }, HEAD_POLL_MS)
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
    const existing = d.approvals.findPending((r) => r.origin === intent.origin && (r.payload as { clientRequestId?: string } | null)?.clientRequestId === intent.clientRequestId)
    let request = existing
    if (!request) {
      // An already-permitted site only needs the vault unlocked, not a new Connect.
      if (intent.kind === 'connect') {
        const row = d.sites.registry.get(intent.origin)
        const status = await d.vault.status()
        if (row?.connected && status.unlocked) {
          const account = (await d.vault.accounts()).find((a) => a.id === row.accountId)
          if (account) return { accountId: account.id, addresses: [account.address], chainId: row.chainId }
        }
      }
      const payload = await this.payloadFor(intent)
      request = await d.approvals.create({ kind: intent.kind === 'eth_sign' ? 'sign_message' : intent.kind, origin: intent.origin, accountId: 'accountId' in intent ? intent.accountId : null, chainId: intent.chainId, payload })
      if (!intent.origin.startsWith('internal:')) d.openApproval?.(request)
    }
    const outcome = await d.approvals.waitFor(request.id)
    const payload = request.payload as { assessment?: AssessmentView } | null
    const blockedBy = payload?.assessment?.presentation.blocked ? payload.assessment.rules.filter((r) => r.severity === 'block').map((r) => r.code) : []
    // Defence in depth: a blocked assessment is never signed, whatever a UI page says (§3.4).
    if (!outcome.approved || blockedBy.length > 0) {
      throw new RpcError(RPC.USER_REJECTED, 'User rejected the request.', blockedBy.length ? { rules: blockedBy } : undefined)
    }
    return this.execute(intent, request, outcome.data)
  }

  private async payloadFor(intent: ApprovalIntent): Promise<ApprovalPayload> {
    const d = this.deps
    switch (intent.kind) {
      case 'connect':
        return { kind: 'connect', requestedChainId: intent.chainId, reconnect: d.sites.registry.get(intent.origin)?.connected === true, firstTime: d.sites.registry.isFirstTime(intent.origin), clientRequestId: intent.clientRequestId }
      case 'switch_chain':
        return { kind: 'switch_chain', chainId: intent.chainId, clientRequestId: intent.clientRequestId }
      case 'add_chain':
        return { kind: 'add_chain', chainId: intent.chainId, clientRequestId: intent.clientRequestId }
      case 'watch_asset': {
        const opts = intent.type === 'ERC20' ? WatchAssetOptionsSchema.safeParse(intent.options) : null
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
        const mismatch = onChain !== null && ((symbol !== null && symbol.toUpperCase() !== onChain.symbol.toUpperCase()) || (decimals !== null && decimals !== onChain.decimals))
        return { kind: 'watch_asset', type: intent.type, options: intent.options, address, symbol, decimals, onChain, mismatch, clientRequestId: intent.clientRequestId }
      }
      case 'sign_message': {
        const assessment = await this.assessment(intent.origin, intent.chainId, intent.from, { kind: 'message', from: intent.from, message: intent.message }, null)
        return { kind: 'sign_message', from: intent.from, message: intent.message, text: decodeMessage(intent.message).text, assessment: toView(assessment), clientRequestId: intent.clientRequestId }
      }
      case 'eth_sign': {
        const assessment = await this.assessment(intent.origin, intent.chainId, intent.from, { kind: 'eth_sign', from: intent.from, hash: intent.hash }, null)
        return { kind: 'eth_sign', from: intent.from, hash: intent.hash, assessment: toView(assessment), clientRequestId: intent.clientRequestId }
      }
      case 'sign_typed_data': {
        const parsed = parseTypedData(intent.typedData)
        const assessment = await this.assessment(intent.origin, intent.chainId, intent.from, { kind: 'typed_data', from: intent.from, typedData: intent.typedData }, null)
        const typedJson = typeof intent.typedData === 'string' ? safeJson(intent.typedData) : intent.typedData
        return { kind: 'sign_typed_data', from: intent.from, typedData: typedJson, version: intent.version, domainName: parsed?.domain.name ?? null, primaryType: parsed?.primaryType ?? 'unknown', assessment: toView(assessment), clientRequestId: intent.clientRequestId }
      }
      case 'send_transaction': {
        const prepared = await this.prepare(intent.chainId, intent.tx)
        const request: SignRequest = { kind: 'transaction', tx: { from: prepared.tx.from as Hex, to: prepared.tx.to as Hex | null, value: BigInt(prepared.tx.value), data: prepared.tx.data as Hex, chainId: intent.chainId, gas: BigInt(prepared.tx.gas), ...(intent.tx.authorizationList ? { authorizationList: intent.tx.authorizationList } : {}) } }
        const simulation = await this.simulate(intent.chainId, prepared, request)
        const assessment = await this.assessment(intent.origin, intent.chainId, intent.tx.from, request, simulation, intent.expectedFee ?? null, intent.bridgeRecipient ?? null)
        const perGas = prepared.tx.type === 'eip1559' ? BigInt(prepared.tx.maxFeePerGas ?? '0x0') : BigInt(prepared.tx.gasPrice ?? '0x0')
        const symbol = getChain(intent.chainId)?.nativeCurrency.symbol ?? 'ETH'
        return { kind: 'send_transaction', tx: prepared.tx, fee: { gasLimit: BigInt(prepared.tx.gas).toString(), maxTotalWei: (perGas * BigInt(prepared.tx.gas)).toString(), symbol }, assessment: toView(assessment), clientRequestId: intent.clientRequestId }
      }
    }
  }

  // ---- firewall -------------------------------------------------------------------

  private async assessment(origin: string, chainId: number, account: Hex, request: SignRequest, simulation: Simulation | null, expectedFee: { sink: Hex; bips: number } | null = null, bridgeRecipient: { hasCodeOnOrigin: boolean; hasCodeOnDestination: boolean | null } | null = null): Promise<Assessment> {
    const d = this.deps
    const settings = await d.settings.get()
    const accounts = await d.vault.accounts()
    const activity = await d.activity.list({ chainId }).catch(() => [] as ActivityEntry[])
    const sentTo = activity.filter((e) => e.category !== 'RECEIVE' && e.to).map((e) => e.to as Hex)
    const contracts: Record<string, { hasCode: boolean }> = {}
    const balances: Record<string, bigint> = {}
    const probe: Hex[] = []
    if (request.kind === 'transaction' && request.tx.to) probe.push(request.tx.to)
    if (request.kind === 'typed_data') {
      const parsed = parseTypedData(request.typedData)
      const dec = parsed?.decoded
      if (dec && 'spender' in dec) probe.push(dec.spender)
    }
    for (const address of probe) {
      const code = (await d.chains.rpc(chainId, 'eth_getCode', [address, 'latest']).catch(() => '0x')) as string
      contracts[address.toLowerCase()] = { hasCode: typeof code === 'string' && code.length > 2 }
    }
    if (request.kind === 'transaction' && request.tx.value > 0n) {
      const bal = (await d.chains.rpc(chainId, 'eth_getBalance', [account, 'latest']).catch(() => null)) as string | null
      if (bal) balances['native'] = BigInt(bal)
    }
    const addressBook = d.addressBook ? await d.addressBook().catch(() => [] as string[]) : []
    const tokens = d.tokenInfo ? await d.tokenInfo(chainId).catch(() => ({}) as Record<string, { symbol: string; decimals: number; name?: string }>) : {}
    const labels: Record<string, string> = {}
    for (const [addr, info] of Object.entries(tokens)) labels[addr] = info.symbol
    const context: AssessmentContext = emptyContext({
      sentTo,
      addressBook: addressBook as Hex[],
      tokens,
      labels,
      own: accounts.map((a) => a.address as Hex),
      firstTimeOrigin: d.sites.registry.isFirstTime(origin),
      contracts,
      balances,
      ethSignEnabled: settings.ethSignEnabled,
      now: d.platform.now(),
      // Our own swap must pay exactly what the schedule said (T10); anything else never sees the field.
      ...(origin === 'internal:swap' ? { expectedFee } : {}),
      ...(origin === 'internal:bridge' ? { bridgeRecipient } : {}),
      originVerified: !this.unverified.has(origin),
      scamOrigins: d.statics?.scamOrigins() ?? [],
    })
    return assess({ origin, chainId, account, request, context, simulation })
  }

  private async simulate(chainId: number, prepared: { tx: PreparedTx; estimateError: string | null }, request: SignRequest): Promise<Simulation> {
    const d = this.deps
    if (request.kind !== 'transaction') return NO_SIMULATION
    const traceUrl = await d.chains.traceUrl(chainId)
    if (traceUrl) {
      const f = d.fetch ?? globalThis.fetch
      try {
        const res = await f(traceUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'debug_traceCall', params: [{ from: prepared.tx.from, to: prepared.tx.to, value: prepared.tx.value, data: prepared.tx.data, gas: prepared.tx.gas }, 'latest', { tracer: 'callTracer', tracerConfig: { withLog: true } }] }),
        })
        const json = (await res.json()) as { result?: TraceFrame; error?: { message?: string } }
        if (json.result) return simulationFromTrace(json.result, request.tx.from)
      } catch {
        // fall through to the estimate
      }
    }
    return estimateSimulation(BigInt(prepared.tx.gas), prepared.estimateError)
  }

  // ---- transactions ---------------------------------------------------------------

  private async prepare(chainId: number, tx: TxParams): Promise<{ tx: PreparedTx; estimateError: string | null }> {
    const rpc = (method: string, params: readonly unknown[]): Promise<unknown> => this.deps.chains.rpc(chainId, method, params)
    const value = tx.value ?? '0x0'
    const data = tx.data ?? '0x'
    const to = tx.to ?? null
    const nonce = tx.nonce !== undefined ? parseInt(tx.nonce, 16) : parseInt(String(await rpc('eth_getTransactionCount', [tx.from, 'pending'])), 16)
    let gas: bigint
    let estimateError: string | null = null
    if (tx.gas !== undefined) {
      gas = BigInt(tx.gas)
    } else {
      try {
        const est = BigInt(String(await rpc('eth_estimateGas', [{ from: tx.from, ...(to ? { to } : {}), value, data }])))
        gas = (est * 12n) / 10n
      } catch (err) {
        estimateError = err instanceof Error ? err.message : String(err)
        gas = data === '0x' && to ? 21_000n : 500_000n
      }
    }
    const block = (await rpc('eth_getBlockByNumber', ['latest', false]).catch(() => null)) as { baseFeePerGas?: string } | null
    const baseFee = block?.baseFeePerGas ? BigInt(block.baseFeePerGas) : 0n
    let fees: Pick<PreparedTx, 'type' | 'maxFeePerGas' | 'maxPriorityFeePerGas' | 'gasPrice'>
    if (tx.gasPrice !== undefined) {
      fees = { type: 'legacy', gasPrice: tx.gasPrice }
    } else if (baseFee > 0n || tx.maxFeePerGas !== undefined) {
      const tip = tx.maxPriorityFeePerGas !== undefined ? BigInt(tx.maxPriorityFeePerGas) : BigInt(String(await rpc('eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00')))
      const max = tx.maxFeePerGas !== undefined ? BigInt(tx.maxFeePerGas) : baseFee * 2n + tip
      fees = { type: 'eip1559', maxFeePerGas: `0x${max.toString(16)}`, maxPriorityFeePerGas: `0x${tip.toString(16)}` }
    } else {
      const gasPrice = BigInt(String(await rpc('eth_gasPrice', [])))
      fees = { type: 'legacy', gasPrice: `0x${gasPrice.toString(16)}` }
    }
    return { tx: { from: tx.from, to, value, data, nonce, gas: `0x${gas.toString(16)}`, ...fees }, estimateError }
  }

  private async execute(intent: ApprovalIntent, request: ApprovalRequest, data: unknown): Promise<unknown> {
    const d = this.deps
    switch (intent.kind) {
      case 'connect': {
        const parsed = ConnectDecisionDataSchema.safeParse(data)
        const accounts = await d.vault.accounts()
        const account = parsed.success ? accounts.find((a) => a.id === parsed.data.accountId) : (await d.vault.active()) ?? accounts[0]
        if (!account) throw new RpcError(RPC.UNAUTHORIZED, 'No account to connect.')
        const chainId = parsed.success && d.chains.known(parsed.data.chainId) ? parsed.data.chainId : intent.chainId
        return { accountId: account.id, addresses: [account.address], chainId }
      }
      case 'switch_chain':
      case 'add_chain':
        return null
      case 'watch_asset': {
        const opts = intent.type === 'ERC20' ? WatchAssetOptionsSchema.safeParse(intent.options) : null
        if (!opts?.success) throw new RpcError(RPC.INVALID_PARAMS, 'wallet_watchAsset needs an ERC20 with a contract address.')
        await d.watchAsset?.({ chainId: intent.chainId, address: opts.data.address, origin: intent.origin, claimed: { ...(opts.data.symbol ? { symbol: opts.data.symbol } : {}), ...(opts.data.decimals !== undefined ? { decimals: opts.data.decimals } : {}) } })
        return true
      }
      case 'sign_message': {
        const account = await this.signer(intent.accountId)
        return account.signMessage({ message: { raw: intent.message } })
      }
      case 'eth_sign': {
        const account = await this.signer(intent.accountId)
        // A device never signs a raw hash (§4.6: eth_sign is 4200 for hardware accounts).
        if (!account.sign) throw new RpcError(RPC.UNSUPPORTED_METHOD, 'This account cannot sign a raw hash.')
        return account.sign({ hash: intent.hash })
      }
      case 'sign_typed_data': {
        const account = await this.signer(intent.accountId)
        const typed = normaliseTypedData(typeof intent.typedData === 'string' ? safeJson(intent.typedData) : intent.typedData)
        return account.signTypedData(typed as never)
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
        throw new RpcError(RPC.INTERNAL, err instanceof Error ? err.message : 'The device did not answer.')
      }
    }
    // Not signable here: a paired device that can may (§6, §8.16).
    if (account && this.remote) {
      const far = await this.remote.signerFor(account)
      if (far) return far
    }
    throw new RpcError(RPC.UNAUTHORIZED, 'This account cannot sign here.')
  }

  /** Remote sign, the signing side: the prepared fields exactly as the requester sent them, signed and returned raw (§6). */
  private async signOnly(intent: Extract<ApprovalIntent, { kind: 'send_transaction' }>, tx: PreparedTx): Promise<Hex> {
    const account = await this.signer(intent.accountId)
    return account.signTransaction(toSerializable(intent.chainId, tx))
  }

  private async broadcast(intent: Extract<ApprovalIntent, { kind: 'send_transaction' }>, request: ApprovalRequest, tx: PreparedTx, assessment: AssessmentView): Promise<Hex> {
    const d = this.deps
    // Already broadcast before a restart? The write-ahead entry carries the hash.
    const prior = (await d.activity.list({ chainId: intent.chainId }).catch(() => [] as ActivityEntry[])).find((e) => e.id === request.id)
    if (prior?.hash) return prior.hash as Hex
    const entry: ActivityEntry = {
      id: request.id,
      hash: null,
      chainId: intent.chainId,
      accountId: intent.accountId,
      to: tx.to,
      value: BigInt(tx.value).toString(),
      nonce: tx.nonce,
      submittedAt: d.platform.now(),
      origin: intent.origin,
      category: categoryFor(assessment, tx, intent.origin),
      statements: assessment.statements.map((s) => s.text),
      riskCodes: assessment.rules.map((r) => r.code),
      status: 'pending',
      blockNumber: null,
    }
    // Write-ahead (§3.4 step 7): the row exists before the signature, so a device refusal or a lost worker still leaves a trace.
    if (!prior) await d.activity.append(entry)
    let raw: Hex
    try {
      const account = await this.signer(intent.accountId)
      raw = await account.signTransaction(toSerializable(intent.chainId, tx))
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'signing failed'
      await d.activity.update(request.id, { status: 'failed', statements: [...entry.statements, reason] }).catch(() => undefined)
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
    const every = d.receiptPollMs ?? getChain(chainId)?.blockTimeMs ?? 12_000
    let attempts = 0
    const tick = async (): Promise<void> => {
      attempts += 1
      const receipt = (await d.chains.rpc(chainId, 'eth_getTransactionReceipt', [hash]).catch(() => null)) as { status?: string; blockNumber?: string } | null
      if (receipt?.blockNumber) {
        await d.activity.update(id, { status: receipt.status === '0x1' ? 'confirmed' : 'failed', blockNumber: parseInt(receipt.blockNumber, 16) }).catch(() => undefined)
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

function toSerializable(chainId: number, tx: PreparedTx): Parameters<LocalAccount['signTransaction']>[0] {
  return {
    chainId,
    to: (tx.to as Hex | null) ?? undefined,
    value: BigInt(tx.value),
    data: tx.data as Hex,
    nonce: tx.nonce,
    gas: BigInt(tx.gas),
    ...(tx.type === 'eip1559' ? { type: 'eip1559' as const, maxFeePerGas: BigInt(tx.maxFeePerGas ?? '0x0'), maxPriorityFeePerGas: BigInt(tx.maxPriorityFeePerGas ?? '0x0') } : { type: 'legacy' as const, gasPrice: BigInt(tx.gasPrice ?? '0x0') }),
  }
}

function toView(a: Assessment): AssessmentView {
  return {
    severity: a.severity,
    rules: a.rules.map((r) => ({ code: r.code, severity: r.severity, title: r.title, detail: r.detail })),
    statements: a.statements.map((s) => ({ text: s.text, tone: s.tone })),
    changes: a.changes.map((s) => ({ text: s.text, tone: s.tone })),
    presentation: a.presentation,
    simulationMode: a.simulation?.mode ?? 'none',
  }
}

function categoryFor(assessment: AssessmentView, tx: PreparedTx, origin: string): ActivityEntry['category'] {
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
  if (!input || typeof input !== 'object') throw new EngineError('invalid_argument', 'typed data must be an object')
  const t = input as { types?: Record<string, Array<{ name: string; type: string }>>; primaryType?: string; domain?: Record<string, unknown>; message?: Record<string, unknown> }
  if (!t.types || !t.primaryType || !t.message) throw new EngineError('invalid_argument', 'typed data needs types, primaryType and message')
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
      for (const f of fields) out[f.name] = convert(f.type, (value as Record<string, unknown>)[f.name])
      return out
    }
    return value
  }
  const domainFields = types['EIP712Domain']
  const domain: Record<string, unknown> = { ...(t.domain ?? {}) }
  if (domain['chainId'] !== undefined) domain['chainId'] = BigInt(String(domain['chainId']))
  if (domainFields) for (const f of domainFields) if (/^u?int/.test(f.type) && domain[f.name] !== undefined) domain[f.name] = BigInt(String(domain[f.name]))
  const { EIP712Domain: _omit, ...rest } = types
  return { domain, types: rest, primaryType: t.primaryType, message: convert(t.primaryType, t.message) }
}

export { hexChainId }
