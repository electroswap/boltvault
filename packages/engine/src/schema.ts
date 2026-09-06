import { FlagsSchema } from '@boltvault/core'
/**
 * DTOs that cross the UI↔engine boundary (master plan §2.4).
 *
 * Every value is plain JSON: no classes, no bigint (raw chain quantities travel
 * as decimal strings). zod schemas are the source of truth; the TypeScript
 * types are inferred from them so the wire contract and the compile-time
 * contract cannot drift.
 */
import { z } from 'zod'

export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'expected a 20-byte hex address')
export type Address = z.infer<typeof AddressSchema>

export const AccountIdSchema = z.string().min(1).max(64)
export type AccountId = z.infer<typeof AccountIdSchema>

export const AccountKindSchema = z.enum(['hd', 'imported', 'ledger', 'trezor', 'keystone', 'watch'])
export type AccountKind = z.infer<typeof AccountKindSchema>

/** What the UI knows about an account. Never a key, never a path secret. */
export const AccountViewSchema = z.object({
  id: AccountIdSchema,
  kind: AccountKindSchema,
  label: z.string().max(64),
  address: AddressSchema,
  /** BIP-44 index for HD accounts. */
  index: z.number().int().nonnegative().optional(),
  /** Which seed an HD account belongs to. */
  seedId: z.string().optional(),
  /** Hardware accounts: derivation path and paired device; the scheme and index read off the path (plan C1). */
  hardware: z.object({ path: z.string(), deviceId: z.string().optional(), scheme: z.enum(['bip44', 'live', 'custom']).optional(), index: z.number().int().nonnegative().optional() }).optional(),
  /** True when the engine can sign for this account without a device. */
  hasKey: z.boolean(),
  hidden: z.boolean(),
  order: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
})
export type AccountView = z.infer<typeof AccountViewSchema>

export const AutoLockSchema = z.enum(['5min', '15min', '60min', 'never'])
export type AutoLock = z.infer<typeof AutoLockSchema>

export const WrapKindSchema = z.enum(['password', 'prf', 'device'])
export type WrapKind = z.infer<typeof WrapKindSchema>

export const SeedViewSchema = z.object({
  id: z.string(),
  label: z.string(),
  backedUp: z.boolean(),
  accountCount: z.number().int().nonnegative(),
  hasPassphrase: z.boolean(),
})
export type SeedView = z.infer<typeof SeedViewSchema>

export const VaultStatusSchema = z.object({
  /** A vault file exists (the user has onboarded). */
  exists: z.boolean(),
  unlocked: z.boolean(),
  unlockedAt: z.number().int().nullable(),
  /** When the auto-lock alarm will fire, or null when never/locked. */
  lockAt: z.number().int().nullable(),
  autoLock: AutoLockSchema,
  /** Enrolled unlock factors (from the file header; readable while locked). */
  wraps: z.array(z.object({ by: WrapKindSchema, id: z.string() })),
  /** Seeds and their backup state (only while unlocked; empty when locked). */
  seeds: z.array(SeedViewSchema),
  /** Every seed backed up, or no seed exists. Gates Swap/Sign (§8.1). */
  backupComplete: z.boolean(),
})
export type VaultStatus = z.infer<typeof VaultStatusSchema>

export const SiteViewSchema = z.object({
  origin: z.string().url().or(z.string().min(1)),
  chainId: z.number().int().positive(),
  accountId: AccountIdSchema.nullable(),
  connected: z.boolean(),
  connectedAt: z.number().int().nonnegative().nullable(),
  lastUsed: z.number().int().nonnegative().nullable(),
  title: z.string().nullable(),
  icon: z.string().nullable(),
})
export type SiteView = z.infer<typeof SiteViewSchema>

export const ChainViewSchema = z.object({
  chainId: z.number().int().positive(),
  name: z.string(),
  symbol: z.string(),
  explorerUrl: z.string().url().nullable(),
  isHome: z.boolean(),
  testnet: z.boolean(),
})
export type ChainView = z.infer<typeof ChainViewSchema>

export const ChainHeadSchema = z.object({
  chainId: z.number().int().positive(),
  /** Block number as a decimal string (no bigint on the wire). */
  blockNumber: z.string().regex(/^\d+$/),
  observedAt: z.number().int().nonnegative(),
  /** True when the RPC answered within its expected cadence. */
  live: z.boolean(),
})
export type ChainHead = z.infer<typeof ChainHeadSchema>

export const ApprovalKindSchema = z.enum([
  'connect',
  'sign_message',
  'sign_typed_data',
  'send_transaction',
  'switch_chain',
  'add_chain',
  'watch_asset',
  'internal',
])
export type ApprovalKind = z.infer<typeof ApprovalKindSchema>

export const ApprovalStatusSchema = z.enum(['pending', 'approved', 'rejected', 'expired'])
export type ApprovalStatus = z.infer<typeof ApprovalStatusSchema>

/**
 * A request that needs a human decision. Created only by the engine; the UI
 * subscribes to it and echoes its `id` in an ApprovalDecision. One decision
 * per id; ids expire five minutes after creation (master plan §3.3).
 */
export const ApprovalRequestSchema = z.object({
  /** 128-bit random id, hex. */
  id: z.string().regex(/^[0-9a-f]{32}$/),
  kind: ApprovalKindSchema,
  /** Registrable origin for dApp requests, `internal:<surface>` for our own. */
  origin: z.string().min(1),
  accountId: AccountIdSchema.nullable(),
  chainId: z.number().int().positive().nullable(),
  /** Kind-specific, JSON-safe payload; the UI renders it, never executes it. */
  payload: z.unknown(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  status: ApprovalStatusSchema,
  /** What the deciding UI attached (e.g. the account chosen on a Connect sheet). */
  decisionData: z.unknown().optional(),
})
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

export const ApprovalDecisionSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  approve: z.boolean(),
  data: z.unknown().optional(),
})
export type ApprovalDecision = z.infer<typeof ApprovalDecisionSchema>

