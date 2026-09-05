/**
 * The MAIN-world provider (master plan §4.3–§4.5). One source for the
 * extension's content script, the mobile in-app browser and the test
 * fixture. No imports of chrome/browser/engine code; ≤ 25 KB minified.
 *
 * - EIP-1193 `request`, events with exact payloads, `isConnected()` as a
 *   method; legacy `send`/`sendAsync`/`enable` for web3 v1 / ethers v5.
 * - EIP-6963 announce on load and on every `eip6963:requestProvider`; the
 *   announced provider IS `window.ethereum` when we own it.
 * - Coexistence: define `window.ethereum` only if absent (configurable so
 *   another wallet can still take over unless the user chose "default").
 * - Approval-class requests wait while the tab is hidden.
 * - The object is frozen after construction; the transport is not reachable.
 */
import { needsUserAttention } from './methods'
import { CONFIG_EVENT, CONTENT_TARGET, INPAGE_TARGET, isInpageMessage, type InpageMessage, type InpageRequest, type RpcErrorShape } from './wire'

export interface PageTransport {
  post(message: InpageRequest): void
  onMessage(listener: (message: InpageMessage) => void): void
}

export interface WindowLike {
  ethereum?: unknown
  addEventListener(type: string, listener: (ev: unknown) => void): void
  dispatchEvent(ev: unknown): boolean
  readonly document: { readonly hidden: boolean; addEventListener(type: string, listener: () => void, opts?: { once: boolean }): void }
  readonly CustomEvent: new (type: string, init?: { detail?: unknown }) => unknown
  readonly Event: new (type: string) => unknown
}

export interface ProviderConfig {
  readonly transport: PageTransport
  readonly channel: string
  readonly win: WindowLike
  readonly uuid: string
  readonly name?: string
  readonly icon: string
  readonly rdns?: string
  /** Settings › "Pretend to be MetaMask" (off by default). */
  readonly isMetaMask?: boolean
  /** Settings › "BoltVault is my default wallet". */
  readonly defaultWallet?: boolean
  readonly initialChainId?: string
}

export class ProviderRpcError extends Error {
  override readonly name = 'ProviderRpcError'
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }
}

type Listener = (...args: unknown[]) => void

class Emitter {
  private readonly listeners = new Map<string, Set<Listener>>()
  on(event: string, fn: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>()
    set.add(fn)
    this.listeners.set(event, set)
    return this
  }
  once(event: string, fn: Listener): this {
    const wrapped: Listener = (...args) => {
      this.removeListener(event, wrapped)
      fn(...args)
    }
    return this.on(event, wrapped)
  }
  removeListener(event: string, fn: Listener): this {
    this.listeners.get(event)?.delete(fn)
    return this
  }
  off(event: string, fn: Listener): this {
    return this.removeListener(event, fn)
  }
  removeAllListeners(event?: string): this {
    if (event) this.listeners.delete(event)
    else this.listeners.clear()
    return this
  }
  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0
  }
  protected emit(event: string, ...args: unknown[]): boolean {
    const set = this.listeners.get(event)
    if (!set || set.size === 0) return false
    for (const fn of [...set]) {
      try {
        fn(...args)
      } catch {
        // a listener must never break the provider
      }
    }
    return true
  }
}

export interface RequestArguments {
  readonly method: string
  readonly params?: readonly unknown[] | Record<string, unknown>
}

interface JsonRpcPayload {
  readonly id?: number | string | null
  readonly jsonrpc?: string
  readonly method: string
  readonly params?: unknown
}

interface JsonRpcResult {
  readonly id: number | string | null
  readonly jsonrpc: '2.0'
  readonly result?: unknown
  readonly error?: RpcErrorShape
}

const SYNC_LEGACY = new Set(['eth_accounts', 'eth_coinbase', 'eth_uninstallFilter', 'net_version'])

/** Mutable state lives here so the provider object itself can be frozen (§3.5). */
interface ProviderState {
  chainId: string | null
  networkVersion: string | null
  selectedAddress: string | null
  connected: boolean
  nextId: number
  readonly pending: Map<number, { resolve: (v: unknown) => void; reject: (e: ProviderRpcError) => void }>
}

export class BoltVaultProvider extends Emitter {
  readonly isBoltVault = true as const
  readonly isBoltWallet = true as const
  readonly isRabby = false as const
  providers?: unknown[]
  private readonly state: ProviderState & { isMetaMask: boolean }
  private readonly transport: PageTransport
  private readonly channel: string
  private readonly win: WindowLike

  constructor(config: ProviderConfig) {
    super()
    this.transport = config.transport
    this.channel = config.channel
    this.win = config.win
    this.state = {
      isMetaMask: config.isMetaMask === true,
      chainId: config.initialChainId ?? null,
      networkVersion: config.initialChainId ? String(parseInt(config.initialChainId, 16)) : null,
      selectedAddress: null,
      connected: false,
      nextId: 1,
      pending: new Map(),
    }
    this.transport.onMessage((m) => this.receive(m))
  }

