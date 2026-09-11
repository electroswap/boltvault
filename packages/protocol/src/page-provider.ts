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
 * - The object is frozen after construction and its internals are `#`-private,
 *   so page script can neither reassign its methods nor read its transport,
 *   its pending map or its window handle. The channel nonce is not a secret
 *   from the page and never was — see `wire.ts`.
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
  /**
   * Fetch the chain id at install time so the deprecated synchronous mirrors
   * (`chainId`, `networkVersion`) are warm. Off by default: priming opens a
   * service-worker Port from every http(s) frame on every page at
   * `document_start`, whether or not anything ever touches the wallet — which
   * defeats the lazy-Port design, tells the worker about every page the user
   * visits, and creates a rate-limiter bucket per origin. EIP-1193 permits
   * `null` for those mirrors and every modern library calls `request`.
   */
  readonly prime?: boolean
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

/** Every method a dApp may pull off the provider; bound in the constructor (§3.5). */
const BOUND_METHODS = ['request', 'send', 'sendAsync', 'enable', 'isConnected', 'on', 'once', 'removeListener', 'off', 'removeAllListeners', 'listenerCount', 'applyConfig', 'prime', 'primeOnce'] as const

type Listener = (...args: unknown[]) => void

class Emitter {
  readonly #listeners = new Map<string, Set<Listener>>()
  on(event: string, fn: Listener): this {
    const set = this.#listeners.get(event) ?? new Set<Listener>()
    set.add(fn)
    this.#listeners.set(event, set)
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
    this.#listeners.get(event)?.delete(fn)
    return this
  }
  off(event: string, fn: Listener): this {
    return this.removeListener(event, fn)
  }
  removeAllListeners(event?: string): this {
    if (event) this.#listeners.delete(event)
    else this.#listeners.clear()
    return this
  }
  listenerCount(event: string): number {
    return this.#listeners.get(event)?.size ?? 0
  }
  protected emit(event: string, ...args: unknown[]): boolean {
    const set = this.#listeners.get(event)
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
  readonly pending: Map<number, { resolve: (v: unknown) => void; reject: (e: ProviderRpcError) => void; method: string; epoch: number }>
}

export class BoltVaultProvider extends Emitter {
  readonly isBoltVault = true as const
  readonly isBoltWallet = true as const
  readonly isRabby = false as const
  providers?: unknown[]
  /*
    `#`-private, not TypeScript `private`.

    TypeScript's `private` is erased at compile time: these were ordinary own
    properties on the instance, so page script could read
    `window.ethereum.transport`, `.channel` and `.state.pending` despite the
    freeze — and the comment at the top of this file said the transport was
    unreachable. `Object.freeze` stops reassignment, not reading. The nonce was
    never a secret from the page (the provider runs in the page's own world and
    `wire.ts` says so), but the pending map is another matter: reaching it means
    resolving another script's in-flight request with a value of your choosing.
  */
  readonly #state: ProviderState & { isMetaMask: boolean }
  readonly #transport: PageTransport
  readonly #channel: string
  readonly #win: WindowLike
  #primed = false
  /*
    Bumped by every event that moves the mirrors.

    A reply and an event can cross: a slow `eth_accounts` answer landing after
    an `accountsChanged` would otherwise overwrite the newer value with the
    older one, and the page would read a stale account. A request remembers the
    epoch it was sent in and declines to mirror if anything has moved since.
  */
  #epoch = 0

  constructor(config: ProviderConfig) {
    super()
    this.#transport = config.transport
    this.#channel = config.channel
    this.#win = config.win
    this.#state = {
      isMetaMask: config.isMetaMask === true,
      chainId: config.initialChainId ?? null,
      networkVersion: config.initialChainId ? String(parseInt(config.initialChainId, 16)) : null,
      selectedAddress: null,
      connected: false,
      nextId: 1,
      pending: new Map(),
    }
    this.#transport.onMessage((m) => this.receive(m))
    this.#bindPublicMethods()
  }

