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
import type { DeviceIdentity } from '@boltvault/core'
import type { CustomToken } from '@boltvault/token-catalog'
import { z } from 'zod'
import {
  AllowanceViewSchema,
  BridgeStatusSchema,
  NotificationViewSchema,
  PortfolioSnapshotSchema,
  PositionsSchema,
  ScanSummarySchema,
  WatchItemSchema,
  type AllowanceView,
  type BridgeStatus,
  type NotificationView,
  type PortfolioSnapshot,
  type Positions,
  type ScanSummary,
  type WatchItem,
} from './schema'
import { PairedDeviceRowSchema, type PairedDeviceRow } from './namespaces/sync'
import { CustomTokenSchema } from './namespaces/tokens'
import { SiteSchema } from './namespaces/sites'
import {
  CustomCollectionSchema,
  NftMetadataSchema,
  type CustomCollection,
  type NftMetadata,
} from './namespaces/nftCustom'
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
  /** Last-good portfolio snapshot, by `<accountId>:<sorted chain ids>`. */
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
  readonly watchlist: SealedMap<{ items: WatchItem[]; nudgedAt: Record<string, number> }>
  /** Pinned/hidden tokens and user-added tokens — what the user is interested in. */
  readonly tokenPrefs: SealedMap<{ pinned: string[]; hidden: string[] }>
  readonly tokensCustom: SealedMap<CustomToken[]>
  /** Custom collections per chain, and NFT metadata per `<chain>.<address>.<tokenId>`. */
  readonly nftCustom: SealedMap<CustomCollection[]>
  readonly nftMeta: SealedMap<NftMetadata | null>
  /** This device's ed25519 sync identity — a private key (one entry, id `me`). */
  readonly syncIdentity: SealedMap<DeviceIdentity>
  /** Paired devices, each carrying an E2E channel key (one entry, id `all`). */
  readonly syncDevices: SealedMap<PairedDeviceRow[]>
  /**
   * This device's label, and the last applied sequence per pairing. The
   * pairing id is the relay's only credential (§9.5 — "no auth beyond
   * possession of a random 256-bit id"), so the map's *keys* are secrets.
   */
  readonly syncMeta: SealedMap<{ label: string | null; applied: Record<string, number> }>
  /**
   * `topic → { origin, verified }` for live WalletConnect sessions (§5.3).
   *
   * A restored session used to be re-keyed to a synthetic
   * `<topic>.walletconnect.invalid` origin, which orphaned the real site row
   * and put `ORIGIN_UNVERIFIED` on every signature it made afterwards — on
   * every restart, for every live session. What Verify said at pairing is
   * written down instead. Sealed because it names the sites this wallet is
   * connected to.
   */
  readonly wcSessions: SealedMap<{ origin: string; verified: boolean }>
  /**
   * Drop every entry belonging to one account. Removing an account used to
   * leave its portfolio, positions, allowances, scan cursors and site rows
   * behind forever — orphaned, unreachable from the UI, and still on disk.
   */
  purgeAccount(accountId: string): Promise<void>
  /** Forget every decrypted blob on lock. */
  forget(): void
}

const AllowanceRowsSchema = z.object({
  rows: z.array(AllowanceViewSchema),
  at: z.number().int().nonnegative(),
}) as unknown as z.ZodType<{ rows: AllowanceView[]; at: number }>

const BridgeItemsSchema = z.object({ items: z.array(BridgeStatusSchema) }) as unknown as z.ZodType<{
  items: BridgeStatus[]
}>
const BlockSchema = z.object({ block: z.number().int().nonnegative() }) as unknown as z.ZodType<{
  block: number
}>
const ActiveSchema = z.object({ id: z.string().nullable() }) as unknown as z.ZodType<{
  id: string | null
}>

const WcSessionSchema = z.object({
  origin: z.string(),
  verified: z.boolean(),
}) as unknown as z.ZodType<{ origin: string; verified: boolean }>

