/**
 * rpcFlow — the one request funnel every body shares (master plan §4.6):
 *
 *   known? → SAFE (no UI, rate-limited) → CONNECT (sheet) → CHAIN (session)
 *          → APPROVAL (one in flight per origin, sheet) → REJECTED (4200)
 *
 * Pure: the engine injects an `RpcContext`; the extension's content Ports,
 * the mobile WebView and WalletConnect all arrive here with an origin the
 * *transport* established.
 */
import { RPC, RpcError } from './errors'
import { APPROVAL_METHODS, classify, MAX_LOG_RANGE, SAFE_RATE_PER_SECOND } from './methods'
import type { SiteRegistry } from './sessions'

export type Hex = `0x${string}`

export type ProviderEvent =
  | { readonly event: 'accountsChanged'; readonly payload: readonly string[] }
  | { readonly event: 'chainChanged'; readonly payload: Hex }
  | { readonly event: 'connect'; readonly payload: { readonly chainId: Hex } }
  | { readonly event: 'disconnect'; readonly payload: { readonly code: number; readonly message: string } }
  | { readonly event: 'message'; readonly payload: { readonly type: string; readonly data: unknown } }

export interface TxParams {
  readonly from: Hex
  readonly to?: Hex
  readonly value?: Hex
  readonly data?: Hex
  readonly gas?: Hex
  readonly gasPrice?: Hex
  readonly maxFeePerGas?: Hex
  readonly maxPriorityFeePerGas?: Hex
  readonly nonce?: Hex
  readonly chainId?: Hex
  readonly authorizationList?: readonly unknown[]
}

/** What the engine must put in front of a human. The `clientRequestId` lets a re-sent request re-attach after a worker restart. */
export type ApprovalIntent =
  | { readonly kind: 'connect'; readonly origin: string; readonly chainId: number; readonly clientRequestId: string }
  | { readonly kind: 'switch_chain'; readonly origin: string; readonly chainId: number; readonly clientRequestId: string }
  | { readonly kind: 'add_chain'; readonly origin: string; readonly chainId: number; readonly clientRequestId: string }
  | { readonly kind: 'sign_message'; readonly origin: string; readonly chainId: number; readonly accountId: string; readonly from: Hex; readonly message: Hex; readonly clientRequestId: string }
  | { readonly kind: 'eth_sign'; readonly origin: string; readonly chainId: number; readonly accountId: string; readonly from: Hex; readonly hash: Hex; readonly clientRequestId: string }
  | { readonly kind: 'sign_typed_data'; readonly origin: string; readonly chainId: number; readonly accountId: string; readonly from: Hex; readonly typedData: unknown; readonly version: 'v3' | 'v4'; readonly clientRequestId: string }
  | { readonly kind: 'send_transaction'; readonly origin: string; readonly chainId: number; readonly accountId: string; readonly tx: TxParams; readonly clientRequestId: string; /** internal:swap only — the fee the encoder wrote, checked by the firewall (T10). */ readonly expectedFee?: { readonly sink: Hex; readonly bips: number } | null }
  | { readonly kind: 'watch_asset'; readonly origin: string; readonly chainId: number; readonly type: string; readonly options: unknown; readonly clientRequestId: string }

export interface ConnectResult {
  readonly accountId: string
  readonly addresses: readonly string[]
  readonly chainId: number
}

export interface RpcContext {
  readonly sites: SiteRegistry
  now(): number
  /** The account and addresses a connected origin sees; null when not connected. */
  session(origin: string): Promise<{ accountId: string; addresses: readonly string[] } | null>
  knownChain(chainId: number): boolean
  /** Read-only passthrough on the origin's chain. */
  executeSafe(chainId: number, method: string, params: readonly unknown[]): Promise<unknown>
  /** Put the intent in front of the user and, if approved, execute it. Throws RpcError 4001 on reject. */
  approve(intent: ApprovalIntent): Promise<unknown>
  emit(origin: string, event: ProviderEvent): void
  readonly settings: { readonly ethSignEnabled: boolean }
  /** Fan a chain's heads out as `message` events to this origin; returns the unsubscribe. */
  subscribeHeads?(origin: string, chainId: number, subscriptionId: Hex): () => void
  /** The client name reported by web3_clientVersion. */
  readonly clientVersion: string
}