  /** Settings › "Pretend to be MetaMask" — only legacy sniffers care (§4.5). */
  get isMetaMask(): boolean {
    return this.state.isMetaMask
  }

  /** Apply settings that arrive after install (the isolated script reads storage asynchronously). */
  applyConfig(config: { isMetaMask?: boolean }): void {
    if (typeof config.isMetaMask === 'boolean') this.state.isMetaMask = config.isMetaMask
  }

  /** Synchronous mirrors (§4.3), updated from events. */
  get chainId(): string | null {
    return this.state.chainId
  }
  get networkVersion(): string | null {
    return this.state.networkVersion
  }
  get selectedAddress(): string | null {
    return this.state.selectedAddress
  }

  isConnected(): boolean {
    return this.state.connected
  }

  async request(args: RequestArguments): Promise<unknown> {
    if (!args || typeof args !== 'object') throw new ProviderRpcError(-32600, 'Expected a single, non-array, object argument.')
    const { method, params } = args
    if (typeof method !== 'string' || method.length === 0) throw new ProviderRpcError(-32600, "'args.method' must be a non-empty string.")
    if (params !== undefined && !Array.isArray(params) && (typeof params !== 'object' || params === null)) throw new ProviderRpcError(-32600, "'args.params' must be an object or array if provided.")
    if (needsUserAttention(method) && this.win.document.hidden) await this.untilVisible()
    return new Promise<unknown>((resolve, reject) => {
      const id = this.state.nextId++
      this.state.pending.set(id, { resolve, reject })
      const msg: InpageRequest = { target: INPAGE_TARGET, channel: this.channel, id, method, ...(params === undefined ? {} : { params }) }
      try {
        this.transport.post(msg)
      } catch (err) {
        this.state.pending.delete(id)
        reject(new ProviderRpcError(4900, err instanceof Error ? err.message : 'transport failed'))
      }
    })
  }

  /** web3 v1 / ethers v5 legacy surface. */
  send(methodOrPayload: string | JsonRpcPayload | JsonRpcPayload[], paramsOrCallback?: unknown): unknown {
    if (typeof methodOrPayload === 'string') {
      return this.request({ method: methodOrPayload, params: Array.isArray(paramsOrCallback) ? paramsOrCallback : [] })
    }
    if (typeof paramsOrCallback === 'function') {
      this.sendAsync(methodOrPayload, paramsOrCallback as (err: unknown, res?: JsonRpcResult | JsonRpcResult[]) => void)
      return undefined
    }
    if (!Array.isArray(methodOrPayload) && SYNC_LEGACY.has(methodOrPayload.method)) {
      const result = methodOrPayload.method === 'eth_accounts' ? (this.selectedAddress ? [this.selectedAddress] : []) : methodOrPayload.method === 'eth_coinbase' ? this.selectedAddress : methodOrPayload.method === 'net_version' ? this.networkVersion : true
      return { id: methodOrPayload.id ?? null, jsonrpc: '2.0', result }
    }
    throw new ProviderRpcError(-32600, 'Synchronous send is only supported for eth_accounts, eth_coinbase, eth_uninstallFilter and net_version. Use request().')
  }

  sendAsync(payload: JsonRpcPayload | JsonRpcPayload[], callback: (err: unknown, res?: JsonRpcResult | JsonRpcResult[]) => void): void {
    const one = async (p: JsonRpcPayload): Promise<JsonRpcResult> => {
      try {
        const result = await this.request({ method: p.method, params: p.params as RequestArguments['params'] })
        return { id: p.id ?? null, jsonrpc: '2.0', result }
      } catch (err) {
        const e = err instanceof ProviderRpcError ? err : new ProviderRpcError(-32603, String(err))
        return { id: p.id ?? null, jsonrpc: '2.0', error: { code: e.code, message: e.message, ...(e.data !== undefined ? { data: e.data } : {}) } }
      }
    }
    if (Array.isArray(payload)) {
      void Promise.all(payload.map(one)).then((res) => callback(null, res))
      return
    }
    void one(payload).then((res) => (res.error ? callback(new ProviderRpcError(res.error.code, res.error.message, res.error.data), res) : callback(null, res)))
  }

  /** The 2018 API. */
  enable(): Promise<unknown> {
    return this.request({ method: 'eth_requestAccounts' })
  }

  private untilVisible(): Promise<void> {
    return new Promise((resolve) => {
      const check = (): void => {
        if (!this.win.document.hidden) resolve()
        else this.win.document.addEventListener('visibilitychange', check, { once: true })
      }
      check()
    })
  }