export function createSealedStores(
  platform: Platform,
  dek: () => Promise<Uint8Array>,
): SealedStores {
  const wcSessions = new SealedMap<{ origin: string; verified: boolean }>(platform, dek, {
    key: 'wc-sessions.blob',
    info: 'bv/wc-sessions',
    aad: 'boltvault.wc-sessions.v1',
    schema: WcSessionSchema,
    // A person does not hold dozens of live WalletConnect sessions; the cap is
    // there so a peer that re-pairs in a loop cannot grow the blob.
    cap: 32,
  })
  const portfolio = new SealedMap<PortfolioSnapshot>(platform, dek, {
    key: 'portfolio.blob',
    info: 'bv/portfolio',
    aad: 'boltvault.portfolio.v1',
    schema: PortfolioSnapshotSchema,
    // One entry per account *and* chain scope now (a snapshot is only true of
    // the chains it was built from), so this is no longer one row per account.
    // The working set is the scopes actually visited; the cap keeps a user who
    // tours every chain on every account from growing the blob without end.
    cap: 32,
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
    schema: z.object({ referrer: z.string(), at: z.number() }) as unknown as z.ZodType<{
      referrer: string
      at: number
    }>,
  })
  const watchlist = new SealedMap<{ items: WatchItem[]; nudgedAt: Record<string, number> }>(
    platform,
    dek,
    {
      key: 'watchlist.blob',
      info: 'bv/watchlist',
      aad: 'boltvault.watchlist.v1',
      schema: z.object({
        items: z.array(WatchItemSchema),
        nudgedAt: z.record(z.string(), z.number()),
      }) as unknown as z.ZodType<{
        items: WatchItem[]
        nudgedAt: Record<string, number>
      }>,
    },
  )
  const tokenPrefs = new SealedMap<{ pinned: string[]; hidden: string[] }>(platform, dek, {
    key: 'tokens.prefs.blob',
    info: 'bv/tokens/prefs',
    aad: 'boltvault.tokens.prefs.v1',
    schema: z.object({
      pinned: z.array(z.string()),
      hidden: z.array(z.string()),
    }) as unknown as z.ZodType<{ pinned: string[]; hidden: string[] }>,
  })
  const tokensCustom = new SealedMap<CustomToken[]>(platform, dek, {
    key: 'tokens.custom.blob',
    info: 'bv/tokens/custom',
    aad: 'boltvault.tokens.custom.v1',
    schema: z.array(CustomTokenSchema) as unknown as z.ZodType<CustomToken[]>,
  })
  const nftCustom = new SealedMap<CustomCollection[]>(platform, dek, {
    key: 'nft.custom.blob',
    info: 'bv/nft/custom',
    aad: 'boltvault.nft.custom.v1',
    schema: z.array(CustomCollectionSchema),
  })
  const nftMeta = new SealedMap<NftMetadata | null>(platform, dek, {
    key: 'nft.meta.blob',
    info: 'bv/nft/meta',
    aad: 'boltvault.nft.meta.v1',
    schema: NftMetadataSchema.nullable(),
    cap: 512,
  })
  const syncIdentity = new SealedMap<DeviceIdentity>(platform, dek, {
    key: 'sync.identity.blob',
    info: 'bv/sync/identity',
    aad: 'boltvault.sync.identity.v1',
    schema: z.object({
      deviceId: z.string(),
      signingPrivateKey: z.string(),
      signingPublicKey: z.string(),
    }) as unknown as z.ZodType<DeviceIdentity>,
  })
  const syncDevices = new SealedMap<PairedDeviceRow[]>(platform, dek, {
    key: 'sync.devices.blob',
    info: 'bv/sync/devices',
    aad: 'boltvault.sync.devices.v1',
    schema: z.array(PairedDeviceRowSchema) as unknown as z.ZodType<PairedDeviceRow[]>,
  })
  const syncMeta = new SealedMap<{ label: string | null; applied: Record<string, number> }>(
    platform,
    dek,
    {
      key: 'sync.meta.blob',
      info: 'bv/sync/meta',
      aad: 'boltvault.sync.meta.v1',
      schema: z.object({
        label: z.string().nullable(),
        applied: z.record(z.string(), z.number()),
      }) as unknown as z.ZodType<{
        label: string | null
        applied: Record<string, number>
      }>,
    },
  )
  const all = [
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
    syncIdentity,
    syncDevices,
    syncMeta,
    wcSessions,
  ]
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
    syncIdentity,
    syncMeta,
    syncDevices,
    wcSessions,
    purgeAccount: async (accountId: string) => {
      const needle = accountId.toLowerCase()
      const names = (id: string): boolean => id.toLowerCase().includes(needle)
      await portfolio.deleteWhere(names)
      await looks.delete(accountId)
      await allowances.deleteWhere(names)
      await positions.deleteWhere(names)
      await scan.deleteWhere(names)
      await scanSummary.deleteWhere(names)
      // A site row is keyed by origin, so it must be matched on its value.
      for (const [origin, row] of Object.entries(await sites.entries())) {
        if (row.accountId === accountId) await sites.delete(origin)
      }
      const wl = await watchlist.get('all')
      if (wl) {
        const nudgedAt = Object.fromEntries(Object.entries(wl.nudgedAt).filter(([k]) => !names(k)))
        await watchlist.set('all', { items: wl.items, nudgedAt })
      }
    },
    forget: () => {
      for (const s of all) s.forget()
    },
  }
}
