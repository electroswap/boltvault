import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

/**
 * Reduced motion = OS setting (from engine settings, which the platform
 * reports) OR the harness override. The app is complete without motion.
 */
export function useReducedMotion(override?: boolean): boolean {
  const engine = useEngine()
  const [os, setOs] = useState(false)
  useEffect(() => {
    let cancelled = false
    engine.settings.get().then(
      (s) => {
        if (!cancelled) setOs(s.reducedMotion)
      },
      () => undefined,
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'settings.changed' && !cancelled) setOs(e.settings.reducedMotion)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [engine])
  return override ?? os
}
