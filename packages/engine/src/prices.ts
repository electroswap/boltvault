/**
 * Display prices off Electroneum (master plan §10.4): GeckoTerminal by token
 * address, 60 s cache, 429/timeouts → unpriced. Only token addresses ever
 * leave the wallet — never the account. The ElectroSwap proxy (§9.4, B6)
 * takes over when it exists; this is the direct fallback the plan allows.
 */
import { getChain } from '@boltvault/chains'

export interface PriceSource {
  prices(chainId: number, addresses: readonly string[]): Promise<Map<string, { price: number; change24h: number | null }>>
}

/** GeckoTerminal network slugs for the registry's chains. */
const NETWORKS: Readonly<Record<number, string>> = { 1: 'eth', 56: 'bsc', 8453: 'base', 10: 'optimism', 137: 'polygon_pos', 43114: 'avax', 42161: 'arbitrum', 130: 'unichain', 59144: 'linea' }

const TTL_MS = 60_000
const BATCH = 30

export class GeckoTerminalPrices implements PriceSource {
  private cache = new Map<string, { at: number; price: number; change24h: number | null }>()
  private cooldownUntil = 0

  constructor(
    private readonly fetchImpl: typeof fetch,
    private readonly now: () => number,
    private readonly base = 'https://api.geckoterminal.com/api/v2',
  ) {}

  async prices(chainId: number, addresses: readonly string[]): Promise<Map<string, { price: number; change24h: number | null }>> {
    const out = new Map<string, { price: number; change24h: number | null }>()
    const network = NETWORKS[chainId]
    if (!network) return out
    const wrapped = getChain(chainId)?.wrappedNative ?? null
    const wanted = [...new Set(addresses.map((a) => (a === 'native' ? wrapped : a)).filter((a): a is string => !!a).map((a) => a.toLowerCase()))]
    const missing: string[] = []
    for (const a of wanted) {
      const hit = this.cache.get(`${chainId}:${a}`)
      if (hit && this.now() - hit.at < TTL_MS) out.set(a, { price: hit.price, change24h: hit.change24h })
      else missing.push(a)
    }
    if (missing.length && this.now() >= this.cooldownUntil) {
      for (let i = 0; i < missing.length; i += BATCH) {
        const chunk = missing.slice(i, i + BATCH)
        try {
          const res = await this.fetchImpl(`${this.base}/networks/${network}/tokens/multi/${chunk.join(',')}`, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(6_000) })
          if (res.status === 429) {
            this.cooldownUntil = this.now() + 5 * 60_000
            break
          }
          if (!res.ok) break
          const json = (await res.json()) as { data?: Array<{ attributes?: { address?: string; price_usd?: string | null } }> }
          for (const row of json.data ?? []) {
            const addr = row.attributes?.address?.toLowerCase()
            const price = Number(row.attributes?.price_usd)
            if (!addr || !Number.isFinite(price) || price <= 0) continue
            this.cache.set(`${chainId}:${addr}`, { at: this.now(), price, change24h: null })
            out.set(addr, { price, change24h: null })
          }
        } catch {
          break
        }
      }
    }
    // Map the wrapped native back to 'native' for the caller.
    if (wrapped) {
      const w = out.get(wrapped.toLowerCase())
      if (w) out.set('native', w)
    }
    return out
  }
}
