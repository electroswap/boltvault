/**
 * Typed fetchers over the ElectroSwap GraphQL (§8.8–8.11 data): every
 * response crosses the boundary through zod and comes out as a plain view
 * the engine can persist and the screens can render. Prices, floors, APYs
 * and campaign copy are display only — the chain owns every quantity.
 */
import { z } from 'zod'
import type { ElectroSwapClient } from './client'
import { chainEnum, NFT_ACTIVITY, NFT_ASSETS, NFT_ASSET_DETAILS, NFT_BALANCES, NFT_BID_OBLIGATION, NFT_BIDS, NFT_COLLECTION_BALANCES, NFT_COLLECTIONS, PRESALE, PRESALES, PRICE_HISTORY, TOKEN_DETAIL, TOP_COLLECTIONS, TOP_TOKENS, YIELD_FARMS } from './queries'

const amount = z.object({ value: z.number().nullable().optional() }).nullable().optional()
const num = (a: z.infer<typeof amount>): number | null => (a && typeof a.value === 'number' && Number.isFinite(a.value) ? a.value : null)
const url = z.object({ url: z.string().nullable().optional() }).nullable().optional()
const str = (u: z.infer<typeof url>): string | null => u?.url ?? null

// ---- tokens ------------------------------------------------------------------------------

const MarketSchema = z
  .object({
    price: amount,
    totalValueLocked: amount,
    volume: amount,
    day: amount,
    week: amount,
    fullyDilutedValuation: amount,
    marketCap: amount,
  })
  .nullable()
  .optional()

const TokenNodeSchema = z.object({
  address: z.string().nullable().optional(),
  symbol: z.string().nullable().optional(),
  name: z.string().nullable().optional(),
  decimals: z.number().nullable().optional(),
  standard: z.string().nullable().optional(),
  market: MarketSchema,
  project: z.object({ safetyLevel: z.string().nullable().optional(), isSpam: z.boolean().nullable().optional(), logoUrl: z.string().nullable().optional(), description: z.string().nullable().optional(), homepageUrl: z.string().nullable().optional(), twitterUrl: z.string().nullable().optional(), telegramUrl: z.string().nullable().optional() }).nullable().optional(),
})

export interface MarketTokenView {
  readonly address: string
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly native: boolean
  readonly price: number | null
  readonly change24h: number | null
  readonly change7d: number | null
  readonly volume24h: number | null
  readonly tvl: number | null
  readonly marketCap: number | null
  readonly fdv: number | null
  readonly safety: 'VERIFIED' | 'MEDIUM_WARNING' | 'STRONG_WARNING' | 'BLOCKED' | null
  readonly spam: boolean
  readonly logoUrl: string | null
}

function tokenView(n: z.infer<typeof TokenNodeSchema>): MarketTokenView | null {
  const address = n.address ?? null
  if (!address) return null
  const native = n.standard === 'NATIVE' || address.toLowerCase() === 'native'
  const s = n.project?.safetyLevel
  return {
    address: native ? 'native' : address,
    symbol: n.symbol ?? '?',
    name: n.name ?? n.symbol ?? '?',
    decimals: n.decimals ?? 18,
    native,
    price: num(n.market?.price),
    change24h: num(n.market?.day),
    change7d: num(n.market?.week),
    volume24h: num(n.market?.volume),
    tvl: num(n.market?.totalValueLocked),
    marketCap: num(n.market?.marketCap),
    fdv: num(n.market?.fullyDilutedValuation),
    safety: s === 'VERIFIED' || s === 'MEDIUM_WARNING' || s === 'STRONG_WARNING' || s === 'BLOCKED' ? s : null,
    spam: n.project?.isSpam === true,
    logoUrl: n.project?.logoUrl ?? null,
  }
}

export async function fetchTopTokens(client: ElectroSwapClient, chainId: number): Promise<MarketTokenView[]> {
  const data = await client.query<unknown>(TOP_TOKENS, { chain: chainEnum(chainId) })
  const parsed = z.object({ topTokens: z.array(TokenNodeSchema.nullable()).nullable().optional() }).parse(data)
  const rows = (parsed.topTokens ?? []).map((n) => (n ? tokenView(n) : null)).filter((x): x is MarketTokenView => x !== null)
  rows.sort((a, b) => (b.volume24h ?? 0) - (a.volume24h ?? 0))
  return rows
}

