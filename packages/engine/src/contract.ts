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
import type { Cached } from './cache'
import type { GovernorSnapshot } from './governor'
import type {
  AvailabilityView,
  PendingRegistration,
  PriceView,
  RegistrarView,
} from './namespaces/names'
import type { CustomCollection } from './namespaces/nftCustom'
import type { AssessInput, PreAssessment, SpendPolicyView } from './namespaces/security'
import type { SyncIncomingItem } from './namespaces/sync'
import type {
  AboutView,
  AccountId,
  AccountView,
  SeedView,
  ActivityEntry,
  AllowanceView,
  ApprovalDecision,
  ApprovalRequest,
  AssetView,
  AutoLock,
  BridgeQuote,
  BridgeRoute,
  BridgeStatus,
  CampaignView,
  ChainHead,
  ChainView,
  CollectionView,
  CollectionWindow,
  ContactView,
  DappSession,
  EngineEvent,
  ExploreToken,
  FarmDepositQuote,
  FarmView,
  FarmWithdrawQuote,
  FeeScheduleView,
  FlagsView,
  HolderTier,
  Inventory,
  KeystonePending,
  LegendsStatus,
  LimitOrderView,
  LimitQuote,
  NameLookup,
  NftActivityView,
  NotificationView,
  Prefs,
  OffersInbox,
  PortfolioPoint,
  PortfolioSnapshot,
  Positions,
  RemoteRequest,
  ScanSummary,
  SendQuote,
  Settings,
  SiteView,
  SwapFlow,
  SwapQuote,
  SyncStatus,
  TokenDetailView,
  LiquidityView,
  ChartDuration,
  PriceHistoryView,
  TokenView,
  VaultStatus,
  WatchItem,
  WcProposalView,
  WcSessionView,
} from './schema'

export type { SyncIncomingItem }
// The views these namespaces answer with are declared beside their service
// (§schema.ts belongs to the shared shapes); re-exported here so a screen
// imports them from the contract like everything else it renders.
export type {
  AssessInput,
  AssessRequest,
  PreAssessment,
  SpendPolicyView,
} from './namespaces/security'
export type {
  AvailabilityView,
  CommitmentState,
  PendingRegistration,
  PriceView,
  RegistrarView,
} from './namespaces/names'

export type Unsubscribe = () => void

export interface EngineEvents {
  subscribe(listener: (event: EngineEvent) => void): Unsubscribe
}

export interface VaultNamespace {
  status(): Promise<VaultStatus>
  /** A vault with no seed yet — watch-only or hardware-first users add accounts afterwards. */
  createEmpty(input: { password: string }): Promise<VaultStatus>
  /** Block screenshots while a phrase is on screen (§8.1). Real on mobile; the extension cannot, and says so. */
  hidePreview(input: { hide: boolean }): Promise<void>
  /** A fresh phrase with nothing written: the words are shown and checked before a password exists (§8.1). */
  /**
   * A phrase, and the words the wallet will ask about (ES-BV-004).
   *
   * The positions come back from here because onboarding quizzes before the
   * seed exists, so `backupQuiz` cannot be what issues them — and
   * `confirmBackup` only accepts positions the wallet chose.
   */
  propose(input: { bits?: 128 | 256 }): Promise<{ mnemonic: string; positions: number[] }>
  /** Onboarding: a fresh 12/24-word seed. The mnemonic is returned exactly once. */
  create(input: {
    password: string
    bits?: 128 | 256
    label?: string
  }): Promise<{ accounts: AccountView[]; mnemonic: string; seedId: string }>
  import(input: {
    mnemonic: string
    password: string
    passphrase?: string
    label?: string
    /** The caller supplied a phrase the user already keeps: no backup gate. Onboarding's restore path sets it; its create path does not. */
    backedUp?: boolean
  }): Promise<{ accounts: AccountView[]; seedId: string }>
  /**
   * Destroy this wallet and everything sealed beside it, leaving the device as
   * if the app had just been installed. Irreversible, and takes no password —
   * it is the way out for someone who has lost theirs. The recovery phrase is
   * the only route back in.
   */
  wipe(): Promise<void>
  unlock(input: { password: string }): Promise<{ accounts: AccountView[] }>
  unlockWithPasskey(input: {
    credentialId: string
    prfSecretHex: string
  }): Promise<{ accounts: AccountView[] }>
  unlockWithDevice(input: { keyId: string; keyHex: string }): Promise<{ accounts: AccountView[] }>
  lock(): Promise<void>
  /** A human interacted: the idle auto-lock timer restarts (debounced in the engine). */
  touch(): Promise<{ lockAt: number | null }>
  /** Seed reveal — password re-verified, UI-class senders only, quiet mode in the UI. */
  /** Any factor the vault is wrapped under — password, passkey PRF, or device key (§3.2). */
  reveal(
    input: { seedId: string } & (
      | { password: string }
      | { credentialId: string; prfSecretHex: string }
      | { keyId: string; keyHex: string }
    ),
  ): Promise<{ mnemonic: string; passphraseSet: boolean }>
  changePassword(input: { current: string; next: string }): Promise<VaultStatus>
  /** Changing who can open the vault costs the password, every time. */
  enrolPasskey(input: {
    credentialId: string
    prfSecretHex: string
    password: string
  }): Promise<VaultStatus>
  removePasskey(input: { credentialId: string; password: string }): Promise<VaultStatus>
  enrolDevice(input: { keyId: string; keyHex: string; password: string }): Promise<VaultStatus>
  removeDevice(input: { keyId: string; password: string }): Promise<VaultStatus>
  setAutoLock(input: { autoLock: AutoLock }): Promise<VaultStatus>
  /** Three word positions to ask for; the words themselves never leave the engine. */
  backupQuiz(input: { seedId: string }): Promise<{ positions: number[]; wordCount: number }>
  confirmBackup(input: {
    seedId: string
    answers: Array<{ position: number; word: string }>
  }): Promise<{ ok: boolean; status: VaultStatus }>
  /** Air-gapped move (§6): the plaintext under a one-time code, as animated-QR frames. */
  /** `code` is minted by the engine when absent; the caller shows what comes back. */
  export(input: { password: string; code?: string }): Promise<{ frames: string[]; code: string }>
  importExport(input: {
    frames: string[]
    code: string
    password: string
  }): Promise<{ accounts: AccountView[] }>
}