export const SettingsSchema = z.object({
  defaultWallet: z.boolean(),
  metaMaskCompat: z.boolean(),
  ethSignEnabled: z.boolean(),
  exactApprovals: z.boolean(),
  /** Default swap slippage in bips (§8.14 Spending). */
  slippageBips: z.number().int().min(1).max(5_000),
  /** Networks the wallet shows besides Electroneum (§8.14 Networks). */
  enabledChains: z.array(z.number().int().positive()),
  showTestnet: z.boolean(),
  /** Feel (§7.8): haptics on confirm/keys/receipt/danger; the per-block tick and sound are off by default. */
  haptics: z.boolean(),
  blockTick: z.boolean(),
  sound: z.boolean(),
  /** Push registration opt-in (§9.3); the phone registers with the watcher only when on. */
  pushEnabled: z.boolean(),
  /** Crash reports (§3.7): off by default; scrubbed; only to ElectroSwap. */
  crashReports: z.boolean(),
  sendWhitelist: z.boolean(),
  autoLock: AutoLockSchema,
  displayCurrency: z.enum(['USD', 'ETN']),
  reducedMotion: z.boolean(),
})
export type Settings = z.infer<typeof SettingsSchema>

/** One holding on one chain. Quantities are decimal strings; fiat is display-only. */
export const PortfolioRowSchema = z.object({
  chainId: z.number().int().positive(),
  /** Token contract, or 'native'. */
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  logoUri: z.string().nullable(),
  /** Raw balance in base units, decimal string. */
  raw: z.string().regex(/^\d+$/),
  /** Human quantity, decimal string. */
  quantity: z.string(),
  /** Fiat value in the display currency, or null when unpriced. */
  fiat: z.number().nullable(),
  /** 24 h change as a signed fraction (0.021 = +2.1 %), or null. */
  change24h: z.number().nullable(),
  /** Share of the scoped portfolio value, 0..1 (0 when unpriced). */
  share: z.number().min(0).max(1),
  pinned: z.boolean(),
  custom: z.boolean(),
  hidden: z.boolean(),
})
export type PortfolioRow = z.infer<typeof PortfolioRowSchema>

export const PortfolioSnapshotSchema = z.object({
  accountId: AccountIdSchema,
  chainIds: z.array(z.number().int().positive()),
  currency: z.enum(['USD', 'ETN']),
  /** Total of priced rows; null when nothing is priced. */
  total: z.number().nullable(),
  /** Signed fraction, or null. Describes exactly `total`. */
  change24h: z.number().nullable(),
  unpricedCount: z.number().int().nonnegative(),
  rows: z.array(PortfolioRowSchema),
  observedAt: z.number().int().nonnegative(),
  /** True when this came from the last-good snapshot rather than a fresh read. */
  stale: z.boolean(),
})
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>

export const ActivityCategorySchema = z.enum([
  'SEND',
  'RECEIVE',
  'SWAP',
  'LIMIT',
  'BRIDGE',
  'APPROVE',
  'REVOKE',
  'FARM_DEPOSIT',
  'FARM_WITHDRAW',
  'FARM_COLLECT',
  'LAUNCHPAD',
  'NFT',
  'DIVIDEND_CLAIM',
  'DAPP',
])
export type ActivityCategory = z.infer<typeof ActivityCategorySchema>

/** One entry of the encrypted local log (master plan §8.12). Written before broadcast. */
export const ActivityEntrySchema = z.object({
  id: z.string(),
  hash: z.string().nullable(),
  chainId: z.number().int().positive(),
  accountId: AccountIdSchema,
  to: z.string().nullable(),
  value: z.string(),
  nonce: z.number().int().nonnegative().nullable(),
  submittedAt: z.number().int().nonnegative(),
  origin: z.string().nullable(),
  category: ActivityCategorySchema,
  /** The plain statements the user was shown at sign time (§3.4). */
  statements: z.array(z.string()),
  riskCodes: z.array(z.string()),
  status: z.enum(['pending', 'confirmed', 'failed', 'replaced']),
  blockNumber: z.number().int().nonnegative().nullable(),
  /** Token contract for a token transfer ('native' or address); absent for other entries. */
  token: z.string().nullable().optional(),
  /** Counterparty for inbound entries. */
  from: z.string().nullable().optional(),
})
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>

export const PairedDeviceSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
  pairedAt: z.number().int().nonnegative(),
  lastSeenAt: z.number().int().nonnegative().nullable(),
})
export type PairedDevice = z.infer<typeof PairedDeviceSchema>

export const SyncStatusSchema = z.object({
  deviceId: z.string(),
  deviceLabel: z.string(),
  devices: z.array(PairedDeviceSchema),
  /** A pairing in progress: show this SAS until confirmed on both sides. */
  pending: z.object({ pairingId: z.string(), sas: z.string(), peerDeviceId: z.string(), role: z.enum(['offer', 'answer']) }).nullable(),
})
export type SyncStatus = z.infer<typeof SyncStatusSchema>

