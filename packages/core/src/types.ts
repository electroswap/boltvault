/**
 * @boltvault/core — domain types shared by every package and both bodies.
 *
 * Types only in v1 (no runtime logic): the vault envelope, account model,
 * per-origin site sessions, history entries, and settings. Runtime lives in
 * packages/history (encrypted log) and the SW/mobile app layers.
 */

export type AccountId = string // stable, random, set once

export type AccountKind = 'hd' | 'imported' | 'ledger' | 'trezor' | 'watch'

export interface VaultAccount {
  readonly id: AccountId
  readonly kind: AccountKind
  readonly label: string
  /** Checksummed EOA address. Every kind resolves to one. */
  readonly address: string
  /** BIP-44 index for HD accounts. */
  readonly index?: number
  /** Present for hardware accounts; signing round-trips through the adapter. */
  readonly hardware?: {
    readonly deviceId?: string
    readonly path: string
  }
  /** HD + imported accounts hold their key inside the vault envelope. */
  readonly hasKey: boolean
  readonly createdAt: number
}

/**
 * The encrypted vault file (VaultFileV1). Stored opaquely in platform
 * `storage.secret`; plaintext never leaves the signing isolate.
 */
export interface VaultFileV1 {
  readonly version: 1
  /** KDF: argon2id (m=64MiB t=3 p=1, salt 16B). */
  readonly kdf: {
    readonly algorithm: 'argon2id'
    readonly salt: string // hex
    readonly m: number
    readonly t: number
    readonly p: number
  }
  /** XChaCha20-Poly1305 keystream-encrypted payload. */
  readonly ciphertext: string // base64
  readonly nonce: string // base64
  readonly tag: string // base64
  /** Plaintext shape: { seedPhraseHex | derived accounts, accounts metadata }. */
}

export interface VaultPlaintext {
  /** BIP-39 seed, 128/256-bit, hex — present when any HD account exists. */
  readonly seedHex: string | null
  /** The BIP-39 mnemonic itself (space-joined) — stored so the seed can be re-revealed. */
  readonly mnemonic: string | null
  /** Imported 32-byte keys, hex, keyed by AccountId. */
  readonly importedKeys: Record<AccountId, string>
  readonly accounts: readonly VaultAccountMeta[]
}

export interface VaultAccountMeta {
  readonly id: AccountId
  readonly kind: AccountKind
  readonly label: string
  readonly address: string
  readonly index?: number
  readonly hardware?: { readonly path: string }
}

/**
 * Per-origin dApp session (Rabby behavior, rewritten). The SW's
 * permissionService is the owner; the UI renders it.
 */
export interface ConnectedSite {
  /** From Port sender (chrome.tabs), never from the payload. */
  readonly origin: string
  /** Last wallet_switchEthereumChain for THIS origin. */
  readonly chainId: number
  readonly accountId: AccountId | null
  readonly connected: boolean
  /** EIP-2255: eth_accounts (the only permission we grant in v1). */
  readonly permissions: readonly string[]
  readonly connectedAt: number
}

export type HistoryCategory =
  | 'SEND'
  | 'RECEIVE'
  | 'SWAP'
  | 'BRIDGE'
  | 'APPROVAL'
  | 'REVOKE'
  | 'FARM_DEPOSIT'
  | 'FARM_WITHDRAW'
  | 'FARM_COLLECT'
  | 'LAUNCHPAD'
  | 'NFT_BUY'
  | 'NFT_SELL'
  | 'NFT_TRANSFER'
  | 'DAPP'

export interface HistoryEntry {
  readonly hash: string
  readonly chainId: number
  readonly account: AccountId
  readonly to: string | null
  readonly data: string
  readonly value: string // hex wei
  readonly nonce: number
  readonly submittedAt: number
  /** Present for dApp-originated (injected) txs. */
  readonly origin?: string
  readonly category: HistoryCategory
  readonly status?: 'pending' | 'confirmed' | 'failed' | 'replaced'
  readonly blockNumber?: number
  readonly replacedBy?: string
}