export interface TokenDetailView extends MarketTokenView {
  readonly description: string | null
  readonly homepageUrl: string | null
  readonly twitterUrl: string | null
  readonly telegramUrl: string | null
  /** Day sparkline, oldest first. */
  readonly sparkline: ReadonlyArray<{ t: number; v: number }>
}

export async function fetchTokenDetail(client: ElectroSwapClient, chainId: number, address: string): Promise<TokenDetailView | null> {
  const data = await client.query<unknown>(TOKEN_DETAIL, { address, chain: chainEnum(chainId) })
  const parsed = z.object({ token: TokenNodeSchema.extend({ sparkline: z.object({ priceHistory: z.array(z.object({ timestamp: z.number(), value: z.number() }).nullable()).nullable().optional() }).nullable().optional() }).nullable().optional() }).parse(data)
  const n = parsed.token
  if (!n) return null
  const base = tokenView(n)
  if (!base) return null
  const points = (n.sparkline?.priceHistory ?? []).filter((p): p is { timestamp: number; value: number } => p !== null).map((p) => ({ t: p.timestamp, v: p.value }))
  points.sort((a, b) => a.t - b.t)
  return { ...base, description: n.project?.description ?? null, homepageUrl: n.project?.homepageUrl ?? null, twitterUrl: n.project?.twitterUrl ?? null, telegramUrl: n.project?.telegramUrl ?? null, sparkline: points }
}

export type HistoryDuration = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR'

export interface PriceHistoryView {
  /** Oldest first. */
  readonly points: ReadonlyArray<{ t: number; v: number }>
  readonly high: number | null
  readonly low: number | null
}

/** One duration of a token's price history (plan B5). The API's `priceHighLow` returns null for a token without a market. */
export async function fetchPriceHistory(client: ElectroSwapClient, chainId: number, address: string, duration: HistoryDuration): Promise<PriceHistoryView | null> {
  const data = await client.query<unknown>(PRICE_HISTORY, { address, chain: chainEnum(chainId), duration })
  const parsed = z.object({ token: z.object({ market: z.object({ priceHistory: z.array(z.object({ timestamp: z.number(), value: z.number() }).nullable()).nullable().optional(), high: amount, low: amount }).nullable().optional() }).nullable().optional() }).parse(data)
  const m = parsed.token?.market
  if (!m) return null
  const points = (m.priceHistory ?? []).filter((p): p is { timestamp: number; value: number } => p !== null && Number.isFinite(p.value)).map((p) => ({ t: p.timestamp, v: p.value }))
  points.sort((a, b) => a.t - b.t)
  return { points, high: num(m.high), low: num(m.low) }
}

// ---- collections and assets ------------------------------------------------------------------

const FeeSchema = z.object({ payoutAddress: z.string(), basisPoints: z.number() })
const CollectionNodeSchema = z.object({
  collectionId: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  isVerified: z.boolean().nullable().optional(),
  numAssets: z.number().nullable().optional(),
  image: url,
  bannerImage: url,
  nftContracts: z.array(z.object({ address: z.string(), standard: z.string().nullable().optional(), name: z.string().nullable().optional(), symbol: z.string().nullable().optional(), totalSupply: z.number().nullable().optional() })).nullable().optional(),
  listingFees: z.array(FeeSchema.nullable()).nullable().optional(),
  markets: z.array(z.object({ floorPrice: amount, totalVolume: amount, volume: amount, owners: z.number().nullable().optional(), listings: amount, percentListed: amount })).nullable().optional(),
  traits: z.array(z.object({ name: z.string().nullable().optional(), values: z.array(z.string()).nullable().optional() })).nullable().optional(),
})

export interface CollectionView {
  readonly address: string
  readonly name: string
  readonly description: string | null
  readonly verified: boolean
  readonly standard: 'ERC721' | 'ERC1155' | 'unknown'
  readonly totalSupply: number | null
  readonly imageUrl: string | null
  readonly bannerUrl: string | null
  /** Creator royalty; the marketplace's own 3 % is not listed here. */
  readonly creatorFee: { readonly payoutAddress: string; readonly basisPoints: number } | null
  readonly floorEtn: number | null
  readonly volume24hEtn: number | null
  readonly totalVolumeEtn: number | null
  readonly owners: number | null
  readonly listed: number | null
  readonly percentListed: number | null
  readonly traits: ReadonlyArray<{ name: string; values: readonly string[] }>
}

