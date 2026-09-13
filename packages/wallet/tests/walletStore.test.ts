/**
 * ES-BV-088 — the blank screen on a fresh signed APK.
 *
 * The wallet snapshot was a plain module-level object. Every `useWalletState`
 * copied it into `useState` at mount and wrote back to it on reply, and
 * nothing told the other instances it had moved. Combined with the generation
 * guard — which discarded every ask but the newest — exactly one instance in
 * the tree ever saw an answer: whichever one issued the last `refresh()`. The
 * rest held `vault: null, accounts: []` for the life of the page.
 *
 * Home draws its header from `active` and its body from `vault`, and it had no
 * branch at all for a null vault, so an instance stuck at null rendered a
 * header with no seat over nothing. Owner, on the signed APK: "I saw the
 * splash screen, and then empty screen with the circuit background ... no
 * onboarding." `custody.spec.ts` reproduces it on the second popup, over a
 * vault that plainly exists — and it reproduced before the `firstRun` change
 * too, just as the wrong screen rather than no screen.
 *
 * The snapshot is a store now. These are the properties that make the screen
 * impossible to blank: every reader is told, one ask serves them all, a
 * refusal invents nothing, and the lock-screen guard still outranks a reply
 * that was already in flight.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import {
  attachWalletStateToEngine,
  clearWalletSnapshot,
  readWalletSnapshot,
  refreshWalletState,
  subscribeToWalletSnapshot,
} from '../src/state/useWalletState'
import type { AccountView, VaultStatus } from '@boltvault/engine'

const UNLOCKED = {
  exists: true,
  unlocked: true,
  unlockedAt: 1_000,
  lockAt: null,
  seeds: [],
  wraps: [],
  backupComplete: true,
} as unknown as VaultStatus

const ACCOUNT = { id: 'acct_1', label: 'Main', address: '0x1' } as unknown as AccountView

function fakeEngine(status: () => Promise<VaultStatus>) {
  const calls = { status: 0, list: 0 }
  let emit: ((e: unknown) => void) | null = null
  const engine = {
    vault: {
      status: () => {
        calls.status += 1
        return status()
      },
      lock: () => Promise.resolve(),
    },
    accounts: {
      list: () => {
        calls.list += 1
        return Promise.resolve([ACCOUNT])
      },
      active: () => Promise.resolve(ACCOUNT),
    },
    events: {
      subscribe: (fn: (e: unknown) => void) => {
        emit = fn
        return () => {
          emit = null
        }
      },
    },
  }
  return {
    engine: engine as unknown as Parameters<typeof refreshWalletState>[0],
    calls,
    emit: (e: unknown) => emit?.(e),
  }
}

describe('the wallet snapshot is a store, not a variable', () => {
  beforeEach(() => clearWalletSnapshot())

  it('tells every reader about the answer, not just the one that asked last', async () => {
    const seen = [0, 0, 0]
    const offs = seen.map((_, i) => subscribeToWalletSnapshot(() => (seen[i] += 1)))
    const { engine } = fakeEngine(() => Promise.resolve(UNLOCKED))
    await refreshWalletState(engine)
    // The regression: two of these three were never told, and rendered blank.
    expect(seen.every((n) => n > 0)).toBe(true)
    expect(readWalletSnapshot().accounts).toEqual([ACCOUNT])
    expect(readWalletSnapshot().activeId).toBe('acct_1')
    expect(readWalletSnapshot().loaded).toBe(true)
    for (const off of offs) off()
  })

  it('serves every mount that asks at once from one round trip', async () => {
    const { engine, calls } = fakeEngine(() => Promise.resolve(UNLOCKED))
    // Twenty-eight instances mounting is twenty-eight `refresh()` calls.
    await Promise.all(Array.from({ length: 28 }, () => refreshWalletState(engine)))
    expect(calls.status).toBe(1)
    expect(calls.list).toBe(1)
    expect(readWalletSnapshot().vault).toEqual(UNLOCKED)
  })

  it('asks again once the answer has landed', async () => {
    const { engine, calls } = fakeEngine(() => Promise.resolve(UNLOCKED))
    await refreshWalletState(engine)
    await refreshWalletState(engine)
    expect(calls.status).toBe(2)
  })

  it('stops waiting when the engine cannot answer, and invents nothing', async () => {
    const { engine } = fakeEngine(() => Promise.reject(new Error('port closed')))
    await refreshWalletState(engine)
    /*
      `loading` must go false — Home has a "cannot reach the wallet" branch for
      exactly this — but a refused status is not a vault that does not exist,
      and offering "Create vault" over somebody's funded wallet is the worst
      thing this screen could do.
    */
    expect(readWalletSnapshot().loaded).toBe(true)
    expect(readWalletSnapshot().vault).toBeNull()
  })

  it('still lets a lock event outrank the reply that was already in flight', async () => {
    let release: (v: VaultStatus) => void = () => {}
    const { engine, emit } = fakeEngine(() => new Promise<VaultStatus>((r) => (release = r)))
    const off = attachWalletStateToEngine(engine)
    const inFlight = refreshWalletState(engine)
    // The autolock alarm fires while `status()` is still out.
    const locked = { ...UNLOCKED, unlocked: false, unlockedAt: null, lockAt: null } as VaultStatus
    emit({ type: 'vault.status', status: locked })
    release(UNLOCKED)
    await inFlight
    expect(readWalletSnapshot().vault?.unlocked).toBe(false)
    off()
  })

  it('keeps one engine subscription however many instances are mounted', () => {
    let live = 0
    const engine = {
      events: {
        subscribe: () => {
          live += 1
          return () => {
            live -= 1
          }
        },
      },
    } as unknown as Parameters<typeof attachWalletStateToEngine>[0]
    const offs = Array.from({ length: 28 }, () => attachWalletStateToEngine(engine))
    expect(live).toBe(1)
    for (const off of offs) off()
    expect(live).toBe(0)
  })
})