export function hexChainId(chainId: number): Hex {
  return `0x${chainId.toString(16)}`
}

export function toDecChainId(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v
  if (typeof v === 'string') {
    const n = v.startsWith('0x') ? parseInt(v, 16) : Number(v)
    if (Number.isInteger(n) && n > 0) return n
  }
  throw new RpcError(RPC.INVALID_PARAMS, `Bad chainId: ${String(v)}`)
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const HEX = /^0x[0-9a-fA-F]*$/

function param(params: readonly unknown[], i: number): unknown {
  return params[i]
}

function requireAddress(v: unknown, what: string): Hex {
  if (typeof v === 'string' && ADDRESS.test(v)) return v as Hex
  throw new RpcError(RPC.INVALID_PARAMS, `${what} must be an address`)
}

function requireHex(v: unknown, what: string): Hex {
  if (typeof v === 'string' && HEX.test(v)) return v as Hex
  throw new RpcError(RPC.INVALID_PARAMS, `${what} must be hex`)
}

function optionalHex(v: unknown, what: string): Hex | undefined {
  return v === undefined || v === null ? undefined : requireHex(v, what)
}

/** A leaky bucket per origin for SAFE traffic. */
class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()
  constructor(
    private readonly perSecond: number,
    private readonly now: () => number,
  ) {}
  take(origin: string): boolean {
    const now = this.now()
    const b = this.buckets.get(origin) ?? { tokens: this.perSecond, at: now }
    const refill = ((now - b.at) / 1000) * this.perSecond
    b.tokens = Math.min(this.perSecond, b.tokens + refill)
    b.at = now
    if (b.tokens < 1) {
      this.buckets.set(origin, b)
      return false
    }
    b.tokens -= 1
    this.buckets.set(origin, b)
    return true
  }
}

export class RpcFlow {
  /** One human-facing request per origin; a re-sent request (same client id) joins it instead of failing. */
  private readonly inFlight = new Map<string, { clientRequestId: string; promise: Promise<unknown> }>()
  private readonly limiter: RateLimiter
  private readonly subscriptions = new Map<string, () => void>()
  private subCounter = 0

  constructor(private readonly ctx: RpcContext) {
    this.limiter = new RateLimiter(SAFE_RATE_PER_SECOND, () => ctx.now())
  }

  /** Whether an approval is open for this origin (the UI may show a badge). */
  isPending(origin: string): boolean {
    return this.inFlight.has(origin)
  }

  async request(origin: string, method: string, rawParams: unknown, clientRequestId: string): Promise<unknown> {
    const params: readonly unknown[] = Array.isArray(rawParams) ? rawParams : rawParams === undefined || rawParams === null ? [] : [rawParams]
    const cls = classify(method)
    const chainId = this.ctx.sites.chainIdFor(origin)

    switch (cls) {
      case 'unknown':
        throw new RpcError(RPC.METHOD_NOT_FOUND, `The method ${method} does not exist / is not available.`)
      case 'rejected':
        throw new RpcError(RPC.UNSUPPORTED_METHOD, `${method} is not supported by BoltVault.`)
      case 'safe':
        if (!this.limiter.take(origin)) throw new RpcError(RPC.LIMIT_EXCEEDED, 'Too many requests. Slow down.')
        return this.safe(origin, chainId, method, params)
      case 'connect':
        return this.connect(origin, chainId, method, clientRequestId)
      case 'chain':
        return this.chain(origin, chainId, method, params, clientRequestId)
      case 'approval':
        return this.approval(origin, chainId, method, params, clientRequestId)
    }
  }

