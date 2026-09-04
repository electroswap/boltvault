/**
 * ElectroSwap GraphQL client (T4.1) — the single typed surface for the
 * ElectroSwap indexer on ETN.
 *
 * Design S11: "Only constructed when chainId is 52014/5201420. Calling it with
 * another chain is a type error (assertElectroneum)." We lean on
 * @boltvault/chains's `assertElectroneum` + `chainIdToGraphQLChain` so a
 * non-ETN chainId fails fast (not silently hits the wrong indexer).
 *
 * Endpoint + auth mirror the proven fork (apps/bolt-wallet/src/bolt/api.ts):
 *   - POST https://electroswap.io/graphql
 *   - headers: Content-Type, Referer=<interface url>/, and X-BoltVault-Key when
 *     an API key is configured.
 *   - native ETN address is the sentinel 'NATIVE', not 0x0.
 *   - batched market reads use aliased token(...) fields (chunk 12).
 *
 * No runtime deps: a thin fetch client with an injectable `fetchImpl` so tests
 * run offline (design: live calls gated by SKIP_LIVE).
 */
import {
  assertElectroneum,
  chainIdToGraphQLChain,
  isElectroneumChainId,
  NATIVE_GRAPHQL_TOKEN_ADDRESS,
} from '@boltvault/chains'

export const ELECTRONEUM_MAINNET = 52014
export const ELECTRONEUM_TESTNET = 5201420

export const DEFAULT_GRAPHQL_URL = 'https://electroswap.io/graphql'
export const INTERFACE_REFERER = 'https://app.electroswap.io/'

/** Native ETN address → GraphQL sentinel (design: never query 0x0 for ETN). */
export function nativeAddress(): string {
  return NATIVE_GRAPHQL_TOKEN_ADDRESS
}

export interface MarketPrice {
  readonly value: number
  readonly currency: string
}

/** A single token market row (display-facing; quantity is NOT here — RPC owns it). */
export interface TokenMarketData {
  readonly address: string
  readonly chain: 'ELECTRONEUM' | 'ELECTRONEUM_TEST'
  readonly symbol: string
  readonly name: string
  readonly decimals: number
  readonly price: MarketPrice | null
}

export interface LiquidityLock {
  readonly lockId: number
  readonly pair: string
  readonly owner: string
  readonly token0: string
  readonly token1: string
  readonly amountToken0: string
  readonly amountToken1: string
  readonly percentSupply: number
  readonly active: boolean
  readonly version: string
}

/**
 * A full token market bundle: metadata + price + active liquidity locks + the
 * aggregated lock %. Used by the token-info surface (T5.5) and the bus bars.
 */
export interface TokenMarketBundle extends TokenMarketData {
  readonly locks: LiquidityLock[]
  readonly totalLockedPercent: number
  readonly lockedLiquidity: {
    readonly totalLockedToken0: string
    readonly totalLockedToken1: string
    readonly lockCount: number
    readonly totalPercent: number
  }
}

/** Portfolio token row (design merge rule: RPC owns quantity, GraphQL = display). */
export interface PortfolioToken {
  readonly id: string
  readonly quantity: string
  readonly denominatedValue: { readonly id: string; readonly currency: string; readonly value: number }
  readonly tokenProjectMarket: {
    readonly pricePercentChange: { readonly id: string; readonly value: number }
    readonly tokenProject: { readonly id: string; readonly logoUrl: string | null; readonly isSpam: boolean | null }
  }
  readonly token: {
    readonly id: string
    readonly chain: string
    readonly address: string
    readonly name: string
    readonly symbol: string
    readonly standard: string
    readonly decimals: number
  }
}

export interface Portfolio {
  readonly id: string
  readonly tokensTotalDenominatedValue: { readonly id: string; readonly value: number }
  readonly tokensTotalDenominatedValueChange: {
    readonly absolute: { readonly id: string; readonly value: number }
    readonly percentage: { readonly id: string; readonly value: number }
  }
  readonly tokenBalances: PortfolioToken[]
}