function collectionView(n: z.infer<typeof CollectionNodeSchema>): CollectionView {
  const contract = n.nftContracts?.[0]
  const m = n.markets?.[0]
  const fee = (n.listingFees ?? []).find((f): f is z.infer<typeof FeeSchema> => f !== null && f.basisPoints > 0) ?? null
  const std = contract?.standard
  return {
    address: contract?.address ?? n.collectionId,
    name: n.name ?? contract?.name ?? 'Collection',
    description: n.description ?? null,
    verified: n.isVerified === true,
    standard: std === 'ERC721' || std === 'ERC1155' ? std : 'unknown',
    totalSupply: contract?.totalSupply ?? n.numAssets ?? null,
    imageUrl: str(n.image),
    bannerUrl: str(n.bannerImage),
    creatorFee: fee ? { payoutAddress: fee.payoutAddress, basisPoints: fee.basisPoints } : null,
    floorEtn: num(m?.floorPrice),
    volume24hEtn: num(m?.volume),
    totalVolumeEtn: num(m?.totalVolume),
    owners: m?.owners ?? null,
    listed: num(m?.listings),
    percentListed: num(m?.percentListed),
    traits: (n.traits ?? []).map((t) => ({ name: t.name ?? '', values: t.values ?? [] })).filter((t) => t.name),
  }
}

const edges = <T extends z.ZodTypeAny>(node: T) => z.object({ edges: z.array(z.object({ node })).nullable().optional(), pageInfo: z.object({ hasNextPage: z.boolean().nullable().optional(), endCursor: z.string().nullable().optional() }).nullable().optional(), totalCount: z.number().nullable().optional() }).nullable().optional()

export async function fetchTopCollections(client: ElectroSwapClient, chainId: number, first = 50): Promise<CollectionView[]> {
  const data = await client.query<unknown>(TOP_COLLECTIONS, { chains: [chainEnum(chainId)], first })
  const parsed = z.object({ topCollections: edges(CollectionNodeSchema) }).parse(data)
  return (parsed.topCollections?.edges ?? []).map((e) => collectionView(e.node))
}

export async function fetchCollections(client: ElectroSwapClient, chainId: number, filter: { addresses?: string[]; nameQuery?: string }, first = 50): Promise<CollectionView[]> {
  const data = await client.query<unknown>(NFT_COLLECTIONS, { chain: chainEnum(chainId), filter, first })
  const parsed = z.object({ nftCollections: edges(CollectionNodeSchema) }).parse(data)
  return (parsed.nftCollections?.edges ?? []).map((e) => collectionView(e.node))
}

const OrderNodeSchema = z.object({
  address: z.string().nullable().optional(),
  tokenId: z.string().nullable().optional(),
  type: z.string(),
  price: amount,
  quantity: z.number().nullable().optional(),
  orderHash: z.string().nullable().optional(),
  signature: z.string().nullable().optional(),
  status: z.string(),
  createdAt: z.number().nullable().optional(),
  startAt: z.number().nullable().optional(),
  endAt: z.number().nullable().optional(),
  maker: z.string(),
  taker: z.string().nullable().optional(),
  protocolParameters: z.unknown().nullable().optional(),
})

export interface OrderView {
  readonly type: 'LISTING' | 'OFFER' | 'BID'
  readonly status: 'VALID' | 'EXECUTED' | 'CANCELLED' | 'EXPIRED' | 'INVALID'
  readonly priceEtn: number | null
  readonly orderHash: string | null
  readonly signature: string | null
  readonly maker: string
  readonly createdAt: number | null
  readonly endAt: number | null
  /** The Seaport parameters as the API stored them (JSON, parsed lazily by the order builder). */
  readonly protocolParameters: unknown
}

function orderView(n: z.infer<typeof OrderNodeSchema>): OrderView {
  const t = n.type
  const s = n.status
  const params = typeof n.protocolParameters === 'string' ? safeJson(n.protocolParameters) : (n.protocolParameters ?? null)
  return {
    type: t === 'LISTING' || t === 'OFFER' || t === 'BID' ? t : 'LISTING',
    status: s === 'VALID' || s === 'EXECUTED' || s === 'CANCELLED' || s === 'EXPIRED' || s === 'INVALID' ? s : 'INVALID',
    priceEtn: num(n.price),
    orderHash: n.orderHash ?? null,
    signature: n.signature ?? null,
    maker: n.maker,
    createdAt: n.createdAt ?? null,
    endAt: n.endAt ?? null,
    protocolParameters: params,
  }
}

function safeJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

