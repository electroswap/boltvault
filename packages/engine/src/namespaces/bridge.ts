/**
 * The Hyperlane bridge (master plan §8.7): corridors from the pinned
 * snapshot, verified on chain by standard at first use (a mismatch disables
 * the corridor); a quote with the router's interchain gas payment and the
 * destination code check; the flow — `approve(router)` on a collateral side,
 * then `transferRemote(dest, bytes32(recipient), amount)` with the gas quote
 * as value — through the same sheet; and the status watcher: the origin
 * receipt's `DispatchId` → the destination mailbox's `ProcessId`, by bounded
 * `eth_getLogs`, never an explorer API.
 */
import { getChain } from '@boltvault/chains'
import { DISPATCH_ID_TOPIC, PROCESS_ID_TOPIC, TOKEN_ROUTER_ABI, corridor, corridorsFrom, dispatchIdFrom, encodeApproveRouter, encodeTransferRemote, etaMinutes, hyperlaneChain, verificationCalls, verifyCorridor, type Corridor } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { maxUint256, parseUnits, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { readMany } from '../multicall'
import { AccountIdSchema, BridgeStatusSchema, type BridgeQuote, type BridgeRoute, type BridgeStatus, type SwapStep } from '../schema'
import type { SettingsStore } from '../settingsStore'
import { readDoc, writeDoc, type DocSpec } from '../storage'
import type { ChainsService } from './chains'
import type { FlowStepRun, FlowStore } from './flows'
import type { ProviderService } from './provider'
import type { VaultManager } from './vault'

export interface BridgeDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly flows: FlowStore
  readonly settings: SettingsStore
  readonly receiptPollMs?: number
  /** Signed flags (§3.7): the bridge and per-corridor kill-switches. */
  readonly statics?: { corridorDisabled(fromChainId: number, toChainId: number, symbol: string): boolean }
}

const DOC: DocSpec<{ items: BridgeStatus[] }> = { key: 'bridge.transfers', version: 1, schema: z.object({ items: z.array(BridgeStatusSchema) }), defaultValue: () => ({ items: [] }) }
const TIMEOUT_MS = 30 * 60_000
const SCAN_WINDOW = 5_000n
const ZERO = '0x0000000000000000000000000000000000000000' as Hex
const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const big = (r: { ok: boolean; value?: unknown } | undefined): bigint => (r?.ok && typeof r.value === 'bigint' ? r.value : 0n)

export class BridgeService {
  private verified = new Map<string, { ok: boolean; reason: string | null }>()
  private items: BridgeStatus[] = []
  private hydrated = false
  private timers = new Map<string, ReturnType<typeof setTimeout>>()

  constructor(private readonly deps: BridgeDeps) {}

  private async hydrate(): Promise<void> {
    if (this.hydrated) return
    const { value } = await readDoc(this.deps.platform.storage.local, DOC, () => this.deps.platform.now())
    this.items = value.items
    this.hydrated = true
  }

  private async persist(): Promise<void> {
    await writeDoc(this.deps.platform.storage.local, DOC, { items: this.items.slice(-50) })
    this.deps.bus.emit({ type: 'bridge.changed', transfers: this.items })
  }

  private async account(accountId: string): Promise<{ id: string; address: Hex; kind: string }> {
    const a = (await this.deps.vault.accounts()).find((x) => x.id === accountId)
    if (!a) throw new EngineError('not_found', 'no such account')
    return { id: a.id, address: a.address as Hex, kind: a.kind }
  }

  /** Verify a corridor's origin side by standard (§2.7 S6), once per session. */
  private async verify(c: Corridor): Promise<{ ok: boolean; reason: string | null }> {
    const key = `${c.origin.chainId}:${c.origin.router.toLowerCase()}:${c.destination.chainId}`
    const hit = this.verified.get(key)
    if (hit) return hit
    let result: { ok: boolean; reason: string | null }
    try {
      const results = await readMany(this.deps.chains, c.origin.chainId, verificationCalls(c))
      result = verifyCorridor(c, results)
    } catch (err) {
      result = { ok: false, reason: err instanceof Error ? err.message : 'verification failed' }
    }
    // Only a positive answer is cached: an RPC hiccup must not disable a corridor for the session.
    if (result.ok) this.verified.set(key, result)
    return result
  }

