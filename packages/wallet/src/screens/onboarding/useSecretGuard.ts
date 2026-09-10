/**
 * What happens around a recovery phrase on screen (master plan §3.2, §8.1).
 *
 * Two promises the product made and had not kept:
 *
 * 1. **Screenshots.** `Platform.hidePreview` existed with no caller anywhere.
 *    On the phone it is `expo-screen-capture`, which blocks the screenshot and
 *    the task-switcher thumbnail. On the extension it is honestly a no-op —
 *    a browser page cannot stop a screenshot, which is exactly why the words
 *    only ever render in `tab.html`.
 * 2. **Blur.** `packages/platform/src/extension.ts` says the UI "clears them on
 *    blur". Nothing did. Now the phrase is masked the moment the surface stops
 *    being the active one.
 *
 * **Masked, not cleared, while hidden.** Clearing on every task-switch would
 * mean a user who checks their password manager comes back to a step that
 * cannot continue — under the create path the phrase exists only in memory, so
 * clearing it would strand them with no way back. Hiding it defeats the
 * screenshot and the shoulder, which is the actual threat; the memory is
 * released on unmount, when the step is genuinely over.
 */
import { useAppHidden } from '@boltvault/ui'
import { useEffect } from 'react'
import { useEngine } from '../../engine/EngineProvider'

export function useSecretGuard(active: boolean): { masked: boolean } {
  const engine = useEngine()
  const hidden = useAppHidden()

  useEffect(() => {
    if (!active) return
    void engine.vault.hidePreview({ hide: true }).catch(() => undefined)
    return () => {
      void engine.vault.hidePreview({ hide: false }).catch(() => undefined)
    }
  }, [engine, active])

  return { masked: active && hidden }
}