/** One token of a chain's universe (master plan §10.2). `address` is 'native' or a checksummed contract. */
export const TokenViewSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  logoUri: z.string().nullable(),
  source: z.enum(['native', 'list', 'user', 'dapp', 'lookup']),
  pinned: z.boolean(),
  hidden: z.boolean(),
  tags: z.array(z.string()),
})
export type TokenView = z.infer<typeof TokenViewSchema>

/** One allowance the account has granted (§8.13). Amounts are raw decimal strings, 'unlimited' or 'all'. */
export const AllowanceViewSchema = z.object({
  chainId: z.number().int().positive(),
  token: z.string(),
  tokenSymbol: z.string().nullable(),
  spender: z.string(),
  spenderName: z.string().nullable(),
  known: z.boolean(),
  standard: z.enum(['erc20', 'permit2', 'erc721']),
  amount: z.string(),
  /** Unix seconds for Permit2 allowances; null otherwise. */
  expiration: z.number().int().nonnegative().nullable(),
})
export type AllowanceView = z.infer<typeof AllowanceViewSchema>

export const ContactViewSchema = z.object({
  id: z.string(),
  address: z.string(),
  label: z.string(),
  chainId: z.number().int().positive().nullable(),
  /** False for an entry synced from another device until confirmed here (§6). */
  confirmed: z.boolean(),
  createdAt: z.number().int().nonnegative(),
})
export type ContactView = z.infer<typeof ContactViewSchema>

export const NameLookupSchema = z.object({
  address: z.string(),
  name: z.string().nullable(),
  /** True when the reverse record was forward-verified on chain. */
  verified: z.boolean(),
})
export type NameLookup = z.infer<typeof NameLookupSchema>

/** What Send shows before the review (§8.4). Raw amounts are decimal strings. */
export const SendQuoteSchema = z.object({
  to: z.string().nullable(),
  name: z.string().nullable(),
  token: z.string(),
  symbol: z.string(),
  decimals: z.number().int().nonnegative(),
  amountRaw: z.string(),
  balanceRaw: z.string(),
  maxRaw: z.string(),
  max: z.string(),
  feeWei: z.string(),
  feeSymbol: z.string(),
  ok: z.boolean(),
  problems: z.array(z.string()),
})
export type SendQuote = z.infer<typeof SendQuoteSchema>

// ---- M5: swap, holder tier, limit orders (§8.6, §8.18) ------------------------------

/** One step of an in-wallet swap or limit-order flow; each is one sheet. */
export const SwapStepSchema = z.enum(['wrap', 'approve', 'permit', 'swap', 'submit', 'cancel', 'approve_collection', 'sign_order', 'post_order', 'buy', 'accept', 'cancel_order', 'transfer', 'mint', 'deposit', 'withdraw', 'collect', 'contribute', 'claim', 'register'])
export type SwapStep = z.infer<typeof SwapStepSchema>

/** The account's BOLT/DYNO tier as the fee schedule sees it (§8.18). Scores are BOLT-eq wei strings. */
export const HolderTierSchema = z.object({
  chainId: z.number().int().positive(),
  bips: z.number().int().nonnegative(),
  tier: z.number().int().nonnegative(),
  score: z.string(),
  nextTierAt: z.string().nullable(),
  nextTierBips: z.number().int().nonnegative().nullable(),
  /** 'chain' when the schedule contract answered; 'fallback' is the base fee, never lower. */
  source: z.enum(['chain', 'fallback']),
  sink: z.string().nullable(),
  schedule: z.string().nullable(),
  /** Where the score comes from, for the fee sheet. */
  breakdown: z.object({ wallet: z.string(), farm: z.string(), dyno: z.string() }),
})
export type HolderTier = z.infer<typeof HolderTierSchema>

export const FeeScheduleViewSchema = z.object({
  chainId: z.number().int().positive(),
  baseBips: z.number().int().nonnegative(),
  tiers: z.array(z.object({ minScore: z.string(), bips: z.number().int().nonnegative() })),
  dynoWeight: z.string(),
  countFarmBolt: z.boolean(),
  boltPayDiscountBips: z.number().int().nonnegative(),
  source: z.enum(['chain', 'fallback']),
  sink: z.string().nullable(),
  address: z.string().nullable(),
})
export type FeeScheduleView = z.infer<typeof FeeScheduleViewSchema>

export const SwapHopSchema = z.object({ kind: z.enum(['v2', 'v3']), tokenIn: z.string(), tokenOut: z.string(), fee: z.number().int().optional() })
export type SwapHop = z.infer<typeof SwapHopSchema>

