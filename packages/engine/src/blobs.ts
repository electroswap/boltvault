/**
 * Every DEK-sealed blob the engine keeps, built in one place.
 *
 * The at-rest audit (2026-09-06) found the wallet's whole financial picture in
 * `chrome.storage.local` as plaintext JSON, readable with the vault locked: USD
 * totals and per-token quantities per account, token approvals, farm and
 * launchpad positions, NFT inventories, and the addresses handed to each
 * connected dApp. Master plan §3.2 promises the opposite — "a stolen
 * `chrome.storage.local` reveals nothing but ciphertext and the vault id" — so
 * each family moves into a `SealedMap`.
 *
 * Each blob gets its own HKDF info and AAD so a blob cannot be replayed into
 * another's slot. The id inside a blob may name an account; the *storage key*
 * never does.
 */
import type { Platform } from '@boltvault/platform'
import type { ConnectedSite } from '@boltvault/protocol'
import { z } from 'zod'
import {
  AllowanceViewSchema,
  BridgeStatusSchema,
  NotificationViewSchema,
  PortfolioSnapshotSchema,
  PositionsSchema,
  ScanSummarySchema,
  type AllowanceView,
  type BridgeStatus,
  type NotificationView,
  type PortfolioSnapshot,
  type Positions,
  type ScanSummary,
} from './schema'
import { SiteSchema } from './namespaces/sites'
import { SealedMap } from './sealed'

/** "Since you last looked" — the total at the previous first open. */
export interface LastLook {
  readonly at: number
  readonly total: number | null
}

const LastLookSchema = z.object({
  at: z.number().int().nonnegative(),
  total: z.number().nullable(),
}) as unknown as z.ZodType<LastLook>

export interface SealedStores {
  /** Last-good portfolio snapshot, by account id. */
  readonly portfolio: SealedMap<PortfolioSnapshot>
  /** "Since you last looked", by account id. */
  readonly looks: SealedMap<LastLook>
  /** Token approvals, by `<accountId>.<chainId>`. */
  readonly allowances: SealedMap<{ rows: AllowanceView[]; at: number }>
  /** Farm/legends/orders/campaign positions, by `<chainId>.<accountId>`. */
  readonly positions: SealedMap<Positions>
  /** Log-scan cursors, by `<accountId>.<chainId>`. */
  readonly scan: SealedMap<{ block: number }>
  /** Scan summaries, by account id. */
  readonly scanSummary: SealedMap<ScanSummary>
  /** In-flight and settled bridge transfers (one entry, id `all`). */
  readonly bridge: SealedMap<{ items: BridgeStatus[] }>
  /** The notification inbox (one entry, id `all`). */
  readonly notifications: SealedMap<NotificationView[]>
  /** Per-origin dApp sessions — the account id and the addresses it was shown. */
  readonly sites: SealedMap<ConnectedSite>
  /** The active account id (one entry, id `active`). */
  readonly active: SealedMap<{ id: string | null }>
  /**
   * Best-seen Legends claim, by `<chainId>.<address>`. The old storage key was
   * `legends.bestClaim.<chainId>.<address>` — the one key that put a raw EVM
   * address in the key space, where sealing the value could not reach it.
   */
  readonly legends: SealedMap<{ wei: string }>
  /** Launchpad referrer per `<chainId>.<pool>` — a referrer address and a timestamp. */
  readonly launchpadRef: SealedMap<{ referrer: string; at: number }>
  /** Watchlist items and nudge state (one entry, id `all`); nudge keys name accounts. */
  readonly watchlist: SealedMap<{ items: unknown[]; nudgedAt: Record<string, number> }>
  /** Pinned/hidden tokens and user-added tokens — what the user is interested in. */
  readonly tokenPrefs: SealedMap<{ pinned: string[]; hidden: string[] }>
  readonly tokensCustom: SealedMap<unknown[]>
  /** Custom collections per chain, and NFT metadata per `<chain>.<address>.<tokenId>`. */
  readonly nftCustom: SealedMap<unknown[]>
  readonly nftMeta: SealedMap<unknown>
  /** Forget every decrypted blob on lock. */
  forget(): void
}

const AllowanceRowsSchema = z.object({
  rows: z.array(AllowanceViewSchema),
  at: z.number().int().nonnegative(),
}) as unknown as z.ZodType<{ rows: AllowanceView[]; at: number }>

const BridgeItemsSchema = z.object({ items: z.array(BridgeStatusSchema) }) as unknown as z.ZodType<{ items: BridgeStatus[] }>
const BlockSchema = z.object({ block: z.number().int().nonnegative() }) as unknown as z.ZodType<{ block: number }>
const ActiveSchema = z.object({ id: z.string().nullable() }) as unknown as z.ZodType<{ id: string | null }>

