import type { AccountView, VaultStatus, WalletEngine } from '@boltvault/engine'
import { useCallback, useEffect, useSyncExternalStore } from 'react'
import { useEngine } from '../engine/EngineProvider'

export interface WalletState {
  readonly vault: VaultStatus | null
  readonly accounts: readonly AccountView[]
  readonly active: AccountView | null
  readonly loading: boolean
  refresh(): void
}

interface Snapshot {
  readonly vault: VaultStatus | null
  readonly accounts: readonly AccountView[]
  readonly activeId: string | null
  readonly loaded: boolean
}

const NOTHING_KNOWN: Snapshot = { vault: null, accounts: [], activeId: null, loaded: false }

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
 *
 * It is a *store*, not a variable, and that is the whole point (ES-BV-088).
 * It used to be a plain module-level object that each instance copied into its
 * own `useState` at mount and then wrote back to. Nothing told the other
 * instances it had changed, and the guard below discards every ask but the
 * newest — so the only instance that ever saw a reply was whichever one issued
 * the last `refresh()`. Mount three of these and two of them hold
 * `vault: null, accounts: []` for the life of the page.
 *
 * That is a blank screen, not a slow one. Home draws its header from `active`
 * and its body from `vault`, and it has no branch for "the status is still
 * unknown" — so an instance stuck at null renders a header with no seat over
 * an empty page. Owner, on the signed APK: "I saw the splash screen, and then
 * empty screen with the circuit background ... no onboarding." It reproduces
 * in `custody.spec.ts` the moment a second popup is opened over a vault that
 * plainly exists.
 *
 * So the snapshot publishes, every instance reads it through
 * `useSyncExternalStore`, and no instance holds a private copy of it at all.
 */
let snapshot: Snapshot = NOTHING_KNOWN
const listeners = new Set<() => void>()

function publish(patch: Partial<Snapshot>): void {
  snapshot = { ...snapshot, ...patch }
  // Over a copy, because a listener may unsubscribe while this is running.
  for (const listener of [...listeners]) listener()
}

/** The store, for the hook and for the suite: every reader gets the one answer. */
export function subscribeToWalletSnapshot(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function readWalletSnapshot(): Snapshot {
  return snapshot
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
 * discarded rather than trusted.
 *
 * `current()` reads the clock without advancing it. `begin()` still advances
 * it, and the difference is which one `refreshWalletState` uses: an *event* has
 * standing to invalidate a reply in flight, another mount asking the same
 * question at the same moment does not.
 */
export function createGeneration(): {
  begin(): number
  current(): number
  bump(): void
  stillCurrent(token: number): boolean
} {
  let n = 0
  return {
    begin: () => {
      n += 1
      return n
    },
    current: () => n,
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

/**
 * The round trip in flight, and the clocks it was issued against.
 *
 * Every mount calls `refresh()`, so opening the popup fired three Port calls
 * per instance and then threw all but the last set of replies away, because
 * the guard read *a newer ask* as grounds to discard an older one. That rule
 * bought nothing — concurrent asks carry the same answer — and it cost the
 * page its only writer whenever the newest ask was the one that failed.
 *
 * One ask is now shared by everyone who asks while it is open, and an ask that
 * an event has overtaken is not shared: the next caller opens a fresh one
 * against the current clocks.
 */
let asking: { vault: number; accounts: number; done: Promise<void> } | null = null

/** Tests and the harness: forget the shared snapshot. */
export function clearWalletSnapshot(): void {
  vaultGen.bump()
  accountsGen.bump()
  asking = null
  publish(NOTHING_KNOWN)
}

export function refreshWalletState(engine: WalletEngine): Promise<void> {
  const askedVault = vaultGen.current()
  const askedAccounts = accountsGen.current()
  if (asking !== null && asking.vault === askedVault && asking.accounts === askedAccounts) {
    return asking.done
  }
  const done = Promise.all([engine.vault.status(), engine.accounts.list(), engine.accounts.active()])
    .then(
      ([v, list, active]) => {
        const decision = decideReply(
          { vault: v, accounts: list, activeId: active?.id ?? null },
          {
            vaultCurrent: vaultGen.stillCurrent(askedVault),
            accountsCurrent: accountsGen.stillCurrent(askedAccounts),
            now: Date.now(),
          },
        )
        // One publish, so one render pass however many halves landed.
        publish({
          loaded: true,
          ...(decision.vault !== null ? { vault: decision.vault } : {}),
          ...(decision.accounts !== null
            ? { accounts: decision.accounts, activeId: decision.activeId }
            : {}),
        })
        if (decision.lock) void engine.vault.lock()
      },
      // The answer never came. Stop waiting on it — "asked, and the engine
      // could not say" is a state Home can draw, and the next event or mount
      // asks again.
      () => publish({ loaded: true }),
    )
    .finally(() => {
      if (asking?.done === done) asking = null
    })
  asking = { vault: askedVault, accounts: askedAccounts, done }
  return done
}

/**
 * One engine subscription for the whole page, ref-counted.
 *
 * Each instance used to subscribe and write its own state, which was fine
 * while that state was private. It is not fine now that a write publishes:
 * twenty-eight subscribers handling one `accounts.changed` would be
 * twenty-eight publishes, and each publish wakes all twenty-eight.
 */
let attached: { engine: WalletEngine; count: number; off: () => void } | null = null

export function attachWalletStateToEngine(engine: WalletEngine): () => void {
  if (attached !== null && attached.engine !== engine) {
    attached.off()
    attached = null
  }
  if (attached === null) {
    const held: { engine: WalletEngine; count: number; off: () => void } = {
      engine,
      count: 0,
      off: () => {},
    }
    held.off = engine.events.subscribe((e) => {
      // Each event bumps only the clock it actually speaks for.
      if (e.type === 'vault.status') vaultGen.bump()
      if (e.type === 'accounts.changed') accountsGen.bump()
      if (e.type === 'vault.status') {
        if (e.status.unlocked && e.status.lockAt != null && e.status.lockAt <= Date.now()) {
          const lockedStatus = { ...e.status, unlocked: false, unlockedAt: null, lockAt: null, seeds: [] }
          publish({ vault: lockedStatus, loaded: true })
          void engine.vault.lock()
          return
        }
        publish({ vault: e.status, loaded: true })
      }
      if (e.type === 'accounts.changed') {
        publish({ accounts: e.accounts, activeId: e.activeId, loaded: true })
      }
    })
    attached = held
  }
  const held = attached
  held.count += 1
  return () => {
    held.count -= 1
    if (held.count === 0 && attached === held) {
      held.off()
      attached = null
    }
  }
}

/** Vault status + accounts, kept current by engine events. */
export function useWalletState(): WalletState {
  const engine = useEngine()
  const { vault, accounts, activeId, loaded } = useSyncExternalStore(
    subscribeToWalletSnapshot,
    readWalletSnapshot,
    readWalletSnapshot,
  )

  const refresh = useCallback(() => {
    void refreshWalletState(engine)
  }, [engine])

  useEffect(() => {
    refresh()
    return attachWalletStateToEngine(engine)
  }, [engine, refresh])

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null
  return { vault, accounts, active, loading: !loaded, refresh }
}