/** What the Swap screen shows before the review (§8.6). Raw amounts are decimal strings. */
export const SwapQuoteSchema = z.object({
  chainId: z.number().int().positive(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  symbolIn: z.string(),
  symbolOut: z.string(),
  decimalsIn: z.number().int().nonnegative(),
  decimalsOut: z.number().int().nonnegative(),
  amountInRaw: z.string(),
  balanceInRaw: z.string(),
  /** The router's quoted output before the wallet fee. */
  amountOutRaw: z.string(),
  /** What the user should receive after the fee. */
  receiveRaw: z.string(),
  /** Guaranteed after fee and slippage; the transaction reverts below this. */
  minimumOutRaw: z.string(),
  /** Output units per input unit, display only. */
  rate: z.number().nullable(),
  priceImpactPct: z.number().nullable(),
  slippageBips: z.number().int().nonnegative(),
  /** Extra slippage folded in for fee-on-transfer tokens. */
  taxBips: z.number().int().nonnegative(),
  fee: z.object({
    bips: z.number().int().nonnegative(),
    tier: z.number().int().nonnegative(),
    amountRaw: z.string(),
    sink: z.string().nullable(),
    source: z.enum(['chain', 'fallback']),
    nextTierAt: z.string().nullable(),
    nextTierBips: z.number().int().nonnegative().nullable(),
  }),
  route: z.object({ label: z.string(), hops: z.array(SwapHopSchema) }),
  gasEstimate: z.string(),
  steps: z.array(SwapStepSchema),
  quotedAt: z.number().int().nonnegative(),
  ok: z.boolean(),
  problems: z.array(z.string()),
})
export type SwapQuote = z.infer<typeof SwapQuoteSchema>

export const FlowStepStatusSchema = z.enum(['pending', 'signing', 'submitted', 'confirmed', 'rejected', 'failed'])
export const SwapFlowSchema = z.object({
  id: z.string(),
  kind: z.enum(['swap', 'limit', 'limit_cancel', 'nft', 'farm', 'launchpad', 'legends', 'bridge']),
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  steps: z.array(z.object({ step: SwapStepSchema, requestId: z.string().nullable(), status: FlowStepStatusSchema, hash: z.string().nullable() })),
  status: z.enum(['running', 'done', 'rejected', 'failed']),
  error: z.string().nullable(),
  /** The final transaction's hash once broadcast. */
  hash: z.string().nullable(),
  /** The quote the flow executes; re-quoted at sign time if the tier moved. */
  quote: SwapQuoteSchema.nullable(),
  startedAt: z.number().int().nonnegative(),
})
export type SwapFlow = z.infer<typeof SwapFlowSchema>

export const LimitOrderViewSchema = z.object({
  chainId: z.number().int().positive(),
  orderId: z.string(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  symbolIn: z.string(),
  symbolOut: z.string(),
  decimalsIn: z.number().int().nonnegative(),
  decimalsOut: z.number().int().nonnegative(),
  amountInExact: z.string(),
  amountOutMin: z.string(),
  amountInRemaining: z.string(),
  amountOutFilled: z.string(),
  unwrapOutput: z.boolean(),
  createdAt: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
  status: z.enum(['open', 'filled', 'closed', 'expired', 'unknown']),
})
export type LimitOrderView = z.infer<typeof LimitOrderViewSchema>

export const LimitQuoteSchema = z.object({
  chainId: z.number().int().positive(),
  tokenIn: z.string(),
  tokenOut: z.string(),
  symbolIn: z.string(),
  symbolOut: z.string(),
  decimalsIn: z.number().int().nonnegative(),
  decimalsOut: z.number().int().nonnegative(),
  amountInRaw: z.string(),
  balanceInRaw: z.string(),
  minOutRaw: z.string(),
  /** Output per input the order asks for, and what the market pays right now. */
  targetRate: z.number().nullable(),
  marketRate: z.number().nullable(),
  /** How far above (+) or below (−) market the target sits, in percent. */
  distancePct: z.number().nullable(),
  durationSeconds: z.number().int().positive(),
  /** The contract's fee on fill, in bips — there is no wallet fee on limit orders (§8.6). */
  platformFeeBips: z.number().int().nonnegative(),
  steps: z.array(SwapStepSchema),
  ok: z.boolean(),
  problems: z.array(z.string()),
})
export type LimitQuote = z.infer<typeof LimitQuoteSchema>

// ---- M6: Explore, NFTs, Legends, farms, launchpad, watchlist, positions (§8.8–8.11, §8.13) -----

const Fiat = z.number().nullable()

export const ExploreTokenSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  logoUri: z.string().nullable(),
  price: Fiat,
  change24h: Fiat,
  change7d: Fiat,
  volume24h: Fiat,
  tvl: Fiat,
  marketCap: Fiat,
  safety: z.enum(['VERIFIED', 'MEDIUM_WARNING', 'STRONG_WARNING', 'BLOCKED']).nullable(),
  /** On a token list the star is the pin (`tokens.setPrefs`): a pinned token stays on Home at any balance. */
  pinned: z.boolean(),
})
export type ExploreToken = z.infer<typeof ExploreTokenSchema>

/** A token's dossier from the ElectroSwap API (display only; quantities stay on the chain). Mirrors `TokenDetailView` in @boltvault/electroswap. */
export const TokenDetailViewSchema = z.object({
  address: z.string(),
  symbol: z.string(),
  name: z.string(),
  decimals: z.number().int().nonnegative(),
  native: z.boolean(),
  price: Fiat,
  change24h: Fiat,
  change7d: Fiat,
  volume24h: Fiat,
  tvl: Fiat,
  marketCap: Fiat,
  fdv: Fiat,
  safety: z.enum(['VERIFIED', 'MEDIUM_WARNING', 'STRONG_WARNING', 'BLOCKED']).nullable(),
  spam: z.boolean(),
  logoUrl: z.string().nullable(),
  description: z.string().nullable(),
  homepageUrl: z.string().nullable(),
  twitterUrl: z.string().nullable(),
  telegramUrl: z.string().nullable(),
  /** Day sparkline, oldest first. */
  sparkline: z.array(z.object({ t: z.number(), v: z.number() })),
})
export type TokenDetailView = z.infer<typeof TokenDetailViewSchema>

/** The chart's timeframes (owner decision): 1D · 1W · 1M · 1Y. */
export const ChartDurationSchema = z.enum(['1D', '1W', '1M', '1Y'])
export type ChartDuration = z.infer<typeof ChartDurationSchema>

/** One timeframe of a token's price history (plan B5), oldest first, with the period's high and low. */
export const PriceHistoryViewSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  duration: ChartDurationSchema,
  points: z.array(z.object({ t: z.number(), v: z.number() })),
  high: Fiat,
  low: Fiat,
})
export type PriceHistoryView = z.infer<typeof PriceHistoryViewSchema>