  /** Corridors from a chain (and token), each with its verification. Disabled chains are left out. */
  async routes(fromChainId: number, token?: string): Promise<BridgeRoute[]> {
    const settings = await this.deps.settings.get()
    const out: BridgeRoute[] = []
    for (const c of corridorsFrom(fromChainId, token)) {
      if (!settings.enabledChains.includes(c.destination.chainId) && c.destination.chainId !== 52014) continue
      const v = await this.verify(c)
      const off = this.deps.statics?.corridorDisabled(c.origin.chainId, c.destination.chainId, c.symbol) === true
      out.push({ symbol: c.symbol, fromChainId: c.origin.chainId, toChainId: c.destination.chainId, token: c.origin.token, router: c.origin.router, standard: c.origin.standard, decimals: c.origin.decimals, verified: v.ok && !off, reason: off ? 'switched off by ElectroSwap (signed flag)' : v.reason })
    }
    return out
  }

  async quote(input: { accountId: string; fromChainId: number; toChainId: number; token: string; amount: string; recipient?: string }): Promise<BridgeQuote> {
    const d = this.deps
    const c = corridor(input.fromChainId, input.toChainId, input.token)
    const account = await this.account(input.accountId)
    const recipient = (input.recipient?.trim() || account.address) as Hex
    const problems: string[] = []
    const base: BridgeQuote = { fromChainId: input.fromChainId, toChainId: input.toChainId, symbol: c?.symbol ?? 'USDC', token: input.token, decimals: c?.origin.decimals ?? 6, amountRaw: '0', balanceRaw: '0', recipient, gasQuoteWei: '0', txFeeWei: '0', feeSymbol: getChain(input.fromChainId)?.nativeCurrency.symbol ?? 'ETH', etaMinutes: etaMinutes(input.fromChainId, input.toChainId), steps: [], recipientCode: { origin: false, destination: null }, ok: false, problems }
    if (!c) return { ...base, problems: ['No Hyperlane corridor for this token between these chains.'] }
    if (!/^0x[0-9a-fA-F]{40}$/.test(recipient)) return { ...base, problems: ['Enter a full destination address.'] }
    const v = await this.verify(c)
    if (!v.ok) problems.push(`This corridor is switched off: ${v.reason ?? 'verification failed'}.`)
    if (this.deps.statics?.corridorDisabled(c.origin.chainId, c.destination.chainId, c.symbol)) problems.push('This corridor is switched off right now by a signed flag from ElectroSwap.')
    if (account.kind === 'watch') problems.push('Watch-only — import a key or pair a device to bridge.')
    let amount = 0n
    try {
      amount = parseUnits(input.amount.trim() || '0', c.origin.decimals)
    } catch {
      problems.push('That amount is not a number.')
    }
    if (amount <= 0n) problems.push('Enter an amount above zero.')
    const owner = account.address
    const dest = hyperlaneChain(c.destination.chainId)
    const [balance, allowance, gasQuote] = await readMany(d.chains, c.origin.chainId, [
      { address: c.origin.token, abi: TOKEN_ROUTER_ABI, functionName: 'balanceOf', args: [owner] },
      { address: c.origin.token, abi: TOKEN_ROUTER_ABI, functionName: 'allowance', args: [owner, c.origin.router] },
      { address: c.origin.router, abi: TOKEN_ROUTER_ABI, functionName: 'quoteGasPayment', args: [dest?.domain ?? c.destination.chainId] },
    ])
    const balanceRaw = big(balance)
    if (amount > balanceRaw) problems.push(`Not enough ${c.symbol}.`)
    const gasQuoteWei = gasQuote?.ok ? big(gasQuote) : null
    if (gasQuoteWei === null) problems.push('The router did not quote the interchain gas; try again in a moment.')
    const native = BigInt(String((await d.chains.rpc(c.origin.chainId, 'eth_getBalance', [owner, 'latest']).catch(() => '0x0')) ?? '0x0'))
    const gasPrice = BigInt(String((await d.chains.rpc(c.origin.chainId, 'eth_gasPrice', []).catch(() => '0x3b9aca00')) ?? '0x3b9aca00'))
    const txFeeWei = 220_000n * gasPrice
    if ((gasQuoteWei ?? 0n) + txFeeWei > native) problems.push(`Not enough ${base.feeSymbol} for the interchain gas plus the network fee.`)
    // A recipient that is a contract here but empty on the destination would receive nothing there (§8.7).
    const [codeOrigin, codeDest] = await Promise.all([d.chains.rpc(c.origin.chainId, 'eth_getCode', [recipient, 'latest']).catch(() => '0x'), d.chains.rpc(c.destination.chainId, 'eth_getCode', [recipient, 'latest']).catch(() => null)])
    const hasCodeOrigin = typeof codeOrigin === 'string' && codeOrigin.length > 2
    const hasCodeDest = typeof codeDest === 'string' && codeDest.length > 2
    if (hasCodeOrigin && codeDest !== null && !hasCodeDest) problems.push('That address is a contract here but nothing on the destination chain — the tokens would be lost.')
    const steps: SwapStep[] = []
    if (c.origin.standard === 'collateral' && big(allowance) < amount) steps.push('approve')
    steps.push('submit')
    return { ...base, symbol: c.symbol, decimals: c.origin.decimals, amountRaw: amount.toString(), balanceRaw: balanceRaw.toString(), recipient, gasQuoteWei: (gasQuoteWei ?? 0n).toString(), txFeeWei: txFeeWei.toString(), steps, recipientCode: { origin: hasCodeOrigin, destination: codeDest === null ? null : hasCodeDest }, ok: problems.length === 0, problems }
  }

