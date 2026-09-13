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
import { createGeneration, decideReply, vaultRequiresUnlock } from '../src/state/useWalletState'
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

/*
  The other half of the same guard: a reply carries a vault status AND the
  accounts, and only one clock used to decide whether any of it was allowed to
  land. So an `accounts.changed` — which says nothing whatsoever about whether
  a vault exists — discarded the vault status travelling beside it, and nothing
  re-asked. `loaded` had already been set by the accounts handler, so `loading`
  went false with `vault` still null, and Home's
  `firstRun = !loading && !vault?.exists` drew "Your vault is not created yet"
  directly above the header for the account it had just loaded.

  `setActive` emits `accounts.changed` alone, as does `announce` (its two emits
  are separated by two awaits), so there was no later `vault.status` to undo it.
*/
const UNLOCKED: VaultStatus = {
  exists: true,
  unlocked: true,
  unlockedAt: 1_000,
  lockAt: null,
  seeds: [],
  wraps: [],
  backupComplete: true,
} as unknown as VaultStatus

const ACCOUNTS = [{ id: 'acct_1', label: 'Main' }] as unknown as readonly { id: string }[]
const reply = { vault: UNLOCKED, accounts: ACCOUNTS as never, activeId: 'acct_1' }

describe('which half of a refresh reply is allowed to land', () => {
  it('keeps the vault status when only the accounts were overtaken', () => {
    const d = decideReply(reply, { vaultCurrent: true, accountsCurrent: false, now: 2_000 })
    // The regression: this used to be null, and Home read null as "no vault".
    expect(d.vault).toEqual(UNLOCKED)
    expect(d.accounts).toBeNull()
    expect(d.lock).toBe(false)
  })

  it('keeps the accounts when only the vault status was overtaken', () => {
    const d = decideReply(reply, { vaultCurrent: false, accountsCurrent: true, now: 2_000 })
    expect(d.vault).toBeNull()
    expect(d.accounts).toEqual(ACCOUNTS)
    expect(d.activeId).toBe('acct_1')
  })

  it('takes both when nothing overtook it', () => {
    const d = decideReply(reply, { vaultCurrent: true, accountsCurrent: true, now: 2_000 })
    expect(d.vault).toEqual(UNLOCKED)
    expect(d.accounts).toEqual(ACCOUNTS)
  })

  it('writes nothing when both were overtaken', () => {
    const d = decideReply(reply, { vaultCurrent: false, accountsCurrent: false, now: 2_000 })
    expect(d.vault).toBeNull()
    expect(d.accounts).toBeNull()
    expect(d.lock).toBe(false)
  })

  /* The lock-screen property the single clock existed for, still held. */
  it('locks a reply taken after the idle deadline had already passed', () => {
    const overdue = { ...UNLOCKED, lockAt: 1_500 } as VaultStatus
    const d = decideReply({ ...reply, vault: overdue }, { vaultCurrent: true, accountsCurrent: true, now: 2_000 })
    expect(d.lock).toBe(true)
    expect(d.vault?.unlocked).toBe(false)
    // Locking clears the accounts with it, whatever the reply carried.
    expect(d.accounts).toEqual([])
    expect(d.activeId).toBeNull()
  })

  it('will not lock on a vault status a newer event has already overtaken', () => {
    const overdue = { ...UNLOCKED, lockAt: 1_500 } as VaultStatus
    const d = decideReply({ ...reply, vault: overdue }, { vaultCurrent: false, accountsCurrent: true, now: 2_000 })
    // No standing to lock, and no standing to paint an unlocked vault either.
    expect(d.lock).toBe(false)
    expect(d.vault).toBeNull()
  })
})
