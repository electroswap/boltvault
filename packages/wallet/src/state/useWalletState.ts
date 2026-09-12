import type { AccountView, VaultStatus } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

export interface WalletState {
  readonly vault: VaultStatus | null
  readonly accounts: readonly AccountView[]
  readonly active: AccountView | null
  readonly loading: boolean
  refresh(): void
}

/**
 * The last answer, shared by every instance for the life of this page.
 *
 * There are ~28 of these mounted across the app and each one used to start at
 * `{ vault: null, loading: true }` and ask again — three Port round trips per
 * instance, on every mount. Since the shell unmounts a screen on every
 * navigation, that meant a screen you had already seen still rendered its
 * logged-out / empty shape for a beat before flipping, which is the "there ->
 * gone -> there" being reported. It is also what made `active?.id` arrive a
 * round trip late and re-key half the cached lists.
 *
 * The data is identical for every caller, so one snapshot is the honest shape
 * for it. The refresh still runs; it just happens behind what is on screen.
 */
let snapshot: { vault: VaultStatus | null; accounts: readonly AccountView[]; activeId: string | null; loaded: boolean } = {
  vault: null,
  accounts: [],
  activeId: null,
  loaded: false,
}

/**
 * Bumped by every engine event, so a slower answer cannot undo a newer one.
 *
 * `refresh()` is fire-and-forget on ~28 mounts, and its reply used to be applied
 * whenever it happened to arrive. On the phone that is a security bug, not a
 * cosmetic one: resuming the app remounts every screen, so a `vault.status()`
 * goes out while the vault is still unlocked; the autolock alarm then fires
 * (`timerAlarms` catches up overdue timers on `active`), the engine locks and
 * emits a locked status, the shell shows Unlock — and then the older reply
 * lands and puts `unlocked: true` back. Owner: "it just flashes the unlock page
 * and then goes to the home page."
 *
 * The engine was locked the whole time and would have refused to sign, but the
 * wallet showed an unlocked wallet, which is exactly what a lock screen exists
 * to prevent. Events are the newer truth; a reply older than the last event is
 * discarded rather than trusted. A newer `refresh()` also invalidates an older
 * one (`begin` advances the token), so two overlapping asks cannot both apply.
 */
export function createGeneration(): { begin(): number; bump(): void; stillCurrent(token: number): boolean } {
  let n = 0
  return {
    begin: () => {
      n += 1
      return n
    },
    bump: () => {
      n += 1
    },
    stillCurrent: (token) => token === n,
  }
}

/** True when the shell must show Unlock: no session, or the idle deadline has already passed. */
export function vaultRequiresUnlock(vault: VaultStatus | null, now: number): boolean {
  if (!vault?.exists) return false
  if (!vault.unlocked) return true
  return vault.lockAt != null && vault.lockAt <= now
}

const generation = createGeneration()

/** Tests and the harness: forget the shared snapshot. */
export function clearWalletSnapshot(): void {
  snapshot = { vault: null, accounts: [], activeId: null, loaded: false }
  generation.bump()
}

/** Vault status + accounts, kept current by engine events. */
export function useWalletState(): WalletState {
  const engine = useEngine()
  const [vault, setVault] = useState<VaultStatus | null>(snapshot.vault)
  const [accounts, setAccounts] = useState<readonly AccountView[]>(snapshot.accounts)
  const [activeId, setActiveId] = useState<string | null>(snapshot.activeId)
  const [loading, setLoading] = useState(!snapshot.loaded)

  const refresh = useCallback(() => {
    const asked = generation.begin()
    Promise.all([engine.vault.status(), engine.accounts.list(), engine.accounts.active()]).then(
      ([v, list, active]) => {
        // Something authoritative happened while this was in flight. Stop
        // loading — the answer arrived — but do not let it speak for now.
        if (!generation.stillCurrent(asked)) {
          setLoading(false)
          return
        }
        // A reply taken while the idle deadline had already passed must not
        // paint Home. The engine now locks inside `status()`, but a racing
        // snapshot can still carry `unlocked: true` with a past `lockAt`.
        if (v.unlocked && v.lockAt != null && v.lockAt <= Date.now()) {
          const lockedStatus = { ...v, unlocked: false, unlockedAt: null, lockAt: null, seeds: [] }
          snapshot = { vault: lockedStatus, accounts: [], activeId: null, loaded: true }
          setVault(lockedStatus)
          setAccounts([])
          setActiveId(null)
          setLoading(false)
          void engine.vault.lock()
          return
        }
        snapshot = { vault: v, accounts: list, activeId: active?.id ?? null, loaded: true }
        setVault(v)
        setAccounts(list)
        setActiveId(active?.id ?? null)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [engine])

  useEffect(() => {
    refresh()
    return engine.events.subscribe((e) => {
      if (e.type === 'vault.status' || e.type === 'accounts.changed') generation.bump()
      if (e.type === 'vault.status') {
        if (e.status.unlocked && e.status.lockAt != null && e.status.lockAt <= Date.now()) {
          const lockedStatus = { ...e.status, unlocked: false, unlockedAt: null, lockAt: null, seeds: [] }
          snapshot = { ...snapshot, vault: lockedStatus, loaded: true }
          setVault(lockedStatus)
          void engine.vault.lock()
          return
        }
        snapshot = { ...snapshot, vault: e.status, loaded: true }
        setVault(e.status)
      }
      if (e.type === 'accounts.changed') {
        snapshot = { ...snapshot, accounts: e.accounts, activeId: e.activeId, loaded: true }
        setAccounts(e.accounts)
        setActiveId(e.activeId)
      }
    })
  }, [engine, refresh])

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null
  return { vault, accounts, active, loading, refresh }
}