export function createSealedStores(platform: Platform, dek: () => Promise<Uint8Array>): SealedStores {
  const portfolio = new SealedMap<PortfolioSnapshot>(platform, dek, {
    key: 'portfolio.blob',
    info: 'bv/portfolio',
    aad: 'boltvault.portfolio.v1',
    schema: PortfolioSnapshotSchema,
  })
  const looks = new SealedMap<LastLook>(platform, dek, {
    key: 'portfolio.look.blob',
    info: 'bv/portfolio/look',
    aad: 'boltvault.portfolio.look.v1',
    schema: LastLookSchema,
  })
  const allowances = new SealedMap<{ rows: AllowanceView[]; at: number }>(platform, dek, {
    key: 'allowances.blob',
    info: 'bv/allowances',
    aad: 'boltvault.allowances.v1',
    schema: AllowanceRowsSchema,
  })
  const positions = new SealedMap<Positions>(platform, dek, {
    key: 'positions.blob',
    info: 'bv/positions',
    aad: 'boltvault.positions.v1',
    schema: PositionsSchema,
  })
  const scan = new SealedMap<{ block: number }>(platform, dek, {
    key: 'activity.scan.blob',
    info: 'bv/activity/scan',
    aad: 'boltvault.activity.scan.v1',
    schema: BlockSchema,
  })
  const scanSummary = new SealedMap<ScanSummary>(platform, dek, {
    key: 'activity.scan.summary.blob',
    info: 'bv/activity/scan/summary',
    aad: 'boltvault.activity.scan.summary.v1',
    schema: ScanSummarySchema,
  })
  const bridge = new SealedMap<{ items: BridgeStatus[] }>(platform, dek, {
    key: 'bridge.blob',
    info: 'bv/bridge',
    aad: 'boltvault.bridge.v1',
    schema: BridgeItemsSchema,
  })
  const notifications = new SealedMap<NotificationView[]>(platform, dek, {
    key: 'notifications.blob',
    info: 'bv/notifications',
    aad: 'boltvault.notifications.v1',
    schema: z.array(NotificationViewSchema),
    // A background alarm can push an inbox entry while locked; dropping it is
    // better than throwing out of the alarm handler.
    whenLocked: 'skip',
  })
  const sites = new SealedMap<ConnectedSite>(platform, dek, {
    key: 'sites.blob',
    info: 'bv/sites',
    aad: 'boltvault.sites.v1',
    schema: SiteSchema as unknown as z.ZodType<ConnectedSite>,
    whenLocked: 'skip',
  })
  const active = new SealedMap<{ id: string | null }>(platform, dek, {
    key: 'accounts.active.blob',
    info: 'bv/accounts/active',
    aad: 'boltvault.accounts.active.v1',
    schema: ActiveSchema,
  })
  const legends = new SealedMap<{ wei: string }>(platform, dek, {
    key: 'legends.blob',
    info: 'bv/legends',
    aad: 'boltvault.legends.v1',
    schema: z.object({ wei: z.string() }) as unknown as z.ZodType<{ wei: string }>,
  })
  const launchpadRef = new SealedMap<{ referrer: string; at: number }>(platform, dek, {
    key: 'launchpad.ref.blob',
    info: 'bv/launchpad/ref',
    aad: 'boltvault.launchpad.ref.v1',
    schema: z.object({ referrer: z.string(), at: z.number() }) as unknown as z.ZodType<{ referrer: string; at: number }>,
  })
  const watchlist = new SealedMap<{ items: unknown[]; nudgedAt: Record<string, number> }>(platform, dek, {
    key: 'watchlist.blob',
    info: 'bv/watchlist',
    aad: 'boltvault.watchlist.v1',
    schema: z.object({ items: z.array(z.unknown()), nudgedAt: z.record(z.string(), z.number()) }) as unknown as z.ZodType<{
      items: unknown[]
      nudgedAt: Record<string, number>
    }>,
  })
  const tokenPrefs = new SealedMap<{ pinned: string[]; hidden: string[] }>(platform, dek, {
    key: 'tokens.prefs.blob',
    info: 'bv/tokens/prefs',
    aad: 'boltvault.tokens.prefs.v1',
    schema: z.object({ pinned: z.array(z.string()), hidden: z.array(z.string()) }) as unknown as z.ZodType<{ pinned: string[]; hidden: string[] }>,
  })
  const tokensCustom = new SealedMap<unknown[]>(platform, dek, {
    key: 'tokens.custom.blob',
    info: 'bv/tokens/custom',
    aad: 'boltvault.tokens.custom.v1',
    schema: z.array(z.unknown()),
  })
  const nftCustom = new SealedMap<unknown[]>(platform, dek, {
    key: 'nft.custom.blob',
    info: 'bv/nft/custom',
    aad: 'boltvault.nft.custom.v1',
    schema: z.array(z.unknown()),
  })
  const nftMeta = new SealedMap<unknown>(platform, dek, {
    key: 'nft.meta.blob',
    info: 'bv/nft/meta',
    aad: 'boltvault.nft.meta.v1',
    schema: z.unknown(),
    cap: 512,
  })
  const all = [portfolio, looks, allowances, positions, scan, scanSummary, bridge, notifications, sites, active, legends, launchpadRef, watchlist, tokenPrefs, tokensCustom, nftCustom, nftMeta]
  return {
    portfolio,
    looks,
    allowances,
    positions,
    scan,
    scanSummary,
    bridge,
    notifications,
    sites,
    active,
    legends,
    launchpadRef,
    watchlist,
    tokenPrefs,
    tokensCustom,
    nftCustom,
    nftMeta,
    forget: () => {
      for (const s of all) s.forget()
    },
  }
}
