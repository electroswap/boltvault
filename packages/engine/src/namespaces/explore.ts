/**
 * Explore (master plan §8.11): the ElectroSwap market inside the wallet —
 * tokens by volume, collections, campaigns, farms, and one search across all
 * of it. Display data from the API, persisted last-good and served stale
 * first (plan A2), refreshed after 60 s; the chain stays the quantity source
 * everywhere else.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { fetchCollectionBalances, fetchCollections, fetchPriceHistory, fetchTokenDetail, fetchTopCollections, fetchTopTokens, type CollectionView as EsCollection, type ElectroSwapClient, type HistoryDuration } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { cacheKey, type Cached, type DocCache } from '../cache'
import type { EventBus, NamespaceSpec } from '../host'
import { CollectionWindowSchema, type CollectionWindow, AccountIdSchema, ChartDurationSchema, CollectionViewSchema, ExploreTokenSchema, LiquidityViewSchema, PriceHistoryViewSchema, TokenDetailViewSchema, type ChartDuration, type CollectionView, type ExploreToken, type LiquidityView, type PriceHistoryView, type TokenDetailView } from '../schema'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'
import type { WatchlistService } from './watchlist'
import type { CustomCollectionsService } from './nftCustom'
import type { LegendsService } from './legends'

export interface ExploreDeps {
  readonly platform: Platform
  readonly electroswap: ElectroSwapClient | null
  readonly tokens: TokensService
  readonly vault: VaultManager
  readonly watchlist: WatchlistService
  readonly cache: DocCache
  readonly bus?: EventBus
  readonly custom?: CustomCollectionsService
  readonly legends?: LegendsService
}

const TTL_MS = 60_000
const DETAIL_TTL_MS = 60_000
const TOKENS_SPEC = (chainId: number) => ({ key: cacheKey('explore', 'tokens', chainId), schema: z.array(ExploreTokenSchema) })
const COLLECTIONS_SPEC = (chainId: number, accountId: string | undefined, all: boolean, window: CollectionWindow) => ({ key: cacheKey('explore', 'collections', chainId, accountId ?? '-', all ? 'all' : 'verified', window), schema: z.array(CollectionViewSchema) })
const DETAIL_SPEC = (chainId: number, address: string) => ({ key: cacheKey('explore', 'tokendetail', chainId, address), schema: TokenDetailViewSchema })
const HISTORY_TTL_MS = 5 * 60_000
const HISTORY_SPEC = (chainId: number, address: string, duration: ChartDuration) => ({ key: cacheKey('explore', 'history', chainId, address, duration), schema: PriceHistoryViewSchema })
const API_DURATION: Record<ChartDuration, HistoryDuration> = { '1D': 'DAY', '1W': 'WEEK', '1M': 'MONTH', '1Y': 'YEAR' }
const LIQUIDITY_TTL_MS = 10 * 60_000
const LIQUIDITY_SPEC = (chainId: number, address: string) => ({ key: cacheKey('explore', 'liquidity', chainId, address), schema: LiquidityViewSchema })
const isEtn = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420

export class ExploreService {
  /** The raw API rows behind `collections`, for `collection()` to reuse within a session. */
  private collectionRows = new Map<number, EsCollection[]>()

  constructor(private readonly deps: ExploreDeps) {
    // A pin is applied at serve time, so a pin change is a cache change for the token list (pages re-read).
    deps.bus?.subscribe((e) => {
      if (e.type === 'tokens.changed') deps.bus?.emit({ type: 'cache.changed', key: cacheKey('explore', 'tokens', e.chainId), observedAt: deps.platform.now() })
    })
  }

  get available(): boolean {
    return this.deps.electroswap !== null
  }

  /** Explore › Tokens. Empty (never a throw) when the API is not reachable; the screen says so. */
  async tokens(chainId: number): Promise<ExploreToken[]> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return []
    const client = d.electroswap
    try {
      const hit = await d.cache.through(TOKENS_SPEC(chainId), TTL_MS, async () => {
        const rows = await fetchTopTokens(client, chainId)
        const universe = await d.tokens.universe(chainId)
        return rows
          .filter((r) => !r.spam)
          .map((r): ExploreToken => {
            const u = universe.find((x) => x.address.toLowerCase() === r.address.toLowerCase())
            return { chainId, address: r.address, symbol: r.symbol, name: r.name, decimals: r.decimals, logoUri: u?.logoUri ?? r.logoUrl, price: r.price, change24h: r.change24h, change7d: r.change7d, volume24h: r.volume24h, tvl: r.tvl, marketCap: r.marketCap, safety: r.safety, pinned: false }
          })
      })
      return this.withPins(chainId, hit.value)
    } catch {
      return []
    }
  }

  /** The last-good token list at once, or null when nothing was ever fetched. */
  async cachedTokens(chainId: number): Promise<Cached<ExploreToken[]> | null> {
    const hit = await this.deps.cache.read(TOKENS_SPEC(chainId))
    return hit ? { ...hit, value: await this.withPins(chainId, hit.value) } : null
  }

  /** Pins are read at serve time (`tokens.prefs`), so a cached list never shows a stale star. */
  private async withPins(chainId: number, rows: ExploreToken[]): Promise<ExploreToken[]> {
    const pinned = new Set((await this.deps.tokens.prefs()).pinned)
    return rows.map((r) => ({ ...r, pinned: pinned.has(`${chainId}:${r.address.toLowerCase()}`) }))
  }

  async tokenDetail(chainId: number, address: string): Promise<TokenDetailView | null> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return null
    const client = d.electroswap
    try {
      return (await d.cache.through(DETAIL_SPEC(chainId, address), DETAIL_TTL_MS, async () => {
        const v = await fetchTokenDetail(client, chainId, address === 'native' ? 'NATIVE' : address)
        if (!v) throw new Error('no such token')
        return { ...v, sparkline: [...v.sparkline] }
      })).value
    } catch {
      return null
    }
  }

  async cachedTokenDetail(chainId: number, address: string): Promise<Cached<TokenDetailView> | null> {
    return this.deps.cache.read(DETAIL_SPEC(chainId, address))
  }

  /** One timeframe of price history (plan B5), five minutes stale-first, per duration. */
  async priceHistory(chainId: number, address: string, duration: ChartDuration): Promise<PriceHistoryView | null> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return null
    const client = d.electroswap
    try {
      return (
        await d.cache.through(HISTORY_SPEC(chainId, address, duration), HISTORY_TTL_MS, async () => {
          const h = await fetchPriceHistory(client, chainId, address === 'native' ? 'NATIVE' : address, API_DURATION[duration])
          if (!h) throw new Error('no market')
          return { chainId, address, duration, points: [...h.points], high: h.high, low: h.low }
        })
      ).value
    } catch {
      return null
    }
  }

  async cachedPriceHistory(chainId: number, address: string, duration: ChartDuration): Promise<Cached<PriceHistoryView> | null> {
    return this.deps.cache.read(HISTORY_SPEC(chainId, address, duration))
  }

  /** Locked liquidity (plan B4): ETN itself has no pool, so the native side reads as WETN. Ten minutes stale-first. */
  async liquidity(chainId: number, address: string): Promise<LiquidityView | null> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return null
    const client = d.electroswap
    const target = address === 'native' ? ELECTRONEUM_ADDRESSES[chainId].wetn : address
    try {
      return (
        await d.cache.through(LIQUIDITY_SPEC(chainId, address), LIQUIDITY_TTL_MS, async () => {
          const r = await client.liquidityLocks(chainId, target)
          return { chainId, address, lockedPct: Math.min(100, Math.max(0, r.totalPercent)), lockCount: r.locks.length }
        })
      ).value
    } catch {
      return null
    }
  }

  async cachedLiquidity(chainId: number, address: string): Promise<Cached<LiquidityView> | null> {
    return this.deps.cache.read(LIQUIDITY_SPEC(chainId, address))
  }

  /** Explore › Collections (§8.10; owner ask 2026-09-06): verified collections by default, ranked by the window's volume — the whole index with `all`; the user's custom collections join either way. */
  async collections(chainId: number, accountId?: string, all = false, window: CollectionWindow = 'DAY'): Promise<CollectionView[]> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return []
    const client = d.electroswap
    try {
      return (await d.cache.through(COLLECTIONS_SPEC(chainId, accountId, all, window), TTL_MS, async () => {
        const rows = await fetchTopCollections(client, chainId, 50, false, window)
        this.collectionRows.set(chainId, [...(this.collectionRows.get(chainId) ?? []).filter((r) => !rows.some((x) => x.address.toLowerCase() === r.address.toLowerCase())), ...rows])
        const owned = new Map<string, number>()
        if (accountId) {
          const account = (await d.vault.accounts()).find((a) => a.id === accountId)
          if (account) {
            try {
              for (const c of await fetchCollectionBalances(client, chainId, account.address)) owned.set(c.address.toLowerCase(), c.balance)
            } catch {
              // no balances → 0
            }
          }
        }
        const views = this.toViews(chainId, rows, owned).filter((v) => all || v.verified)
        const customs = await this.customViews(chainId)
        return [...views.filter((v) => !customs.some((c) => c.address.toLowerCase() === v.address.toLowerCase())), ...customs]
      })).value
    } catch {
      return []
    }
  }

  async cachedCollections(chainId: number, accountId?: string, all = false, window: CollectionWindow = 'DAY'): Promise<Cached<CollectionView[]> | null> {
    return this.deps.cache.read(COLLECTIONS_SPEC(chainId, accountId, all, window))
  }

  /** The user's own collections as views (plan A3): what the chain told us, no market fields. */
  private async customViews(chainId: number): Promise<CollectionView[]> {
    const rows = this.deps.custom ? await this.deps.custom.list(chainId).catch(() => []) : []
    return rows.map((c) => ({ chainId, address: c.address, name: c.name, description: null, verified: false, standard: c.standard, totalSupply: null, imageUrl: null, bannerUrl: null, creatorFee: null, floorEtn: null, volume24hEtn: null, totalVolumeEtn: null, owners: null, listed: null, percentListed: null, volumeEtn: null, volumeChangePct: null, floorChangePct: null, sales: null, traits: [], paysDividends: false, starred: false, owned: 0, custom: true }))
  }

  toViews(chainId: number, rows: readonly EsCollection[], owned: ReadonlyMap<string, number>): CollectionView[] {
    const legends = isEtn(chainId) ? ELECTRONEUM_ADDRESSES[chainId].electricLegends.toLowerCase() : ''
    const starred = new Set(this.deps.watchlist.cached().filter((w) => w.kind === 'collection').map((w) => `${w.chainId}:${w.address.toLowerCase()}`))
    const out = rows.map((r): CollectionView => ({
      chainId,
      address: r.address,
      name: r.name,
      description: r.description,
      verified: r.verified,
      standard: r.standard,
      totalSupply: r.totalSupply,
      imageUrl: r.imageUrl,
      bannerUrl: r.bannerUrl,
      creatorFee: r.creatorFee,
      floorEtn: r.floorEtn,
      volume24hEtn: r.volume24hEtn,
      totalVolumeEtn: r.totalVolumeEtn,
      owners: r.owners,
      listed: r.listed,
      percentListed: r.percentListed,
      volumeEtn: r.volumeEtn,
      volumeChangePct: r.volumeChangePct,
      floorChangePct: r.floorChangePct,
      sales: r.sales,
      traits: r.traits.map((t) => ({ name: t.name, values: [...t.values] })),
      paysDividends: r.address.toLowerCase() === legends,
      starred: starred.has(`${chainId}:${r.address.toLowerCase()}`),
      owned: owned.get(r.address.toLowerCase()) ?? 0,
    }))
    out.sort((a, b) => (a.paysDividends === b.paysDividends ? (b.volume24hEtn ?? 0) - (a.volume24hEtn ?? 0) : a.paysDividends ? -1 : 1))
    return out
  }

  async collection(chainId: number, address: string, accountId?: string): Promise<CollectionView | null> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return null
    const cached = this.collectionRows.get(chainId)?.find((r) => r.address.toLowerCase() === address.toLowerCase())
    let row = cached ?? null
    if (!row) {
      try {
        row = (await fetchCollections(d.electroswap, chainId, { addresses: [address] }))[0] ?? null
      } catch {
        row = null
      }
    }
    const account = accountId ? ((await d.vault.accounts()).find((a) => a.id === accountId) ?? null) : null
    if (!row) {
      // Not on the indexer: a custom collection still gets a page (plan A3).
      const custom = (await this.customViews(chainId)).find((c) => c.address.toLowerCase() === address.toLowerCase())
      return custom ?? null
    }
    const owned = new Map<string, number>()
    if (account) {
      try {
        for (const c of await fetchCollectionBalances(d.electroswap, chainId, account.address)) owned.set(c.address.toLowerCase(), c.balance)
      } catch {
        // 0
      }
    }
    const view = this.toViews(chainId, [row], owned)[0] ?? null
    if (!view) return null
    // The mint capability is read on the page only (plan C1, owner item N5).
    const mint = this.deps.legends ? await this.deps.legends.mintInfo(chainId, address, account?.address ?? null).catch(() => null) : null
    return { ...view, mint }
  }

  /** One search field across tokens, collections and campaigns (§8.11). */
  async search(chainId: number, query: string): Promise<{ tokens: ExploreToken[]; collections: CollectionView[] }> {
    const q = query.trim().toLowerCase()
    if (!q) return { tokens: [], collections: [] }
    const tokens = (await this.tokens(chainId)).filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) || t.address.toLowerCase() === q)
    let collections: CollectionView[] = []
    if (this.deps.electroswap && isEtn(chainId)) {
      try {
        const rows = /^0x[0-9a-f]{40}$/.test(q) ? await fetchCollections(this.deps.electroswap, chainId, { addresses: [q] }) : await fetchCollections(this.deps.electroswap, chainId, { nameQuery: query.trim() }, 20)
        collections = this.toViews(chainId, rows, new Map())
      } catch {
        collections = []
      }
    }
    return { tokens: tokens.slice(0, 20), collections }
  }
}

