/**
 * Human activity restarts the idle timer (plan A1): once on install, then at
 * most once per debounce window across every gesture kind, and never after
 * uninstall.
 */
import { describe, expect, it } from 'vitest'
import { installActivityTouch, TOUCH_DEBOUNCE_MS } from '../src/activity-touch'

function fakeWindow() {
  const listeners = new Map<string, Set<() => void>>()
  return {
    addEventListener: (type: string, listener: () => void) => {
      const set = listeners.get(type) ?? new Set<() => void>()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type: string, listener: () => void) => {
      listeners.get(type)?.delete(listener)
    },
    fire: (type: string) => {
      for (const l of listeners.get(type) ?? []) l()
    },
    count: () => [...listeners.values()].reduce((n, s) => n + s.size, 0),
  }
}

describe('installActivityTouch', () => {
  it('touches once on install, debounces gestures, and touches again after the window', () => {
    let now = 0
    let touches = 0
    const engine = { vault: { touch: async () => ({ lockAt: now + 900_000 }) } }
    const win = fakeWindow()
    const wrapped = { vault: { touch: async () => { touches += 1; return engine.vault.touch() } } }
    const off = installActivityTouch(wrapped as never, win, () => now, TOUCH_DEBOUNCE_MS)
    expect(touches).toBe(1)
    expect(win.count()).toBe(4)
    win.fire('pointerdown')
    win.fire('keydown')
    win.fire('wheel')
    expect(touches).toBe(1)
    now += TOUCH_DEBOUNCE_MS
    win.fire('touchstart')
    expect(touches).toBe(2)
    now += 1_000
    win.fire('pointerdown')
    expect(touches).toBe(2)
    off()
    expect(win.count()).toBe(0)
    now += TOUCH_DEBOUNCE_MS
    win.fire('pointerdown')
    expect(touches).toBe(2)
  })

  it('a touch that fails (locked, disconnected) is swallowed', async () => {
    const win = fakeWindow()
    const engine = { vault: { touch: async () => { throw new Error('locked') } } }
    expect(() => installActivityTouch(engine as never, win, () => 0, 0)).not.toThrow()
    await Promise.resolve()
    expect(() => win.fire('keydown')).not.toThrow()
  })
})