export interface AccountsNamespace {
  list(): Promise<AccountView[]>
  active(): Promise<AccountView | null>
  setActive(input: { id: AccountId }): Promise<AccountView>
  rename(input: { id: AccountId; label: string }): Promise<AccountView>
  setHidden(input: { id: AccountId; hidden: boolean }): Promise<AccountView>
  reorder(input: { ids: AccountId[] }): Promise<AccountView[]>
  /** Rename a recovery phrase (plan C2). */
  renameSeed(input: { seedId: string; label: string }): Promise<SeedView>
  /**
   * The next account along one of a seed's two derivation trees.
   *
   * `bip44` (the default) walks the address index and is what every other
   * software wallet calls "account 2"; `ledgerLive` walks the account index, so
   * the same phrase gives a different set after the first address. Indices are
   * counted per tree.
   */
  derive(input: { seedId: string; label?: string; tree?: 'bip44' | 'ledgerLive' }): Promise<AccountView>
  addSeed(input: {
    mnemonic: string
    label?: string
    passphrase?: string
  }): Promise<{ seedId: string; account: AccountView }>
  addImported(input: { privateKey: string; label?: string }): Promise<AccountView>
  addWatch(input: { address: string; label?: string }): Promise<AccountView>
  addHardware(input: {
    kind: 'ledger' | 'trezor' | 'keystone'
    address: string
    path: string
    deviceId?: string
    label?: string
  }): Promise<AccountView>
  /** Imported, watch and hardware accounts can be removed; HD accounts are hidden instead. */
  remove(input: { id: AccountId }): Promise<void>
  /** BIP-44 vs Ledger Live preview addresses for an import decision (§8.1). */
  previewDerivations(input: {
    mnemonic: string
    passphrase?: string
    count?: number
  }): Promise<{ bip44: string[]; ledgerLive: string[] }>
}

/** Replacing a transaction already in a node's pool (§8.12). */
export interface TxNamespace {
  /** Re-send the same call at the same nonce, priced to replace. Returns an approval request id. */
  speedUp(input: { id: string }): Promise<{ requestId: string }>
  /** Occupy the nonce with a transfer of nothing to yourself. Returns an approval request id. */
  cancel(input: { id: string }): Promise<{ requestId: string }>
  /** Whether Activity should offer either action for this row, and why not when it should not. */
  replaceable(input: { id: string }): Promise<{ can: boolean; why: string | null }>
}

