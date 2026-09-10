/**
 * A slower answer must never undo a newer one.
 *
 * This is a lock-screen bug, not a cosmetic one. Resuming the phone app
 * remounts every screen, so `vault.status()` goes out while the vault is still
 * unlocked; the autolock alarm then catches up (`timerAlarms` fires overdue
 * timers on `active`), the engine locks and emits a locked status, and the
 * shell shows Unlock — and then the older reply lands and puts `unlocked: true`
 * back. The wallet showed an unlocked wallet over a locked vault, which is the
 * one thing a lock screen exists to prevent.
 */
import { describe, expect, it } from 'vitest'
import { createGeneration } from '../src/state/useWalletState'

describe('the wallet-state generation guard', () => {
  it('accepts an answer when nothing happened while it was in flight', () => {
    const g = createGeneration()
    const asked = g.begin()
    expect(g.stillCurrent(asked)).toBe(true)
  })

  it('refuses an answer that an event overtook — the lock wins', () => {
    const g = createGeneration()
    const asked = g.begin() // status() goes out; the vault is still unlocked
    g.bump() // the autolock alarm fires and the engine emits a locked status
    expect(g.stillCurrent(asked)).toBe(false) // the stale "unlocked" is dropped
  })

  it('keeps refusing it however many events follow', () => {
    const g = createGeneration()
    const asked = g.begin()
    g.bump()
    g.bump()
    expect(g.stillCurrent(asked)).toBe(false)
  })

  it('lets the next question through, so the UI is not stuck on the old answer', () => {
    const g = createGeneration()
    const stale = g.begin()
    g.bump()
    const asked = g.begin()
    expect(g.stillCurrent(stale)).toBe(false)
    expect(g.stillCurrent(asked)).toBe(true)
  })

  it('is per-guard, so one surface cannot invalidate another’s', () => {
    const a = createGeneration()
    const b = createGeneration()
    const asked = b.begin()
    a.bump()
    expect(b.stillCurrent(asked)).toBe(true)
  })
})