export interface ElectroSwapClientOptions {
  /** Override endpoint (tests / local). Default https://electroswap.io/graphql */
  readonly url?: string
  /** X-BoltVault-Key header (optional; many reads work keyless). */
  readonly apiKey?: string
  /** Referer sent to the ElectroSwap endpoint. */
  readonly referer?: string
  /** Injectable fetch (tests). */
  readonly fetchImpl?: typeof fetch
}

/** Thrown on transport / GraphQL error; `.status` is the HTTP status when set. */
export class ElectroSwapError extends Error {
  readonly status?: number
  constructor(message: string, status?: number) {
    super(message)
    this.name = 'ElectroSwapError'
    this.status = status
  }
}

export class ElectroSwapClient {
  readonly url: string
  private readonly apiKey: string | undefined
  private readonly referer: string
  private readonly doFetch: typeof fetch

  constructor(opts: ElectroSwapClientOptions = {}) {
    this.url = opts.url ?? DEFAULT_GRAPHQL_URL
    this.apiKey = opts.apiKey
    this.referer = opts.referer ?? INTERFACE_REFERER
    this.doFetch = opts.fetchImpl ?? fetch
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    // Mirror the fork: only send the interface Referer + key on the ES host.
    if (this.url.includes('electroswap.io')) {
      h['Referer'] = this.referer
      if (this.apiKey) h['X-BoltVault-Key'] = this.apiKey
    }
    return h
  }