/** Locked liquidity for a token (plan B4, owner item W3): the share of the pool supply under active locks, and how many locks. */
export const LiquidityViewSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  /** 0..100. */
  lockedPct: z.number().min(0).max(100),
  lockCount: z.number().int().nonnegative(),
})
export type LiquidityView = z.infer<typeof LiquidityViewSchema>

/** One entry in the notifications inbox (plan A6). `target` is a route hint: `campaign:<pool>`, `token:<address>`, `collection:<address>`, `legends`, `positions`, `offers`. */
export const NotificationViewSchema = z.object({
  id: z.string(),
  kind: z.enum(['alert', 'live', 'offer', 'collect', 'dividends', 'arrival', 'system']),
  title: z.string(),
  body: z.string(),
  target: z.string().nullable(),
  at: z.number().int().nonnegative(),
  read: z.boolean(),
})
export type NotificationView = z.infer<typeof NotificationViewSchema>

/** Per-install UI preferences (plan B2): remembered choices that are not settings. `homeScope` is a chain id or 'all' (= every enabled chain). */
export const PrefsSchema = z.object({
  homeScope: z.union([z.literal('all'), z.number().int().positive()]),
  swapCoachDismissed: z.boolean(),
  chartDuration: z.enum(['1D', '1W', '1M', '1Y']),
  collectionsShowAll: z.boolean(),
})
export type Prefs = z.infer<typeof PrefsSchema>

/** What the inbound-transfer scan last did for an account (plan A2). */
export const ScanSummarySchema = z.object({
  accountId: AccountIdSchema,
  chainIds: z.array(z.number().int().positive()),
  added: z.number().int().nonnegative(),
  /** Chains whose scan failed this round. */
  problems: z.array(z.number().int().positive()),
  observedAt: z.number().int().nonnegative(),
})
export type ScanSummary = z.infer<typeof ScanSummarySchema>

export const CollectionViewSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  verified: z.boolean(),
  standard: z.enum(['ERC721', 'ERC1155', 'unknown']),
  totalSupply: z.number().nullable(),
  imageUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  creatorFee: z.object({ payoutAddress: z.string(), basisPoints: z.number().int() }).nullable(),
  floorEtn: Fiat,
  volume24hEtn: Fiat,
  totalVolumeEtn: Fiat,
  owners: z.number().nullable(),
  listed: z.number().nullable(),
  percentListed: Fiat,
  traits: z.array(z.object({ name: z.string(), values: z.array(z.string()) })),
  /** Electric Legends pay marketplace dividends (§8.10). */
  paysDividends: z.boolean(),
  starred: z.boolean(),
  /** How many the active account owns (Explore shows "you own 3"). */
  owned: z.number().int().nonnegative(),
})
export type CollectionView = z.infer<typeof CollectionViewSchema>

export const OrderViewSchema = z.object({
  type: z.enum(['LISTING', 'OFFER', 'BID']),
  status: z.enum(['VALID', 'EXECUTED', 'CANCELLED', 'EXPIRED', 'INVALID']),
  priceEtn: Fiat,
  /** Raw wei of the price where the parameters carried it. */
  priceRaw: z.string().nullable(),
  orderHash: z.string().nullable(),
  maker: z.string(),
  createdAt: z.number().nullable(),
  endAt: z.number().nullable(),
  /** True when the order can be fulfilled/cancelled from here (parameters + signature present). */
  actionable: z.boolean(),
})
export type OrderView = z.infer<typeof OrderViewSchema>

export const AssetViewSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  tokenId: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  imageUrl: z.string().nullable(),
  smallImageUrl: z.string().nullable(),
  animationUrl: z.string().nullable(),
  mediaType: z.enum(['IMAGE', 'VIDEO', 'AUDIO', 'RAW']).nullable(),
  owner: z.string().nullable(),
  /** The active account owns it (from the chain when the piece is opened). */
  mine: z.boolean(),
  standard: z.enum(['ERC721', 'ERC1155', 'unknown']),
  collectionName: z.string(),
  collectionVerified: z.boolean(),
  collectionImageUrl: z.string().nullable(),
  creatorFee: z.object({ payoutAddress: z.string(), basisPoints: z.number().int() }).nullable(),
  suspicious: z.boolean(),
  rarityRank: z.number().nullable(),
  traits: z.array(z.object({ name: z.string(), value: z.string(), rarity: z.number().nullable() })),
  lastPriceEtn: Fiat,
  listing: OrderViewSchema.nullable(),
  bestBid: OrderViewSchema.nullable(),
  bids: z.array(OrderViewSchema),
  /** Electric Legend: unclaimed dividends for this piece, wei string; null for other collections. */
  dividendsWei: z.string().nullable(),
  paysDividends: z.boolean(),
})
export type AssetView = z.infer<typeof AssetViewSchema>

export const InventorySchema = z.object({
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  assets: z.array(AssetViewSchema),
  collections: z.array(z.object({ address: z.string(), name: z.string(), logoUrl: z.string().nullable(), balance: z.number().int(), floorEtn: Fiat })),
  /** Sum of floors × counts, ETN, where floors exist. */
  floorValueEtn: Fiat,
  listedCount: z.number().int().nonnegative(),
  withOffersCount: z.number().int().nonnegative(),
  observedAt: z.number().int().nonnegative(),
})
export type Inventory = z.infer<typeof InventorySchema>