  private receive(m: InpageMessage): void {
    if (!isInpageMessage(m, this.channel)) return
    if (m.kind === 'response') {
      const p = this.state.pending.get(m.id)
      if (!p) return
      this.state.pending.delete(m.id)
      if (m.error) p.reject(new ProviderRpcError(m.error.code, m.error.message, m.error.data))
      else p.resolve(m.result)
      return
    }
    switch (m.event) {
      case 'accountsChanged': {
        const accounts = Array.isArray(m.payload) ? (m.payload as string[]) : []
        this.state.selectedAddress = accounts[0] ?? null
        this.emit('accountsChanged', accounts)
        break
      }
      case 'chainChanged': {
        const chainId = String(m.payload)
        this.state.chainId = chainId
        this.state.networkVersion = String(parseInt(chainId, 16))
        this.emit('chainChanged', chainId)
        this.emit('networkChanged', this.networkVersion)
        break
      }
      case 'connect': {
        const payload = m.payload as { chainId?: string }
        if (payload?.chainId) {
          this.state.chainId = payload.chainId
          this.state.networkVersion = String(parseInt(payload.chainId, 16))
        }
        this.state.connected = true
        this.emit('connect', { chainId: this.chainId })
        break
      }
      case 'disconnect': {
        this.state.connected = false
        const e = m.payload as RpcErrorShape
        this.emit('disconnect', new ProviderRpcError(e?.code ?? 4900, e?.message ?? 'disconnected'))
        break
      }
      case 'message':
        this.emit('message', m.payload)
        break
      default:
        break
    }
  }

  /** Prime the synchronous mirrors with SAFE calls; failures are silent. */
  prime(): void {
    void this.request({ method: 'eth_chainId' })
      .then((c) => {
        if (typeof c === 'string') {
          this.state.chainId = c
          this.state.networkVersion = String(parseInt(c, 16))
          this.state.connected = true
          this.emit('connect', { chainId: c })
        }
      })
      .catch(() => undefined)
    void this.request({ method: 'eth_accounts' })
      .then((a) => {
        if (Array.isArray(a)) this.state.selectedAddress = (a[0] as string | undefined) ?? null
      })
      .catch(() => undefined)
  }
}

export interface Eip6963Info {
  readonly uuid: string
  readonly name: string
  readonly icon: string
  readonly rdns: string
}

export interface InstallResult {
  readonly provider: BoltVaultProvider
  readonly info: Eip6963Info
  /** Where `window.ethereum` ended up: ours, another wallet's, or shared through `providers`. */
  readonly windowEthereum: 'ours' | 'theirs' | 'providers'
}

export function installProvider(config: ProviderConfig): InstallResult {
  const win = config.win
  const provider = new BoltVaultProvider(config)
  const info: Eip6963Info = Object.freeze({ uuid: config.uuid, name: config.name ?? 'BoltVault', icon: config.icon, rdns: config.rdns ?? 'io.electroswap.boltvault' })

  let windowEthereum: InstallResult['windowEthereum'] = 'theirs'
  const existing = win.ethereum
  if (existing === undefined || existing === null) {
    provider.providers = [provider]
    Object.freeze(provider)
    try {
      if (config.defaultWallet) {
        Object.defineProperty(win, 'ethereum', { value: provider, configurable: false, writable: false, enumerable: true })
      } else {
        Object.defineProperty(win, 'ethereum', { value: provider, configurable: true, writable: true, enumerable: true })
      }
      windowEthereum = 'ours'
    } catch {
      windowEthereum = 'theirs'
    }
  } else {
    Object.freeze(provider)
    const theirs = existing as { providers?: unknown }
    if (Array.isArray(theirs.providers)) {
      theirs.providers.push(provider)
      windowEthereum = 'providers'
    } else if (config.defaultWallet) {
      try {
        Object.defineProperty(win, 'ethereum', { value: provider, configurable: false, writable: false, enumerable: true })
        windowEthereum = 'ours'
      } catch {
        windowEthereum = 'theirs'
      }
    }
  }

  const announce = (): void => {
    const detail = Object.freeze({ info, provider })
    win.dispatchEvent(new win.CustomEvent('eip6963:announceProvider', { detail }))
  }
  win.addEventListener('eip6963:requestProvider', announce)
  win.addEventListener(CONFIG_EVENT, (ev) => {
    const detail = (ev as { detail?: { isMetaMask?: boolean; defaultWallet?: boolean } }).detail
    if (!detail) return
    provider.applyConfig(detail)
    if (detail.defaultWallet && win.ethereum === provider) {
      // Best effort: pin ourselves so a later wallet cannot replace us. If we are not
      // first any more, the plan's answer is "Reload open sites", never a fight on a timer.
      try {
        Object.defineProperty(win, 'ethereum', { value: provider, configurable: false, writable: false, enumerable: true })
      } catch {
        // already non-configurable
      }
    }
  })
  announce()
  provider.prime()
  return { provider, info, windowEthereum }
}

/** A `window.postMessage` transport bound to the per-load channel nonce. */
export function windowTransport(win: { postMessage(message: unknown, targetOrigin: string): void; addEventListener(type: string, listener: (ev: { source: unknown; origin: string; data: unknown }) => void): void; location: { origin: string } }, channel: string): PageTransport {
  return {
    post: (message) => win.postMessage(message, win.location.origin === 'null' ? '*' : win.location.origin),
    onMessage: (listener) => {
      win.addEventListener('message', (ev) => {
        if (ev.source !== win) return
        const d = ev.data as { target?: unknown } | null
        if (!d || d.target !== CONTENT_TARGET) return
        if (isInpageMessage(ev.data, channel)) listener(ev.data)
      })
    },
  }
}
