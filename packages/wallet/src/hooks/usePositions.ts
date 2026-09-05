/**
 * Home › Positions: the persisted snapshot first, then a fresh one, kept
 * current by `positions.changed` events from any surface that moved money.
 */
import type { Positions } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'

const ETN = 52014

export function usePositions(accountId: string | null, enabled = true): { positions: Positions | null; refresh: () => void; loading: boolean } {
  const engine = useEngine()
  const [positions, setPositions] = useState<Positions | null>(null)
  const [loading, setLoading] = useState(false)
  const onChanged = useCallback(
    (e: { positions: Positions }) => {
      if (e.positions.accountId === accountId) setPositions(e.positions)
    },
    [accountId],
  )
  useEngineEvent('positions.changed', onChanged)
  const refresh = useCallback(() => {
    if (!accountId || !enabled) return
    setLoading(true)
    engine.positions.snapshot({ accountId, chainId: ETN }).then(
      (p) => {
        setPositions(p)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [engine, accountId, enabled])
  useEffect(() => {
    if (!accountId || !enabled) return
    let alive = true
    engine.positions.cached({ accountId, chainId: ETN }).then((p) => {
      if (alive && p) setPositions((cur) => cur ?? p)
    }, () => undefined)
    refresh()
    return () => {
      alive = false
    }
  }, [engine, accountId, enabled, refresh])
  return { positions, refresh, loading }
}
