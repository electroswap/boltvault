/**
 * BoltVault page-provider (T3.4) — the MAIN-world provider a dApp talks to.
 *
 * This is the part that runs *inside the page's JS context* (MAIN world). Per
 * design §"What gets installed in MAIN world": it must be a self-contained
 * unit with ZERO imports of `chrome`/`browser`/core (the page's bundle must be
 * able to eval it), implementing EIP-1193 + the legacy wrappers dApps still
 * need (`send`/`sendAsync`/`enable`), announcing via EIP-6963, and coexisting
 * with MetaMask/Rabby via the `providers` array + EIP-5749.
 *
 * The page never talks to the SW directly; it posts to the ISOLATED bridge,
 * which relays over a Port. We make the transport an injected `relay` so this
 * exact module is unit-testable outside the page (and in the page, where the
 * relay is `window.postMessage`).
 */

export const PROVIDER_RDNS = 'io.electroswap.boltvault' as const
// Stable UUIDv4 baked at build (EIP-6963 requires a stable uuid).
export const PROVIDER_UUID = 'a5f447be-a152-4438-8d02-1e24e6867d14' as const
export const PROVIDER_NAME = 'BoltVault' as const

/** Frozen EIP-6963 provider info (icon must be a data: URI per spec). */
export function providerInfo(iconDataUri: string): Readonly<{
  uuid: string
  name: string
  icon: string
  rdns: string
}> {
  return Object.freeze({
    uuid: PROVIDER_UUID,
    name: PROVIDER_NAME,
    icon: iconDataUri,
    rdns: PROVIDER_RDNS,
  })
}

/** Transport the provider uses to reach the ISOLATED bridge. */
export interface Relay {
  /** Send one JSON-RPC request; resolves with the response. */
  request(payload: { jsonrpc: string; id: number; method: string; params?: unknown[] }): Promise<unknown>
}

export type EmitterEvents =
  | { event: 'chainChanged'; chainId: string }
  | { event: 'accountsChanged'; accounts: string[] }
  | { event: 'disconnect' }
  | { event: 'message'; message: { type: string; data?: unknown } }

export interface BoltProviderOptions {
  readonly relay: Relay
  /** Set when we own window.ethereum AND the user chose BoltVault as default. */
  readonly isDefaultWallet?: boolean
  /** MetaMask compatibility mode (isMetaMask = true). */
  readonly metaMaskCompat?: boolean
  /** Override the injected window (tests). */
  readonly win?: Window
}

type Listener = (payload: any) => void

export class BoltVaultProvider {
  readonly isBoltVault = true
  /** Alias kept for any dApp that still sniffs the abandoned fork's flag. */
  readonly isBoltWallet = true
  isMetaMask: boolean
  isRabby = false
  /** ETN mainnet (0xcb2e = 52014) until a per-origin session says otherwise. */
  chainId = '0xcb2e'
  networkVersion = '52014'
  selectedAddress: string | null = null
  isConnected = true

  private readonly win: Window
  private readonly relay: Relay
  private nextId = 1
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
  private readonly listeners = new Set<Listener>()

  constructor(opts: BoltProviderOptions) {
    this.win = opts.win ?? window
    this.relay = opts.relay
    this.isMetaMask = opts.metaMaskCompat ?? false
    // Listen for relay responses + SW-pushed events.
    this.win.addEventListener('message', (ev: MessageEvent) => {
      this.onWindowMessage(ev)
    })
  }