export interface SitesNamespace {
  list(): Promise<SiteView[]>
  get(input: { origin: string }): Promise<SiteView | null>
  setChain(input: { origin: string; chainId: number }): Promise<SiteView>
  /** Move one origin to another account; the site is told via accountsChanged (§8.14, §4.6). */
  setAccount(input: { origin: string; accountId: AccountId }): Promise<SiteView>
  disconnect(input: { origin: string }): Promise<void>
  /** Per-origin spend cap in base units as a decimal string, or null to clear (§4.6). */
  setBudget(input: { origin: string; budget: string | null }): Promise<SiteView>
  /**
   * Tell the engine the wallet just put this address on the clipboard, so a
   * paste that does not match within a minute is caught (§3.6). Not persisted.
   */
  noteAddressCopied(input: { address: string }): Promise<null>
}

export interface ChainsNamespace {
  list(): Promise<ChainView[]>
  head(input: { chainId: number }): Promise<ChainHead>
  /** User RPC overrides by chain id (Settings › Networks). */
  rpcs(): Promise<Record<string, { url: string; trace?: string }>>
  /** Set (url) or clear (null) a chain's RPC; validated by eth_chainId. */
  setRpc(input: { chainId: number; url: string | null; trace?: string | null }): Promise<void>
  /**
   * Every outside host this session has spoken to, as the rate governor sees
   * it — budget, cooldown, and `refused` when the host answered 401/403 and has
   * not accepted a request since. Settings › Networks reads this so a rejected
   * wallet key reads as "ElectroSwap's API is refusing this wallet" rather than
   * as a screen of silent failures.
   */
  hosts(): Promise<GovernorSnapshot[]>
}

export interface ApprovalsNamespace {
  list(): Promise<ApprovalRequest[]>
  /**
   * Returns the request as it stands after the decision. A yes on something
   * that gets signed comes back as `signing`, not `approved` — the screen uses
   * that to keep itself up while a device is being waited on.
   */
  decide(input: ApprovalDecision): Promise<ApprovalRequest>
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
  lastLook(input: {
    accountId: AccountId
  }): Promise<{ previous: { at: number; total: number | null } | null; total: number | null }>
  /** The persisted last-good snapshot, no refresh (plan C1): balances beside an account, badges on Home. */
  cached(input: { accountId: AccountId }): Promise<PortfolioSnapshot | null>
  /** The totals this wallet has seen in this scope, oldest first and bounded (§8.2). */
  history(input: { accountId: AccountId; chainIds?: number[] }): Promise<PortfolioPoint[]>
}

export interface ActivityScanNamespace {
  /** Bounded inbound transfer scan (§8.12); returns how many entries were added. */
  scan(input: {
    accountId: AccountId
    chainId: number
  }): Promise<{ added: number; fromBlock: number; toBlock: number }>
  /** Every enabled chain in turn; a round younger than 60 s is returned as is unless forced. */
  scanAll(input: { accountId: AccountId; force?: boolean }): Promise<ScanSummary>
  cached(input: { accountId: AccountId }): Promise<Cached<ScanSummary> | null>
}

export interface TokensNamespace {
  universe(input: { chainId?: number }): Promise<TokenView[]>
  get(input: { chainId?: number; address: string }): Promise<TokenView | null>
  search(input: { chainId?: number; query: string }): Promise<TokenView[]>
  /**
   * The address this symbol already belongs to, or null (ES-BV-037). Anyone
   * may deploy a token calling itself USDC; this says where the one the user
   * already has lives.
   */
  lookalikeOf(input: { chainId: number; address: string; symbol: string }): Promise<string | null>
  metadata(input: {
    chainId?: number
    address: string
  }): Promise<{ address: string; name: string; symbol: string; decimals: number; hasCode: boolean }>
  addCustom(input: {
    chainId?: number
    address: string
    source?: 'user' | 'dapp'
    origin?: string
  }): Promise<TokenView>
  removeCustom(input: { chainId?: number; address: string }): Promise<void>
  setPrefs(input: {
    chainId?: number
    address: string
    pinned?: boolean
    hidden?: boolean
  }): Promise<void>
}