  private async safe(origin: string, chainId: number, method: string, params: readonly unknown[]): Promise<unknown> {
    switch (method) {
      case 'eth_chainId':
        return hexChainId(chainId)
      case 'net_version':
        return String(chainId)
      case 'net_listening':
        return true
      case 'web3_clientVersion':
        return this.ctx.clientVersion
      case 'eth_accounts': {
        const s = await this.ctx.session(origin)
        return s ? [...s.addresses] : []
      }
      case 'wallet_getPermissions': {
        const s = await this.ctx.session(origin)
        return s ? permissions(origin, s.addresses, this.ctx.now()) : []
      }
      case 'wallet_getCapabilities': {
        const s = await this.ctx.session(origin)
        if (!s) throw new RpcError(RPC.UNAUTHORIZED, 'Not connected.')
        return { [hexChainId(chainId)]: { atomic: { status: 'unsupported' } } }
      }
      case 'eth_subscribe': {
        const type = param(params, 0)
        if (type !== 'newHeads') throw new RpcError(RPC.UNSUPPORTED_METHOD, `Subscription type ${String(type)} is not supported.`)
        if (!this.ctx.subscribeHeads) throw new RpcError(RPC.UNSUPPORTED_METHOD, 'Subscriptions are not supported here.')
        const id = `0x${(++this.subCounter).toString(16).padStart(32, '0')}` as Hex
        this.subscriptions.set(`${origin}:${id}`, this.ctx.subscribeHeads(origin, chainId, id))
        return id
      }
      case 'eth_unsubscribe': {
        const id = String(param(params, 0))
        const off = this.subscriptions.get(`${origin}:${id}`)
        if (!off) return false
        off()
        this.subscriptions.delete(`${origin}:${id}`)
        return true
      }
      case 'eth_getLogs': {
        const f = param(params, 0)
        if (f && typeof f === 'object') {
          const { fromBlock, toBlock } = f as { fromBlock?: unknown; toBlock?: unknown }
          const from = blockNumber(fromBlock)
          const to = blockNumber(toBlock)
          if (from !== null && to !== null && to - from > MAX_LOG_RANGE) throw new RpcError(RPC.LIMIT_EXCEEDED, `eth_getLogs range is limited to ${MAX_LOG_RANGE} blocks.`)
          if (from !== null && to === null && fromBlock !== 'latest') {
            // An open-ended range from a fixed block is unbounded; refuse rather than melt the RPC.
            throw new RpcError(RPC.LIMIT_EXCEEDED, `eth_getLogs needs a toBlock within ${MAX_LOG_RANGE} blocks of fromBlock.`)
          }
        }
        return this.passthrough(chainId, method, params)
      }
      default:
        return this.passthrough(chainId, method, params)
    }
  }

  private async passthrough(chainId: number, method: string, params: readonly unknown[]): Promise<unknown> {
    try {
      return await this.ctx.executeSafe(chainId, method, params)
    } catch (err) {
      throw RpcError.from(err)
    }
  }

  private async connect(origin: string, chainId: number, method: string, clientRequestId: string): Promise<unknown> {
    const existing = await this.ctx.session(origin)
    if (existing) {
      await this.ctx.sites.touch(origin, this.ctx.now())
      return method === 'wallet_requestPermissions' ? permissions(origin, existing.addresses, this.ctx.now()) : [...existing.addresses]
    }
    return this.exclusive(origin, clientRequestId, async () => {
      const result = (await this.ctx.approve({ kind: 'connect', origin, chainId, clientRequestId })) as ConnectResult
      await this.ctx.sites.connect(origin, { accountId: result.accountId, chainId: result.chainId, accounts: [...result.addresses], now: this.ctx.now() })
      this.ctx.emit(origin, { event: 'accountsChanged', payload: result.addresses })
      this.ctx.emit(origin, { event: 'connect', payload: { chainId: hexChainId(result.chainId) } })
      if (result.chainId !== chainId) this.ctx.emit(origin, { event: 'chainChanged', payload: hexChainId(result.chainId) })
      return method === 'wallet_requestPermissions' ? permissions(origin, result.addresses, this.ctx.now()) : [...result.addresses]
    })
  }