const AssetNodeSchema = z.object({
  tokenId: z.string(),
  name: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  image: url,
  smallImage: url,
  animationUrl: z.string().nullable().optional(),
  mediaType: z.string().nullable().optional(),
  ownerAddress: z.string().nullable().optional(),
  suspiciousFlag: z.boolean().nullable().optional(),
  isSpam: z.boolean().nullable().optional(),
  lastPrice: amount,
  rarities: z.array(z.object({ rank: z.number().nullable().optional(), score: z.number().nullable().optional() })).nullable().optional(),
  traits: z.array(z.object({ name: z.string().nullable().optional(), value: z.string().nullable().optional(), rarity: z.number().nullable().optional() })).nullable().optional(),
  nftContract: z.object({ address: z.string(), standard: z.string().nullable().optional(), name: z.string().nullable().optional() }).nullable().optional(),
  collection: z.object({ collectionId: z.string().nullable().optional(), name: z.string().nullable().optional(), isVerified: z.boolean().nullable().optional(), listingFees: z.array(FeeSchema.nullable()).nullable().optional(), image: url }).nullable().optional(),
  listings: edges(OrderNodeSchema),
  bids: edges(OrderNodeSchema),
})

export interface AssetView {
  readonly address: string
  readonly tokenId: string
  readonly name: string
  readonly description: string | null
  readonly imageUrl: string | null
  readonly smallImageUrl: string | null
  readonly animationUrl: string | null
  readonly mediaType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'RAW' | null
  readonly owner: string | null
  readonly standard: 'ERC721' | 'ERC1155' | 'unknown'
  readonly collectionName: string
  readonly collectionVerified: boolean
  readonly collectionImageUrl: string | null
  readonly creatorFee: { readonly payoutAddress: string; readonly basisPoints: number } | null
  readonly suspicious: boolean
  readonly rarityRank: number | null
  readonly traits: ReadonlyArray<{ name: string; value: string; rarity: number | null }>
  readonly lastPriceEtn: number | null
  readonly listing: OrderView | null
  readonly bestBid: OrderView | null
  readonly bids: readonly OrderView[]
}

function assetView(n: z.infer<typeof AssetNodeSchema>): AssetView {
  const listing = (n.listings?.edges ?? []).map((e) => orderView(e.node)).find((o) => o.status === 'VALID') ?? null
  const bids = (n.bids?.edges ?? []).map((e) => orderView(e.node)).filter((o) => o.status === 'VALID')
  bids.sort((a, b) => (b.priceEtn ?? 0) - (a.priceEtn ?? 0))
  const fee = (n.collection?.listingFees ?? []).find((f): f is z.infer<typeof FeeSchema> => f !== null && f.basisPoints > 0) ?? null
  const std = n.nftContract?.standard
  const mt = n.mediaType
  return {
    address: n.nftContract?.address ?? n.collection?.collectionId ?? '',
    tokenId: n.tokenId,
    name: n.name ?? `#${n.tokenId}`,
    description: n.description ?? null,
    imageUrl: str(n.image),
    smallImageUrl: str(n.smallImage) ?? str(n.image),
    animationUrl: n.animationUrl ?? null,
    mediaType: mt === 'IMAGE' || mt === 'VIDEO' || mt === 'AUDIO' || mt === 'RAW' ? mt : null,
    owner: n.ownerAddress ?? null,
    standard: std === 'ERC721' || std === 'ERC1155' ? std : 'unknown',
    collectionName: n.collection?.name ?? n.nftContract?.name ?? 'Collection',
    collectionVerified: n.collection?.isVerified === true,
    collectionImageUrl: str(n.collection?.image),
    creatorFee: fee ? { payoutAddress: fee.payoutAddress, basisPoints: fee.basisPoints } : null,
    suspicious: n.suspiciousFlag === true || n.isSpam === true,
    rarityRank: n.rarities?.[0]?.rank ?? null,
    traits: (n.traits ?? []).map((t) => ({ name: t.name ?? '', value: t.value ?? '', rarity: t.rarity ?? null })).filter((t) => t.name),
    lastPriceEtn: num(n.lastPrice),
    listing,
    bestBid: bids[0] ?? null,
    bids,
  }
}

export interface AssetsPage {
  readonly assets: AssetView[]
  readonly total: number | null
  readonly next: string | null
}

