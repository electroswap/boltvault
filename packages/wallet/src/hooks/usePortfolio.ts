import { EngineError, type PortfolioSnapshot } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

export interface PortfolioState {
  readonly snapshot: PortfolioSnapshot | null
  /** The host has no portfolio service yet (or it failed); render the empty state. */
  readonly unavailable: boolean
  readonly error: string | null
}

/**
 * The last-good snapshot first, then every refresh the engine emits. While
 * mounted the heartbeat asks for a refresh on Electroneum's cadence (§2.8);
 * the engine debounces, so several surfaces share one read.
 */
export function usePortfolio(accountId: string | null, intervalMs = 5_000, chainIds?: readonly number[]): PortfolioState {
  const engine = useEngine()
  const [state, setState] = useState<PortfolioState>({ snapshot: null, unavailable: false, error: null })
  const scope = chainIds ? chainIds.join(',') : ''

  useEffect(() => {
    if (!accountId) {
      setState({ snapshot: null, unavailable: false, error: null })
      return
    }
    let cancelled = false
    const ask = (): void => {
      engine.portfolio.snapshot({ accountId, ...(scope ? { chainIds: scope.split(',').map(Number) } : {}) }).then(
        (snapshot) => {
          if (!cancelled) setState((prev) => (prev.snapshot && !snapshot.stale ? { snapshot, unavailable: false, error: null } : prev.snapshot && snapshot.stale ? prev : { snapshot, unavailable: false, error: null }))
        },
        (err: unknown) => {
          if (cancelled) return
          const e = err instanceof EngineError ? err : null
          setState({ snapshot: null, unavailable: e?.code === 'not_implemented', error: e && e.code !== 'not_implemented' ? e.message : null })
        },
      )
    }
    ask()
    const timer = setInterval(ask, intervalMs)
    const off = engine.events.subscribe((e) => {
      if (e.type === 'portfolio.snapshot' && e.snapshot.accountId === accountId && !cancelled) setState({ snapshot: e.snapshot, unavailable: false, error: null })
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      off()
    }
  }, [engine, accountId, intervalMs, scope])

  return state
}
