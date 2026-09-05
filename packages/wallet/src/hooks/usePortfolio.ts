import { EngineError, type PortfolioSnapshot } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

export interface PortfolioState {
  readonly snapshot: PortfolioSnapshot | null
  /** The host has no portfolio service yet (or it failed); render the empty state. */
  readonly unavailable: boolean
  readonly error: string | null
}

export function usePortfolio(accountId: string | null): PortfolioState {
  const engine = useEngine()
  const [state, setState] = useState<PortfolioState>({ snapshot: null, unavailable: false, error: null })

  useEffect(() => {
    if (!accountId) {
      setState({ snapshot: null, unavailable: false, error: null })
      return
    }
    let cancelled = false
    engine.portfolio.snapshot({ accountId }).then(
      (snapshot) => {
        if (!cancelled) setState({ snapshot, unavailable: false, error: null })
      },
      (err: unknown) => {
        if (cancelled) return
        const e = err instanceof EngineError ? err : null
        setState({ snapshot: null, unavailable: e?.code === 'not_implemented', error: e && e.code !== 'not_implemented' ? e.message : null })
      },
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'portfolio.snapshot' && e.snapshot.accountId === accountId && !cancelled) setState({ snapshot: e.snapshot, unavailable: false, error: null })
    })
    return () => {
      cancelled = true
      off()
    }
  }, [engine, accountId])

  return state
}
