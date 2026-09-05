/**
 * WalletEngine — the one brain (master plan §2.4).
 *
 * The UI (extension pages, mobile screens) only ever talks to this interface.
 * On mobile it is implemented in-process; in the extension it is served from
 * the service worker over a chrome.runtime.Port by the same host. Every method
 * takes zero or one JSON-safe argument and returns JSON-safe data, so the
 * in-process and channel transports are interchangeable.
 *
 * Namespaces land with their milestone; a host without one answers
 * `not_implemented`, which the UI renders as an honest empty state.
 */
import type {
  AccountId,
  AccountView,
  ActivityEntry,
  ApprovalDecision,
  ApprovalRequest,
  AutoLock,
  ChainHead,
  ChainView,
  EngineEvent,
  PortfolioSnapshot,
  Settings,
  SiteView,
  SyncStatus,
  VaultStatus,
} from './schema'

export type Unsubscribe = () => void

export interface EngineEvents {
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe
}

export interface VaultNamespace {
  status(): Promise<VaultStatus>
  /** A vault with no seed yet — watch-only or hardware-first users add accounts afterwards. */
  createEmpty(input: { password: string }): Promise<VaultStatus>
  /** Onboarding: a fresh 12/24-word seed. The mnemonic is returned exactly once. */
  create(input: { password: string; bits?: 128 | 256; label?: string }): Promise<{ accounts: AccountView[]; mnemonic: string; seedId: string }>
  import(input: { mnemonic: string; password: string; passphrase?: string; label?: string }): Promise<{ accounts: AccountView[]; seedId: string }>
  unlock(input: { password: string }): Promise<{ accounts: AccountView[] }>
  unlockWithPasskey(input: { credentialId: string; prfSecretHex: string }): Promise<{ accounts: AccountView[] }>
  unlockWithDevice(input: { keyId: string; keyHex: string }): Promise<{ accounts: AccountView[] }>
  lock(): Promise<void>
  /** Seed reveal — password re-verified, UI-class senders only, quiet mode in the UI. */
  reveal(input: { seedId: string; password: string }): Promise<{ mnemonic: string; passphraseSet: boolean }>
  changePassword(input: { current: string; next: string }): Promise<VaultStatus>
  enrolPasskey(input: { credentialId: string; prfSecretHex: string }): Promise<VaultStatus>
  removePasskey(input: { credentialId: string }): Promise<VaultStatus>
  enrolDevice(input: { keyId: string; keyHex: string }): Promise<VaultStatus>
  removeDevice(input: { keyId: string }): Promise<VaultStatus>
  setAutoLock(input: { autoLock: AutoLock }): Promise<VaultStatus>
  /** Three word positions to ask for; the words themselves never leave the engine. */
  backupQuiz(input: { seedId: string }): Promise<{ positions: number[]; wordCount: number }>
  confirmBackup(input: { seedId: string; answers: Array<{ position: number; word: string }> }): Promise<{ ok: boolean; status: VaultStatus }>
  /** Air-gapped move (§6): the plaintext under a one-time code, as animated-QR frames. */
  export(input: { password: string; code: string }): Promise<{ frames: string[] }>
  importExport(input: { frames: string[]; code: string; password: string }): Promise<{ accounts: AccountView[] }>
}

export interface AccountsNamespace {
  list(): Promise<AccountView[]>
  active(): Promise<AccountView | null>
  setActive(input: { id: AccountId }): Promise<AccountView>
  rename(input: { id: AccountId; label: string }): Promise<AccountView>
  setHidden(input: { id: AccountId; hidden: boolean }): Promise<AccountView>
  reorder(input: { ids: AccountId[] }): Promise<AccountView[]>
  /** Next BIP-44 index of a seed. */
  derive(input: { seedId: string; label?: string }): Promise<AccountView>
  addSeed(input: { mnemonic: string; label?: string; passphrase?: string }): Promise<{ seedId: string; account: AccountView }>
  addImported(input: { privateKey: string; label?: string }): Promise<AccountView>
  addWatch(input: { address: string; label?: string }): Promise<AccountView>
  addHardware(input: { kind: 'ledger' | 'trezor' | 'keystone'; address: string; path: string; deviceId?: string; label?: string }): Promise<AccountView>
  /** Imported, watch and hardware accounts can be removed; HD accounts are hidden instead. */
  remove(input: { id: AccountId }): Promise<void>
  /** BIP-44 vs Ledger Live preview addresses for an import decision (§8.1). */
  previewDerivations(input: { mnemonic: string; passphrase?: string; count?: number }): Promise<{ bip44: string[]; ledgerLive: string[] }>
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
 * snapshot) lands in M4.
 */
export interface PortfolioNamespace {
  snapshot(input: { accountId: AccountId; chainIds?: number[] }): Promise<PortfolioSnapshot>
  refresh(input: { accountId: AccountId }): Promise<PortfolioSnapshot>
}

/** The encrypted local activity log (§8.12). Locked vault = empty. */
export interface ActivityNamespace {
  list(input?: { accountId?: AccountId; chainId?: number; limit?: number }): Promise<ActivityEntry[]>
  clear(): Promise<void>
}

/** Device pairing and non-secret sync (§6). */
export interface SyncNamespace {
  status(): Promise<SyncStatus>
  setDeviceLabel(input: { label: string }): Promise<SyncStatus>
  /** Device A: an offer to show as a QR. */
  createOffer(input: { relayUrl: string }): Promise<{ offer: string }>
  /** Device B: scan A's offer; returns the SAS and an answer for A. */
  acceptOffer(input: { offer: string }): Promise<{ sas: string; answer: string }>
  /** Device A: scan B's answer; returns the SAS to compare. */
  completeOffer(input: { answer: string }): Promise<{ sas: string }>
  /** Both: the user confirmed the codes match. */
  confirm(): Promise<SyncStatus>
  cancelPairing(): Promise<SyncStatus>
  unpair(input: { deviceId: string }): Promise<SyncStatus>
  /** Push local state to every paired device; pull and apply theirs. */
  push(): Promise<{ pushed: number }>
  pull(): Promise<{ applied: number }>
}

export interface WalletEngine {
  readonly vault: VaultNamespace
  readonly accounts: AccountsNamespace
  readonly sites: SitesNamespace
  readonly chains: ChainsNamespace
  readonly approvals: ApprovalsNamespace
  readonly settings: SettingsNamespace
  readonly portfolio: PortfolioNamespace
  readonly activity: ActivityNamespace
  readonly sync: SyncNamespace
  readonly events: EngineEvents
}

/** The callable namespaces (everything except the event source). */
export type EngineNamespaces = Omit<WalletEngine, 'events'>
export type NamespaceName = keyof EngineNamespaces