export async function fetchAssets(client: ElectroSwapClient, chainId: number, address: string, opts: { orderBy?: 'PRICE' | 'RARITY'; asc?: boolean; listed?: boolean; traits?: Array<{ name: string; values: string[] }>; query?: string; first?: number; after?: string } = {}): Promise<AssetsPage> {
  const filter: Record<string, unknown> = {}
  if (opts.listed !== undefined) filter['listed'] = opts.listed
  if (opts.traits?.length) filter['traits'] = opts.traits
  if (opts.query) filter['tokenSearchQuery'] = opts.query
  const data = await client.query<unknown>(NFT_ASSETS, { chain: chainEnum(chainId), address, orderBy: opts.orderBy ?? 'PRICE', asc: opts.asc ?? true, filter, first: opts.first ?? 40, after: opts.after ?? null })
  const parsed = z.object({ nftAssets: edges(AssetNodeSchema) }).parse(data)
  const page = parsed.nftAssets
  return { assets: (page?.edges ?? []).map((e) => assetView(e.node)), total: page?.totalCount ?? null, next: page?.pageInfo?.hasNextPage ? (page.pageInfo.endCursor ?? null) : null }
}

export async function fetchAsset(client: ElectroSwapClient, chainId: number, address: string, tokenId: string): Promise<AssetView | null> {
  const data = await client.query<unknown>(NFT_ASSET_DETAILS, { chain: chainEnum(chainId), address, tokenId })
  const parsed = z.object({ nftAssetDetails: AssetNodeSchema.nullable().optional() }).parse(data)
  return parsed.nftAssetDetails ? assetView(parsed.nftAssetDetails) : null
}

export interface OwnedAssetView extends AssetView {
  readonly quantity: number
  readonly listed: boolean
}

export async function fetchOwnedAssets(client: ElectroSwapClient, chainId: number, owner: string, first = 100): Promise<OwnedAssetView[]> {
  const out: OwnedAssetView[] = []
  let after: string | null = null
  for (let page = 0; page < 5; page++) {
    const data = await client.query<unknown>(NFT_BALANCES, { chain: chainEnum(chainId), owner, first, after })
    const parsed = z.object({ nftBalances: edges(z.object({ quantity: z.number().nullable().optional(), listedMarketplaces: z.array(z.string()).nullable().optional(), ownedAsset: AssetNodeSchema.nullable().optional() })) }).parse(data)
    const p = parsed.nftBalances
    for (const e of p?.edges ?? []) {
      if (!e.node.ownedAsset) continue
      const a = assetView(e.node.ownedAsset)
      out.push({ ...a, quantity: e.node.quantity ?? 1, listed: (e.node.listedMarketplaces ?? []).length > 0 || a.listing !== null })
    }
    after = p?.pageInfo?.hasNextPage ? (p.pageInfo.endCursor ?? null) : null
    if (!after) break
  }
  return out
}

export interface CollectionBalanceView {
  readonly address: string
  readonly name: string
  readonly logoUrl: string | null
  readonly balance: number
}

export async function fetchCollectionBalances(client: ElectroSwapClient, chainId: number, owner: string): Promise<CollectionBalanceView[]> {
  const data = await client.query<unknown>(NFT_COLLECTION_BALANCES, { chain: chainEnum(chainId), address: owner })
  const parsed = z.object({ nftCollectionBalances: z.object({ collections: z.array(z.object({ address: z.string(), name: z.string(), logoImage: z.string().nullable().optional(), balance: z.number() }).nullable()).nullable().optional() }).nullable().optional() }).parse(data)
  return (parsed.nftCollectionBalances?.collections ?? []).filter((c): c is NonNullable<typeof c> => c !== null).map((c) => ({ address: c.address, name: c.name, logoUrl: c.logoImage ?? null, balance: c.balance }))
}

export interface NftActivityView {
  readonly address: string
  readonly tokenId: string | null
  readonly name: string | null
  readonly imageUrl: string | null
  readonly type: 'LISTING' | 'SALE' | 'CANCEL_LISTING' | 'TRANSFER' | 'BID' | 'CANCEL_BID'
  readonly from: string
  readonly to: string | null
  readonly hash: string | null
  readonly priceEtn: number | null
  readonly timestamp: number
}

