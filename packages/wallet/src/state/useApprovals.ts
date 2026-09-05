import type { ApprovalRequest } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

/** Pending approvals, oldest first, kept current by the engine event. */
export function useApprovals(): { pending: readonly ApprovalRequest[]; loaded: boolean } {
  const engine = useEngine()
  const [pending, setPending] = useState<readonly ApprovalRequest[]>([])
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    engine.approvals.list().then(
      (list) => {
        if (!alive) return
        setPending(list)
        setLoaded(true)
      },
      () => alive && setLoaded(true),
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'approvals.changed') setPending(e.pending)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine])
  return { pending, loaded }
}