  /** EIP-1193 request. */
  async request(args: { method: string; params?: unknown[] }): Promise<unknown> {
    const id = this.nextId++
    const payload = { jsonrpc: '2.0', id, method: args.method, params: args.params ?? [] }
    // Fire-and-track; resolve/reject from the relay response.
    const result = await new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      void this.relay.request(payload).then((resp) => this.handleRelayResponse(id, resp))
    })
    // Auto-apply state mutations returned by the SW.
    this.applyStateFromMethod(args.method, result)
    return result
  }

  private applyStateFromMethod(method: string, result: unknown): void {
    if (method === 'eth_chainId' || method === 'net_version') {
      this.chainId = method === 'eth_chainId' ? (result as string) : this.hexOf(result)
      this.networkVersion = this.hexToDec(this.chainId)
    }
    if (method === 'eth_accounts') {
      const accounts = (result as string[]) ?? []
      this.selectedAddress = accounts[0] ?? null
    }
  }

  /** Legacy EIP-1102 `enable` (2018) — returns connected accounts. */
  async enable(): Promise<string[]> {
    const accounts = await this.request({ method: 'eth_requestAccounts' })
    return (accounts as string[]) ?? []
  }

  /** Legacy EIP-300 `send(method, params)`. */
  async send(method: string, params: unknown[] = []): Promise<unknown> {
    return this.request({ method, params })
  }

  /** Legacy web3 v1 `sendAsync(payload, callback)`. */
  sendAsync(
    payload: { jsonrpc?: string; id?: number; method: string; params?: unknown[] },
    callback: (err: unknown, res?: { jsonrpc: string; id: number; result: unknown }) => void,
  ): void {
    void this.request({ method: payload.method, params: payload.params }).then(
      (result) => callback(null, { jsonrpc: '2.0', id: payload.id ?? 0, result }),
      (err) => callback(err, undefined),
    )
  }

  /** Subscribe to SW-pushed events (chainChanged/accountsChanged/disconnect). */
  on(event: string, listener: Listener): this {
    this.listeners.add(listener)
    return this
  }

  off(event: string, listener: Listener): this {
    this.listeners.delete(listener)
    return this
  }

  private onWindowMessage(ev: MessageEvent): void {
    const msg = ev.data as any
    if (!msg || msg.target !== PROVIDER_RDNS) return
    if (msg.jsonrpc === '2.0' && typeof msg.id === 'number' && this.pending.has(msg.id)) {
      const { resolve, reject } = this.pending.get(msg.id)!
      this.pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message ?? 'rpc error'))
      else resolve(msg.result)
      return
    }
    // SW → page event push (chainChanged etc.), not an RPC response.
    if (msg.event) {
      this.emit(msg.event, msg.data)
    }
  }

  private handleRelayResponse(id: number, resp: any): void {
    // The relay may hand us the raw response (with error) or just the result.
    if (resp && typeof resp === 'object' && ('error' in resp || 'result' in resp)) {
      const pending = this.pending.get(id)
      if (pending) {
        this.pending.delete(id)
        if (resp.error) pending.reject(new Error(resp.error.message ?? 'rpc error'))
        else pending.resolve(resp.result)
      }
    } else {
      // relay resolved with the bare result
      const pending = this.pending.get(id)
      if (pending) {
        this.pending.delete(id)
        pending.resolve(resp)
      }
    }
  }

  private emit(event: string, data: unknown): void {
    for (const l of this.listeners) {
      try {
        l({ event, data })
      } catch {
        /* listener errors must not break others */
      }
    }
  }

  private hexToDec(hex: string): string {
    try {
      return String(BigInt(hex))
    } catch {
      return hex
    }
  }
  private hexOf(v: unknown): string {
    if (typeof v === 'string') return v
    if (typeof v === 'number' || typeof v === 'bigint') return `0x${BigInt(v).toString(16)}`
    return '0x0'
  }
}

/**
 * EIP-6963 announcement + window.ethereum coexistence (design table).
 * Returns the installed provider so the caller can keep a reference.
 */
export function installProvider(opts: {
  win: Window
  relay: Relay
  iconDataUri: string
  isDefaultWallet?: boolean
  metaMaskCompat?: boolean
}): BoltVaultProvider {
  const win = opts.win as any
  const provider = new BoltVaultProvider({
    win,
    relay: opts.relay,
    isDefaultWallet: opts.isDefaultWallet,
    metaMaskCompat: opts.metaMaskCompat,
  })

  const existing = win.ethereum
  const info = providerInfo(opts.iconDataUri)

  if (opts.isDefaultWallet && (!existing || existing === provider)) {
    // We own window.ethereum.
    win.ethereum = provider
    win.ethereum.providers = [provider]
  } else if (existing) {
    // Another wallet is present — coexist, don't replace (design row 2).
    const providers: BoltVaultProvider[] = Array.isArray(existing.providers)
      ? [...existing.providers, provider]
      : [existing, provider]
    try {
      existing.providers = providers
    } catch {
      /* existing may be a frozen object; EIP-6963 still carries us */
    }
  } else {
    // No other wallet — claim it.
    win.ethereum = provider
    win.ethereum.providers = [provider]
  }

  // EIP-6963: announce now, and on every request for a provider.
  const announce = () =>
    win.dispatchEvent(
      new win.CustomEvent('eip6963:announceProvider', {
        detail: Object.freeze({ info, provider }),
      }),
    )
  win.addEventListener('eip6963:requestProvider', announce)
  announce()

  return provider
}
