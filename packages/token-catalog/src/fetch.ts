import { PUBLIC_LIST_URLS, parseTokenList, type RawTokenList, type TokenEntry } from './catalog.js'

export interface FetchResult {
  tokens: TokenEntry[]
  /** true when we fell back to a cached/last-good list (fetch failed). */
  stale: boolean
}

/**
 * Fetch + validate the pinned public list for a chain. `fetchImpl` is injectable
 * for tests. Returns last-good (cached) on network failure.
 */
export async function fetchTokenList(
  chainId: number,
  opts: {
    fetchImpl?: typeof fetch
    cache?: Map<number, { tokens: TokenEntry[]; at: number }>
    cacheMs?: number
  } = {},
): Promise<FetchResult> {
  const url = PUBLIC_LIST_URLS[chainId]
  if (!url) throw new Error(`No pinned public list for chain ${chainId}`)
  const fetchImpl = opts.fetchImpl ?? fetch
  const cache = opts.cache
  const cacheMs = opts.cacheMs ?? 6 * 60 * 60 * 1000 // 6h per design

  try {
    const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const raw = (await res.json()) as RawTokenList
    const tokens = parseTokenList(raw, chainId)
    if (cache) cache.set(chainId, { tokens, at: Date.now() })
    return { tokens, stale: false }
  } catch (e) {
    const cached = cache?.get(chainId)
    if (cached && Date.now() - cached.at < cacheMs) {
      return { tokens: cached.tokens, stale: true }
    }
    throw new Error(`tokenlist fetch failed for ${chainId}: ${(e as Error).message}`)
  }
}