export interface NamesNamespace {
  /** Forward-verified reverse names for display; null where none. */
  lookup(input: { chainId: number; addresses: string[] }): Promise<NameLookup[]>
  /** Live forward resolution for a recipient field. */
  resolve(input: { chainId: number; name: string }): Promise<{ address: string | null }>
  /** Whether this chain can register a name at all, and — when it cannot — why not, in plain language. */
  registrar(input: { chainId: number }): Promise<RegistrarView>
  /** `valid()` and `available()` on the registrar itself (§8.1). */
  availability(input: { chainId: number; name: string }): Promise<AvailabilityView>
  /** Rent for a duration, in wei as decimal strings. */
  price(input: { chainId: number; name: string; durationSeconds?: number }): Promise<PriceView>
  /**
   * Step one of the commit–reveal: raises an `internal:names` approval for the
   * `commit` transaction and persists the commitment, so the mandatory wait
   * survives a worker restart. `setPrimary` defaults to true.
   */
  commit(input: {
    accountId: AccountId
    chainId: number
    name: string
    durationSeconds?: number
    setPrimary?: boolean
  }): Promise<{
    id: string
    requestId: string
    commitment: string
    name: string
    waitSeconds: number
  }>
  /** Commitments this device holds, with the countdown read off the chain. */
  pending(input?: { chainId?: number }): Promise<PendingRegistration[]>
  /** Step two: the payable reveal, again as an approval. */
  register(input: {
    id: string
  }): Promise<{ requestId: string; name: string; priceWei: string; valueWei: string }>
  /** Forget a commitment held here. */
  cancel(input: { id: string }): Promise<PendingRegistration[]>
  /** `ReverseRegistrar.setName` — the primary name every other wallet will show. */
  setPrimary(input: {
    accountId: AccountId
    chainId: number
    name: string
  }): Promise<{ requestId: string; name: string }>
}

/**
 * Security (§2.4 `security: { assess(request); policy(); }`).
 *
 * `assess` runs the one firewall pipeline that builds every sheet and returns
 * what that sheet would carry, without raising an approval. It is advisory and
 * a lower bound: the real sheet sees the origin, the fee assertion and a fresh
 * simulation, and §3.4 lets those add rules but never lower one. The origin is
 * the engine's, never the caller's, and the reply carries no part of the
 * context the assessment reasoned over.
 */
export interface SecurityNamespace {
  assess(input: AssessInput): Promise<PreAssessment>
  /** Settings › Spending as the firewall reads it, and the step-up ladder it drives (§3.4 points 5 and 6). */
  policy(): Promise<SpendPolicyView>
}

export interface AllowancesNamespace {
  cached(input: {
    accountId: AccountId
    chainId: number
  }): Promise<{ rows: AllowanceView[]; at: number }>
  scan(input: { accountId: AccountId; chainId: number; logs?: boolean }): Promise<AllowanceView[]>
  /** Zero the allowance through the internal approval path; the sheet decides. */
  revoke(input: {
    accountId: AccountId
    chainId: number
    token: string
    spender: string
    standard: 'erc20' | 'permit2' | 'erc721'
  }): Promise<{ requestId: string }>
}

export interface ContactsNamespace {
  list(): Promise<ContactView[]>
  add(input: { address: string; label: string; chainId?: number | null }): Promise<ContactView>
  remove(input: { id: string }): Promise<void>
  confirm(input: { id: string }): Promise<void>
}

export interface SendNamespace {
  quote(input: {
    accountId: AccountId
    chainId: number
    token: string
    to: string
    amount: string
  }): Promise<SendQuote>
  /** Creates the `internal:send` approval; Activity carries the result under `requestId`. */
  submit(input: {
    accountId: AccountId
    chainId: number
    token: string
    to: string
    amount: string
  }): Promise<{ requestId: string; to: string }>
}

/** In-wallet swaps (§8.6): quote on chain, execute as a flow of sheets (approve → permit → swap). */
/**
 * Either side of the trade may be the fixed one (§8.6). Exactly one of
 * `amountIn` / `amountOut` is given, and `tradeType` says which the user typed.
 */
export interface SwapArgs {
  readonly accountId: AccountId
  readonly chainId: number
  readonly tokenIn: string
  readonly tokenOut: string
  readonly amountIn?: string
  readonly amountOut?: string
  readonly tradeType?: 'exactIn' | 'exactOut'
  readonly slippageBips?: number
}

export interface SwapNamespace {
  quote(input: SwapArgs): Promise<SwapQuote>
  /** Starts the flow; resolves once the first sheet exists. Progress arrives as `swap.progress` events. */
  execute(input: SwapArgs): Promise<{ flowId: string; requestId: string | null }>
  flow(input: { flowId: string }): Promise<SwapFlow | null>
  flows(input?: { accountId?: AccountId }): Promise<SwapFlow[]>
}

