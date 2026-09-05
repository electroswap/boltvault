/**
 * Per-origin connection sessions (T3.5) — the Rabby behavior, rewritten.
 *
 * Design §"Per-origin chain": each connected dApp (origin) carries its OWN
 * chainId + account, persisted so a reload doesn't disconnect. The portfolio UI
 * has its own homeChainId (default 52014); switching the Home tab to Base does
 * NOT change app.electroswap.io's session.
 */
import { HOME_CHAIN_ID } from '@boltvault/chains'

export type AccountId = string

export interface ConnectedSite {
  /** From the Port `sender`, never from the payload (a dApp can spoof postMessage). */
  readonly origin: string
  /** Last wallet_switchEthereumChain for THIS origin. */
  chainId: number
  accountId: AccountId
  connected: boolean
  /** The dApp's last declared address selection (usually the connected account). */
  lastAccounts?: string[]
}

export interface SitesStore {
  /** Persisted as JSON in chrome.storage.local under a fixed key. */
  load(): Promise<Record<string, ConnectedSite> | undefined>
  save(sites: Record<string, ConnectedSite>): Promise<void>
}

/**
 * Holds one ConnectedSite per origin. `homeChainId` is the portfolio default
 * (52014) — a NEW origin connects to it; it is not the per-origin chain.
 */
export class SiteRegistry {
  private readonly sites: Record<string, ConnectedSite> = {}

  constructor(
    private readonly store: SitesStore,
    private readonly _homeChainId: number = HOME_CHAIN_ID,
  ) {}

  get homeChainId(): number {
    return this._homeChainId
  }

  /** Populate from the persistent store (call once at SW boot). */
  async hydrate(): Promise<void> {
    const persisted = await this.store.load()
    if (persisted) Object.assign(this.sites, persisted)
  }

  /** Get a site's chain, or the home chain default if not yet connected. */
  chainIdFor(origin: string): number {
    return this.sites[origin]?.chainId ?? this._homeChainId
  }

  get(origin: string): ConnectedSite | undefined {
    return this.sites[origin]
  }

  isConnected(origin: string): boolean {
    return this.sites[origin]?.connected === true
  }

  /**
   * Connect (or re-seat) an origin to an account on a chain. Persists.
   * Returns the stored row.
   */
  async connect(
    origin: string,
    params: { accountId: AccountId; chainId?: number; accounts?: string[] },
  ): Promise<ConnectedSite> {
    const chainId = params.chainId ?? this.chainIdFor(origin)
    const row: ConnectedSite = {
      origin,
      chainId,
      accountId: params.accountId,
      connected: true,
      lastAccounts: params.accounts,
    }
    this.sites[origin] = row
    await this.persist(origin)
    return row
  }

  /** Disconnect: mark disconnected but keep the row (so chain preference survives). */
  async disconnect(origin: string): Promise<void> {
    const row = this.sites[origin]
    if (!row) return
    row.connected = false
    row.lastAccounts = []
    await this.persist(origin)
  }

  /**
   * wallet_switchEthereumChain — set this origin's chain. Returns the new
   * chainId. (Caller rejects unknown chains with RPC.UNRECOGNIZED_CHAIN.)
   */
  async setChain(origin: string, chainId: number): Promise<number> {
    const row = this.sites[origin] ?? (await this.connect(origin, { accountId: 'unknown' }))
    row.chainId = chainId
    await this.persist(origin)
    return chainId
  }

  /** All connected origins (Settings "Connected sites" tab). */
  connected(): ConnectedSite[] {
    return Object.values(this.sites).filter((s) => s.connected)
  }

  async persist(_origin: string): Promise<void> {
    await this.store.save(this.sites)
  }
}
