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
 *   - batched market reads pass their addresses as VARIABLES to `tokens(...)`
 *     (chunk 12); see BOLT_BATCH for why they are not pasted into the query.
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

/**
 * Batched token markets. One document, whatever is being asked for.
 *
 * This used to be built per call: an aliased `token(...)` field per address,
 * with the ADDRESSES PASTED INTO THE QUERY TEXT. That made the document itself
 * different for every set of tokens a wallet happened to hold, which meant the
 * API could not put it on its operation allow-list (there is no finite list of
 * them), could not cache it, and could not read it in a log without seeing
 * someone's holdings in the query.
 *
 * The addresses are variables now, so the text is constant. `tokens(...)`
 * answers in the order asked, holding a null for anything it does not know —
 * which is what lets the caller line the answers up with the chunk it sent.
 */
const BOLT_BATCH = `query BoltBatch($contracts: [ContractInput!]!) {
  tokens(contracts: $contracts) {
    address symbol name decimals
    market(currency: USD) { price { value currency } }
  }
}`
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
  readonly denominatedValue: {
    readonly id: string
    readonly currency: string
    readonly value: number
  }
  readonly tokenProjectMarket: {
    readonly pricePercentChange: { readonly id: string; readonly value: number }
    readonly tokenProject: {
      readonly id: string
      readonly logoUrl: string | null
      readonly isSpam: boolean | null
    }
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
  /**
   * Auth headers for one request, or nothing for a keyless caller.
   *
   * A function rather than the key itself: the key must not travel (§9.1), what
   * travels is a per-request MAC, and the code that computes it lives in the
   * engine. Handing this package the key would either drag a crypto dependency
   * into a deliberately dependency-free client or duplicate the algorithm.
   */
  readonly authHeaders?: (method: string, url: string, body: string) => Record<string, string>
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
  private readonly authHeaders:
    ((method: string, url: string, body: string) => Record<string, string>) | undefined
  private readonly referer: string
  private readonly doFetch: typeof fetch

  constructor(opts: ElectroSwapClientOptions = {}) {
    this.url = opts.url ?? DEFAULT_GRAPHQL_URL
    this.authHeaders = opts.authHeaders
    this.referer = opts.referer ?? INTERFACE_REFERER
    this.doFetch = opts.fetchImpl ?? fetch
  }

  private headers(method: string, url: string, body: string): Record<string, string> {
    const h: Record<string, string> = { 'Content-Type': 'application/json' }
    // The URL is a build constant (ElectroSwap's API, or a developer's own services/api), so the
    // interface Referer always travels with the request. The credential is signed per request.
    h['Referer'] = this.referer
    return { ...h, ...(this.authHeaders?.(method, url, body) ?? {}) }
  }

  /** Raw GraphQL POST. Throws ElectroSwapError on !ok or body.errors. */
  async query<T>(query: string, variables: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify({ query, variables })
    const res = await this.doFetch(this.url, {
      method: 'POST',
      headers: this.headers('POST', this.url, payload),
      body: payload,
    })
    if (!res.ok) throw new ElectroSwapError(`GraphQL request failed: ${res.status}`, res.status)
    const body = (await res.json()) as { data?: T; errors?: { message?: string }[] }
    if (body.errors && body.errors.length) {
      throw new ElectroSwapError(body.errors[0]?.message ?? 'GraphQL error')
    }
    if (!body.data) throw new ElectroSwapError('GraphQL response missing data')
    return body.data
  }

  /** REST base next to the GraphQL endpoint (`https://electroswap.io/graphql` → `https://electroswap.io`). */
  get restBase(): string {
    return this.url.replace(/\/graphql\/?$/, '')
  }

  /** `POST /api/nfts/order` — the marketplace's Seaport order intake (§8.10). Answers `{ code: 200 }` on success. */
  async postOrder(
    body: Record<string, unknown>,
  ): Promise<{ ok: boolean; status: number; message: string | null }> {
    const url = `${this.restBase}/api/nfts/order`
    const payload = JSON.stringify(body)
    const res = await this.doFetch(url, {
      method: 'POST',
      headers: this.headers('POST', url, payload),
      body: payload,
    })
    let message: string | null = null
    try {
      const j = (await res.json()) as { code?: number; message?: string }
      message = typeof j.message === 'string' ? j.message : null
      return { ok: res.ok && (j.code === undefined || j.code === 200), status: res.status, message }
    } catch {
      return { ok: res.ok, status: res.status, message }
    }
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
   * Batch token markets (chunk 12). Returns a Map keyed by the lowercased
   * display address.
   *
   * The chunk bounds the request, not the document: `tokens(...)` is capped
   * server-side, and twelve stays well inside it.
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
      const contracts = chunk.map((addr) => ({ chain, address: resolveTokenAddress(addr) }))
      const data = await this.query<{ tokens: (TokenMarketData | null)[] | null }>(BOLT_BATCH, {
        contracts,
      })
      // Positional by contract: the nth answer is the nth address we asked for,
      // and a null means that one is unknown rather than that the list shifted.
      const rows = data.tokens ?? []
      chunk.forEach((addr, idx) => {
        const row = rows[idx]
        out.set(addr.toLowerCase(), row ? normalizeToken(row, chain) : emptyToken(addr, chain))
      })
    }
    return out
  }

  /** Active liquidity locks for a token + aggregated locked %. */
  async liquidityLocks(
    chainId: number,
    tokenAddress: string,
  ): Promise<{
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