  /** Raw GraphQL POST. Throws ElectroSwapError on !ok or body.errors. */
  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const res = await this.doFetch(this.url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ query, variables }),
    })
    if (!res.ok) throw new ElectroSwapError(`GraphQL request failed: ${res.status}`, res.status)
    const body = (await res.json()) as { data?: T; errors?: { message?: string }[] }
    if (body.errors && body.errors.length) {
      throw new ElectroSwapError(body.errors[0]?.message ?? 'GraphQL error')
    }
    if (!body.data) throw new ElectroSwapError('GraphQL response missing data')
    return body.data
  }

  /**
   * Portfolio balances for a wallet on ETN. Design: prices + 24h come from
   * here (indexed); the wallet still pulls *quantity* from RPC so a stale
   * indexer can't hide a drain. This client returns the raw rows; the portfolio
   * merger (T4.2) applies the RPC-is-truth rule.
   */
  async portfolio(chainId: number, ownerAddress: string): Promise<Portfolio> {
    assertElectroneum(chainId)
    const chain = chainIdToGraphQLChain(chainId)
    const query = `
      query PortfolioBalances($ownerAddress: String!, $chains: [Chain!]!) {
        portfolios(ownerAddresses: [$ownerAddress], chains: $chains) {
          id
          tokensTotalDenominatedValue { id value }
          tokensTotalDenominatedValueChange(duration: DAY) {
            absolute { id value }
            percentage { id value }
          }
          tokenBalances {
            id
            quantity
            denominatedValue { id currency value }
            tokenProjectMarket {
              pricePercentChange(duration: DAY) { id value }
              tokenProject { id logoUrl isSpam }
            }
            token { id chain address name symbol standard decimals }
          }
        }
      }`
    const data = await this.query<{ portfolios: Portfolio[] }>(query, {
      ownerAddress,
      chains: [chain],
    })
    const first = data.portfolios?.[0]
    if (!first) return emptyPortfolio()
    return first
  }

  /** Single token market (price + metadata). */
  async tokenMarket(chainId: number, tokenAddress: string): Promise<TokenMarketData> {
    assertElectroneum(chainId)
    const chain = chainIdToGraphQLChain(chainId)
    const query = `
      query BoltTokenMarket($address: String!, $chain: Chain!) {
        token(address: $address, chain: $chain) {
          address symbol name decimals
          market(currency: USD) { price { value currency } }
        }
      }`
    const data = await this.query<{ token: TokenMarketData | null }>(query, {
      address: resolveTokenAddress(tokenAddress),
      chain,
    })
    return data.token ? normalizeToken(data.token, chain) : emptyToken(tokenAddress, chain)
  }

  /**
   * Batch token markets via aliased token(...) fields (fork convention, chunk 12).
   * Returns a Map keyed by the lowercased display address.
   */
  async tokenMarkets(
    chainId: number,
    tokenAddresses: readonly string[],
  ): Promise<Map<string, TokenMarketData>> {
    assertElectroneum(chainId)
    const chain = chainIdToGraphQLChain(chainId)
    const out = new Map<string, TokenMarketData>()
    const CHUNK = 12
    for (let i = 0; i < tokenAddresses.length; i += CHUNK) {
      const chunk = tokenAddresses.slice(i, i + CHUNK)
      const parts = chunk.map((addr, idx) => {
        const alias = `t${idx}`
        return `${alias}: token(address: "${resolveTokenAddress(addr)}", chain: $chain) { address symbol name decimals market(currency: USD) { price { value currency } } }`
      })
      const query = `query BoltBatch($chain: Chain!) { ${parts.join('\n')} }`
      const data = await this.query<Record<string, TokenMarketData | null>>(query, { chain })
      chunk.forEach((addr, idx) => {
        const row = data[`t${idx}`]
        out.set(addr.toLowerCase(), row ? normalizeToken(row, chain) : emptyToken(addr, chain))
      })
    }
    return out
  }

  /** Active liquidity locks for a token + aggregated locked %. */
  async liquidityLocks(chainId: number, tokenAddress: string): Promise<{
    locks: LiquidityLock[]
    totalPercent: number
  }> {
    assertElectroneum(chainId)
    const chain = chainIdToGraphQLChain(chainId)
    const query = `
      query BoltLocks($address: String!, $chain: Chain!) {
        liquidityLocksByToken(address: $address, chain: $chain) {
          lockId pair owner token0 token1 amountToken0 amountToken1 percentSupply active version
        }
      }`
    const data = await this.query<{ liquidityLocksByToken: LiquidityLock[] }>(query, {
      address: resolveTokenAddress(tokenAddress),
      chain,
    })
    const locks = data.liquidityLocksByToken ?? []
    const active = locks.filter((l) => l.active)
    return {
      locks: active,
      totalPercent: active.reduce((s, l) => s + (l.percentSupply || 0), 0),
    }
  }
}

// ---- helpers -----------------------------------------------------------------

function resolveTokenAddress(addr: string): string {
  const a = addr.toLowerCase()
  return a === NATIVE_GRAPHQL_TOKEN_ADDRESS.toLowerCase() ? NATIVE_GRAPHQL_TOKEN_ADDRESS : addr
}

function normalizeToken(
  t: {
    address: string
    symbol: string
    name: string
    decimals: number
    market?: { price?: MarketPrice } | null
  },
  chain: 'ELECTRONEUM' | 'ELECTRONEUM_TEST',
): TokenMarketData {
  return {
    address: t.address,
    chain,
    symbol: t.symbol,
    name: t.name,
    decimals: t.decimals,
    price: t.market?.price ?? null,
  }
}

function emptyToken(address: string, chain: 'ELECTRONEUM' | 'ELECTRONEUM_TEST'): TokenMarketData {
  return { address, chain, symbol: '', name: '', decimals: 18, price: null }
}

function emptyPortfolio(): Portfolio {
  return {
    id: '',
    tokensTotalDenominatedValue: { id: '', value: 0 },
    tokensTotalDenominatedValueChange: {
      absolute: { id: '', value: 0 },
      percentage: { id: '', value: 0 },
    },
    tokenBalances: [],
  }
}

export { isElectroneumChainId }
