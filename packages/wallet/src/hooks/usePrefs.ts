/**
 * UI preferences (plan B2): the Home scope, the dismissed coach, the chart
 * timeframe, hidden balances. Defaults paint first; the engine's document
 * replaces them and every page hears a change.
 */
import { DEFAULT_PREFS, type Prefs } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

/**
 * The last answer, shared by every instance for the life of this page.
 *
 * `DEFAULT_PREFS.homeScope` is Electroneum, and reading the real one is a Port
 * round trip — so with per-instance state every mount of Home or Portfolio
 * started on Electroneum and corrected itself a beat later. Since the shell
 * unmounts a screen on every navigation, that is every navigation: with
 * Ethereum selected, moving Home -> Portfolio painted the whole Electroneum
 * portfolio first — its total, its rows, its pill — for about a second, then
 * flipped. Owner: "It seems like switching from home <-> portfolio that
 * Electroneum is treated as default, and then the actual chain selected comes
 * in after."
 *
 * One snapshot is the honest shape for this: the preference is one value for
 * the whole app, it does not vary by screen, and the second screen to ask
 * should not have to ask again. The read still happens; it just happens behind
 * what is already correct on screen.
 */
let snapshot: { prefs: Prefs; loaded: boolean } = { prefs: DEFAULT_PREFS, loaded: false }

/** Tests and the harness: forget the shared snapshot. */
export function clearPrefsSnapshot(): void {
  snapshot = { prefs: DEFAULT_PREFS, loaded: false }
}

export function usePrefs(): { prefs: Prefs; loaded: boolean; set: (patch: Partial<Prefs>) => void } {
  const engine = useEngine()
  const [prefs, setPrefs] = useState<Prefs>(snapshot.prefs)
  const [loaded, setLoaded] = useState(snapshot.loaded)
  useEffect(() => {
    let alive = true
    engine.prefs.get().then(
      (p) => {
        snapshot = { prefs: p, loaded: true }
        if (!alive) return
        setPrefs(p)
        setLoaded(true)
      },
      () => alive && setLoaded(true),
    )
    const off = engine.events.subscribe((e) => {
      if (e.type !== 'prefs.changed') return
      snapshot = { prefs: e.prefs, loaded: true }
      if (alive) setPrefs(e.prefs)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine])
  const set = useCallback(
    (patch: Partial<Prefs>) => {
      // Paint the choice at once; the engine's event confirms it.
      snapshot = { prefs: { ...snapshot.prefs, ...patch }, loaded: snapshot.loaded }
      setPrefs((p) => ({ ...p, ...patch }))
      void engine.prefs.set(patch).catch(() => undefined)
    },
    [engine],
  )
  return { prefs, loaded, set }
}