const Chain = z.object({ chainId: z.number().int().positive() })

export function exploreNamespace(explore: ExploreService): NamespaceSpec {
  return {
    available: { handler: async () => explore.available },
    tokens: { input: Chain, handler: (arg) => explore.tokens((arg as { chainId: number }).chainId) },
    cachedTokens: { input: Chain, handler: (arg) => explore.cachedTokens((arg as { chainId: number }).chainId) },
    tokenDetail: { input: Chain.extend({ address: z.string() }), handler: (arg) => explore.tokenDetail((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    cachedTokenDetail: { input: Chain.extend({ address: z.string() }), handler: (arg) => explore.cachedTokenDetail((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    priceHistory: { input: Chain.extend({ address: z.string(), duration: ChartDurationSchema }), handler: (arg) => explore.priceHistory((arg as { chainId: number }).chainId, (arg as { address: string }).address, (arg as { duration: ChartDuration }).duration) },
    cachedPriceHistory: { input: Chain.extend({ address: z.string(), duration: ChartDurationSchema }), handler: (arg) => explore.cachedPriceHistory((arg as { chainId: number }).chainId, (arg as { address: string }).address, (arg as { duration: ChartDuration }).duration) },
    liquidity: { input: Chain.extend({ address: z.string() }), handler: (arg) => explore.liquidity((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    cachedLiquidity: { input: Chain.extend({ address: z.string() }), handler: (arg) => explore.cachedLiquidity((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    collections: { input: Chain.extend({ accountId: AccountIdSchema.optional(), all: z.boolean().optional(), window: CollectionWindowSchema.optional() }), handler: (arg) => explore.collections((arg as { chainId: number }).chainId, (arg as { accountId?: string }).accountId, (arg as { all?: boolean }).all ?? false, (arg as { window?: CollectionWindow }).window ?? 'DAY') },
    cachedCollections: { input: Chain.extend({ accountId: AccountIdSchema.optional(), all: z.boolean().optional(), window: CollectionWindowSchema.optional() }), handler: (arg) => explore.cachedCollections((arg as { chainId: number }).chainId, (arg as { accountId?: string }).accountId, (arg as { all?: boolean }).all ?? false, (arg as { window?: CollectionWindow }).window ?? 'DAY') },
    collection: { input: Chain.extend({ address: z.string(), accountId: AccountIdSchema.optional() }), handler: (arg) => explore.collection((arg as { chainId: number }).chainId, (arg as { address: string }).address, (arg as { accountId?: string }).accountId) },
    search: { input: Chain.extend({ query: z.string().max(120) }), handler: (arg) => explore.search((arg as { chainId: number }).chainId, (arg as { query: string }).query) },
  }
}
