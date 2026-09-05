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
  /** True when the engine can sign for this account without a device. */
  hasKey: z.boolean(),
  hidden: z.boolean(),
  createdAt: z.number().int().nonnegative(),
})
export type AccountView = z.infer<typeof AccountViewSchema>

export const AutoLockSchema = z.enum(['immediately', '1min', '5min', '30min', 'never'])
export type AutoLock = z.infer<typeof AutoLockSchema>

export const VaultStatusSchema = z.object({
  /** A vault file exists (the user has onboarded). */
  exists: z.boolean(),
  unlocked: z.boolean(),
  unlockedAt: z.number().int().nullable(),
  /** When the auto-lock alarm will fire, or null when never/locked. */
  lockAt: z.number().int().nullable(),
  autoLock: AutoLockSchema,
})
export type VaultStatus = z.infer<typeof VaultStatusSchema>

export const SiteViewSchema = z.object({
  origin: z.string().url().or(z.string().min(1)),
  chainId: z.number().int().positive(),
  accountId: AccountIdSchema.nullable(),
  connected: z.boolean(),
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
})
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>

export const ApprovalDecisionSchema = z.object({
  id: z.string().regex(/^[0-9a-f]{32}$/),
  approve: z.boolean(),
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

export const EngineEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('vault.status'), status: VaultStatusSchema }),
  z.object({ type: z.literal('accounts.changed'), accounts: z.array(AccountViewSchema), activeId: AccountIdSchema.nullable() }),
  z.object({ type: z.literal('sites.changed'), sites: z.array(SiteViewSchema) }),
  z.object({ type: z.literal('chains.head'), head: ChainHeadSchema }),
  z.object({ type: z.literal('approvals.changed'), pending: z.array(ApprovalRequestSchema) }),
  z.object({ type: z.literal('settings.changed'), settings: SettingsSchema }),
])
export type EngineEvent = z.infer<typeof EngineEventSchema>