/** The BOLT/DYNO holder program (§8.18): the account's fee tier and the whole schedule. */
export interface HolderNamespace {
  tier(input: { accountId: AccountId; chainId: number }): Promise<HolderTier>
  cachedTier(input: { accountId: AccountId; chainId: number }): Promise<Cached<HolderTier> | null>
  schedule(input: { chainId: number }): Promise<FeeScheduleView>
  addresses(input: { chainId: number }): Promise<{ sink: string | null; schedule: string | null }>
  /** Dev/test only; refused for a chain whose sink is pinned in the build. */
  configure(input: {
    chainId: number
    sink: string | null
    schedule: string | null
  }): Promise<{ sink: string | null; schedule: string | null }>
}

/** Limit orders on EsLimitOrderManagerV1 (§8.6). */
export interface LimitNamespace {
  quote(input: {
    accountId: AccountId
    chainId: number
    tokenIn: string
    tokenOut: string
    amountIn: string
    minOut: string
    durationSeconds: number
  }): Promise<LimitQuote>
  place(input: {
    accountId: AccountId
    chainId: number
    tokenIn: string
    tokenOut: string
    amountIn: string
    minOut: string
    durationSeconds: number
  }): Promise<{ flowId: string; requestId: string | null }>
  cancel(input: {
    accountId: AccountId
    chainId: number
    orderId: string
  }): Promise<{ flowId: string; requestId: string | null }>
  list(input: { accountId: AccountId; chainId: number }): Promise<LimitOrderView[]>
}

/** Explore (§8.11): the ElectroSwap market inside the wallet. Display data; empty when the API is unreachable. */
export interface ExploreNamespace {
  available(): Promise<boolean>
  tokens(input: { chainId: number }): Promise<ExploreToken[]>
  cachedTokens(input: { chainId: number }): Promise<Cached<ExploreToken[]> | null>
  tokenDetail(input: { chainId: number; address: string }): Promise<TokenDetailView | null>
  cachedTokenDetail(input: {
    chainId: number
    address: string
  }): Promise<Cached<TokenDetailView> | null>
  /** One timeframe of price history (plan B5); null when the market is unreachable. */
  priceHistory(input: {
    chainId: number
    address: string
    duration: ChartDuration
  }): Promise<PriceHistoryView | null>
  cachedPriceHistory(input: {
    chainId: number
    address: string
    duration: ChartDuration
  }): Promise<Cached<PriceHistoryView> | null>
  /** Locked liquidity for a token (native → WETN); null when the market is unreachable. */
  liquidity(input: { chainId: number; address: string }): Promise<LiquidityView | null>
  cachedLiquidity(input: {
    chainId: number
    address: string
  }): Promise<Cached<LiquidityView> | null>
  /** Listed collections by default (verified, traded, listed or owned) plus the user's own; `all` for the whole index (plan C3). */
  collections(input: {
    chainId: number
    accountId?: AccountId
    all?: boolean
    window?: CollectionWindow
  }): Promise<CollectionView[]>
  cachedCollections(input: {
    chainId: number
    accountId?: AccountId
    all?: boolean
    window?: CollectionWindow
  }): Promise<Cached<CollectionView[]> | null>
  collection(input: {
    chainId: number
    address: string
    accountId?: AccountId
  }): Promise<CollectionView | null>
  search(input: {
    chainId: number
    query: string
  }): Promise<{ tokens: ExploreToken[]; collections: CollectionView[] }>
}

