/**
 * Reduced motion (plan A4) = the Settings › Appearance choice OR the system
 * preference the host reports, OR the harness override. TabShell resolves
 * it once and provides it; every screen reads the same answer. The app is
 * complete without motion.
 */
import { createContext, useContext, useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'

export const MotionContext = createContext<boolean | null>(null)

/** The resolved value from the nearest provider, or the setting itself when there is none (the harness). */
export function useReducedMotion(override?: boolean): boolean {
  const engine = useEngine()
  const host = useHost()
  const provided = useContext(MotionContext)
  const [setting, setSetting] = useState(false)
  useEffect(() => {
    if (provided !== null) return
    let cancelled = false
    engine.settings.get().then(
      (s) => {
        if (!cancelled) setSetting(s.reducedMotion)
      },
      () => undefined,
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'settings.changed' && !cancelled) setSetting(e.settings.reducedMotion)
    })
    return () => {
      cancelled = true
      off()
    }
  }, [engine, provided])
  if (override !== undefined) return override
  if (provided !== null) return provided
  return setting || host.prefersReducedMotion?.() === true
}