export async function fetchNftActivity(client: ElectroSwapClient, chainId: number, filter: { address?: string; tokenId?: string }, first = 40): Promise<NftActivityView[]> {
  const data = await client.query<unknown>(NFT_ACTIVITY, { chain: chainEnum(chainId), filter, first })
  const parsed = z.object({ nftActivity: edges(z.object({ address: z.string(), tokenId: z.string().nullable().optional(), type: z.string(), fromAddress: z.string(), toAddress: z.string().nullable().optional(), transactionHash: z.string().nullable().optional(), price: amount, timestamp: z.number(), asset: z.object({ tokenId: z.string().nullable().optional(), name: z.string().nullable().optional(), smallImage: url }).nullable().optional() })) }).parse(data)
  return (parsed.nftActivity?.edges ?? []).map((e) => {
    const n = e.node
    const t = n.type
    return {
      address: n.address,
      tokenId: n.tokenId ?? n.asset?.tokenId ?? null,
      name: n.asset?.name ?? null,
      imageUrl: str(n.asset?.smallImage),
      type: t === 'LISTING' || t === 'SALE' || t === 'CANCEL_LISTING' || t === 'TRANSFER' || t === 'BID' || t === 'CANCEL_BID' ? t : 'TRANSFER',
      from: n.fromAddress,
      to: n.toAddress ?? null,
      hash: n.transactionHash ?? null,
      priceEtn: num(n.price),
      timestamp: n.timestamp,
    }
  })
}

export interface BidView {
  readonly order: OrderView
  readonly address: string
  readonly tokenId: string
  readonly name: string
  readonly imageUrl: string | null
  readonly owner: string | null
  readonly collectionName: string
  readonly creatorFee: { readonly payoutAddress: string; readonly basisPoints: number } | null
  readonly expiresAt: number
}

/** Bids the account made (as bidder). */
export async function fetchBids(client: ElectroSwapClient, chainId: number, bidder: string, first = 50): Promise<BidView[]> {
  const data = await client.query<unknown>(NFT_BIDS, { chain: chainEnum(chainId), address: bidder, statuses: ['VALID'], first })
  const parsed = z.object({ nftBids: edges(z.object({ type: z.string().nullable().optional(), price: amount, status: z.string().nullable().optional(), createdAt: z.number(), expiresAt: z.number(), protocolParameters: z.unknown().nullable().optional(), asset: z.object({ tokenId: z.string().nullable().optional(), name: z.string().nullable().optional(), smallImage: url, ownerAddress: z.string().nullable().optional(), nftContract: z.object({ address: z.string() }).nullable().optional(), collection: z.object({ name: z.string().nullable().optional(), listingFees: z.array(FeeSchema.nullable()).nullable().optional() }).nullable().optional() }).nullable().optional(), collection: z.object({ collectionId: z.string().nullable().optional(), name: z.string().nullable().optional() }).nullable().optional() })) }).parse(data)
  return (parsed.nftBids?.edges ?? []).flatMap((e) => {
    const n = e.node
    const address = n.asset?.nftContract?.address ?? n.collection?.collectionId
    const tokenId = n.asset?.tokenId
    if (!address || !tokenId) return []
    const fee = (n.asset?.collection?.listingFees ?? []).find((f): f is z.infer<typeof FeeSchema> => f !== null && f.basisPoints > 0) ?? null
    const order = orderView({ type: n.type ?? 'BID', price: n.price, status: n.status ?? 'VALID', createdAt: n.createdAt, endAt: n.expiresAt, maker: bidder, protocolParameters: n.protocolParameters })
    return [{ order, address, tokenId, name: n.asset?.name ?? `#${tokenId}`, imageUrl: str(n.asset?.smallImage), owner: n.asset?.ownerAddress ?? null, collectionName: n.asset?.collection?.name ?? n.collection?.name ?? 'Collection', creatorFee: fee ? { payoutAddress: fee.payoutAddress, basisPoints: fee.basisPoints } : null, expiresAt: n.expiresAt }]
  })
}

export async function fetchBidObligation(client: ElectroSwapClient, chainId: number, bidder: string): Promise<bigint> {
  const data = await client.query<unknown>(NFT_BID_OBLIGATION, { chain: chainEnum(chainId), address: bidder })
  const parsed = z.object({ nftBidObligation: z.object({ wetnObligation: z.string().nullable().optional() }).nullable().optional() }).parse(data)
  const v = parsed.nftBidObligation?.wetnObligation
  return v && /^\d+$/.test(v) ? BigInt(v) : 0n
}

// ---- launchpad ----------------------------------------------------------------------------

