/**
 * Design T7.2 — other-chain market-data enrichment.
 *
 * Market data is display-only enrichment: it may add a fiat price, a 24h
 * change, and charts to a row, but it NEVER owns quantity (quantity always
 * comes from the on-chain multicall balance) and never blocks the UI when
 * down (network failure → unpriced, not an error thrown to the UI).
 */

export interface TokenPrice {
  /** Fiat price in USD. */
  readonly usd: number
  /** Optional 24h change, percent. */
  readonly change24h?: number
  /** Timestamp (ms) when the price was fetched. */
  readonly at: number
}

/** Display-only enrichment. quantity never comes from here. */
export interface MarketData {
  /**
   * Price for a token by (chainId, checksummed address).
   * null = unpriced (no mapping, HTTP 429, offline, or any other failure).
   */
  price(chainId: number, address: string): Promise<TokenPrice | null>
  /**
   * Batch variant (implementations SHOULD dedupe + cache).
   * Entries keyed by lowercased address; null entries allowed.
   */
  prices(chainId: number, addresses: readonly string[]): Promise<TokenPriceMap>
}

/** lowercased address -> price (or null when unpriced). */
export type TokenPriceMap = Record<string, TokenPrice | null>