  private async chain(origin: string, chainId: number, method: string, params: readonly unknown[], clientRequestId: string): Promise<unknown> {
    if (method === 'wallet_revokePermissions') {
      const was = await this.ctx.session(origin)
      await this.ctx.sites.disconnect(origin)
      if (was) this.ctx.emit(origin, { event: 'accountsChanged', payload: [] })
      return null
    }
    const p = param(params, 0)
    const requested = toDecChainId((p as { chainId?: unknown } | undefined)?.chainId)
    if (!this.ctx.knownChain(requested)) {
      // A dApp's RPC/explorer URLs are never honoured (§4.6); an unknown chain is 4902 until the user adds it in Settings.
      throw new RpcError(RPC.UNRECOGNIZED_CHAIN, `Chain ${hexChainId(requested)} is not available. Add it in BoltVault › Settings › Networks first.`)
    }
    if (requested === chainId) return null
    const session = await this.ctx.session(origin)
    if (session && method === 'wallet_addEthereumChain') {
      // Known chain: the add is a switch, with a prompt because the site is changing the session.
      await this.exclusive(origin, clientRequestId, () => this.ctx.approve({ kind: 'add_chain', origin, chainId: requested, clientRequestId }))
    }
    await this.ctx.sites.setChain(origin, requested)
    this.ctx.emit(origin, { event: 'chainChanged', payload: hexChainId(requested) })
    return null
  }

  private async approval(origin: string, chainId: number, method: string, params: readonly unknown[], clientRequestId: string): Promise<unknown> {
    if (!APPROVAL_METHODS.has(method)) throw new RpcError(RPC.METHOD_NOT_FOUND, method)
    if (method === 'eth_sign' && !this.ctx.settings.ethSignEnabled) {
      throw new RpcError(RPC.UNSUPPORTED_METHOD, 'eth_sign is disabled. It can be enabled in BoltVault › Settings › Security.')
    }
    const session = await this.ctx.session(origin)
    if (method !== 'wallet_watchAsset' && !session) throw new RpcError(RPC.UNAUTHORIZED, 'Not connected. Call eth_requestAccounts first.')
    const intent = this.intent(origin, chainId, method, params, session, clientRequestId)
    return this.exclusive(origin, clientRequestId, async () => {
      const result = await this.ctx.approve(intent)
      await this.ctx.sites.touch(origin, this.ctx.now())
      return result
    })
  }

