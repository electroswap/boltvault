/**
 * Per-origin sessions (master plan §4.6): each connected origin carries its
 * own chain and account, persisted so a reload does not disconnect. The Home
 * tab's chain scope never touches a site's session.
 */
import { HOME_CHAIN_ID } from '@boltvault/chains'

export interface ConnectedSite {
  /** From the Port sender, never from the payload. */
  readonly origin: string
  chainId: number
  accountId: string
  connected: boolean
  /** The addresses exposed to the site (one account, but EIP-1193 speaks in arrays). */
  lastAccounts?: string[]
  connectedAt?: number
  lastUsed?: number
  /** Tab title/favicon captured by the engine from the tab, not supplied by the page. */
  title?: string
  icon?: string
}

export interface SitesStore {
  load(): Promise<Record<string, ConnectedSite> | undefined>
  save(sites: Record<string, ConnectedSite>): Promise<void>
}

export class SiteRegistry {
  private readonly sites: Record<string, ConnectedSite> = {}

  constructor(
    private readonly store: SitesStore,
    private readonly _homeChainId: number = HOME_CHAIN_ID,
  ) {}

  get homeChainId(): number {
    return this._homeChainId
  }

  async hydrate(): Promise<void> {
    const persisted = await this.store.load()
    if (persisted) Object.assign(this.sites, persisted)
  }

  chainIdFor(origin: string): number {
    return this.sites[origin]?.chainId ?? this._homeChainId
  }

  get(origin: string): ConnectedSite | undefined {
    return this.sites[origin]
  }

  isConnected(origin: string): boolean {
    return this.sites[origin]?.connected === true
  }

  /** True until the first successful connect from this origin. */
  isFirstTime(origin: string): boolean {
    return this.sites[origin]?.connectedAt === undefined
  }

  async connect(origin: string, params: { accountId: string; chainId?: number; accounts?: string[]; now?: number; title?: string; icon?: string }): Promise<ConnectedSite> {
    const prev = this.sites[origin]
    const row: ConnectedSite = {
      origin,
      chainId: params.chainId ?? this.chainIdFor(origin),
      accountId: params.accountId,
      connected: true,
      ...(params.accounts ? { lastAccounts: params.accounts } : {}),
      connectedAt: params.now ?? prev?.connectedAt ?? Date.now(),
      lastUsed: params.now ?? Date.now(),
      ...(params.title ?? prev?.title ? { title: params.title ?? prev?.title } : {}),
      ...(params.icon ?? prev?.icon ? { icon: params.icon ?? prev?.icon } : {}),
    }
    this.sites[origin] = row
    await this.persist()
    return row
  }

  /** Mark disconnected but keep the row so the chain preference survives. */
  async disconnect(origin: string): Promise<void> {
    const row = this.sites[origin]
    if (!row) return
    row.connected = false
    row.lastAccounts = []
    await this.persist()
  }

  async setChain(origin: string, chainId: number): Promise<number> {
    const row = this.sites[origin]
    if (row) {
      row.chainId = chainId
    } else {
      // A chain preference for a site that has not connected yet (coalesced connect + switch).
      this.sites[origin] = { origin, chainId, accountId: '', connected: false }
    }
    await this.persist()
    return chainId
  }

  async touch(origin: string, now: number): Promise<void> {
    const row = this.sites[origin]
    if (!row || row.lastUsed === now) return
    row.lastUsed = now
    await this.persist()
  }

  async forget(origin: string): Promise<void> {
    delete this.sites[origin]
    await this.persist()
  }

  connected(): ConnectedSite[] {
    return Object.values(this.sites).filter((s) => s.connected)
  }

  all(): ConnectedSite[] {
    return Object.values(this.sites)
  }

  private async persist(): Promise<void> {
    await this.store.save(this.sites)
  }
}