/** The NFT marketplace (§8.10) on Seaport 1.5. Flows resolve once the first sheet exists; progress arrives as `swap.progress`. */
export interface NftNamespace {
  inventory(input: { accountId: AccountId; chainId: number }): Promise<Inventory>
  cachedInventory(input: {
    accountId: AccountId
    chainId: number
  }): Promise<Cached<Inventory> | null>
  assets(input: {
    chainId: number
    address: string
    orderBy?: 'PRICE' | 'RARITY'
    asc?: boolean
    listed?: boolean
    traits?: Array<{ name: string; values: string[] }>
    query?: string
    after?: string
    accountId?: AccountId
  }): Promise<{ assets: AssetView[]; total: number | null; next: string | null }>
  asset(input: {
    chainId: number
    address: string
    tokenId: string
    accountId?: AccountId
  }): Promise<AssetView | null>
  activity(input: {
    chainId: number
    address: string
    tokenId?: string
  }): Promise<NftActivityView[]>
  offers(input: { accountId: AccountId; chainId: number }): Promise<OffersInbox>
  list(input: {
    accountId: AccountId
    chainId: number
    address: string
    tokenId: string
    priceEtn: string
    days: number
  }): Promise<{ flowId: string; requestId: string | null }>
  offer(input: {
    accountId: AccountId
    chainId: number
    address: string
    tokenId: string
    priceEtn: string
    days: number
  }): Promise<{ flowId: string; requestId: string | null }>
  buy(input: {
    accountId: AccountId
    chainId: number
    address: string
    tokenId: string
  }): Promise<{ flowId: string; requestId: string | null }>
  accept(input: {
    accountId: AccountId
    chainId: number
    address: string
    tokenId: string
    orderHash: string
  }): Promise<{ flowId: string; requestId: string | null }>
  cancel(input: {
    accountId: AccountId
    chainId: number
    address: string
    tokenId: string
    orderHash: string
  }): Promise<{ flowId: string; requestId: string | null }>
  transfer(input: {
    accountId: AccountId
    chainId: number
    address: string
    tokenId: string
    to: string
  }): Promise<{ flowId: string; requestId: string | null }>
  mint(input: {
    accountId: AccountId
    chainId: number
    count: number
    address?: string
  }): Promise<{ flowId: string; requestId: string | null }>
  collectionApproved(input: {
    accountId: AccountId
    chainId: number
    address: string
  }): Promise<boolean>
  /** Custom collections (plan A3): the chain's word on a contract, add, remove, list. */
  previewCollection(input: {
    chainId: number
    address: string
  }): Promise<{
    chainId: number
    address: string
    name: string
    symbol: string
    standard: 'ERC721' | 'ERC1155'
    enumerable: boolean
  }>
  addCollection(input: { chainId: number; address: string }): Promise<CustomCollection>
  removeCollection(input: { chainId: number; address: string }): Promise<void>
  customCollections(input: { chainId: number }): Promise<CustomCollection[]>
}

/** Electric Legends dividends (§8.10). */
export interface LegendsNamespace {
  status(input: { accountId: AccountId; chainId: number }): Promise<LegendsStatus | null>
  activate(input: {
    accountId: AccountId
    chainId: number
  }): Promise<{ flowId: string; requestId: string | null }>
  claim(input: {
    accountId: AccountId
    chainId: number
  }): Promise<{ flowId: string; requestId: string | null }>
  mint(input: {
    accountId: AccountId
    chainId: number
    count: number
  }): Promise<{ flowId: string; requestId: string | null }>
}

/** The Hyperlane bridge (§8.7): verified corridors, a quote with the interchain gas, the flow, and delivery status. */
export interface BridgeNamespace {
  /** Every chain a warp route starts on, whether it is turned on, and the assets it can send (plan C4). */
  origins(): Promise<Array<{ chainId: number; enabled: boolean; symbols: Array<'USDC' | 'USDT'> }>>
  routes(input: { fromChainId: number; token?: string }): Promise<BridgeRoute[]>
  quote(input: {
    accountId: AccountId
    fromChainId: number
    toChainId: number
    token: string
    amount: string
    recipient?: string
  }): Promise<BridgeQuote>
  execute(input: {
    accountId: AccountId
    fromChainId: number
    toChainId: number
    token: string
    amount: string
    recipient?: string
  }): Promise<{ flowId: string; requestId: string | null }>
  list(input?: { accountId?: AccountId }): Promise<BridgeStatus[]>
  status(input: { id: string }): Promise<BridgeStatus | null>
}

