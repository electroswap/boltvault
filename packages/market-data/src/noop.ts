import type { MarketData, TokenPrice, TokenPriceMap } from './types'

/**
 * Offline implementation: everything is unpriced. The UI still works —
 * rows simply show no fiat price — because market data never blocks.
 */
export class NoOpMarketData implements MarketData {
  async price(_chainId: number, _address: string): Promise<TokenPrice | null> {
    return null
  }

  async prices(_chainId: number, addresses: readonly string[]): Promise<TokenPriceMap> {
    const out: TokenPriceMap = {}
    for (const a of addresses) out[a.toLowerCase()] = null
    return out
  }
}

/** Shared offline instance. */
export const noOpMarketData: MarketData = new NoOpMarketData()
