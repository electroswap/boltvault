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
import type { TokenDetailView } from '@boltvault/electroswap'
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
  TokenView,
  NameLookup,
  AllowanceView,
  ContactView,
  SendQuote,
  Settings,
  SiteView,
  SwapQuote,
  SwapFlow,
  HolderTier,
  FeeScheduleView,
  LimitQuote,
  LimitOrderView,
  ExploreToken,
  CollectionView,
  AssetView,
  Inventory,
  OffersInbox,
  NftActivityView,
  LegendsStatus,
  FarmView,
  FarmDepositQuote,
  FarmWithdrawQuote,
  CampaignView,
  WatchItem,
  Positions,
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
  /** User RPC overrides by chain id (Settings › Networks). */
  rpcs(): Promise<Record<string, { url: string; trace?: string }>>
  /** Set (url) or clear (null) a chain's RPC; validated by eth_chainId. */
  setRpc(input: { chainId: number; url: string | null; trace?: string | null }): Promise<void>
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
  /** The last-good snapshot at once (stale), with a refresh started in the background. */
  snapshot(input: { accountId: AccountId; chainIds?: number[] }): Promise<PortfolioSnapshot>
  refresh(input: { accountId: AccountId; chainIds?: number[] }): Promise<PortfolioSnapshot>
  /** "Since you last looked" (§7.13): the previous first-open total, and record this open. */
  lastLook(input: { accountId: AccountId }): Promise<{ previous: { at: number; total: number | null } | null; total: number | null }>
}

export interface ActivityScanNamespace {
  /** Bounded inbound transfer scan (§8.12); returns how many entries were added. */
  scan(input: { accountId: AccountId; chainId: number }): Promise<{ added: number; fromBlock: number; toBlock: number }>
}

export interface TokensNamespace {
  universe(input: { chainId?: number }): Promise<TokenView[]>
  get(input: { chainId?: number; address: string }): Promise<TokenView | null>
  search(input: { chainId?: number; query: string }): Promise<TokenView[]>
  metadata(input: { chainId?: number; address: string }): Promise<{ address: string; name: string; symbol: string; decimals: number; hasCode: boolean }>
  addCustom(input: { chainId?: number; address: string; source?: 'user' | 'dapp'; origin?: string }): Promise<TokenView>
  removeCustom(input: { chainId?: number; address: string }): Promise<void>
  setPrefs(input: { chainId?: number; address: string; pinned?: boolean; hidden?: boolean }): Promise<void>
}

export interface NamesNamespace {
  /** Forward-verified reverse names for display; null where none. */
  lookup(input: { chainId: number; addresses: string[] }): Promise<NameLookup[]>
  /** Live forward resolution for a recipient field. */
  resolve(input: { chainId: number; name: string }): Promise<{ address: string | null }>
}

export interface AllowancesNamespace {
  cached(input: { accountId: AccountId; chainId: number }): Promise<{ rows: AllowanceView[]; at: number }>
  scan(input: { accountId: AccountId; chainId: number; logs?: boolean }): Promise<AllowanceView[]>
  /** Zero the allowance through the internal approval path; the sheet decides. */
  revoke(input: { accountId: AccountId; chainId: number; token: string; spender: string; standard: 'erc20' | 'permit2' | 'erc721' }): Promise<{ requestId: string }>
}

export interface ContactsNamespace {
  list(): Promise<ContactView[]>
  add(input: { address: string; label: string; chainId?: number | null }): Promise<ContactView>
  remove(input: { id: string }): Promise<void>
  confirm(input: { id: string }): Promise<void>
}

export interface SendNamespace {
  quote(input: { accountId: AccountId; chainId: number; token: string; to: string; amount: string }): Promise<SendQuote>
  /** Creates the `internal:send` approval; Activity carries the result under `requestId`. */
  submit(input: { accountId: AccountId; chainId: number; token: string; to: string; amount: string }): Promise<{ requestId: string; to: string }>
}

/** In-wallet swaps (§8.6): quote on chain, execute as a flow of sheets (approve → permit → swap). */
export interface SwapNamespace {
  quote(input: { accountId: AccountId; chainId: number; tokenIn: string; tokenOut: string; amountIn: string; slippageBips?: number }): Promise<SwapQuote>
  /** Starts the flow; resolves once the first sheet exists. Progress arrives as `swap.progress` events. */
  execute(input: { accountId: AccountId; chainId: number; tokenIn: string; tokenOut: string; amountIn: string; slippageBips?: number }): Promise<{ flowId: string; requestId: string | null }>
  flow(input: { flowId: string }): Promise<SwapFlow | null>
  flows(input?: { accountId?: AccountId }): Promise<SwapFlow[]>
}

