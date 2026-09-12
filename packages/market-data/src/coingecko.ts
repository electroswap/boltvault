import type { MarketData, TokenPrice, TokenPriceMap } from './types'
import { mapKey } from './geckoterminal'

/**
 * Design T7.2 — CoinGecko adapter (token-ids-only).
 *
 * Same display-only rules as the GeckoTerminal adapter: only tokens with an
 * explicit `tokenIds` mapping are priced; everything else is unpriced (null)
 * without hitting the network. Only the CoinGecko token ids go to the API —
 * NEVER the user's wallet address. Results are cached for `cacheMs` (60s
 * default). HTTP 429, any other HTTP/network error, or a timeout all yield
 * null (unpriced) — never a throw to the UI.
 *
 * Endpoint (under `{apiBase}`, default https://api.coingecko.com/api/v3):
 *   - GET /simple/price?ids={id1,id2,...}&vs_currencies=usd&include_24hr_change=true
 * CoinGecko echoes each requested id back keyed by id in the response object,
 * so batch results are matched by id (not array order).
 */

export interface CoinGeckoOpts {
  readonly fetchImpl: typeof fetch
  /**
   * Maps `${chainId}:${address}` (address lowercased — see `mapKey`) to a
   * CoinGecko token id. NO mapping = unpriced.
   */
  readonly tokenIds: Readonly<Record<string, string>>
  /** 60s cache window (design). Default 60_000. */
  readonly cacheMs?: number
  readonly now?: () => number
  readonly apiBase?: string
  readonly timeoutMs?: number
}

interface GeckoSimplePrice {
  usd?: number
  usd_24h_change?: number
}
type GeckoSimpleResponse = Record<string, GeckoSimplePrice>

interface CacheEntry {
  readonly price: TokenPrice | null
  readonly at: number
}

function parseSimplePrice(d: GeckoSimplePrice | undefined, at: number): TokenPrice | null {
  if (d === undefined) return null
  const usd = typeof d.usd === 'number' ? d.usd : parseFloat(String(d.usd))
  if (!Number.isFinite(usd)) return null
  const ch = d.usd_24h_change
  return Number.isFinite(ch) ? { usd, change24h: ch, at } : { usd, at }
}

export class CoinGeckoMarketData implements MarketData {
  private readonly fetchImpl: typeof fetch
  private readonly tokenIds: Readonly<Record<string, string>>
  private readonly cacheMs: number
  private readonly now: () => number
  private readonly apiBase: string
  private readonly timeoutMs: number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(opts: CoinGeckoOpts) {
    this.fetchImpl = opts.fetchImpl
    this.tokenIds = opts.tokenIds
    this.cacheMs = opts.cacheMs ?? 60_000
    this.now = opts.now ?? Date.now
    this.apiBase = opts.apiBase ?? 'https://api.coingecko.com/api/v3'
    this.timeoutMs = opts.timeoutMs ?? 8_000
  }

  async price(chainId: number, address: string): Promise<TokenPrice | null> {
    const key = mapKey(chainId, address)
    const hit = this.cached(key)
    if (hit !== undefined) return hit.price

    const id = this.tokenIds[key]
    if (id === undefined) return null // no mapping → unpriced, no network

    const entry = (await this.fetchBatch([id])).get(id)!
    this.cache.set(key, entry)
    return entry.price
  }

  async prices(chainId: number, addresses: readonly string[]): Promise<TokenPriceMap> {
    const out: TokenPriceMap = {}
    const keyToAddr = new Map<string, string>() // cache key -> lowercased address
    for (const a of addresses) {
      const lower = a.toLowerCase()
      const key = mapKey(chainId, a)
      if (!keyToAddr.has(key)) keyToAddr.set(key, lower) // dedupe
    }

    const toFetch: string[] = []
    for (const key of keyToAddr.keys()) {
      const hit = this.cached(key)
      if (hit !== undefined) out[keyToAddr.get(key)!] = hit.price
      else toFetch.push(key)
    }

    // Group remaining keys by coingecko id so one batch call covers them all.
    // NOTE: `prices` is implemented as ONE batched CoinGecko call for the
    // uncached set (not per-address `price()` calls) — batch results are
    // matched back to addresses via the echoed id key in the response.
    const idToKeys = new Map<string, string[]>()
    for (const key of toFetch) {
      const id = this.tokenIds[key]
      if (id === undefined) {
        out[keyToAddr.get(key)!] = null // unpriced, no network
        continue
      }
      const list = idToKeys.get(id) ?? []
      list.push(key)
      idToKeys.set(id, list)
    }

    if (idToKeys.size > 0) {
      const results = await this.fetchBatch([...idToKeys.keys()])
      for (const [id, keys] of idToKeys) {
        const entry = results.get(id)!
        for (const key of keys) {
          out[keyToAddr.get(key)!] = entry.price
          this.cache.set(key, entry) // cache nulls too (429/error → unpriced for cacheMs)
        }
      }
    }
    return out
  }

  /** Fresh (non-stale) cache entry, or undefined on miss/stale. */
  private cached(key: string): CacheEntry | undefined {
    const hit = this.cache.get(key)
    if (hit === undefined) return undefined
    if (this.now() - hit.at > this.cacheMs) {
      this.cache.delete(key)
      return undefined
    }
    return hit
  }

  /**
   * One GET for all requested coingecko ids (single id → same endpoint).
   * Returns an entry for EVERY requested id: parsed price, or a null entry
   * when the fetch/HTTP/parse failed or the id was missing from the response.
   */
  private async fetchBatch(ids: readonly string[]): Promise<Map<string, CacheEntry>> {
    const out = new Map<string, CacheEntry>()
    const at = this.now()
    const res = await this.fetchJson(
      `${this.apiBase}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
    )
    if (res !== null) {
      for (const id of ids) {
        const d = res[id]
        if (d !== undefined) out.set(id, { price: parseSimplePrice(d, at), at })
      }
    }
    for (const id of ids) {
      if (!out.has(id)) out.set(id, { price: null, at })
    }
    return out
  }

  private async fetchJson(url: string): Promise<GeckoSimpleResponse | null> {
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (res.status === 429) return null // rate-limited → unpriced, no retry
      if (!res.ok) return null // any other HTTP error → unpriced
      const json = (await res.json()) as GeckoSimpleResponse
      if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
      return json
    } catch {
      return null // network error / timeout / bad JSON → unpriced, don't throw to UI
    }
  }
}
