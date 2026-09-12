import type { MarketData, TokenPrice, TokenPriceMap } from './types'

/**
 * Design T7.2 — GeckoTerminal adapter (token-ids-only).
 *
 * Only tokens with an explicit `tokenIds` mapping are priced; everything
 * else is unpriced (null) without hitting the network. Results are cached
 * for `cacheMs` (60s default). HTTP 429, any other HTTP/network error, or a
 * timeout all yield null (unpriced) — never a throw to the UI.
 *
 * Endpoints (both under `{apiBase}`, default https://api.geckoterminal.com/api/v2):
 *   - single: GET /networks/all/tokens/{geckoId}
 *   - batch:  GET /networks/all/tokens/{id1,id2,...}
 * GeckoTerminal echoes each requested token back as an object whose `id`
 * field is the gecko token id — we match batch results to addresses via that
 * id (array order is NOT guaranteed to match the request).
 */

/** GeckoTerminal token mapping (design: token-ids-only). */
export interface GeckoTokenMapping {
  /** gecko token id, e.g. 'ethereum_usdc'. */
  readonly token: string
  readonly geckoId: string
}

export interface GeckoOpts {
  readonly fetchImpl: typeof fetch
  /**
   * Maps `${chainId}:${address}` (address lowercased — see `mapKey`) to a
   * GeckoTerminal token id. NO mapping = unpriced.
   */
  readonly tokenIds: Readonly<Record<string, string>>
  /** 60s cache window (design). Default 60_000. */
  readonly cacheMs?: number
  readonly now?: () => number
  readonly apiBase?: string
  readonly timeoutMs?: number
}

interface GeckoTokenAttrs {
  price_usd: string
  price_change_percentage_24h?: string
}
interface GeckoTokenData {
  id: string
  attributes: GeckoTokenAttrs
}
interface GeckoResponse {
  data: GeckoTokenData[]
}
interface CacheEntry {
  readonly price: TokenPrice | null
  readonly at: number
}

/** Shared key form: `${chainId}:${address.toLowerCase()}` (no viem dep). */
export function mapKey(chainId: number, address: string): string {
  return `${chainId}:${address.toLowerCase()}`
}

function parseTokenPrice(d: GeckoTokenData, at: number): TokenPrice | null {
  const usd = parseFloat(d.attributes.price_usd)
  if (!Number.isFinite(usd)) return null
  const raw = d.attributes.price_change_percentage_24h
  const ch = raw !== undefined && raw !== '' ? parseFloat(raw) : NaN
  return Number.isFinite(ch)
    ? { usd, change24h: ch, at }
    : { usd, at }
}

export class GeckoTerminalMarketData implements MarketData {
  private readonly fetchImpl: typeof fetch
  private readonly tokenIds: Readonly<Record<string, string>>
  private readonly cacheMs: number
  private readonly now: () => number
  private readonly apiBase: string
  private readonly timeoutMs: number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(opts: GeckoOpts) {
    this.fetchImpl = opts.fetchImpl
    this.tokenIds = opts.tokenIds
    this.cacheMs = opts.cacheMs ?? 60_000
    this.now = opts.now ?? Date.now
    this.apiBase = opts.apiBase ?? 'https://api.geckoterminal.com/api/v2'
    this.timeoutMs = opts.timeoutMs ?? 8_000
  }

  async price(chainId: number, address: string): Promise<TokenPrice | null> {
    const key = mapKey(chainId, address)
    const hit = this.cached(key)
    if (hit !== undefined) return hit.price

    const geckoId = this.tokenIds[key]
    if (geckoId === undefined) return null // no mapping → unpriced, no network

    const entry = (await this.fetchBatch([geckoId])).get(geckoId)!
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

    // Group remaining keys by gecko id so one batch call covers them all.
    // NOTE: `prices` is implemented as ONE batched GeckoTerminal call for the
    // uncached set (not per-address `price()` calls) — batch results are
    // matched back to addresses via the echoed `id` field.
    const idToKeys = new Map<string, string[]>()
    for (const key of toFetch) {
      const geckoId = this.tokenIds[key]
      if (geckoId === undefined) {
        out[keyToAddr.get(key)!] = null // unpriced, no network
        continue
      }
      const list = idToKeys.get(geckoId) ?? []
      list.push(key)
      idToKeys.set(geckoId, list)
    }

    if (idToKeys.size > 0) {
      const results = await this.fetchBatch([...idToKeys.keys()])
      for (const [geckoId, keys] of idToKeys) {
        const entry = results.get(geckoId)!
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
   * One GET for all requested gecko ids (single id → same endpoint).
   * Returns an entry for EVERY requested id: parsed price, or a null entry
   * when the fetch/HTTP/parse failed or the id was missing from the response.
   */
  private async fetchBatch(geckoIds: readonly string[]): Promise<Map<string, CacheEntry>> {
    const out = new Map<string, CacheEntry>()
    const at = this.now()
    const res = await this.fetchJson(`${this.apiBase}/networks/all/tokens/${geckoIds.join(',')}`)
    if (res !== null) {
      for (const d of res.data) {
        if (d.id !== undefined) out.set(d.id, { price: parseTokenPrice(d, at), at })
      }
    }
    for (const id of geckoIds) {
      if (!out.has(id)) out.set(id, { price: null, at })
    }
    return out
  }

  private async fetchJson(url: string): Promise<GeckoResponse | null> {
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (res.status === 429) return null // rate-limited → unpriced, no retry
      if (!res.ok) return null // any other HTTP error → unpriced
      const json = (await res.json()) as GeckoResponse
      if (json === null || typeof json !== 'object' || !Array.isArray(json.data)) return null
      return json
    } catch {
      return null // network error / timeout / bad JSON → unpriced, don't throw to UI
    }
  }
}
