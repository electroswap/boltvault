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
  /** Hardware accounts: derivation path and paired device. */
  hardware: z.object({ path: z.string(), deviceId: z.string().optional() }).optional(),
  /** True when the engine can sign for this account without a device. */
  hasKey: z.boolean(),
  hidden: z.boolean(),
  order: z.number().int().nonnegative(),
  createdAt: z.number().int().nonnegative(),
})
export type AccountView = z.infer<typeof AccountViewSchema>

export const AutoLockSchema = z.enum(['immediately', '1min', '5min', '30min', 'never'])
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

export const EngineEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('portfolio.snapshot'), snapshot: PortfolioSnapshotSchema }),
  z.object({ type: z.literal('activity.changed'), entries: z.array(ActivityEntrySchema) }),
  z.object({ type: z.literal('sync.changed'), status: SyncStatusSchema }),
  z.object({ type: z.literal('vault.status'), status: VaultStatusSchema }),
  z.object({ type: z.literal('accounts.changed'), accounts: z.array(AccountViewSchema), activeId: AccountIdSchema.nullable() }),
  z.object({ type: z.literal('sites.changed'), sites: z.array(SiteViewSchema) }),
  z.object({ type: z.literal('chains.head'), head: ChainHeadSchema }),
  z.object({ type: z.literal('approvals.changed'), pending: z.array(ApprovalRequestSchema) }),
  z.object({ type: z.literal('settings.changed'), settings: SettingsSchema }),
])
export type EngineEvent = z.infer<typeof EngineEventSchema>
