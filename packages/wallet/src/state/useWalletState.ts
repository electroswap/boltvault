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

/**
 * Two clocks, because one reply carries two different truths.
 *
 * There was one, bumped by `vault.status` AND by `accounts.changed`, and the
 * reply was taken or dropped whole. So an `accounts.changed` arriving while
 * `refresh()` was in flight threw away the *vault status* that reply was
 * carrying — and nothing re-asked for it. The accounts handler had already set
 * `loaded: true`, so `loading` went false with `vault` still null, and Home's
 * `firstRun = !loading && !vault?.exists` painted "Your vault is not created
 * yet" above a header showing the account it had just loaded. Owner
 * photographed exactly that.
 *
 * `setActive` (and `announce`, whose two emits are separated by two awaits)
 * emit `accounts.changed` with no `vault.status` beside it, so nothing came
 * along afterwards to put the vault back.
 *
 * Each half is now judged against the events that actually speak for it. The
 * property this guard exists for is untouched: a lock emits `vault.status`,
 * which still bumps the vault clock, so a stale reply can never put
 * `unlocked: true` back.
 */
const vaultGen = createGeneration()
const accountsGen = createGeneration()

/** Tests and the harness: forget the shared snapshot. */
export function clearWalletSnapshot(): void {
  snapshot = { vault: null, accounts: [], activeId: null, loaded: false }
  vaultGen.bump()
  accountsGen.bump()
}

/** What a `refresh()` reply is allowed to write, given what overtook it. */
export interface ReplyDecision {
  readonly vault: VaultStatus | null
  readonly accounts: readonly AccountView[] | null
  readonly activeId: string | null
  /** The reply was taken while the idle deadline had already passed: lock, and clear the accounts with it. */
  readonly lock: boolean
}

/**
 * Which half of a reply still speaks for now — the whole decision, as a pure
 * function, because the hook it lives in cannot be mounted in this suite.
 *
 * `vaultCurrent` / `accountsCurrent` are the two generation checks. A half that
 * an event overtook is returned as null and simply not written.
 */
export function decideReply(
  reply: { vault: VaultStatus; accounts: readonly AccountView[]; activeId: string | null },
  opts: { vaultCurrent: boolean; accountsCurrent: boolean; now: number },
): ReplyDecision {
  const { vault, accounts, activeId } = reply
  /*
    The deadline check belongs to the vault half and only runs when that half
    is still current: if a newer `vault.status` has already spoken, this reply
    has no standing to lock anything.
  */
  if (opts.vaultCurrent && vault.unlocked && vault.lockAt != null && vault.lockAt <= opts.now) {
    return {
      vault: { ...vault, unlocked: false, unlockedAt: null, lockAt: null, seeds: [] },
      accounts: [],
      activeId: null,
      lock: true,
    }
  }
  return {
    vault: opts.vaultCurrent ? vault : null,
    accounts: opts.accountsCurrent ? accounts : null,
    activeId: opts.accountsCurrent ? activeId : null,
    lock: false,
  }
}

/** Vault status + accounts, kept current by engine events. */
export function useWalletState(): WalletState {
  const engine = useEngine()
  const [vault, setVault] = useState<VaultStatus | null>(snapshot.vault)
  const [accounts, setAccounts] = useState<readonly AccountView[]>(snapshot.accounts)
  const [activeId, setActiveId] = useState<string | null>(snapshot.activeId)
  const [loading, setLoading] = useState(!snapshot.loaded)

  const refresh = useCallback(() => {
    const askedVault = vaultGen.begin()
    const askedAccounts = accountsGen.begin()
    Promise.all([engine.vault.status(), engine.accounts.list(), engine.accounts.active()]).then(
      ([v, list, active]) => {
        // The answer arrived, whatever it is allowed to say.
        setLoading(false)
        const decision = decideReply(
          { vault: v, accounts: list, activeId: active?.id ?? null },
          {
            vaultCurrent: vaultGen.stillCurrent(askedVault),
            accountsCurrent: accountsGen.stillCurrent(askedAccounts),
            now: Date.now(),
          },
        )
        if (decision.vault !== null) {
          snapshot = { ...snapshot, vault: decision.vault, loaded: true }
          setVault(decision.vault)
        }
        if (decision.accounts !== null) {
          snapshot = { ...snapshot, accounts: decision.accounts, activeId: decision.activeId, loaded: true }
          setAccounts(decision.accounts)
          setActiveId(decision.activeId)
        }
        if (decision.lock) void engine.vault.lock()
      },
      () => setLoading(false),
    )
  }, [engine])

  useEffect(() => {
    refresh()
    return engine.events.subscribe((e) => {
      // Each event bumps only the clock it actually speaks for.
      if (e.type === 'vault.status') vaultGen.bump()
      if (e.type === 'accounts.changed') accountsGen.bump()
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
