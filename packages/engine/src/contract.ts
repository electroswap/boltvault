/**
 * WalletEngine — the one brain (master plan §2.4).
 *
 * The UI (extension pages, mobile screens) only ever talks to this interface.
 * On mobile it is implemented in-process; in the extension it is served from
 * the service worker over a chrome.runtime.Port by the same host. Every method
 * takes zero or one JSON-safe argument and returns JSON-safe data, so the
 * in-process and channel transports are interchangeable.
 *
 * M0 ships the namespaces below. Later milestones add portfolio, tokens,
 * activity, approvals scanning, tx, swap, limit, holder, bridge, farm,
 * launchpad, nft, names, security and sync — each as its own namespace file
 * under `src/namespaces/`, registered in the host with its zod input schema.
 */
import type {
  AccountId,
  AccountView,
  ApprovalDecision,
  ApprovalRequest,
  AutoLock,
  ChainHead,
  ChainView,
  EngineEvent,
  PortfolioSnapshot,
  Settings,
  SiteView,
  VaultStatus,
} from './schema'

export type Unsubscribe = () => void

export interface EngineEvents {
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe
}

export interface VaultNamespace {
  status(): Promise<VaultStatus>
  /** Onboarding: a fresh 12/24-word seed. The mnemonic is returned exactly once. */
  create(input: { password: string; bits?: 128 | 256 }): Promise<{ accounts: AccountView[]; mnemonic: string }>
  import(input: { mnemonic: string; password: string }): Promise<{ accounts: AccountView[] }>
  unlock(input: { password: string }): Promise<{ accounts: AccountView[] }>
  lock(): Promise<void>
  /** Seed reveal — password-gated, UI-class senders only, quiet mode in the UI. */
  reveal(input: { password: string }): Promise<{ mnemonic: string }>
  setAutoLock(input: { autoLock: AutoLock }): Promise<VaultStatus>
}

export interface AccountsNamespace {
  list(): Promise<AccountView[]>
  active(): Promise<AccountView | null>
  setActive(input: { id: AccountId }): Promise<AccountView>
  rename(input: { id: AccountId; label: string }): Promise<AccountView>
}

export interface SitesNamespace {
  list(): Promise<SiteView[]>
  get(input: { origin: string }): Promise<SiteView | null>
  setChain(input: { origin: string; chainId: number }): Promise<SiteView>
  disconnect(input: { origin: string }): Promise<void>
}

export interface ChainsNamespace {
  list(): Promise<ChainView[]>
  head(input: { chainId: number }): Promise<ChainHead>
}

export interface ApprovalsNamespace {
  list(): Promise<ApprovalRequest[]>
  decide(input: ApprovalDecision): Promise<void>
}

export interface SettingsNamespace {
  get(): Promise<Settings>
  set(input: Partial<Settings>): Promise<Settings>
}

/**
 * Portfolio (master plan §8.2). Declared here so screens are built against the
 * contract from M1; the real service (multicall + GraphQL merge, last-good
 * snapshot) lands in M4. A host without the namespace answers
 * `not_implemented`, which the UI renders as the funding/empty state.
 */
export interface PortfolioNamespace {
  snapshot(input: { accountId: AccountId; chainIds?: number[] }): Promise<PortfolioSnapshot>
  refresh(input: { accountId: AccountId }): Promise<PortfolioSnapshot>
}

export interface WalletEngine {
  readonly vault: VaultNamespace
  readonly accounts: AccountsNamespace
  readonly sites: SitesNamespace
  readonly chains: ChainsNamespace
  readonly approvals: ApprovalsNamespace
  readonly settings: SettingsNamespace
  readonly portfolio: PortfolioNamespace
  readonly events: EngineEvents
}

/** The callable namespaces (everything except the event source). */
export type EngineNamespaces = Omit<WalletEngine, 'events'>
export type NamespaceName = keyof EngineNamespaces