const PresaleNodeSchema = z.object({
  pool: z.string(),
  status: z.string(),
  shareLink: z.string().nullable().optional(),
  affiliate: z.object({ percent: z.number().nullable().optional() }).nullable().optional(),
  token: z.object({ name: z.string(), symbol: z.string(), decimals: z.number(), totalSupply: z.number().nullable().optional(), address: z.string().nullable().optional(), liquidityPool: z.string().nullable().optional() }),
  campaign: z.object({
    manager: z.string(),
    creator: z.string(),
    logoUrl: z.string().nullable().optional(),
    bannerUrl: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    website: z.string().nullable().optional(),
    twitter: z.string().nullable().optional(),
    discord: z.string().nullable().optional(),
    telegram: z.string().nullable().optional(),
    starts: z.number(),
    ends: z.number(),
    etnRaised: z.number().nullable().optional(),
    minEtnToLaunch: z.number().nullable().optional(),
    minEtnToList: z.number().nullable().optional(),
    currentRate: z.number().nullable().optional(),
    tokensForPresale: z.number().nullable().optional(),
    tokensForLiquidity: z.number().nullable().optional(),
    initialMarketCap: z.number().nullable().optional(),
    maxBuy: z.number().nullable().optional(),
    contributorCount: z.number().nullable().optional(),
    contributors: z.array(z.object({ address: z.string(), ensName: z.string().nullable().optional(), amountEtn: z.number().nullable().optional(), valueUsd: z.number().nullable().optional() })).nullable().optional(),
    refundTxHash: z.string().nullable().optional(),
  }),
})

export type PresaleWireStatus = 'ACTIVE' | 'LAUNCHED' | 'FAILED' | 'CANCELLED' | 'PENDING'

export interface CampaignView {
  readonly pool: string
  readonly status: PresaleWireStatus
  readonly shareLink: string | null
  readonly affiliatePercent: number
  readonly token: { readonly name: string; readonly symbol: string; readonly decimals: number; readonly address: string | null; readonly totalSupply: number | null; readonly liquidityPool: string | null }
  readonly creator: string
  readonly logoUrl: string | null
  readonly bannerUrl: string | null
  readonly description: string
  readonly links: { readonly website: string | null; readonly twitter: string | null; readonly discord: string | null; readonly telegram: string | null }
  readonly starts: number
  readonly ends: number
  readonly raisedEtn: number
  readonly minEtnToLaunch: number
  readonly minEtnToList: number
  readonly maxBuyEtn: number | null
  readonly tokensForPresale: number | null
  readonly tokensForLiquidity: number | null
  readonly initialMarketCapUsd: number | null
  readonly contributorCount: number
  readonly contributors: ReadonlyArray<{ address: string; name: string | null; amountEtn: number | null }>
}

function campaignView(n: z.infer<typeof PresaleNodeSchema>): CampaignView {
  const s = n.status
  const c = n.campaign
  return {
    pool: n.pool,
    status: s === 'ACTIVE' || s === 'LAUNCHED' || s === 'FAILED' || s === 'CANCELLED' || s === 'PENDING' ? s : 'PENDING',
    shareLink: n.shareLink ?? null,
    affiliatePercent: n.affiliate?.percent ?? 0,
    token: { name: n.token.name, symbol: n.token.symbol, decimals: n.token.decimals, address: n.token.address ?? null, totalSupply: n.token.totalSupply ?? null, liquidityPool: n.token.liquidityPool ?? null },
    creator: c.creator,
    logoUrl: c.logoUrl ?? null,
    bannerUrl: c.bannerUrl ?? null,
    description: c.description ?? '',
    links: { website: c.website ?? null, twitter: c.twitter ?? null, discord: c.discord ?? null, telegram: c.telegram ?? null },
    starts: c.starts,
    ends: c.ends,
    raisedEtn: c.etnRaised ?? 0,
    minEtnToLaunch: c.minEtnToLaunch ?? 0,
    minEtnToList: c.minEtnToList ?? 0,
    maxBuyEtn: c.maxBuy ?? null,
    tokensForPresale: c.tokensForPresale ?? null,
    tokensForLiquidity: c.tokensForLiquidity ?? null,
    initialMarketCapUsd: c.initialMarketCap ?? null,
    contributorCount: c.contributorCount ?? 0,
    contributors: (c.contributors ?? []).map((x) => ({ address: x.address, name: x.ensName ?? null, amountEtn: x.amountEtn ?? null })),
  }
}

export async function fetchCampaigns(client: ElectroSwapClient, chainId: number, statuses?: PresaleWireStatus[], query?: string): Promise<CampaignView[]> {
  const filter: Record<string, unknown> = {}
  if (statuses?.length) filter['status'] = statuses
  if (query) filter['searchQuery'] = query
  const data = await client.query<unknown>(PRESALES, { chain: chainEnum(chainId), filter, first: 50 })
  const parsed = z.object({ presales: edges(PresaleNodeSchema) }).parse(data)
  return (parsed.presales?.edges ?? []).map((e) => campaignView(e.node))
}

