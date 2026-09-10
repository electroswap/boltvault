/**
 * Is this surface out of sight?
 *
 * One hook for both bodies. `AppState` is react-native's, and
 * react-native-web implements it over `visibilitychange` — so the phone's task
 * switcher and the browser's hidden tab arrive through the same API, with no
 * host plumbing and no `.native` split.
 *
 * It exists for the screens that put a recovery phrase on the glass. The
 * extension cannot block a screenshot, and `packages/platform/src/extension.ts`
 * has always said so, promising instead that "the UI keeps secrets in tab.html
 * and clears them on blur". Nothing implemented the second half. This is it.
 */
import { useEffect, useState } from 'react'
import { AppState } from 'react-native'

export function useAppHidden(): boolean {
  const [hidden, setHidden] = useState(false)
  useEffect(() => {
    // `active` is the only state that counts as on screen: `inactive` is the
    // iOS app switcher and a macOS window losing focus, and both are exactly
    // when a phrase should stop being visible.
    const sub = AppState.addEventListener('change', (state) => setHidden(state !== 'active'))
    return () => sub.remove()
  }, [])
  return hidden
}