export const OffersInboxSchema = z.object({
  /** Offers on the account's pieces. */
  received: z.array(z.object({ asset: AssetViewSchema, offer: OrderViewSchema })),
  /** Offers the account made. */
  made: z.array(z.object({ address: z.string(), tokenId: z.string(), name: z.string(), imageUrl: z.string().nullable(), collectionName: z.string(), offer: OrderViewSchema, expiresAt: z.number() })),
  /** Total WETN the account's open offers commit, wei string. */
  obligationWei: z.string(),
  wetnBalanceWei: z.string(),
})
export type OffersInbox = z.infer<typeof OffersInboxSchema>

export const NftActivityViewSchema = z.object({
  address: z.string(),
  tokenId: z.string().nullable(),
  name: z.string().nullable(),
  imageUrl: z.string().nullable(),
  type: z.enum(['LISTING', 'SALE', 'CANCEL_LISTING', 'TRANSFER', 'BID', 'CANCEL_BID']),
  from: z.string(),
  to: z.string().nullable(),
  hash: z.string().nullable(),
  priceEtn: Fiat,
  timestamp: z.number(),
})
export type NftActivityView = z.infer<typeof NftActivityViewSchema>

export const LegendsStatusSchema = z.object({
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  collection: z.string(),
  distributor: z.string(),
  ownedTokenIds: z.array(z.string()),
  registeredTokenIds: z.array(z.string()),
  unregisteredTokenIds: z.array(z.string()),
  claimableWei: z.string(),
  /** The best single claim so far, for the vessel's level (§8.10). */
  bestClaimWei: z.string(),
  /** 0..1 */
  vesselLevel: z.number(),
  lifetimePaidWei: z.string(),
  activeTokenCount: z.number().int().nonnegative(),
  /** The account's share of the holders' third of the next fee, 0..1. */
  shareOfNextFee: z.number(),
  dividendsEnabled: z.boolean(),
  mint: z.object({ mintable: z.boolean(), priceWei: z.string(), mintableCount: z.number().int().nonnegative(), totalSupply: z.number().int().nonnegative() }).nullable(),
  observedAt: z.number().int().nonnegative(),
})
export type LegendsStatus = z.infer<typeof LegendsStatusSchema>

export const FarmViewSchema = z.object({
  chainId: z.number().int().positive(),
  id: z.number().int().nonnegative(),
  version: z.union([z.literal(2), z.literal(3)]),
  name: z.string(),
  poolAddr: z.string(),
  token0: z.string(),
  token1: z.string(),
  symbol0: z.string(),
  symbol1: z.string(),
  decimals0: z.number().int().nonnegative(),
  decimals1: z.number().int().nonnegative(),
  active: z.boolean(),
  tvlUsd: Fiat,
  baseApy: Fiat,
  thirdPartyApy: Fiat,
  thirdParty: z.object({ token: z.string(), symbol: z.string() }).nullable(),
  farmerCount: z.number().int().nonnegative(),
  /** The active account's position (chain read), or null. */
  position: z
    .object({
      liquidity: z.string(),
      shareOfFarm: z.number(),
      durationMultiplier: z.number().int(),
      boltMultiplier: z.number().int(),
      boltDeposited: z.string(),
      startingBlock: z.number().int().nonnegative(),
      blocksServed: z.number().int().nonnegative(),
      pendingRewards: z.string(),
      pendingThirdParty: z.string(),
      fees0: z.string(),
      fees1: z.string(),
      /** Estimated wall-clock dates (5 s blocks) at which the ring reaches 2.0× and 2.5×; null when reached. */
      at2x: z.number().nullable(),
      at25x: z.number().nullable(),
      nextStair: z.object({ bolt: z.string(), multiplier: z.number().int(), more: z.string() }).nullable(),
      /** Token amounts the position holds right now (for the withdraw preview). */
      amount0: z.string(),
      amount1: z.string(),
    })
    .nullable(),
})
export type FarmView = z.infer<typeof FarmViewSchema>

export const FarmDepositQuoteSchema = z.object({
  farmId: z.number().int().nonnegative(),
  amount0Raw: z.string(),
  amount1Raw: z.string(),
  boltRaw: z.string(),
  /** Which side is native ETN (goes in `value`), if any. */
  nativeSide: z.union([z.literal(0), z.literal(1)]).nullable(),
  liquidityAdded: z.string(),
  /** Duration multiplier before and after this deposit (the dilution plate). */
  multiplierBefore: z.number().int(),
  multiplierAfter: z.number().int(),
  boltStair: z.object({ total: z.string(), multiplier: z.number().int() }).nullable(),
  steps: z.array(SwapStepSchema),
  ok: z.boolean(),
  problems: z.array(z.string()),
})
export type FarmDepositQuote = z.infer<typeof FarmDepositQuoteSchema>

export const FarmWithdrawQuoteSchema = z.object({
  farmId: z.number().int().nonnegative(),
  liquidityRaw: z.string(),
  percent: z.number(),
  amount0Raw: z.string(),
  amount1Raw: z.string(),
  rewardsRaw: z.string(),
  thirdPartyRaw: z.string(),
  fees0Raw: z.string(),
  fees1Raw: z.string(),
  /** BOLT returned — only when everything is withdrawn. */
  boltReturnedRaw: z.string(),
  keepsMultiplier: z.boolean(),
  ok: z.boolean(),
  problems: z.array(z.string()),
})
export type FarmWithdrawQuote = z.infer<typeof FarmWithdrawQuoteSchema>

