/**
 * One MMKV encryption key per install, whoever asks for it first.
 *
 * The key for `bv-secret` is minted on first run and kept in the OS keychain.
 * The vault file is sealed under it, so the key IS the wallet: lose it and the
 * ciphertext is noise, the vault reads as absent, and the app offers to create
 * a new one. A beta tester hit exactly that — onboarded from their phrase, used
 * the wallet, reopened it later and was asked to create a vault again — and a
 * second tester reproduced it.
 *
 * The cause is a race, not corruption. `App.tsx` builds the platform and
 * WalletKit CONCURRENTLY (`Promise.all`), and both reach `secretStoreKey()`:
 * the platform to open the secret store, WalletKit to put its pairing keys in
 * the same one. On a fresh install the keychain is empty, so both reads miss,
 * both mint a random key, and both write. The last write wins in the keychain
 * while each caller goes on using the key IT minted — so the vault is sealed
 * under one key and the keychain remembers the other. Whether that install
 * survives its first restart is a coin flip.
 *
 * `react-native` and the keychain are native modules, so they stand in here.
 * What is asserted is the invariant, not the implementation: every caller in a
 * process gets the same key, and the keychain is written once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as PlatformModule from '../src/platform'

const state = vi.hoisted(() => ({
  /** The keychain's contents, and every write made to it. */
  stored: null as string | null,
  writes: [] as string[],
  reads: 0,
  /**
   * How many readers must arrive before any of them is allowed to return.
   * 0 disables it. This is what makes the overlap deterministic: on a device
   * it depends on two native round trips racing, which is why it bites some
   * installs and not others.
   */
  barrier: 0,
  waiting: [] as Array<() => void>,
  /** `createMMKV` calls, so the key each store actually opened with is visible. */
  opened: [] as Array<{ id: string; encryptionKey?: string }>,
}))

vi.mock('react-native-keychain', () => ({
  ACCESSIBLE: { WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'whenUnlockedThisDeviceOnly' },
  getGenericPassword: async () => {
    state.reads += 1
    if (state.barrier > 0) {
      // Hold every reader until they have all arrived, so each one decides
      // "no key yet" before any of them has written one.
      await new Promise<void>((resolve) => {
        const releaseAll = (): void => {
          const all = state.waiting
          state.waiting = []
          for (const r of all) r()
        }
        state.waiting.push(resolve)
        if (state.waiting.length >= state.barrier) releaseAll()
        // A lone reader must not hang: once the key is minted a single time —
        // which is the fixed behaviour — the second reader never arrives.
        else setTimeout(releaseAll, 300)
      })
    }
    return state.stored === null ? false : { username: 'secret-store', password: state.stored }
  },
  setGenericPassword: async (_u: string, password: string) => {
    state.writes.push(password)
    state.stored = password
    return true
  },
}))

vi.mock('react-native-mmkv', () => ({
  createMMKV: (opts: { id: string; encryptionKey?: string }) => {
    state.opened.push({ id: opts.id, ...(opts.encryptionKey ? { encryptionKey: opts.encryptionKey } : {}) })
    const map = new Map<string, string>()
    return {
      getString: (k: string) => map.get(k),
      set: (k: string, v: string) => map.set(k, v),
      remove: (k: string) => map.delete(k),
      getAllKeys: () => [...map.keys()],
    }
  },
}))

vi.mock('react-native', () => ({
  Platform: { OS: 'android' },
  AppState: { addEventListener: () => ({ remove: () => undefined }), currentState: 'active' },
  Linking: { openURL: async () => undefined, canOpenURL: async () => true },
}))

vi.mock('react-native-libsodium', () => ({
  default: { ready: Promise.resolve(), crypto_pwhash: () => new Uint8Array(32), crypto_pwhash_ALG_ARGON2ID13: 2 },
}))

vi.mock('expo-local-authentication', () => ({
  hasHardwareAsync: async () => false,
  isEnrolledAsync: async () => false,
  authenticateAsync: async () => ({ success: false }),
}))

vi.mock('expo-file-system', () => ({
  Paths: { document: '/doc' },
  Directory: class {
    exists = true
    constructor(..._args: unknown[]) {}
    create(): void {}
  },
}))

vi.mock('../src/backup-exclusion', () => ({ excludeFromBackup: async () => false }))

async function freshModule(): Promise<typeof PlatformModule> {
  vi.resetModules()
  return import('../src/platform')
}

beforeEach(() => {
  state.stored = null
  state.writes = []
  state.reads = 0
  state.barrier = 0
  state.waiting = []
  state.opened = []
})

describe('the secret store key', () => {
  it('is minted once on a fresh install, however many callers ask at once', async () => {
    const platform = await freshModule()
    // The exact shape of App.tsx's startup: both halves, concurrently, on an
    // install whose keychain is still empty.
    state.barrier = 2
    await Promise.all([platform.createMobilePlatform(), platform.secretStore()])

    expect(state.writes.length, 'the keychain was written more than once — two keys were minted').toBe(1)
  })

  it('opens every bv-secret instance under the key the keychain ends up holding', async () => {
    const platform = await freshModule()
    state.barrier = 2
    await Promise.all([platform.createMobilePlatform(), platform.secretStore()])

    const secrets = state.opened.filter((o) => o.id === 'bv-secret')
    expect(secrets.length).toBeGreaterThan(0)
    for (const s of secrets) {
      // If this differs from the keychain's key, the next launch opens the
      // store with a key that cannot read what this launch wrote: the vault
      // is gone and the app asks for a new one.
      expect(s.encryptionKey, 'a bv-secret store was opened under a key the keychain does not hold').toBe(state.stored)
    }
  })

  it('reuses the stored key on a later launch rather than minting over it', async () => {
    state.stored = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
    const platform = await freshModule()
    await platform.createMobilePlatform()
    await platform.secretStore()
    expect(state.writes, 'an existing key was overwritten — every sealed document is now unreadable').toEqual([])
    expect(state.opened.find((o) => o.id === 'bv-secret')?.encryptionKey).toBe('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA')
  })

  it('asks the keychain once per process, not once per caller', async () => {
    const platform = await freshModule()
    await platform.createMobilePlatform()
    await platform.secretStore()
    expect(state.reads).toBe(1)
  })
})
