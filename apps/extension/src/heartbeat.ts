/**
 * The one engine: the block heartbeat (design §"The one engine").
 *
 * A single React hook that polls the chain head from the SW and keeps a
 * `HeartbeatState`. The UI renders the filament + head from this one state:
 *
 *   - "the digits roll only when the displayed value actually changed" → we
 *     only bump `block` + `at` when the head actually moved.
 *   - "the filament holds and then snaps to the new head" → between a slow
 *     poll and the next head we HOLD the last head and flag `stale` (derived
 *     live from the age of the last reading); when the head arrives we snap.
 *   - one in-flight guard so slow SW/RPC calls never stack.
 *
 * Node/happy-dom safe: no top-level `browser` access — the client is injected
 * (default the `sw` singleton) so tests can fake it.
 */
import { useEffect, useRef, useState } from 'react'
import { sw, type SwClient } from './sw-client'

export interface HeartbeatState {
  chainId: number
  /** Last head we actually snaped to, or null before the first successful poll. */
  block: number | null
  /** Date.now() when `block` last changed, or null. */
  at: number | null
  /** True while we're past the interval without a fresh head ("holding"). */
  stale: boolean
}

/** Pure staleness check: no reading yet, or the last reading is older than `intervalMs`. */
export function isStale(at: number | null, now: number, intervalMs: number): boolean {
  if (at === null) return true
  return now - at > intervalMs
}

const DEFAULT_INTERVAL_MS = 5000
/** Cadence of the live staleness re-evaluation (independent of the poll interval). */
const STALENESS_TICK_MS = 200

export interface BlockHeartbeatOptions {
  intervalMs?: number
  /** Injectable for tests; defaults to the `sw` singleton. */
  client?: SwClient
}

export function useBlockHeartbeat(
  chainId: number,
  opts: BlockHeartbeatOptions = {},
): { state: HeartbeatState } {
  const intervalMs = opts.intervalMs ?? DEFAULT_INTERVAL_MS
  const client = opts.client ?? sw

  const [state, setState] = useState<HeartbeatState>({
    chainId,
    block: null,
    at: null,
    stale: true,
  })
  // Single in-flight guard across ticks (don't stack slow polls).
  const inflight = useRef(false)

  useEffect(() => {
    let mounted = true
    inflight.current = false
    // A new chain starts with an unknown head — the filament is empty until
    // the first successful poll.
    setState({ chainId, block: null, at: null, stale: true })

    const poll = async () => {
      if (inflight.current) return // in-flight: hold the last head, don't stack
      inflight.current = true
      try {
        const block = await client.blockHead(chainId)
        if (!mounted) return
        setState((s) => {
          // Digits roll only when the displayed value actually changed.
          const changed = s.block !== block
          return {
            chainId,
            block,
            at: changed ? Date.now() : s.at,
            stale: false,
          }
        })
      } catch {
        // Failed poll: hold the last head; staleness is derived from `at`.
      } finally {
        if (mounted) inflight.current = false
      }
    }

    // Poll immediately, then on the interval.
    void poll()
    const pollId = setInterval(() => void poll(), intervalMs)

    // Live staleness: recompute from the age of the last reading so the UI can
    // show "holding" while a poll is in flight and we're past the interval.
    const stalenessId = setInterval(() => {
      if (!mounted) return
      setState((s) => {
        const stale = isStale(s.at, Date.now(), intervalMs)
        if (s.stale === stale) return s // avoid re-render spam
        return { ...s, stale }
      })
    }, STALENESS_TICK_MS)

    return () => {
      mounted = false
      clearInterval(pollId)
      clearInterval(stalenessId)
    }
  }, [chainId, intervalMs, client])

  return { state }
}