/** Yield farms (§8.8): positions from the chain; Deposit · Withdraw · Collect through the sheet. */
export interface FarmNamespace {
  list(input: { chainId: number; accountId?: AccountId }): Promise<FarmView[]>
  cachedList(input: { chainId: number; accountId?: AccountId }): Promise<Cached<FarmView[]> | null>
  farm(input: { chainId: number; farmId: number; accountId?: AccountId }): Promise<FarmView | null>
  quoteDeposit(input: {
    accountId: AccountId
    chainId: number
    farmId: number
    amount0?: string
    amount1?: string
    bolt?: string
  }): Promise<FarmDepositQuote>
  deposit(input: {
    accountId: AccountId
    chainId: number
    farmId: number
    amount0?: string
    amount1?: string
    bolt?: string
  }): Promise<{ flowId: string; requestId: string | null }>
  quoteWithdraw(input: {
    accountId: AccountId
    chainId: number
    farmId: number
    percent: number
    asNative: boolean
  }): Promise<FarmWithdrawQuote>
  withdraw(input: {
    accountId: AccountId
    chainId: number
    farmId: number
    percent: number
    asNative: boolean
  }): Promise<{ flowId: string; requestId: string | null }>
  collect(input: {
    accountId: AccountId
    chainId: number
    farmId: number
    asNative: boolean
  }): Promise<{ flowId: string; requestId: string | null }>
}

/** Launchpad (§8.9). */
export interface LaunchpadNamespace {
  list(input: {
    chainId: number
    accountId?: AccountId
    statuses?: Array<'ACTIVE' | 'LAUNCHED' | 'FAILED' | 'CANCELLED' | 'PENDING'>
  }): Promise<CampaignView[]>
  cachedList(input: {
    chainId: number
    accountId?: AccountId
  }): Promise<Cached<CampaignView[]> | null>
  detail(input: {
    chainId: number
    pool: string
    accountId?: AccountId
  }): Promise<CampaignView | null>
  contribute(input: {
    accountId: AccountId
    chainId: number
    pool: string
    amountEtn: string
  }): Promise<{ flowId: string; requestId: string | null }>
  claim(input: {
    accountId: AccountId
    chainId: number
    pool: string
    kind: 'tokens' | 'refund' | 'referral'
  }): Promise<{ flowId: string; requestId: string | null }>
  rememberReferral(input: { chainId: number; pool: string; referrer: string }): Promise<void>
  rememberFromLink(input: {
    url: string
  }): Promise<{ pool: string; referrer: string | null } | null>
}

/** Watchlist and alerts (§7.13). */
export interface WatchlistNamespace {
  list(): Promise<WatchItem[]>
  star(input: {
    kind: 'token' | 'collection' | 'campaign'
    chainId: number
    address: string
    label: string
  }): Promise<WatchItem[]>
  unstar(input: {
    kind: 'token' | 'collection' | 'campaign'
    chainId: number
    address: string
  }): Promise<WatchItem[]>
  setAlert(input: {
    kind: 'token' | 'collection' | 'campaign'
    chainId: number
    address: string
    above: number | null
    below: number | null
    onLive: boolean
  }): Promise<WatchItem[]>
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
  ledgerStatus(): Promise<{
    available: boolean
    devices: Array<{ deviceId: string; model: string }>
    app: { version: string; blindSigning: boolean } | null
    problem: string | null
  }>
  /**
   * Can the device be asked to sign right now? Bounded at a few seconds and
   * silent on the device, so a sheet may ask while it is being read.
   */
  ledgerPreflight(input?: {
    deviceId?: string
  }): Promise<{
    state: 'ready' | 'no_device' | 'locked' | 'wrong_app' | 'no_answer' | 'unavailable' | 'error'
    message: string | null
    blindSigning: boolean | null
    /** Whether the Ethereum app is new enough to show typed data as fields. */
    clearSigning: boolean | null
  }>
  ledgerAddresses(input: {
    scheme: 'bip44' | 'live'
    from?: number
    count?: number
    deviceId?: string
  }): Promise<Array<{ path: string; address: string; index: number }>>
  ledgerVerify(input: { path: string; deviceId?: string }): Promise<{ address: string }>
  verifyAccount(input: { accountId: AccountId }): Promise<{ address: string }>
  trezorStatus(): Promise<{
    available: boolean
    model: string | null
    label: string | null
    problem: string | null
  }>
  trezorAddresses(input: {
    scheme: 'bip44' | 'live'
    from?: number
    count?: number
  }): Promise<Array<{ path: string; address: string; index: number }>>
  trezorVerify(input: { path: string }): Promise<{ address: string }>
  /** The Keystone's account QR (crypto-hdkey / crypto-account) as picker rows. */
  keystoneImport(input: {
    parts: string[]
    count?: number
  }): Promise<{
    xfp: string
    name: string | null
    addresses: Array<{ path: string; address: string; index: number }>
  }>
  keystonePending(): Promise<KeystonePending[]>
  keystoneSubmit(input: { id: string; parts: string[] }): Promise<{ ok: true }>
  keystoneCancel(input: { id: string }): Promise<{ ok: true }>
}

