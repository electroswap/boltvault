/**
 * Human activity restarts the idle auto-lock timer (plan A1). Any gesture in
 * an extension page — a pointer, a key, a scroll — calls `vault.touch()` at
 * most once per debounce window, and once when the page opens (opening the
 * wallet is activity). Polling hooks are deliberately not activity: a tab
 * left open must still lock.
 */
import type { WalletEngine } from '@boltvault/engine'

export interface ActivityWindow {
  addEventListener(
    type: string,
    listener: () => void,
    options?: { capture?: boolean; passive?: boolean },
  ): void
  removeEventListener(type: string, listener: () => void, options?: { capture?: boolean }): void
}

const EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const
export const TOUCH_DEBOUNCE_MS = 30_000

export function installActivityTouch(
  engine: Pick<WalletEngine, 'vault'>,
  win: ActivityWindow,
  now: () => number = Date.now,
  debounceMs = TOUCH_DEBOUNCE_MS,
): () => void {
  let last = -Infinity
  const touch = (): void => {
    const t = now()
    if (t - last < debounceMs) return
    last = t
    void engine.vault.touch().catch(() => undefined)
  }
  for (const e of EVENTS) win.addEventListener(e, touch, { capture: true, passive: true })
  touch()
  return () => {
    for (const e of EVENTS) win.removeEventListener(e, touch, { capture: true })
  }
}
