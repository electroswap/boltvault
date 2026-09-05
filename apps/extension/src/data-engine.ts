/**
 * DataEngine (E0b) — the SERVICE-WORKER side of the popup data layer.
 *
 * The popup (sw-client) sends SwRequests; the SW answers with SwResponses.
 * This class implements the SW-side logic: read native + ERC-20 balances,
 * fetch display-only prices, run @boltvault/portfolio's buildPortfolio, and
 * map the result to the JSON-safe SafeRow shape (rawBalance as a STRING —
 * no bigint crosses the wire).
 *
 * Node-testable: the RPC reader + price source are injected (the SW wraps a
 * viem client in the reader; tests provide fakes). No chrome access here.
 *
 * Design laws:
 *  - "RPC quantity is source of truth; GraphQL/market denominatedValue is
 *    display" → balances come from the reader, prices are enrichment only.
 *  - "429 or fail → raw units, price unavailable" → a failed price is null,
 *    never a thrown error.
 *  - "stale API cannot hide a drain" → a failed balance read returns whatever
 *    rows we could (fail-soft), not a hard error.
 */
import { buildPortfolio, type PortfolioRow } from '@boltvault/portfolio'
import type { TokenEntry } from '@boltvault/token-catalog'
import type { SafeRow, SwResponse } from './sw-messages'

/** On-chain reads. The SW wraps a viem PublicClient; tests inject fakes. */
export interface RpcReader {
  /** Current block number (hex or bigint — DataEngine coerces). */
  blockNumber(): Promise<bigint>
  /** Native balance of `address`, in wei. */
  nativeBalance(address: string): Promise<bigint>
  /**
   * ERC-20 balances of `account` for the given tokens, keyed by lowercased
   * address, in base units. The reader handles multicall3 chunking.
   */
  erc20Balances(account: string, tokens: readonly { address: string }[]): Promise<Record<string, bigint>>
}

/** Display-only price enrichment (never owns quantity). */
export interface PriceSource {
  /** Prices for tokens on a chain, keyed by lowercased address; null = unpriced. */
  prices(chainId: number, addresses: readonly string[]): Promise<Record<string, { usd: number; change24h?: number; at: number } | null>>
  /** Native-token price (ETN has no ERC-20 address); null = unpriced. */
  nativePrice(chainId: number): Promise<{ usd: number; change24h?: number; at: number } | null>
}

export interface DataEngineOpts {
  reader: RpcReader
  /** Injectable universe resolver (token-catalog). Defaults to in-repo. */
  universe?: (chainId: number) => Promise<TokenEntry[]> | TokenEntry[]
  /** Display-only price enrichment (never owns quantity). */
  prices: PriceSource
}

/** A no-op price source: every token is unpriced (v1 display-only default). */
export const noOpPrices: PriceSource = {
  async prices() {
    return {}
  },
  async nativePrice() {
    return null
  },
}

/** Map a PortfolioRow to the JSON-safe SafeRow (rawBalance as a string). */
export function toSafeRow(row: PortfolioRow): SafeRow {
  return {
    address: row.address,
    symbol: row.symbol,
    name: row.name,
    decimals: row.decimals,
    logoURI: row.logoURI,
    rawBalance: row.rawBalance.toString(),
    quantity: row.quantity,
    priceUsd: row.priceUsd,
    usd: row.usd,
    change24h: row.change24h,
    share: row.share,
    hidden: row.hidden,
    priced: row.priced,
  }
}

export class DataEngine {
  constructor(private readonly opts: DataEngineOpts) {}

  /** bv:block:head → the block-head SwResponse. */
  async blockHead(chainId: number): Promise<SwResponse> {
    try {
      const n = await this.opts.reader.blockNumber()
      return { ok: true, block: Number(n), chainId, at: Date.now() }
    } catch (e) {
      return { ok: false, error: errMsg(e) }
    }
  }

  /** bv:portfolio → the priced portfolio SwResponse (fail-soft). */
  async portfolio(chainId: number, account: string): Promise<SwResponse> {
    try {
      const universe = await this.resolveUniverse(chainId)
      const nativeEntry: TokenEntry = {
        chainId,
        address: 'native',
        name: nativeName(chainId),
        symbol: nativeSymbol(chainId),
        decimals: 18,
      }
      const erc20 = universe.filter((t) => t.address.toLowerCase() !== 'native')

      // Native balance (truth).
      let nativeRaw = 0n
      try {
        nativeRaw = await this.opts.reader.nativeBalance(account)
      } catch {
        nativeRaw = 0n // fail-soft: show 0 native if the read fails
      }

      // ERC-20 balances (truth), keyed by lowercased address.
      let balances: Record<string, bigint> = { native: nativeRaw }
      if (erc20.length > 0) {
        try {
          const b = await this.opts.reader.erc20Balances(account, erc20)
          balances = { ...b, native: nativeRaw }
        } catch {
          balances = { native: nativeRaw } // fail-soft: native only
        }
      }

      // Prices (display-only, never throw).
      const prices: Record<string, { usd: number; change24h?: number; at: number } | null> = {}
      if (erc20.length > 0) {
        try {
          const p = await this.opts.prices.prices(chainId, erc20.map((t) => t.address))
          Object.assign(prices, p)
        } catch {
          // leave unpriced
        }
      }
      try {
        const np = await this.opts.prices.nativePrice(chainId)
        if (np) prices['native'] = np
      } catch {
        // leave native unpriced
      }

      const fullUniverse: TokenEntry[] = [nativeEntry, ...erc20]
      const pf = buildPortfolio({ chainId, universe: fullUniverse, balances, prices })

      return {
        ok: true,
        chainId,
        account,
        native: pf.native ? toSafeRow(pf.native) : null,
        rows: pf.rows.map(toSafeRow),
        pricedTotalUsd: pf.pricedTotalUsd,
        at: Date.now(),
      }
    } catch (e) {
      return { ok: false, error: errMsg(e) }
    }
  }

  /** bv:price → the price SwResponse (null when unpriced). */
  async price(chainId: number, address: string): Promise<SwResponse> {
    try {
      const p = await this.opts.prices.prices(chainId, [address])
      const hit = p[address.toLowerCase()] ?? null
      return { ok: true, usd: hit ? hit.usd : null, at: Date.now() }
    } catch (e) {
      return { ok: false, error: errMsg(e) }
    }
  }

  private async resolveUniverse(chainId: number): Promise<TokenEntry[]> {
    const res = await this.opts.universe?.(chainId) ?? []
    return res
  }
}

function nativeSymbol(chainId: number): string {
  return chainId === 52014 || chainId === 5201420 ? 'ETN' : 'ETH'
}
function nativeName(chainId: number): string {
  return chainId === 52014 || chainId === 5201420 ? 'Electroneum' : 'Ether'
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