/** External dApp transports (§2.7 S9): the in-app browser opens a session per committed origin and relays EIP-1193 messages. */
export interface DappsNamespace {
  /** `channel` is the nonce the host injected into the committed document; every request must carry it back. */
  open(input: {
    url: string
    kind: 'webview' | 'walletconnect'
    verified?: boolean
    channel?: string
  }): Promise<DappSession>
  request(input: {
    sessionId: string
    channel?: string
    id: number
    method: string
    params?: unknown
  }): Promise<{ result?: unknown; error?: { code: number; message: string; data?: unknown } }>
  close(input: { sessionId: string }): Promise<void>
  list(): Promise<DappSession[]>
}

/** WalletConnect (§5.3): pair from a `wc:` link; proposals run the Connect sheet; sessions list under Connected sites. */
export interface ConnectNamespace {
  status(): Promise<{ available: boolean; proposals: WcProposalView[]; sessions: WcSessionView[] }>
  pair(input: { uri: string }): Promise<void>
  disconnect(input: { topic: string }): Promise<void>
}

/** The build's endpoints and optional surfaces: a development build may point the API at a local services/api. */
export interface AboutNamespace {
  get(): Promise<AboutView>
}

/** Signed flags (§3.7): kill-switches, the minimum version, a notice; only ever disable. */
/** The notifications inbox (plan A6): the record behind the Activity badge. */
export interface NotificationsNamespace {
  list(): Promise<NotificationView[]>
  unread(): Promise<number>
  markRead(input?: { ids?: string[] }): Promise<void>
  clear(): Promise<void>
}

/** UI preferences (plan B2): the Home scope, the dismissed coach, the chart timeframe, hidden balances. */
export interface PrefsNamespace {
  get(): Promise<Prefs>
  set(input: Partial<Prefs>): Promise<Prefs>
}

export interface FlagsNamespace {
  get(): Promise<FlagsView>
  refresh(): Promise<{
    flags: 'updated' | 'kept' | 'refused'
    scam: 'updated' | 'kept' | 'refused'
  }>
  /** Hosts the signed list names as scams, for the link gate (ES-BV-035). */
  scamOrigins(): Promise<string[]>
}

/** Remote sign (§6, §8.16): what this device is waiting on, and what paired devices are asking it to sign. */
export interface RemoteNamespace {
  list(): Promise<{ outgoing: RemoteRequest[]; incoming: RemoteRequest[] }>
  cancel(input: { id: string }): Promise<void>
}

/** The encrypted local activity log (§8.12). Locked vault = empty. */
export interface ActivityNamespace {
  /** The local log merged with the account feed, newest first (§8.12). */
  list(input?: {
    accountId?: AccountId
    chainId?: number
    limit?: number
  }): Promise<ActivityEntry[]>
  /** One row by its id or its transaction hash, for the detail sheet. */
  detail(input: { id: string }): Promise<ActivityEntry | null>
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
  /**
   * Address-book entries and custom tokens a paired device sent that nobody
   * has vouched for on this device yet (§6). They are present locally but
   * untrusted: out of the lookalike reference set, out of the firewall's
   * "known token" identity.
   */
  incoming(): Promise<SyncIncomingItem[]>
  /** Vouch for one here; returns what is still waiting. */
  confirmIncoming(input: {
    collection: SyncIncomingItem['collection']
    key: string
  }): Promise<SyncIncomingItem[]>
  /** Refuse one: it goes from this device, and the refusal does not travel back. */
  rejectIncoming(input: {
    collection: SyncIncomingItem['collection']
    key: string
  }): Promise<SyncIncomingItem[]>
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
  readonly tx: TxNamespace
  readonly activityScan: ActivityScanNamespace
  readonly tokens: TokensNamespace
  readonly names: NamesNamespace
  readonly security: SecurityNamespace
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
  readonly bridge: BridgeNamespace
  readonly remote: RemoteNamespace
  readonly dapps: DappsNamespace
  readonly connect: ConnectNamespace
  readonly flags: FlagsNamespace
  readonly about: AboutNamespace
  readonly notifications: NotificationsNamespace
  readonly prefs: PrefsNamespace
  readonly events: EngineEvents
}

/** The callable namespaces (everything except the event source). */
export type EngineNamespaces = Omit<WalletEngine, 'events'>
export type NamespaceName = keyof EngineNamespaces
