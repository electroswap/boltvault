import { EngineError, type PortfolioSnapshot } from '@boltvault/engine'
import { useEffect, useRef, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useLastGood } from './useLastGood'

export interface PortfolioState {
  readonly snapshot: PortfolioSnapshot | null
  /** The host has no portfolio service yet (or it failed); render the empty state. */
  readonly unavailable: boolean
  readonly error: string | null
}

/**
 * The last-good snapshot first, then every refresh the engine emits.
 *
 * The rebuild follows the chain, not a wall clock. It used to run on its own
 * 5 s `setInterval` — an eth_getBalance, a Multicall3 batch and a
 * PortfolioBalances query every five seconds whether or not anything on chain
 * had moved, and one timer per mounting surface. Now it refreshes when the
 * block advances (`chains.head`, which useChainHead already polls and every
 * surface shares) and keeps a slow fallback so a stalled head still recovers.
 * The engine debounces on top of this, so several surfaces share one read.
 */
const FALLBACK_MS = 30_000

export function usePortfolio(accountId: string | null, _intervalMs = 5_000, chainIds?: readonly number[]): PortfolioState {
  const engine = useEngine()
  const [state, setState] = useState<PortfolioState>({ snapshot: null, unavailable: false, error: null })
  const scope = chainIds ? chainIds.join(',') : ''
  const lastBlock = useRef<string | null>(null)

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
    const timer = setInterval(ask, FALLBACK_MS)
    const off = engine.events.subscribe((e) => {
      if (cancelled) return
      if (e.type === 'portfolio.snapshot' && e.snapshot.accountId === accountId) {
        setState({ snapshot: e.snapshot, unavailable: false, error: null })
        return
      }
      // One rebuild per block, not one per five seconds.
      if (e.type === 'chains.head') {
        const at = String(e.head.blockNumber)
        if (at === lastBlock.current) return
        lastBlock.current = at
        ask()
      }
    })
    return () => {
      cancelled = true
      clearInterval(timer)
      off()
    }
  }, [engine, accountId, scope])

  // Scoped by account and chain selection, so switching either still starts
  // clean rather than showing the previous account's total.
  const remembered = useLastGood(accountId === null ? null : `portfolio:${accountId}:${scope}`, state.snapshot)
  return remembered === state.snapshot ? state : { ...state, snapshot: remembered }
}
