/**
 * Feel (master plan §7.8): haptics and sound through the body's host, gated
 * by Settings › Appearance & feel. Light on confirm and keys, medium on a
 * receipt, heavy on danger/reject; the per-block tick and sound are off by
 * default and never nag.
 */
import type { Settings } from '@boltvault/engine'
import { useCallback, useEffect, useRef } from 'react'
import { useEngine } from './engine/EngineProvider'
import { useHost } from './host'

export interface Feel {
  readonly tick: () => void
  readonly medium: () => void
  readonly heavy: () => void
  readonly confirm: () => void
  readonly receive: () => void
  readonly error: () => void
  readonly block: () => void
}

export function useFeel(): Feel {
  const engine = useEngine()
  const host = useHost()
  const settings = useRef<Pick<Settings, 'haptics' | 'blockTick' | 'sound'> | null>(null)
  useEffect(() => {
    engine.settings.get().then((s) => (settings.current = s), () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'settings.changed') settings.current = e.settings
    })
  }, [engine])
  const haptic = useCallback(
    (kind: 'light' | 'medium' | 'heavy') => {
      if (settings.current?.haptics !== false) host.haptic?.(kind)
    },
    [host],
  )
  const sound = useCallback(
    (kind: 'confirm' | 'receive' | 'error') => {
      if (settings.current?.sound) host.sound?.(kind)
    },
    [host],
  )
  return {
    tick: useCallback(() => haptic('light'), [haptic]),
    medium: useCallback(() => haptic('medium'), [haptic]),
    heavy: useCallback(() => haptic('heavy'), [haptic]),
    confirm: useCallback(() => {
      haptic('light')
      sound('confirm')
    }, [haptic, sound]),
    receive: useCallback(() => {
      haptic('medium')
      sound('receive')
    }, [haptic, sound]),
    error: useCallback(() => {
      haptic('heavy')
      sound('error')
    }, [haptic, sound]),
    block: useCallback(() => {
      if (settings.current?.blockTick) host.haptic?.('light')
    }, [host]),
  }
}

/** Mount once per body: receipts and blocks become feel without every screen wiring it (§7.8). */
export function useFeelEvents(): void {
  const engine = useEngine()
  const feel = useFeel()
  useEffect(
    () =>
      engine.events.subscribe((e) => {
        if (e.type === 'activity.changed') {
          for (const a of e.entries) if (a.status === 'confirmed' && a.category === 'RECEIVE') feel.receive()
        }
        if (e.type === 'chains.head' && e.head.chainId === 52014) feel.block()
      }),
    [engine, feel],
  )
}