export async function fetchCampaign(client: ElectroSwapClient, chainId: number, pool: string, account?: string): Promise<CampaignView | null> {
  const data = await client.query<unknown>(PRESALE, { pool, account: account ?? null, chain: chainEnum(chainId) })
  const parsed = z.object({ presale: PresaleNodeSchema.nullable().optional() }).parse(data)
  return parsed.presale ? campaignView(parsed.presale) : null
}

// ---- farms ---------------------------------------------------------------------------------

const FarmNodeSchema = z.object({
  id: z.number(),
  version: z.number(),
  name: z.string(),
  poolAddr: z.string(),
  liquidity: z.string(),
  allocation: z.number().nullable().optional(),
  farmerCount: z.number().nullable().optional(),
  token0: z.string(),
  token1: z.string(),
  tokenId: z.number().nullable().optional(),
  fee: z.number().nullable().optional(),
  active: z.boolean(),
  tvl: z.number().nullable().optional(),
  baseRewardApy: z.number().nullable().optional(),
  thirdPartyRewardApy: z.number().nullable().optional(),
  thirdPartyReward: z.object({ token: z.string(), symbol: z.string(), tokensPerBlock: z.string(), endBlock: z.number(), tokenPrice: amount }).nullable().optional(),
  farmer: z.object({ addr: z.string(), liquidity: z.string(), durationMultiplier: z.number(), boltMultiplier: z.number(), boltDeposited: z.string(), startingBlock: z.number(), rewards: z.string(), thirdPartyRewards: z.string(), farmOwnership: z.number() }).nullable().optional(),
})

export interface FarmIndexView {
  readonly id: number
  readonly version: 2 | 3
  readonly name: string
  readonly poolAddr: string
  readonly token0: string
  readonly token1: string
  readonly tokenId: number | null
  readonly fee: number | null
  readonly active: boolean
  readonly allocation: number | null
  readonly farmerCount: number
  readonly tvlUsd: number | null
  readonly baseApy: number | null
  readonly thirdPartyApy: number | null
  readonly thirdParty: { readonly token: string; readonly symbol: string; readonly tokensPerBlock: string; readonly endBlock: number } | null
  /** The indexer's view of the farmer — a sanity companion to the chain read, never the quantity source. */
  readonly farmer: { readonly liquidity: string; readonly durationMultiplier: number; readonly boltMultiplier: number; readonly boltDeposited: string; readonly startingBlock: number; readonly rewards: string; readonly thirdPartyRewards: string; readonly ownership: number } | null
}

export async function fetchFarms(client: ElectroSwapClient, chainId: number, farmer?: string, active?: boolean): Promise<FarmIndexView[]> {
  const data = await client.query<unknown>(YIELD_FARMS, { chain: chainEnum(chainId), farmer: farmer ?? null, active: active ?? null })
  const parsed = z.object({ yieldFarms: z.array(FarmNodeSchema) }).parse(data)
  return parsed.yieldFarms.map((n) => ({
    id: n.id,
    version: n.version === 3 ? 3 : 2,
    name: n.name,
    poolAddr: n.poolAddr,
    token0: n.token0,
    token1: n.token1,
    tokenId: n.tokenId ?? null,
    fee: n.fee ?? null,
    active: n.active,
    allocation: n.allocation ?? null,
    farmerCount: n.farmerCount ?? 0,
    tvlUsd: n.tvl ?? null,
    baseApy: n.baseRewardApy ?? null,
    thirdPartyApy: n.thirdPartyRewardApy ?? null,
    thirdParty: n.thirdPartyReward ? { token: n.thirdPartyReward.token, symbol: n.thirdPartyReward.symbol, tokensPerBlock: n.thirdPartyReward.tokensPerBlock, endBlock: n.thirdPartyReward.endBlock } : null,
    farmer: n.farmer ? { liquidity: n.farmer.liquidity, durationMultiplier: n.farmer.durationMultiplier, boltMultiplier: n.farmer.boltMultiplier, boltDeposited: n.farmer.boltDeposited, startingBlock: n.farmer.startingBlock, rewards: n.farmer.rewards, thirdPartyRewards: n.farmer.thirdPartyRewards, ownership: n.farmer.farmOwnership } : null,
  }))
}
