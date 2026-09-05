/**
 * Design T7.2 — DefiLlama display adapter (TVL / protocol, by slug).
 *
 * Display-only enrichment: fetches a protocol's TVL snapshot by its DefiLlama
 * slug. Only the slug goes to the API — NEVER the user's wallet address.
 * Results are cached for `cacheMs` (60s default). HTTP 429, any other
 * HTTP/network error, or a timeout all yield null (unpriced) — never a throw
 * to the UI (market data never blocks the UI when down).
 *
 * Endpoint (under `{apiBase}`, default https://api.llama.fi):
 *   - GET /protocol/{slug}
 */

export interface ProtocolTvData {
  readonly slug: string
  readonly name: string
  /** Total TVL in USD (current). */
  readonly tvl: number
  /** Timestamp (ms) when the TVL was fetched. */
  readonly at: number
}

export interface DefiLlamaOpts {
  readonly fetchImpl: typeof fetch
  /** 60s cache window (design). Default 60_000. */
  readonly cacheMs?: number
  readonly now?: () => number
  readonly apiBase?: string
  readonly timeoutMs?: number
}

interface LlamaProtocol {
  name?: string
  tvl?: number
}

interface CacheEntry {
  readonly data: ProtocolTvData | null
  readonly at: number
}

export class DefiLlamaMarketData {
  private readonly fetchImpl: typeof fetch
  private readonly cacheMs: number
  private readonly now: () => number
  private readonly apiBase: string
  private readonly timeoutMs: number
  private readonly cache = new Map<string, CacheEntry>()

  constructor(opts: DefiLlamaOpts) {
    this.fetchImpl = opts.fetchImpl
    this.cacheMs = opts.cacheMs ?? 60_000
    this.now = opts.now ?? Date.now
    this.apiBase = opts.apiBase ?? 'https://api.llama.fi'
    this.timeoutMs = opts.timeoutMs ?? 8_000
  }

  /** TVL snapshot for a protocol slug; null = unpriced (no data / 429 / error). */
  async protocol(slug: string): Promise<ProtocolTvData | null> {
    const key = slug.toLowerCase()
    const hit = this.cached(key)
    if (hit !== undefined) return hit.data

    const at = this.now()
    const res = await this.fetchJson(`${this.apiBase}/protocol/${encodeURIComponent(slug)}`)
    const data = res !== null && typeof res.tvl === 'number' && Number.isFinite(res.tvl)
      ? { slug, name: res.name ?? slug, tvl: res.tvl, at }
      : null
    this.cache.set(key, { data, at })
    return data
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

  private async fetchJson(url: string): Promise<LlamaProtocol | null> {
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(this.timeoutMs),
      })
      if (res.status === 429) return null // rate-limited → unpriced, no retry
      if (!res.ok) return null // any other HTTP error → unpriced
      const json = (await res.json()) as LlamaProtocol
      if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
      return json
    } catch {
      return null // network error / timeout / bad JSON → unpriced, don't throw to UI
    }
  }
}
