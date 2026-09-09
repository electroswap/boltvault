/**
 * Android's hardware/gesture back, wired to the router.
 *
 * Owner: "Android back button closes the app instead of navigating to the
 * prior tab." Nothing listened for it — `BackHandler` appeared nowhere in the
 * repo — so every press fell through to MainActivity and finished the
 * activity.
 *
 * Precedence is "undo the last thing that appeared":
 *   1. a sheet or other overlay      → close it
 *   2. a pushed screen               → pop it
 *   3. an earlier tab                → return to it
 *   4. nothing left                  → let Android close the app
 *
 * Step 4 must return false. Returning true unconditionally would swallow the
 * press and strand the user in an app whose back button does nothing.
 */
import { closeTopOverlay, useHardwareBack } from '@boltvault/ui'
import { useCallback } from 'react'
import { useRouter } from '../navigation/router'

export function useAndroidBack(): void {
  const router = useRouter()
  const stackDepth = router.state.stack.length
  const onBack = useCallback((): boolean => {
    if (closeTopOverlay()) return true
    if (stackDepth > 0) {
      router.back()
      return true
    }
    return router.backTab()
  }, [router, stackDepth])
  useHardwareBack(onBack)
}