  private intent(origin: string, chainId: number, method: string, params: readonly unknown[], session: { accountId: string; addresses: readonly string[] } | null, clientRequestId: string): ApprovalIntent {
    const owns = (from: Hex): void => {
      if (!session || !session.addresses.some((a) => a.toLowerCase() === from.toLowerCase())) throw new RpcError(RPC.UNAUTHORIZED, 'That address is not connected to this site.')
    }
    switch (method) {
      case 'personal_sign': {
        // MetaMask accepts [message, address] and, historically, [address, message].
        const a = param(params, 0)
        const b = param(params, 1)
        const [message, from] = typeof a === 'string' && ADDRESS.test(a) && typeof b === 'string' && !ADDRESS.test(b) ? [b, a] : [a, b]
        const fromHex = requireAddress(from, 'address')
        owns(fromHex)
        const msg = typeof message === 'string' && HEX.test(message) ? (message as Hex) : (`0x${utf8Hex(String(message))}` as Hex)
        return { kind: 'sign_message', origin, chainId, accountId: session?.accountId ?? '', from: fromHex, message: msg, clientRequestId }
      }
      case 'eth_sign': {
        const from = requireAddress(param(params, 0), 'address')
        owns(from)
        return { kind: 'eth_sign', origin, chainId, accountId: session?.accountId ?? '', from, hash: requireHex(param(params, 1), 'data'), clientRequestId }
      }
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4': {
        const from = requireAddress(param(params, 0), 'address')
        owns(from)
        const typed = param(params, 1)
        if (typed === undefined || typed === null) throw new RpcError(RPC.INVALID_PARAMS, 'typed data is required')
        return { kind: 'sign_typed_data', origin, chainId, accountId: session?.accountId ?? '', from, typedData: typed, version: method === 'eth_signTypedData_v3' ? 'v3' : 'v4', clientRequestId }
      }
      case 'eth_sendTransaction': {
        const raw = param(params, 0)
        if (!raw || typeof raw !== 'object') throw new RpcError(RPC.INVALID_PARAMS, 'transaction object is required')
        const t = raw as Record<string, unknown>
        const from = requireAddress(t['from'], 'from')
        owns(from)
        if (t['chainId'] !== undefined && toDecChainId(t['chainId']) !== chainId) throw new RpcError(RPC.INVALID_PARAMS, `Transaction chainId does not match the connected chain ${hexChainId(chainId)}.`)
        const tx: TxParams = {
          from,
          ...(t['to'] !== undefined && t['to'] !== null ? { to: requireAddress(t['to'], 'to') } : {}),
          ...(optionalHex(t['value'], 'value') !== undefined ? { value: optionalHex(t['value'], 'value') } : {}),
          ...(optionalHex(t['data'] ?? t['input'], 'data') !== undefined ? { data: optionalHex(t['data'] ?? t['input'], 'data') } : {}),
          ...(optionalHex(t['gas'], 'gas') !== undefined ? { gas: optionalHex(t['gas'], 'gas') } : {}),
          ...(optionalHex(t['gasPrice'], 'gasPrice') !== undefined ? { gasPrice: optionalHex(t['gasPrice'], 'gasPrice') } : {}),
          ...(optionalHex(t['maxFeePerGas'], 'maxFeePerGas') !== undefined ? { maxFeePerGas: optionalHex(t['maxFeePerGas'], 'maxFeePerGas') } : {}),
          ...(optionalHex(t['maxPriorityFeePerGas'], 'maxPriorityFeePerGas') !== undefined ? { maxPriorityFeePerGas: optionalHex(t['maxPriorityFeePerGas'], 'maxPriorityFeePerGas') } : {}),
          ...(optionalHex(t['nonce'], 'nonce') !== undefined ? { nonce: optionalHex(t['nonce'], 'nonce') } : {}),
          ...(Array.isArray(t['authorizationList']) ? { authorizationList: t['authorizationList'] } : {}),
        }
        return { kind: 'send_transaction', origin, chainId, accountId: session?.accountId ?? '', tx, clientRequestId }
      }
      case 'wallet_watchAsset': {
        const p = param(params, 0) as { type?: unknown; options?: unknown } | undefined
        if (!p || typeof p.type !== 'string') throw new RpcError(RPC.INVALID_PARAMS, 'type is required')
        return { kind: 'watch_asset', origin, chainId, type: p.type, options: p.options, clientRequestId }
      }
      default:
        throw new RpcError(RPC.METHOD_NOT_FOUND, method)
    }
  }

  /** Run one human-facing request per origin. The same client id re-sent (worker restart) shares the open promise. */
  private exclusive(origin: string, clientRequestId: string, run: () => Promise<unknown>): Promise<unknown> {
    const open = this.inFlight.get(origin)
    if (open) {
      if (open.clientRequestId === clientRequestId) return open.promise
      return Promise.reject(new RpcError(RPC.RESOURCE_UNAVAILABLE, 'A request is already open for this site. Finish it first.'))
    }
    const promise = run().finally(() => {
      if (this.inFlight.get(origin)?.promise === promise) this.inFlight.delete(origin)
    })
    this.inFlight.set(origin, { clientRequestId, promise })
    // A rejection must not surface as unhandled when nobody joined it.
    promise.catch(() => undefined)
    return promise
  }

  /** Called by the engine when the user disconnects a site from Settings. */
  async disconnected(origin: string): Promise<void> {
    this.ctx.emit(origin, { event: 'accountsChanged', payload: [] })
  }

  /** Called by the engine when the user changes a site's chain from Settings. */
  chainChanged(origin: string, chainId: number): void {
    this.ctx.emit(origin, { event: 'chainChanged', payload: hexChainId(chainId) })
  }

  dispose(): void {
    for (const off of this.subscriptions.values()) off()
    this.subscriptions.clear()
  }
}

function permissions(origin: string, addresses: readonly string[], now: number): unknown[] {
  return [{ id: `${origin}:eth_accounts`, parentCapability: 'eth_accounts', invoker: origin, caveats: [{ type: 'restrictReturnedAccounts', value: [...addresses] }], date: now }]
}

function blockNumber(v: unknown): number | null {
  if (typeof v !== 'string') return null
  if (v === 'latest' || v === 'pending' || v === 'earliest' || v === 'safe' || v === 'finalized') return null
  if (/^0x[0-9a-fA-F]+$/.test(v)) return parseInt(v, 16)
  if (/^\d+$/.test(v)) return Number(v)
  return null
}

function utf8Hex(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')
}
