/**
 * UI preferences (plan B2): the Home scope, the dismissed coach, the chart
 * timeframe. Defaults paint first; the engine's document replaces them and
 * every page hears a change.
 */
import { DEFAULT_PREFS, type Prefs } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

export function usePrefs(): { prefs: Prefs; loaded: boolean; set: (patch: Partial<Prefs>) => void } {
  const engine = useEngine()
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS)
  const [loaded, setLoaded] = useState(false)
  useEffect(() => {
    let alive = true
    engine.prefs.get().then(
      (p) => {
        if (!alive) return
        setPrefs(p)
        setLoaded(true)
      },
      () => alive && setLoaded(true),
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'prefs.changed' && alive) setPrefs(e.prefs)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine])
  const set = useCallback(
    (patch: Partial<Prefs>) => {
      // Paint the choice at once; the engine's event confirms it.
      setPrefs((p) => ({ ...p, ...patch }))
      void engine.prefs.set(patch).catch(() => undefined)
    },
    [engine],
  )
  return { prefs, loaded, set }
}
