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
/** The engine's own default scope when a caller names no chains. */
const ETN = 52014

/** Same chains, whatever order they were asked for in. */
function sameScope(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) return false
  const x = [...a].sort((m, n) => m - n)
  const y = [...b].sort((m, n) => m - n)
  return x.every((v, i) => v === y[i])
}

/**
 * `chainIds` says which chains; `null` says "the scope is not known yet".
 *
 * That distinction matters because the default scope is Electroneum, so a
 * caller that guesses while its preference is still loading does not show
 * nothing — it shows a different chain's money. Holding is the honest state.
 */
export function usePortfolio(
  accountId: string | null,
  _intervalMs = 5_000,
  chainIds?: readonly number[] | null,
): PortfolioState {
  const engine = useEngine()
  const [state, setState] = useState<PortfolioState>({
    snapshot: null,
    unavailable: false,
    error: null,
  })
  // Always explicit, so the scope this hook waits for is the scope it asked
  // for — an unscoped call still means "the home chain", which is what the
  // engine defaults to.
  const held = chainIds === null
  const scope = (chainIds && chainIds.length ? [...chainIds] : [ETN]).join(',')
  const lastBlock = useRef<string | null>(null)

  useEffect(() => {
    /*
      A new scope is a new question, and the previous chain's answer is not a
      provisional answer to it.

      This state survived a scope change — only the account was ever cleared —
      and the first reply for a new scope is always `stale: true`, which the
      rule below deliberately keeps `prev` for. So switching Home from
      Electroneum to Ethereum went on showing Electroneum's total, its token
      count and its rows under the Ethereum pill until a fresh build landed
      seconds later. Owner: "I'm seeing weird numbers until chain data is able
      to refresh."

      Scoping the engine's cache was necessary and not sufficient: the wrong
      figure was being held here, in front of it.
    */
    setState({ snapshot: null, unavailable: false, error: null })
    if (!accountId || held) return
    let cancelled = false
    const wanted = scope.split(',').map(Number)
    const ask = (): void => {
      engine.portfolio.snapshot({ accountId, chainIds: wanted }).then(
        (snapshot) => {
          if (cancelled || !sameScope(snapshot.chainIds, wanted)) return
          // Within one scope a stale re-read never displaces a fresh answer;
          // that is what stops a background refresh blanking the hero.
          setState((prev) =>
            prev.snapshot && snapshot.stale ? prev : { snapshot, unavailable: false, error: null },
          )
        },
        (err: unknown) => {
          if (cancelled) return
          const e = err instanceof EngineError ? err : null
          setState({
            snapshot: null,
            unavailable: e?.code === 'not_implemented',
            error: e && e.code !== 'not_implemented' ? e.message : null,
          })
        },
      )
    }
    ask()
    const timer = setInterval(ask, FALLBACK_MS)
    const off = engine.events.subscribe((e) => {
      if (cancelled) return
      /*
        Only this hook's own scope. The event is broadcast for every rebuild on
        the account, and Home rebuilding "All chains" would otherwise land its
        rows and its total on a Send screen that had asked about one chain —
        which is the other half of "switching between chains causes some really
        weird behaviors".
      */
      if (
        e.type === 'portfolio.snapshot' &&
        e.snapshot.accountId === accountId &&
        sameScope(e.snapshot.chainIds, wanted)
      ) {
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
  }, [engine, accountId, scope, held])

  // Scoped by account and chain selection, so switching either still starts
  // clean rather than showing the previous account's total.
  const remembered = useLastGood(
    accountId === null || held ? null : `portfolio:${accountId}:${scope}`,
    state.snapshot,
  )
  return remembered === state.snapshot ? state : { ...state, snapshot: remembered }
}
