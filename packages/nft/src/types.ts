/**
 * @boltvault/nft — domain types for the ETN NFT marketplace (Seaport 1.5).
 * Pure data shapes; parsing lives in parse.ts and is display-only.
 */

/** A tracked NFT collection (ERC-721 asset on ETN). */
export interface NftCollection {
  id: string
  name: string
  /** Floor (cheapest listed price, wei) if known. */
  floor?: number
}

/** A single ERC-721 token within a collection. */
export interface NftAsset {
  /** Contract address of the collection this token belongs to. */
  collection: string
  tokenId: string
  name?: string
  /** Raw tokenURI (may be `ipfs://`); resolve with resolveMedia() from media.ts. */
  mediaUri?: string
  /** Floor price (wei) if known. */
  floor?: number
  owner?: string
  listed?: boolean
}

/** An active bid on a specific token. */
export interface NftBid {
  /** Contract address of the asset. */
  asset: string
  tokenId: string
  /** Bid price in wei. */
  price: bigint
  bidder: string
  /** Unix seconds; undefined = non-expiring. */
  expiresAt?: number
}

/** A marketplace activity event (sale / bid / list / transfer). */
export interface NftActivity {
  asset: string
  tokenId: string
  kind: 'sale' | 'bid' | 'list' | 'transfer'
  price?: bigint
  from?: string
  to?: string
  /** Unix seconds. */
  at?: number
}
