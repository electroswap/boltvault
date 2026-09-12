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
  /**
   * The origin's native spend cap (§4.6), in base units as a decimal string.
   * Undefined means no limit.
   *
   * Token units, never fiat: prices are display-only (§3.4 step 6), so a USD
   * cap would put a price feed in the signing path and let it decide what the
   * user may sign.
   */
  budget?: string
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
      // A reconnect is not a reason to forget a limit the user set.
      ...(prev?.budget !== undefined ? { budget: prev.budget } : {}),
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

  /**
   * Move an origin's session to another account (Settings › Connected sites).
   *
   * `accounts` is what the site has actually been told. Omitting it clears
   * `lastAccounts`, which is the truthful state between the re-seat and the
   * `accountsChanged` that follows it: the registry does not hold the vault,
   * so it cannot turn an account id into an address, and recording an address
   * the site has not been given would be a record of something that never
   * happened.
   *
   * A site that has never connected is left alone — there is no session to
   * re-seat, and inventing a disconnected row here would put an account id
   * beside an origin the user never linked it to.
   */
  async setAccount(origin: string, accountId: string, accounts?: readonly string[]): Promise<boolean> {
    const row = this.sites[origin]
    if (!row) return false
    row.accountId = accountId
    row.lastAccounts = accounts ? [...accounts] : []
    await this.persist()
    return true
  }

  /** Record what an origin was last told, without touching which account it is on. */
  async setExposed(origin: string, accounts: readonly string[]): Promise<void> {
    const row = this.sites[origin]
    if (!row) return
    row.lastAccounts = [...accounts]
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

  /**
   * Set (decimal string, base units) or clear (null) an origin's spend cap.
   *
   * A budget can be set before the site has ever connected — the row is
   * created disconnected, exactly as a chain preference is.
   */
  async setBudget(origin: string, budget: string | null): Promise<void> {
    const row = this.sites[origin] ?? { origin, chainId: this._homeChainId, accountId: '', connected: false }
    if (budget === null) delete row.budget
    else row.budget = budget
    this.sites[origin] = row
    await this.persist()
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
