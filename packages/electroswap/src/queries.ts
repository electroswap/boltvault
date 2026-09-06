/**
 * GraphQL documents for the ElectroSwap API (services/api/schema.graphql,
 * verified 2026-09-05). Display and enrichment only — quantities come from
 * the chain (§2.8). Every document uses variables; the client sends them.
 * Constructed only for Electroneum chains (`chainEnum` throws otherwise).
 */

export type ChainEnum = 'ELECTRONEUM' | 'ELECTRONEUM_TEST'

export function chainEnum(chainId: number): ChainEnum {
  if (chainId === 52014) return 'ELECTRONEUM'
  if (chainId === 5201420) return 'ELECTRONEUM_TEST'
  throw new Error(`ElectroSwap has no data for chain ${chainId}`)
}

const MARKET = `market(currency: USD) { price { value currency } totalValueLocked { value } volume(duration: DAY) { value } day: pricePercentChange(duration: DAY) { value } week: pricePercentChange(duration: WEEK) { value } fullyDilutedValuation { value } marketCap { value } }`

/** Explore › Tokens: listed tokens by volume (paging args are ignored server-side; sort client-side). */
export const TOP_TOKENS = `query TopTokens($chain: Chain) { topTokens(chain: $chain, orderBy: VOLUME, pageSize: 200, page: 1) { id address symbol name decimals standard ${MARKET} project { safetyLevel isSpam logoUrl } } }`

/** One token's market line plus the sparkline. */
/** Token details › chart (plan B5): one duration of price history with the period's high and low. */
export const PRICE_HISTORY = `query PriceHistory($address: String, $chain: Chain, $duration: HistoryDuration!) { token(address: $address, chain: $chain) { market(currency: USD) { priceHistory(duration: $duration) { timestamp value } high: priceHighLow(duration: $duration, highLow: HIGH) { value } low: priceHighLow(duration: $duration, highLow: LOW) { value } } } }`

export const TOKEN_DETAIL = `query TokenDetail($address: String, $chain: Chain) { token(address: $address, chain: $chain) { id address symbol name decimals standard ${MARKET} sparkline: market(currency: USD) { priceHistory(duration: DAY) { timestamp value } } project { description homepageUrl twitterUrl telegramUrl safetyLevel isSpam logoUrl } } }`

const COLLECTION = `id collectionId name description isVerified numAssets image { url } bannerImage { url } nftContracts { address standard name symbol totalSupply } listingFees { payoutAddress basisPoints } markets(currencies: [ETN]) { floorPrice { value } totalVolume { value } volume(duration: DAY) { value } owners listings { value } percentListed { value } }`

/** Explore › Collectibles. */
export const TOP_COLLECTIONS = `query TopCollections($chains: [Chain!]!, $first: Int, $listed: Boolean) { topCollections(chains: $chains, listed: $listed, orderBy: VOLUME, duration: DAY, first: $first) { edges { node { ${COLLECTION} } } } }`

export const NFT_COLLECTIONS = `query NftCollections($chain: Chain, $filter: NftCollectionsFilterInput, $first: Int) { nftCollections(chain: $chain, filter: $filter, first: $first) { edges { node { ${COLLECTION} traits { name values } } } } }`

const ORDER = `id address tokenId type price { value } quantity orderHash signature status createdAt startAt endAt maker taker protocolParameters`

const ASSET = `id tokenId name description image { url } smallImage { url } animationUrl mediaType ownerAddress suspiciousFlag isSpam lastPrice { value } rarities { rank score } traits { name value rarity } nftContract { address standard name } collection { collectionId name isVerified listingFees { payoutAddress basisPoints } image { url } } listings(first: 1) { edges { node { ${ORDER} } } } bids(first: 10) { edges { node { ${ORDER} } } }`

export const NFT_ASSETS = `query NftAssets($chain: Chain, $address: String!, $orderBy: NftAssetSortableField, $asc: Boolean, $filter: NftAssetsFilterInput, $first: Int, $after: String) { nftAssets(chain: $chain, address: $address, orderBy: $orderBy, asc: $asc, filter: $filter, first: $first, after: $after) { totalCount pageInfo { hasNextPage endCursor } edges { node { ${ASSET} } } } }`

export const NFT_ASSET_DETAILS = `query NftAssetDetails($chain: Chain, $address: String!, $tokenId: String!) { nftAssetDetails(chain: $chain, address: $address, tokenId: $tokenId) { ${ASSET} } }`

export const NFT_BALANCES = `query NftBalances($chain: Chain, $owner: String!, $first: Int, $after: String) { nftBalances(chain: $chain, ownerAddress: $owner, filter: { filterSpam: true }, first: $first, after: $after) { pageInfo { hasNextPage endCursor } edges { node { quantity listedMarketplaces lastPrice { value } listingFees { payoutAddress basisPoints } ownedAsset { ${ASSET} } } } } }`

export const NFT_COLLECTION_BALANCES = `query NftCollectionBalances($chain: Chain, $address: String!) { nftCollectionBalances(chain: $chain, address: $address) { collections { address name logoImage balance } } }`

export const NFT_ACTIVITY = `query NftActivity($chain: Chain, $filter: NftActivityFilterInput, $first: Int) { nftActivity(chain: $chain, filter: $filter, first: $first) { edges { node { id address tokenId type marketplace fromAddress toAddress transactionHash price { value } quantity orderStatus timestamp asset { tokenId name smallImage { url } } } } } }`

export const NFT_BIDS = `query NftBids($chain: Chain, $address: String!, $statuses: [OrderStatus!], $first: Int) { nftBids(chain: $chain, address: $address, statuses: $statuses, first: $first) { totalCount edges { node { id type price { value } status statusReason createdAt expiresAt protocolParameters asset { tokenId name smallImage { url } ownerAddress nftContract { address } collection { name listingFees { payoutAddress basisPoints } } } collection { collectionId name } } } } }`

export const NFT_BID_OBLIGATION = `query NftBidObligation($chain: Chain, $address: String!) { nftBidObligation(chain: $chain, address: $address) { wetnObligation } }`

const PRESALE_FIELDS = `id pool status shareLink affiliate { percent } token { name symbol decimals totalSupply address liquidityPool } campaign { manager creator logoUrl bannerUrl description website twitter discord telegram starts ends etnRaised minEtnToLaunch minEtnToList currentRate tokensForPresale tokensForLiquidity initialMarketCap maxBuy contributorCount contributors { address ensName amountEtn valueUsd } refundTxHash }`

export const PRESALES = `query Presales($chain: Chain!, $filter: PresaleFilterInput, $first: Int) { presales(chain: $chain, filter: $filter, first: $first) { edges { node { ${PRESALE_FIELDS} } } } }`

export const PRESALE = `query Presale($pool: String!, $account: String, $chain: Chain!) { presale(pool: $pool, account: $account, chain: $chain) { ${PRESALE_FIELDS} } }`

export const YIELD_FARMS = `query YieldFarms($chain: Chain!, $farmer: String, $active: Boolean) { yieldFarms(chain: $chain, farmer: $farmer, active: $active) { id version name poolAddr liquidity allocation farmerCount token0 token1 tokenId fee active tvl baseRewardApy thirdPartyRewardApy thirdPartyReward { token symbol tokensPerBlock endBlock tokenPrice { value } } farmer { addr liquidity durationMultiplier boltMultiplier boltDeposited startingBlock rewards thirdPartyRewards farmOwnership } } }`
