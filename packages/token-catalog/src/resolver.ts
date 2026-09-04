/**
 * Other-chain list resolver (T7.1) — the "last-good + in-repo fallback" pipeline.
 *
 * For every chain we try, in order:
 *   1. REMOTE   — fetch the pinned public list (6h cache, design).
 *   2. LAST-GOOD — the most recent successful remote fetch (cached in memory).
 *   3. IN-REPO  — a small bundled fallback list (Unichain 130 / Linea 59144),
 *                 so the wallet still has *some* tokens when the network is down
 *                 or a chain has no reliable public list.
 *   4. NONE     — truly empty (no remote, no cache, no bundled fallback).
 *
 * The result always names its `source` so the UI can mark rows as live / stale /
 * fallback. A remote fetch never blocks the UI on failure — it degrades.
 *
 * In-repo fallbacks are generated from real, RPC-verified data (see lists/):
 *   - unichain-130.json: top 200 from the Uniswap public list (chainId 130).
 *   - linea-59144.json:  10 widely-held tokens from the official Linea shortlist
 *                        (RPC-verified to have code on chain 59144).
 */

import {
  PUBLIC_LIST_URLS,
  parseTokenList,
  type RawTokenList,
  type TokenEntry,
} from './catalog'
import lineaFallback from '../lists/linea-59144.json'
import unichainFallback from '../lists/unichain-130.json'

/** Where a resolved list came from — surfaced in the UI. */
export type ListSource = 'remote' | 'last-good' | 'in-repo' | 'none'

export interface ResolveResult {
  readonly tokens: TokenEntry[]
  readonly source: ListSource
  /** true when we fell back to last-good or in-repo (not a live remote). */
  readonly degraded: boolean
}

interface FallbackShape {
  name?: string
  tokens: Array<{
    chainId?: number
    address?: string
    name?: string
    symbol?: string
    decimals?: number
    logoURI?: string
    tags?: string[]
  }>
}

/** In-repo fallbacks, keyed by chainId (only the two chains that need one). */
const IN_REPO_FALLBACKS: Readonly<Record<number, FallbackShape>> = {
  130: unichainFallback as FallbackShape,
  59144: lineaFallback as FallbackShape,
}

/** Parse a bundled fallback list for `chainId` (entry-level chainId filtered). */
export function inRepoTokens(chainId: number): TokenEntry[] {
  const fb = IN_REPO_FALLBACKS[chainId]
  if (!fb) return []
  return parseTokenList(fb as RawTokenList, chainId)
}

export interface ResolveOpts {
  readonly fetchImpl?: typeof fetch
  readonly cache?: Map<number, { tokens: TokenEntry[]; at: number }>
  readonly cacheMs?: number
  readonly now?: number
}

/**
 * Resolve the token universe for a chain across the 4-tier pipeline. Never
 * throws on a failed remote fetch — it degrades to last-good / in-repo / none.
 */
export async function resolveChainList(chainId: number, opts: ResolveOpts = {}): Promise<ResolveResult> {
  const fetchImpl = opts.fetchImpl ?? fetch
  const cache = opts.cache
  const cacheMs = opts.cacheMs ?? 6 * 60 * 60 * 1000
  const now = opts.now ?? Date.now()

  const url = PUBLIC_LIST_URLS[chainId]

  // Tier 1 — remote (only if we have a pinned list URL for this chain).
  if (url) {
    try {
      const res = await fetchImpl(url, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const raw = (await res.json()) as RawTokenList
      const tokens = parseTokenList(raw, chainId)
      if (cache) cache.set(chainId, { tokens, at: now })
      return { tokens, source: 'remote', degraded: false }
    } catch {
      // fall through to last-good
    }
  }

  // Tier 2 — last-good (a prior successful remote fetch, still within cacheMs).
  const lastGood = cache?.get(chainId)
  if (lastGood && now - lastGood.at < cacheMs) {
    return { tokens: lastGood.tokens, source: 'last-good', degraded: true }
  }

  // Tier 3 — in-repo fallback (Unichain / Linea).
  const fb = inRepoTokens(chainId)
  if (fb.length > 0) {
    return { tokens: fb, source: 'in-repo', degraded: true }
  }

  // Tier 4 — none.
  return { tokens: [], source: 'none', degraded: true }
}

/** ChainIds that ship an in-repo fallback (for tests / UI hints). */
export const FALLBACK_CHAIN_IDS: readonly number[] = Object.keys(IN_REPO_FALLBACKS).map(Number)
