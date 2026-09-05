/**
 * SWR-style data hooks (E0a) — the popup's data access layer.
 *
 * Design laws encoded here (the design spec):
 *  - "Chamber first paint < 150ms ... live numbers reconcile" + "stall copy
 *    + Retry" → on a FAILED re-fetch we KEEP the last-good data, flag `stale`,
 *    and never blank the chamber. `loading` is only true before the very first
 *    read resolves.
 *  - Refresh cadence: ETN 52014 = 15s, other chains 30s.
 *
 * Node/happy-dom safe: the client is injected (default the `sw` singleton) so
 * tests can fake it; no top-level `browser` access.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { sw, type SwClient } from './sw-client'
import type { SafeRow } from './sw-messages'

export interface AsyncState<T> {
  data: T | null
  error: string | null
  /** True only before the first read resolves. */
  loading: boolean
  /** True when a re-fetch failed and we're holding last-good. */
  stale: boolean
  refresh: () => Promise<void>
}

export interface PortfolioData {
  chainId: number
  account: string
  native: SafeRow | null
  rows: SafeRow[]
  pricedTotalUsd: number
  at: number
}

export interface UseDataOpts {
  refreshMs?: number
  client?: SwClient
}

/** Default cadence per chain (ETN 15s, other 30s). */
function defaultRefreshMs(chainId: number): number {
  return chainId === 52014 ? 15000 : 30000
}

/**
 * The portfolio snapshot (total + rows) with last-good + refresh semantics.
 */
export function usePortfolio(
  chainId: number,
  account: string,
  opts: UseDataOpts = {},
): AsyncState<PortfolioData> {
  const client = opts.client ?? sw
  const refreshMs = opts.refreshMs ?? defaultRefreshMs(chainId)

  const [data, setData] = useState<PortfolioData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const hasLoaded = useRef(false)
  const inflight = useRef(false)

  const load = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const d = await client.portfolio(chainId, account)
      setData(d)
      setError(null)
      setStale(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'refresh failed')
      // A failed re-fetch keeps last-good; a failed FIRST load leaves data null.
      if (hasLoaded.current) setStale(true)
    } finally {
      inflight.current = false
      hasLoaded.current = true
      setLoading(false)
    }
  }, [client, chainId, account])

  useEffect(() => {
    // A new (chainId, account) starts cold — reset to the loading state.
    hasLoaded.current = false
    inflight.current = false
    setData(null)
    setError(null)
    setStale(false)
    setLoading(true)
    void load()
    const id = setInterval(() => {
      if (hasLoaded.current) void load()
    }, refreshMs)
    return () => clearInterval(id)
  }, [chainId, account, refreshMs, load])

  return { data, error, loading, stale, refresh: load }
}

/**
 * A single token's USD price with the same last-good + refresh semantics.
 */
export function useTokenPrice(
  chainId: number,
  address: string,
  opts: UseDataOpts = {},
): AsyncState<number | null> {
  const client = opts.client ?? sw
  const refreshMs = opts.refreshMs ?? defaultRefreshMs(chainId)

  const [data, setData] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [stale, setStale] = useState(false)
  const hasLoaded = useRef(false)
  const inflight = useRef(false)

  const load = useCallback(async () => {
    if (inflight.current) return
    inflight.current = true
    try {
      const usd = await client.price(chainId, address)
      setData(usd)
      setError(null)
      setStale(false)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'price refresh failed')
      if (hasLoaded.current) setStale(true)
    } finally {
      inflight.current = false
      hasLoaded.current = true
      setLoading(false)
    }
  }, [client, chainId, address])

  useEffect(() => {
    hasLoaded.current = false
    inflight.current = false
    setData(null)
    setError(null)
    setStale(false)
    setLoading(true)
    void load()
    const id = setInterval(() => {
      if (hasLoaded.current) void load()
    }, refreshMs)
    return () => clearInterval(id)
  }, [chainId, address, refreshMs, load])

  return { data, error, loading, stale, refresh: load }
}