  /** Bridge: approve the collateral router when needed, then `transferRemote` with the gas quote as value. */
  async execute(input: { accountId: string; fromChainId: number; toChainId: number; token: string; amount: string; recipient?: string }): Promise<{ flowId: string; requestId: string | null }> {
    const d = this.deps
    const q = await this.quote(input)
    if (!q.ok) throw new EngineError('invalid_argument', q.problems[0] ?? 'cannot bridge')
    const c = corridor(input.fromChainId, input.toChainId, input.token)
    if (!c) throw new EngineError('invalid_argument', 'No corridor.')
    const account = await this.account(input.accountId)
    const dest = hyperlaneChain(c.destination.chainId)
    if (!dest) throw new EngineError('invalid_argument', 'Destination not in the Hyperlane snapshot.')
    const amount = BigInt(q.amountRaw)
    const exact = (await d.settings.get()).exactApprovals
    const tag = d.platform.now().toString(36)
    const steps: FlowStepRun[] = []
    if (q.steps.includes('approve')) {
      steps.push({ step: 'approve', waitReceipt: true, run: () => d.provider.runInternal({ kind: 'send_transaction', origin: 'internal:bridge:approve', chainId: c.origin.chainId, accountId: input.accountId, tx: { from: account.address, to: c.origin.token, value: '0x0', data: encodeApproveRouter(c.origin.router, exact ? amount : maxUint256) }, clientRequestId: `bridge:${tag}:approve` }) })
    }
    const recipient = q.recipient as Hex
    steps.push({
      step: 'submit',
      waitReceipt: true,
      run: async () => {
        const r = await d.provider.runInternal({ kind: 'send_transaction', origin: 'internal:bridge', chainId: c.origin.chainId, accountId: input.accountId, tx: { from: account.address, to: c.origin.router, value: hex(BigInt(q.gasQuoteWei)), data: encodeTransferRemote(dest.domain, recipient, amount) }, clientRequestId: `bridge:${tag}:transfer`, bridgeRecipient: { hasCodeOnOrigin: q.recipientCode.origin, hasCodeOnDestination: q.recipientCode.destination } })
        const settled = r.result.then(async (hash) => {
          if (typeof hash === 'string') await this.track({ accountId: input.accountId, fromChainId: c.origin.chainId, toChainId: c.destination.chainId, symbol: c.symbol, amountRaw: amount.toString(), decimals: c.origin.decimals, recipient, originHash: hash })
          return hash
        })
        settled.catch(() => undefined)
        return { requestId: r.requestId, result: settled }
      },
    })
    const flow = await d.flows.start({ kind: 'bridge', accountId: input.accountId, chainId: c.origin.chainId, quote: null, steps })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  private async track(input: { accountId: string; fromChainId: number; toChainId: number; symbol: 'USDC' | 'USDT'; amountRaw: string; decimals: number; recipient: string; originHash: string }): Promise<void> {
    await this.hydrate()
    const now = this.deps.platform.now()
    const item: BridgeStatus = { id: input.originHash, ...input, messageId: null, destinationHash: null, state: 'pending', startedAt: now, updatedAt: now, scanFrom: null }
    this.items = [...this.items.filter((x) => x.id !== item.id), item]
    await this.persist()
    this.watch(item.id)
  }

  /** The watcher: origin receipt → `DispatchId` → destination `ProcessId`, bounded to blocks since the dispatch. */
  private watch(id: string): void {
    const d = this.deps
    const every = d.receiptPollMs ?? 15_000
    const tick = async (): Promise<void> => {
      await this.hydrate()
      const item = this.items.find((x) => x.id === id)
      if (!item || item.state === 'delivered' || item.state === 'failed' || item.state === 'timeout') return
      try {
        let next: BridgeStatus = item
        if (item.state === 'pending') {
          const receipt = (await d.chains.rpc(item.fromChainId, 'eth_getTransactionReceipt', [item.originHash])) as { status: string; logs: Array<{ address: string; topics: string[] }> } | null
          if (receipt) {
            const mailbox = hyperlaneChain(item.fromChainId)?.mailbox
            if (receipt.status !== '0x1') next = { ...item, state: 'failed' }
            else {
              const messageId = mailbox ? dispatchIdFrom(receipt.logs, mailbox) : null
              const destHead = Number((await d.chains.head(item.toChainId).catch(() => null))?.blockNumber ?? 0)
              next = { ...item, state: messageId ? 'dispatched' : 'failed', messageId, scanFrom: destHead > 0 ? Math.max(0, destHead - 50) : 0 }
            }
          }
        } else if (item.state === 'dispatched' && item.messageId) {
          const dest = hyperlaneChain(item.toChainId)
          const head = BigInt((await d.chains.head(item.toChainId)).blockNumber)
          const from = BigInt(item.scanFrom ?? 0)
          const to = from + SCAN_WINDOW < head ? from + SCAN_WINDOW : head
          if (dest && to >= from) {
            const logs = (await d.chains.rpc(item.toChainId, 'eth_getLogs', [{ fromBlock: hex(from), toBlock: hex(to), address: dest.mailbox, topics: [PROCESS_ID_TOPIC, item.messageId] }])) as Array<{ transactionHash: string }>
            if (logs.length > 0) next = { ...item, state: 'delivered', destinationHash: logs[0]?.transactionHash ?? null }
            else next = { ...item, scanFrom: Number(to >= head ? head - 20n : to) }
          }
        }
        if (next.state === 'dispatched' && d.platform.now() - next.startedAt > TIMEOUT_MS) next = { ...next, state: 'timeout' }
        if (next !== item) {
          this.items = this.items.map((x) => (x.id === id ? { ...next, updatedAt: d.platform.now() } : x))
          await this.persist()
        }
        const after = this.items.find((x) => x.id === id)
        if (after && (after.state === 'pending' || after.state === 'dispatched')) this.timers.set(id, setTimeout(() => void tick(), every))
      } catch {
        this.timers.set(id, setTimeout(() => void tick(), every))
      }
    }
    const existing = this.timers.get(id)
    if (existing) clearTimeout(existing)
    this.timers.set(id, setTimeout(() => void tick(), 0))
  }

  /** Re-arm watchers for transfers still in flight (after unlock / a worker restart). */
  async resume(): Promise<void> {
    await this.hydrate()
    for (const item of this.items) if (item.state === 'pending' || item.state === 'dispatched') this.watch(item.id)
  }

  async list(accountId?: string): Promise<BridgeStatus[]> {
    await this.hydrate()
    return this.items.filter((x) => !accountId || x.accountId === accountId).sort((a, b) => b.startedAt - a.startedAt)
  }

  /** One transfer now; kicks the watcher when it is still in flight. */
  async status(id: string): Promise<BridgeStatus | null> {
    await this.hydrate()
    const item = this.items.find((x) => x.id === id) ?? null
    if (item && (item.state === 'pending' || item.state === 'dispatched')) this.watch(id)
    return item
  }

  dispose(): void {
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
  }

  /** Testing aid: the topics the watcher relies on. */
  static readonly topics = { dispatch: DISPATCH_ID_TOPIC, process: PROCESS_ID_TOPIC, zero: ZERO }
}

const QuoteInput = z.object({ accountId: AccountIdSchema, fromChainId: z.number().int().positive(), toChainId: z.number().int().positive(), token: z.string(), amount: z.string().max(60), recipient: z.string().max(64).optional() })

export function bridgeNamespace(bridge: BridgeService): NamespaceSpec {
  return {
    routes: { input: z.object({ fromChainId: z.number().int().positive(), token: z.string().optional() }), handler: (arg) => bridge.routes((arg as { fromChainId: number }).fromChainId, (arg as { token?: string }).token) },
    quote: { input: QuoteInput, handler: (arg) => bridge.quote(arg as { accountId: string; fromChainId: number; toChainId: number; token: string; amount: string; recipient?: string }) },
    execute: { input: QuoteInput, handler: (arg) => bridge.execute(arg as { accountId: string; fromChainId: number; toChainId: number; token: string; amount: string; recipient?: string }) },
    list: { input: z.object({ accountId: AccountIdSchema.optional() }).optional(), handler: (arg) => bridge.list((arg as { accountId?: string } | undefined)?.accountId) },
    status: { input: z.object({ id: z.string() }), handler: (arg) => bridge.status((arg as { id: string }).id) },
  }
}