/** The BOLT/DYNO holder program (§8.18): the account's fee tier and the whole schedule. */
export interface HolderNamespace {
  tier(input: { accountId: AccountId; chainId: number }): Promise<HolderTier>
  schedule(input: { chainId: number }): Promise<FeeScheduleView>
  addresses(input: { chainId: number }): Promise<{ sink: string | null; schedule: string | null }>
  /** Dev/test only; refused for a chain whose sink is pinned in the build. */
  configure(input: { chainId: number; sink: string | null; schedule: string | null }): Promise<{ sink: string | null; schedule: string | null }>
}

/** Limit orders on EsLimitOrderManagerV1 (§8.6). */
export interface LimitNamespace {
  quote(input: { accountId: AccountId; chainId: number; tokenIn: string; tokenOut: string; amountIn: string; minOut: string; durationSeconds: number }): Promise<LimitQuote>
  place(input: { accountId: AccountId; chainId: number; tokenIn: string; tokenOut: string; amountIn: string; minOut: string; durationSeconds: number }): Promise<{ flowId: string; requestId: string | null }>
  cancel(input: { accountId: AccountId; chainId: number; orderId: string }): Promise<{ flowId: string; requestId: string | null }>
  list(input: { accountId: AccountId; chainId: number }): Promise<LimitOrderView[]>
}

/** Explore (§8.11): the ElectroSwap market inside the wallet. Display data; empty when the API is unreachable. */
export interface ExploreNamespace {
  available(): Promise<boolean>
  tokens(input: { chainId: number }): Promise<ExploreToken[]>
  tokenDetail(input: { chainId: number; address: string }): Promise<TokenDetailView | null>
  collections(input: { chainId: number; accountId?: AccountId }): Promise<CollectionView[]>
  collection(input: { chainId: number; address: string; accountId?: AccountId }): Promise<CollectionView | null>
  search(input: { chainId: number; query: string }): Promise<{ tokens: ExploreToken[]; collections: CollectionView[] }>
}

/** The NFT marketplace (§8.10) on Seaport 1.5. Flows resolve once the first sheet exists; progress arrives as `swap.progress`. */
export interface NftNamespace {
  inventory(input: { accountId: AccountId; chainId: number }): Promise<Inventory>
  assets(input: { chainId: number; address: string; orderBy?: 'PRICE' | 'RARITY'; asc?: boolean; listed?: boolean; traits?: Array<{ name: string; values: string[] }>; query?: string; after?: string; accountId?: AccountId }): Promise<{ assets: AssetView[]; total: number | null; next: string | null }>
  asset(input: { chainId: number; address: string; tokenId: string; accountId?: AccountId }): Promise<AssetView | null>
  activity(input: { chainId: number; address: string; tokenId?: string }): Promise<NftActivityView[]>
  offers(input: { accountId: AccountId; chainId: number }): Promise<OffersInbox>
  list(input: { accountId: AccountId; chainId: number; address: string; tokenId: string; priceEtn: string; days: number }): Promise<{ flowId: string; requestId: string | null }>
  offer(input: { accountId: AccountId; chainId: number; address: string; tokenId: string; priceEtn: string; days: number }): Promise<{ flowId: string; requestId: string | null }>
  buy(input: { accountId: AccountId; chainId: number; address: string; tokenId: string }): Promise<{ flowId: string; requestId: string | null }>
  accept(input: { accountId: AccountId; chainId: number; address: string; tokenId: string; orderHash: string }): Promise<{ flowId: string; requestId: string | null }>
  cancel(input: { accountId: AccountId; chainId: number; address: string; tokenId: string; orderHash: string }): Promise<{ flowId: string; requestId: string | null }>
  transfer(input: { accountId: AccountId; chainId: number; address: string; tokenId: string; to: string }): Promise<{ flowId: string; requestId: string | null }>
  mint(input: { accountId: AccountId; chainId: number; count: number }): Promise<{ flowId: string; requestId: string | null }>
  collectionApproved(input: { accountId: AccountId; chainId: number; address: string }): Promise<boolean>
}

/** Electric Legends dividends (§8.10). */
export interface LegendsNamespace {
  status(input: { accountId: AccountId; chainId: number }): Promise<LegendsStatus | null>
  activate(input: { accountId: AccountId; chainId: number }): Promise<{ flowId: string; requestId: string | null }>
  claim(input: { accountId: AccountId; chainId: number }): Promise<{ flowId: string; requestId: string | null }>
  mint(input: { accountId: AccountId; chainId: number; count: number }): Promise<{ flowId: string; requestId: string | null }>
}

