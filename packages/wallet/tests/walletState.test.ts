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
import { createGeneration, vaultRequiresUnlock } from '../src/state/useWalletState'
import type { VaultStatus } from '@boltvault/engine'

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

  it('a newer ask invalidates an older one even without an event', () => {
    const g = createGeneration()
    const first = g.begin()
    const second = g.begin()
    expect(g.stillCurrent(first)).toBe(false)
    expect(g.stillCurrent(second)).toBe(true)
  })

  it('is per-guard, so one surface cannot invalidate another’s', () => {
    const a = createGeneration()
    const b = createGeneration()
    const asked = b.begin()
    a.bump()
    expect(b.stillCurrent(asked)).toBe(true)
  })
})

describe('vaultRequiresUnlock', () => {
  const base = {
    exists: true,
    unlockedAt: 1,
    autoLock: '15min' as const,
    wraps: [],
    seeds: [],
    backupComplete: true,
  } satisfies Omit<VaultStatus, 'unlocked' | 'lockAt'>

  it('holds the lock screen while there is a vault and no session', () => {
    expect(vaultRequiresUnlock({ ...base, unlocked: false, lockAt: null }, 1_000)).toBe(true)
  })

  it('holds the lock screen when the idle deadline is already in the past', () => {
    expect(vaultRequiresUnlock({ ...base, unlocked: true, lockAt: 900 }, 1_000)).toBe(true)
  })

  it('lets Home through only while the session is live and the deadline is ahead', () => {
    expect(vaultRequiresUnlock({ ...base, unlocked: true, lockAt: 2_000 }, 1_000)).toBe(false)
    expect(vaultRequiresUnlock(null, 1_000)).toBe(false)
    expect(vaultRequiresUnlock({ ...base, exists: false, unlocked: false, lockAt: null }, 1_000)).toBe(false)
  })
})