export const CampaignViewSchema = z.object({
  chainId: z.number().int().positive(),
  pool: z.string(),
  status: z.enum(['ACTIVE', 'LAUNCHED', 'FAILED', 'CANCELLED', 'PENDING']),
  phase: z.enum(['upcoming', 'live', 'awaiting_finalize', 'launched', 'failed', 'cancelled']),
  token: z.object({ name: z.string(), symbol: z.string(), decimals: z.number().int(), address: z.string().nullable() }),
  creator: z.string(),
  creatorName: z.string().nullable(),
  logoUrl: z.string().nullable(),
  bannerUrl: z.string().nullable(),
  description: z.string(),
  links: z.object({ website: z.string().nullable(), twitter: z.string().nullable(), discord: z.string().nullable(), telegram: z.string().nullable() }),
  starts: z.number(),
  ends: z.number(),
  raisedWei: z.string(),
  minEtnToLaunchWei: z.string(),
  maxContributionWei: z.string().nullable(),
  minContributionWei: z.string().nullable(),
  /** 0..1 of the launch target. */
  fill: z.number(),
  contributorCount: z.number().int().nonnegative(),
  affiliatePercent: z.number(),
  shareLink: z.string().nullable(),
  /** The account's side. */
  contributedWei: z.string(),
  claimed: z.boolean(),
  claimableTokensRaw: z.string(),
  referralClaimableWei: z.string(),
  keys: z.array(z.enum(['contribute', 'claim_tokens', 'claim_refund', 'claim_referral'])),
  starred: z.boolean(),
})
export type CampaignView = z.infer<typeof CampaignViewSchema>

export const WatchItemSchema = z.object({
  kind: z.enum(['token', 'collection', 'campaign']),
  chainId: z.number().int().positive(),
  address: z.string(),
  label: z.string(),
  /** Alert when the price/floor crosses this (USD for tokens, ETN for floors); null = no alert. */
  above: z.number().nullable(),
  below: z.number().nullable(),
  /** Campaigns: tell me when it goes live. */
  onLive: z.boolean(),
  addedAt: z.number().int().nonnegative(),
  lastValue: z.number().nullable(),
})
export type WatchItem = z.infer<typeof WatchItemSchema>

export const PositionsSchema = z.object({
  accountId: AccountIdSchema,
  chainId: z.number().int().positive(),
  farms: z.array(FarmViewSchema),
  legends: LegendsStatusSchema.nullable(),
  orders: z.array(LimitOrderViewSchema),
  campaigns: z.array(CampaignViewSchema),
  /** The one accessory Home shows for positions, if any: rewards to collect or dividends to claim. */
  accessory: z.object({ kind: z.enum(['collect', 'dividends', 'claim_tokens', 'claim_refund']), text: z.string(), target: z.string() }).nullable(),
  observedAt: z.number().int().nonnegative(),
})
export type Positions = z.infer<typeof PositionsSchema>

// ---- M7: bridge (§8.7) and chain preferences (§8.14 Networks) --------------------------------

export const BridgeRouteSchema = z.object({
  symbol: z.enum(['USDC', 'USDT']),
  fromChainId: z.number().int().positive(),
  toChainId: z.number().int().positive(),
  /** The token the user holds and bridges on the origin. */
  token: z.string(),
  router: z.string(),
  standard: z.enum(['synthetic', 'collateral']),
  decimals: z.number().int().nonnegative(),
  /** Verified on chain at boot; a mismatch disables the corridor (kill-switch). */
  verified: z.boolean(),
  reason: z.string().nullable(),
})
export type BridgeRoute = z.infer<typeof BridgeRouteSchema>

export const BridgeQuoteSchema = z.object({
  fromChainId: z.number().int().positive(),
  toChainId: z.number().int().positive(),
  symbol: z.enum(['USDC', 'USDT']),
  token: z.string(),
  decimals: z.number().int().nonnegative(),
  amountRaw: z.string(),
  balanceRaw: z.string(),
  recipient: z.string(),
  /** The interchain gas payment the router quotes, in origin native wei. */
  gasQuoteWei: z.string(),
  /** The origin transaction's own gas, in wei. */
  txFeeWei: z.string(),
  feeSymbol: z.string(),
  etaMinutes: z.number().int().positive(),
  steps: z.array(SwapStepSchema),
  /** Whether the recipient is a contract here and on the destination (null when the destination did not answer). */
  recipientCode: z.object({ origin: z.boolean(), destination: z.boolean().nullable() }),
  ok: z.boolean(),
  problems: z.array(z.string()),
})
export type BridgeQuote = z.infer<typeof BridgeQuoteSchema>

export const BridgeStatusSchema = z.object({
  id: z.string(),
  accountId: AccountIdSchema,
  fromChainId: z.number().int().positive(),
  toChainId: z.number().int().positive(),
  symbol: z.enum(['USDC', 'USDT']),
  amountRaw: z.string(),
  decimals: z.number().int().nonnegative(),
  recipient: z.string(),
  originHash: z.string(),
  messageId: z.string().nullable(),
  destinationHash: z.string().nullable(),
  state: z.enum(['pending', 'dispatched', 'delivered', 'failed', 'timeout']),
  startedAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
  /** Destination block the watcher scans from. */
  scanFrom: z.number().int().nonnegative().nullable(),
})
export type BridgeStatus = z.infer<typeof BridgeStatusSchema>

// ---- M8: hardware round trips (§2.7 S7) and remote sign (§6) ------------------------------------

export const KeystonePendingSchema = z.object({
  id: z.string(),
  /** The animated QR's frames (one for a small request). */
  frames: z.array(z.string()),
  kind: z.enum(['transaction', 'typed_transaction', 'personal_message', 'typed_data']),
  address: z.string(),
  path: z.string(),
  createdAt: z.number(),
})
export type KeystonePending = z.infer<typeof KeystonePendingSchema>