/** Yield farms (§8.8): positions from the chain; Deposit · Withdraw · Collect through the sheet. */
export interface FarmNamespace {
  list(input: { chainId: number; accountId?: AccountId }): Promise<FarmView[]>
  farm(input: { chainId: number; farmId: number; accountId?: AccountId }): Promise<FarmView | null>
  quoteDeposit(input: { accountId: AccountId; chainId: number; farmId: number; amount0?: string; amount1?: string; bolt?: string }): Promise<FarmDepositQuote>
  deposit(input: { accountId: AccountId; chainId: number; farmId: number; amount0?: string; amount1?: string; bolt?: string }): Promise<{ flowId: string; requestId: string | null }>
  quoteWithdraw(input: { accountId: AccountId; chainId: number; farmId: number; percent: number; asNative: boolean }): Promise<FarmWithdrawQuote>
  withdraw(input: { accountId: AccountId; chainId: number; farmId: number; percent: number; asNative: boolean }): Promise<{ flowId: string; requestId: string | null }>
  collect(input: { accountId: AccountId; chainId: number; farmId: number; asNative: boolean }): Promise<{ flowId: string; requestId: string | null }>
}

/** Launchpad (§8.9). */
export interface LaunchpadNamespace {
  list(input: { chainId: number; accountId?: AccountId; statuses?: Array<'ACTIVE' | 'LAUNCHED' | 'FAILED' | 'CANCELLED' | 'PENDING'> }): Promise<CampaignView[]>
  detail(input: { chainId: number; pool: string; accountId?: AccountId }): Promise<CampaignView | null>
  contribute(input: { accountId: AccountId; chainId: number; pool: string; amountEtn: string }): Promise<{ flowId: string; requestId: string | null }>
  claim(input: { accountId: AccountId; chainId: number; pool: string; kind: 'tokens' | 'refund' | 'referral' }): Promise<{ flowId: string; requestId: string | null }>
  rememberReferral(input: { chainId: number; pool: string; referrer: string }): Promise<void>
  rememberFromLink(input: { url: string }): Promise<{ pool: string; referrer: string | null } | null>
}

/** Watchlist and alerts (§7.13). */
export interface WatchlistNamespace {
  list(): Promise<WatchItem[]>
  star(input: { kind: 'token' | 'collection' | 'campaign'; chainId: number; address: string; label: string }): Promise<WatchItem[]>
  unstar(input: { kind: 'token' | 'collection' | 'campaign'; chainId: number; address: string }): Promise<WatchItem[]>
  setAlert(input: { kind: 'token' | 'collection' | 'campaign'; chainId: number; address: string; above: number | null; below: number | null; onLive: boolean }): Promise<WatchItem[]>
  /** One alert pass now (the alarm does this every five minutes). Returns the tags sent. */
  check(): Promise<string[]>
}

/** Home › Positions (§8.2). */
export interface PositionsNamespace {
  cached(input: { accountId: AccountId; chainId: number }): Promise<Positions | null>
  snapshot(input: { accountId: AccountId; chainId: number }): Promise<Positions>
}

/** Hardware devices (§2.7 S7): Ledger over HID from the worker in M5. */
export interface HardwareNamespace {
  ledgerStatus(): Promise<{ available: boolean; devices: Array<{ deviceId: string; model: string }>; app: { version: string; blindSigning: boolean } | null; problem: string | null }>
  ledgerAddresses(input: { scheme: 'bip44' | 'live'; from?: number; count?: number; deviceId?: string }): Promise<Array<{ path: string; address: string; index: number }>>
  ledgerVerify(input: { path: string; deviceId?: string }): Promise<{ address: string }>
  verifyAccount(input: { accountId: AccountId }): Promise<{ address: string }>
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
  readonly activityScan: ActivityScanNamespace
  readonly tokens: TokensNamespace
  readonly names: NamesNamespace
  readonly allowances: AllowancesNamespace
  readonly contacts: ContactsNamespace
  readonly send: SendNamespace
  readonly sync: SyncNamespace
  readonly swap: SwapNamespace
  readonly holder: HolderNamespace
  readonly limit: LimitNamespace
  readonly hardware: HardwareNamespace
  readonly explore: ExploreNamespace
  readonly nft: NftNamespace
  readonly legends: LegendsNamespace
  readonly farm: FarmNamespace
  readonly launchpad: LaunchpadNamespace
  readonly watchlist: WatchlistNamespace
  readonly positions: PositionsNamespace
  readonly events: EngineEvents
}

/** The callable namespaces (everything except the event source). */
export type EngineNamespaces = Omit<WalletEngine, 'events'>
export type NamespaceName = keyof EngineNamespaces
