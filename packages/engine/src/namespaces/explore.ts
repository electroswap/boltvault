/**
 * Explore (master plan §8.11): the ElectroSwap market inside the wallet —
 * tokens by volume, collections, campaigns, farms, and one search across all
 * of it. Display data from the API, cached 60 s while a surface is open and
 * kept last-good; the chain stays the quantity source everywhere else.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { fetchCollectionBalances, fetchCollections, fetchTokenDetail, fetchTopCollections, fetchTopTokens, type CollectionView as EsCollection, type ElectroSwapClient, type TokenDetailView } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import type { NamespaceSpec } from '../host'
import { AccountIdSchema, type CollectionView, type ExploreToken } from '../schema'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'
import type { WatchlistService } from './watchlist'

export interface ExploreDeps {
  readonly platform: Platform
  readonly electroswap: ElectroSwapClient | null
  readonly tokens: TokensService
  readonly vault: VaultManager
  readonly watchlist: WatchlistService
}

const TTL_MS = 60_000
const isEtn = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420

export class ExploreService {
  private tokenCache = new Map<number, { at: number; rows: ExploreToken[] }>()
  private collectionCache = new Map<number, { at: number; rows: EsCollection[] }>()

  constructor(private readonly deps: ExploreDeps) {}

  get available(): boolean {
    return this.deps.electroswap !== null
  }

  /** Explore › Tokens. Empty (never a throw) when the API is not reachable; the screen says so. */
  async tokens(chainId: number): Promise<ExploreToken[]> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return []
    const now = d.platform.now()
    const hit = this.tokenCache.get(chainId)
    if (hit && now - hit.at < TTL_MS) return this.withStars(hit.rows)
    try {
      const rows = await fetchTopTokens(d.electroswap, chainId)
      const universe = await d.tokens.universe(chainId)
      const out: ExploreToken[] = rows
        .filter((r) => !r.spam)
        .map((r) => {
          const u = universe.find((x) => x.address.toLowerCase() === r.address.toLowerCase())
          return { chainId, address: r.address, symbol: r.symbol, name: r.name, decimals: r.decimals, logoUri: u?.logoUri ?? r.logoUrl, price: r.price, change24h: r.change24h, change7d: r.change7d, volume24h: r.volume24h, tvl: r.tvl, marketCap: r.marketCap, safety: r.safety, starred: false }
        })
      this.tokenCache.set(chainId, { at: now, rows: out })
      return this.withStars(out)
    } catch {
      return hit ? this.withStars(hit.rows) : []
    }
  }

  private withStars(rows: ExploreToken[]): ExploreToken[] {
    const starred = new Set(this.deps.watchlist.cached().filter((w) => w.kind === 'token').map((w) => `${w.chainId}:${w.address.toLowerCase()}`))
    return rows.map((r) => ({ ...r, starred: starred.has(`${r.chainId}:${r.address.toLowerCase()}`) }))
  }

  async tokenDetail(chainId: number, address: string): Promise<TokenDetailView | null> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return null
    try {
      return await fetchTokenDetail(d.electroswap, chainId, address === 'native' ? 'NATIVE' : address)
    } catch {
      return null
    }
  }

  /** Explore › Collectibles: top collections, Electric Legends pinned first with the dividends mark (§8.10). */
  async collections(chainId: number, accountId?: string): Promise<CollectionView[]> {
    const d = this.deps
    if (!d.electroswap || !isEtn(chainId)) return []
    const now = d.platform.now()
    let rows = this.collectionCache.get(chainId)?.rows ?? []
    const fresh = this.collectionCache.get(chainId)
    if (!fresh || now - fresh.at >= TTL_MS) {
      try {
        rows = await fetchTopCollections(d.electroswap, chainId)
        this.collectionCache.set(chainId, { at: now, rows })
      } catch {
        // last-good
      }
    }
    const owned = new Map<string, number>()
    if (accountId) {
      const account = (await d.vault.accounts()).find((a) => a.id === accountId)
      if (account) {
        try {
          for (const c of await fetchCollectionBalances(d.electroswap, chainId, account.address)) owned.set(c.address.toLowerCase(), c.balance)
        } catch {
          // no balances → 0
        }
      }
    }
    return this.toViews(chainId, rows, owned)
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
    const cached = this.collectionCache.get(chainId)?.rows.find((r) => r.address.toLowerCase() === address.toLowerCase())
    let row = cached ?? null
    if (!row) {
      try {
        row = (await fetchCollections(d.electroswap, chainId, { addresses: [address] }))[0] ?? null
      } catch {
        row = null
      }
    }
    if (!row) return null
    const owned = new Map<string, number>()
    if (accountId) {
      const account = (await d.vault.accounts()).find((a) => a.id === accountId)
      if (account) {
        try {
          for (const c of await fetchCollectionBalances(d.electroswap, chainId, account.address)) owned.set(c.address.toLowerCase(), c.balance)
        } catch {
          // 0
        }
      }
    }
    return this.toViews(chainId, [row], owned)[0] ?? null
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
    tokenDetail: { input: Chain.extend({ address: z.string() }), handler: (arg) => explore.tokenDetail((arg as { chainId: number }).chainId, (arg as { address: string }).address) },
    collections: { input: Chain.extend({ accountId: AccountIdSchema.optional() }), handler: (arg) => explore.collections((arg as { chainId: number }).chainId, (arg as { accountId?: string }).accountId) },
    collection: { input: Chain.extend({ address: z.string(), accountId: AccountIdSchema.optional() }), handler: (arg) => explore.collection((arg as { chainId: number }).chainId, (arg as { address: string }).address, (arg as { accountId?: string }).accountId) },
    search: { input: Chain.extend({ query: z.string().max(120) }), handler: (arg) => explore.search((arg as { chainId: number }).chainId, (arg as { query: string }).query) },
  }
}