export interface CustomTokenStoreEntry {
  readonly chainId: number
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly logoURI?: string
  readonly source: 'user' | 'dapp'
  readonly origin?: string
}

/**
 * Idle timeout: the timer restarts on every interaction; the vault always locks
 * when the browser closes.
 *
 * `background` is the phone's answer and has no timer at all — the app locks
 * when it leaves the foreground (ES-BV-041). It lived only in the engine's own
 * schema for one release, so every write of it was clamped back to fifteen
 * minutes by `normalizeSettings` and the setting the user picked was not the
 * setting they got (ES-BV-067). It is a stored value like any other now.
 */
export type AutoLock = 'background' | '5min' | '15min' | '60min' | 'never'

export interface BoltVaultSettings {
  /** 'BoltVault is default wallet' — the only window.ethereum writer. */
  defaultWallet: boolean
  /** isMetaMask compat flag for legacy dApps. */
  metaMaskCompat: boolean
  /** Dangerous legacy eth_sign (default off). */
  ethSignEnabled: boolean
  /**
   * Where a transaction preview comes from. `'api'` (default) asks
   * ElectroSwap's trace node — the only way to see what a transaction moves on
   * a chain whose public RPCs cannot trace, and it means the address and the
   * calldata leave the device. `'off'` keeps them local and leaves only the
   * gas-estimate revert check.
   */
  txPreview: 'api' | 'off'
  /** Approve exact amounts instead of max (default on). */
  exactApprovals: boolean
  /** Default swap slippage in bips (0.5 % = 50). */
  slippageBips: number
  /** Chains shown besides Electroneum (§8.14 Networks). */
  enabledChains: number[]
  showTestnet: boolean
  /** Feel (§7.8). */
  haptics: boolean
  blockTick: boolean
  sound: boolean
  /** Push registration opt-in (§9.3). */
  pushEnabled: boolean
  /** Crash reports opt-in (§3.7). */
  crashReports: boolean
  /** Unknown-recipient extra confirm (default off; poison 4+4 is always on). */
  sendWhitelist: boolean
  /**
   * The password is required to reveal a recovery phrase, whatever else the
   * vault is wrapped under (§3.2). On by default — the Security and Onboarding
   * copy has always said so, and a fingerprint should not be enough for the
   * one secret that is the whole wallet on any device for ever.
   */
  revealNeedsPassword: boolean
  /**
   * The home-screen widget may show the portfolio total (§7.13).
   *
   * Off by default, which is what the docs always claimed and the code never
   * did: the snapshot is a plaintext file in the App Group container, so a
   * stolen phone or an iCloud backup of that container gave up the total —
   * and, until this, the account's address beside it — while the wallet itself
   * was locked. A widget that shows a balance is a choice, and it is made here.
   */
  widgetShowsTotal: boolean
  autoLock: AutoLock
  /** UI language/currency for totals display. */
  displayCurrency: 'USD' | 'ETN'
  readonly reducedMotion: boolean
  /**
   * The animated background. 'circuit' is the board on Home, 'grid' the
   * original wave mesh, 'off' neither. Owner asked for the Grid to be kept but
   * demoted to a choice.
   */
  readonly scene: 'circuit' | 'grid' | 'off'
}

export const DEFAULT_SETTINGS: BoltVaultSettings = {
  defaultWallet: false,
  metaMaskCompat: false,
  // On by default: a real preview is a real safety feature, and the trade-off
  // is stated in Settings rather than assumed.
  txPreview: 'api',
  ethSignEnabled: false,
  exactApprovals: true,
  slippageBips: 50,
  enabledChains: [1, 56, 8453],
  showTestnet: false,
  haptics: true,
  blockTick: false,
  sound: false,
  pushEnabled: false,
  crashReports: false,
  sendWhitelist: false,
  revealNeedsPassword: true,
  widgetShowsTotal: false,
  autoLock: '15min',
  displayCurrency: 'USD',
  reducedMotion: false,
  scene: 'circuit',
}

/** Platform storage contract (S1) — the only way core touches OS capabilities. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
}