  /**
   * §3.5 asks for the methods to be bound. `Object.freeze` does not do that, and
   * dApps really do write `const { request } = window.ethereum` — which, with
   * #private state, throws rather than merely misbehaving. Own, non-configurable
   * properties shadow the prototype and survive the freeze.
   */
  #bindPublicMethods(): void {
    const self = this as unknown as Record<string, unknown>
    for (const name of BOUND_METHODS) {
      const fn = self[name]
      if (typeof fn !== 'function') continue
      Object.defineProperty(this, name, {
        value: (fn as (...a: unknown[]) => unknown).bind(this),
        writable: false,
        enumerable: false,
        configurable: false,
      })
    }
  }

  /** Settings › "Pretend to be MetaMask" — only legacy sniffers care (§4.5). */
  get isMetaMask(): boolean {
    return this.#state.isMetaMask
  }

  /** Apply settings that arrive after install (the isolated script reads storage asynchronously). */
  applyConfig(config: { isMetaMask?: boolean }): void {
    if (typeof config.isMetaMask === 'boolean') this.#state.isMetaMask = config.isMetaMask
  }

  /** Synchronous mirrors (§4.3), updated from events. */
  /*
    The deprecated synchronous mirrors, primed on first interest.

    `prime()` used to run from `installProvider`, so every http(s) frame on
    every page opened a service-worker Port at `document_start` — whether or
    not anything ever touched the wallet. That defeats the lazy-Port design,
    tells the worker about every page the user visits, and leaves a
    rate-limiter bucket per origin. Reading one of these getters, or a page
    asking for providers over EIP-6963, is the first evidence that the page
    cares; the round trip starts there instead. The first read still answers
    `null`, which EIP-1193 permits and every modern library avoids by calling
    `request`.
  */
  get chainId(): string | null {
    this.primeOnce()
    return this.#state.chainId
  }
  get networkVersion(): string | null {
    this.primeOnce()
    return this.#state.networkVersion
  }
  get selectedAddress(): string | null {
    this.primeOnce()
    return this.#state.selectedAddress
  }

  /** At most one priming round trip per provider, started by the first sign of interest. */
  primeOnce(): void {
    if (this.#primed) return
    this.#primed = true
    this.prime()
  }

  isConnected(): boolean {
    return this.#state.connected
  }

  async request(args: RequestArguments): Promise<unknown> {
    if (!args || typeof args !== 'object') throw new ProviderRpcError(-32600, 'Expected a single, non-array, object argument.')
    const { method, params } = args
    if (typeof method !== 'string' || method.length === 0) throw new ProviderRpcError(-32600, "'args.method' must be a non-empty string.")
    if (params !== undefined && !Array.isArray(params) && (typeof params !== 'object' || params === null)) throw new ProviderRpcError(-32600, "'args.params' must be an object or array if provided.")
    if (needsUserAttention(method) && this.#win.document.hidden) await this.untilVisible()
    return new Promise<unknown>((resolve, reject) => {
      const id = this.#state.nextId++
      this.#state.pending.set(id, { resolve, reject, method, epoch: this.#epoch })
      const msg: InpageRequest = { target: INPAGE_TARGET, channel: this.#channel, id, method, ...(params === undefined ? {} : { params }) }
      try {
        this.#transport.post(msg)
      } catch (err) {
        this.#state.pending.delete(id)
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
        if (!this.#win.document.hidden) resolve()
        else this.#win.document.addEventListener('visibilitychange', check, { once: true })
      }
      check()
    })
  }

  private receive(m: InpageMessage): void {
    if (!isInpageMessage(m, this.#channel)) return
    if (m.kind === 'response') {
      const p = this.#state.pending.get(m.id)
      if (!p) return
      this.#state.pending.delete(m.id)
      if (m.error) p.reject(new ProviderRpcError(m.error.code, m.error.message, m.error.data))
      else {
        /*
          The synchronous mirrors follow real traffic, not an eager probe.

          `connected`, `chainId` and `selectedAddress` used to be set only by
          `prime()`, which is why priming had to run in every frame of every
          page at document_start. Any answered request is the provider
          demonstrably talking to the wallet — which is what EIP-1193 means by
          connected — and a request that asked the chain or the accounts has
          just been told the answer. Reading it here makes the probe one way of
          warming the mirrors rather than the only way.
        */
        this.mirror(p.method, m.result, p.epoch)
        if (!this.#state.connected) {
          this.#state.connected = true
          this.emit('connect', { chainId: this.#state.chainId })
        }
        p.resolve(m.result)
      }
      return
    }
    switch (m.event) {
      case 'accountsChanged': {
        const accounts = Array.isArray(m.payload) ? (m.payload as string[]) : []
        this.#epoch += 1
        this.#state.selectedAddress = accounts[0] ?? null
        this.emit('accountsChanged', accounts)
        break
      }
      case 'chainChanged': {
        const chainId = String(m.payload)
        this.#epoch += 1
        this.#state.chainId = chainId
        this.#state.networkVersion = String(parseInt(chainId, 16))
        this.emit('chainChanged', chainId)
        this.emit('networkChanged', this.#state.networkVersion)
        break
      }
      case 'connect': {
        const payload = m.payload as { chainId?: string }
        const chainId = typeof payload?.chainId === 'string' && payload.chainId.length > 0 ? payload.chainId : this.#state.chainId
        // EIP-1193 says `connect` carries a chain id, and wagmi and viem both call
        // parseInt on it. Emitting null breaks their handlers, so stay quiet until
        // we actually know the chain (§4.3).
        if (chainId === null) break
        this.#state.chainId = chainId
        this.#state.networkVersion = String(parseInt(chainId, 16))
        this.#state.connected = true
        this.emit('connect', { chainId })
        break
      }
      case 'disconnect': {
        this.#state.connected = false
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

  /** Keep the deprecated synchronous mirrors in step with any answer that carries them. */
  private mirror(method: string, result: unknown, epoch: number): void {
    // An event has moved the mirrors since this request went out; it wins.
    if (epoch !== this.#epoch) return
    if (method === 'eth_chainId' && typeof result === 'string') {
      this.#state.chainId = result
      this.#state.networkVersion = String(parseInt(result, 16))
      return
    }
    if ((method === 'eth_accounts' || method === 'eth_requestAccounts') && Array.isArray(result)) {
      const first = result[0]
      this.#state.selectedAddress = typeof first === 'string' ? first : null
    }
  }

  /** Prime the synchronous mirrors with SAFE calls; failures are silent. */
  prime(): void {
    /*
      Just the two requests; `mirror()` records the answers.

      These handlers used to write the mirrors themselves, which put them
      outside the epoch guard — a slow probe reply landing after an
      `accountsChanged` overwrote the newer account with the older one, and the
      page then read a stale address. One writer, one rule.
    */
    void this.request({ method: 'eth_chainId' }).catch(() => undefined)
    void this.request({ method: 'eth_accounts' }).catch(() => undefined)
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

/*
  Freeze the prototypes, not just the instances.

  `Object.freeze(provider)` stops properties being added or replaced on the
  object; it does nothing about its prototype, so page script could still
  overwrite `BoltVaultProvider.prototype.request` and intercept every call any
  other script on the page makes through `window.ethereum`.
*/
Object.freeze(BoltVaultProvider.prototype)
Object.freeze(Emitter.prototype)

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
  // A page asking for providers is the page taking an interest, so the
  // synchronous mirrors are worth warming at that point — and only then.
  win.addEventListener('eip6963:requestProvider', () => {
    announce()
    provider.primeOnce()
  })
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
  if (config.prime) provider.primeOnce()
  return { provider, info, windowEthereum }
}

/** A `window.postMessage` transport bound to the per-load channel nonce. */
export function windowTransport(win: { postMessage(message: unknown, targetOrigin: string): void; addEventListener(type: string, listener: (ev: { source: unknown; origin: string; data: unknown }) => void): void; location: { origin: string } }, channel: string): PageTransport {
  return {
    post: (message) => win.postMessage(message, win.location.origin),
    onMessage: (listener) => {
      win.addEventListener('message', (ev) => {
        if (ev.source !== win) return
        if (ev.origin !== win.location.origin) return
        const d = ev.data as { target?: unknown } | null
        if (!d || d.target !== CONTENT_TARGET) return
        if (isInpageMessage(ev.data, channel)) listener(ev.data)
      })
    },
  }
}