export const RemoteRequestSchema = z.object({
  id: z.string(),
  address: z.string(),
  chainId: z.number().int().nonnegative(),
  kind: z.enum(['transaction', 'message', 'typed_data']),
  /** The paired device that asked (incoming) or null (outgoing). */
  from: z.string().nullable(),
  at: z.number(),
  state: z.enum(['waiting', 'done', 'failed']),
})
export type RemoteRequest = z.infer<typeof RemoteRequestSchema>

// ---- M9: external dApp transports and WalletConnect (§5.3) ------------------------------------

export const DappSessionSchema = z.object({
  sessionId: z.string(),
  origin: z.string(),
  kind: z.enum(['webview', 'walletconnect']),
  verified: z.boolean(),
  openedAt: z.number(),
})
export type DappSession = z.infer<typeof DappSessionSchema>

export const WcProposalViewSchema = z.object({
  id: z.number(),
  name: z.string(),
  url: z.string(),
  icon: z.string().nullable(),
  origin: z.string(),
  verified: z.boolean(),
  requiredChains: z.array(z.string()),
  optionalChains: z.array(z.string()),
})
export type WcProposalView = z.infer<typeof WcProposalViewSchema>

export const WcSessionViewSchema = z.object({
  topic: z.string(),
  name: z.string(),
  url: z.string(),
  icon: z.string().nullable(),
  origin: z.string(),
  chains: z.array(z.number().int()),
  expiry: z.number(),
})
export type WcSessionView = z.infer<typeof WcSessionViewSchema>

// ---- M10: signed statics (§3.7) --------------------------------------------------------------

export const FlagsViewSchema = z.object({
  flags: FlagsSchema,
  fetchedAt: z.number().nullable(),
  /** This body is older than the signed minimum: the shell blocks with an update plate. */
  updateRequired: z.boolean(),
  minVersion: z.string().nullable(),
  problem: z.string().nullable(),
  scamOriginsCount: z.number().int().nonnegative(),
})
export type FlagsView = z.infer<typeof FlagsViewSchema>

/** What this build is pointed at and which optional surfaces it carries — read by About and by screens that hide a surface. */
export const AboutViewSchema = z.object({
  /** The ElectroSwap API origin every GraphQL/REST call goes to. */
  apiOrigin: z.string(),
  /** False when a development build points the API somewhere other than ElectroSwap's servers. */
  apiIsDefault: z.boolean(),
  features: z.object({ limitOrders: z.boolean() }),
})
export type AboutView = z.infer<typeof AboutViewSchema>

export const EngineEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('swap.progress'), flow: SwapFlowSchema }),
  z.object({ type: z.literal('positions.changed'), positions: PositionsSchema }),
  z.object({ type: z.literal('bridge.changed'), transfers: z.array(BridgeStatusSchema) }),
  z.object({ type: z.literal('hardware.keystone'), pending: z.array(KeystonePendingSchema) }),
  z.object({ type: z.literal('dapp.event'), sessionId: z.string(), origin: z.string(), event: z.string(), payload: z.unknown() }),
  z.object({ type: z.literal('connect.changed'), proposals: z.array(WcProposalViewSchema), sessions: z.array(WcSessionViewSchema) }),
  z.object({ type: z.literal('flags.changed'), flags: FlagsViewSchema }),
  z.object({ type: z.literal('remote.changed'), outgoing: z.array(RemoteRequestSchema), incoming: z.array(RemoteRequestSchema) }),
  z.object({ type: z.literal('watchlist.changed'), items: z.array(WatchItemSchema) }),
  z.object({ type: z.literal('limit.changed'), accountId: AccountIdSchema, chainId: z.number().int().positive(), orders: z.array(LimitOrderViewSchema) }),
  z.object({ type: z.literal('tokens.changed'), chainId: z.number().int().positive() }),
  z.object({ type: z.literal('allowances.changed'), accountId: AccountIdSchema, chainId: z.number().int().positive(), rows: z.array(AllowanceViewSchema) }),
  z.object({ type: z.literal('contacts.changed'), contacts: z.array(ContactViewSchema) }),
  z.object({ type: z.literal('portfolio.snapshot'), snapshot: PortfolioSnapshotSchema }),
  z.object({ type: z.literal('activity.changed'), entries: z.array(ActivityEntrySchema) }),
  z.object({ type: z.literal('sync.changed'), status: SyncStatusSchema }),
  z.object({ type: z.literal('vault.status'), status: VaultStatusSchema }),
  z.object({ type: z.literal('accounts.changed'), accounts: z.array(AccountViewSchema), activeId: AccountIdSchema.nullable() }),
  z.object({ type: z.literal('sites.changed'), sites: z.array(SiteViewSchema) }),
  z.object({ type: z.literal('chains.head'), head: ChainHeadSchema }),
  z.object({ type: z.literal('approvals.changed'), pending: z.array(ApprovalRequestSchema) }),
  z.object({ type: z.literal('settings.changed'), settings: SettingsSchema }),
  /** A cached resource was written or dropped; pages re-read `cached…()` for that key (the value never rides the event). */
  z.object({ type: z.literal('cache.changed'), key: z.string(), observedAt: z.number().int().nonnegative() }),
  z.object({ type: z.literal('notifications.changed'), unread: z.number().int().nonnegative() }),
  z.object({ type: z.literal('prefs.changed'), prefs: PrefsSchema }),
])
export type EngineEvent = z.infer<typeof EngineEventSchema>
