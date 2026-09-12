import type { ActivityEntry } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

/** The local activity log for an account, newest first, kept current by the engine event. */
export function useActivity(
  accountId: string | null,
  chainId?: number,
): { entries: readonly ActivityEntry[]; loaded: boolean } {
  const engine = useEngine()
  const [entries, setEntries] = useState<readonly ActivityEntry[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    if (!accountId) {
      setEntries([])
      setLoaded(true)
      return
    }
    let alive = true
    const filter = (list: readonly ActivityEntry[]): ActivityEntry[] =>
      list.filter(
        (e) => e.accountId === accountId && (chainId === undefined || e.chainId === chainId),
      )
    engine.activity.list({ accountId, ...(chainId !== undefined ? { chainId } : {}) }).then(
      (list) => {
        if (!alive) return
        setEntries(list)
        setLoaded(true)
      },
      () => alive && setLoaded(true),
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'activity.changed') setEntries(filter(e.entries))
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, accountId, chainId])
  return { entries, loaded }
}
