/**
 * Mobile Platform (master plan §5.2, v1 exact):
 *
 * - local  → MMKV `bv-local` (non-secret documents)
 * - secret → MMKV `bv-secret`, AES-256 under a 32-character base64 key (192
 *            bits) that lives in the OS keychain
 *            (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no biometry — it guards
 *            ciphertext at rest, not the vault DEK)
 * - session→ process memory only (the unlocked DEK never touches disk)
 * - kdf    → react-native-libsodium `crypto_pwhash` (RFC 9106 Argon2id;
 *            byte-identical to hash-wasm in the extension — CI vector)
 * - biometric → expo-local-authentication (used to gate the device wrap key,
 *            see device-key.ts)
 * - alarms → timers, re-checked on foreground so a background sleep still
 *            locks on time
 */
import { Buffer } from 'buffer'
import type { AlarmScheduler, KeyValueStore, Platform } from '@boltvault/platform'
import * as LocalAuthentication from 'expo-local-authentication'
import { AppState, Linking, Platform as RNPlatform } from 'react-native'
import { excludeFromBackup } from './backup-exclusion'
import * as Keychain from 'react-native-keychain'
import Sodium from 'react-native-libsodium'
import { createMMKV, type MMKV } from 'react-native-mmkv'

function mmkvStore(instance: MMKV): KeyValueStore {
  return {
    get: async (k) => instance.getString(k) ?? null,
    set: async (k, v) => instance.set(k, v),
    remove: async (k) => {
      instance.remove(k)
    },
    keys: async () => instance.getAllKeys(),
  }
}

function memoryStore(): KeyValueStore {
  const map = new Map<string, string>()
  return {
    get: async (k) => map.get(k) ?? null,
    set: async (k, v) => {
      map.set(k, v)
    },
    remove: async (k) => {
      map.delete(k)
    },
    keys: async () => [...map.keys()],
  }
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

const SECRET_STORE_KEY_SERVICE = 'io.electroswap.boltvault.secret-store'

/*
  The MMKV encryption key for the secret store: 24 random bytes as base64.

  MMKV takes the key as a *string* and bounds it by character length, not by
  byte count. The original minted 16 random bytes and hex-encoded them — 32
  characters, twice the 16 the AES-128 default accepts — so the declared
  parameter was out of range and the store was opened under whatever MMKV made
  of it, at best the first 16 hex characters. That is 64 bits, not the 128 the
  byte count suggests.

  Base64 of 24 bytes is 32 characters exactly, which is the AES-256 maximum,
  and carries 192 bits.

  A key of any other shape is one this build did not write, so it is replaced
  rather than used. BoltVault has not shipped, so there is no install whose
  store that could strand — and a developer carrying a stale test vault clears
  the app's data, which is the honest cost of a pre-release scheme change.
*/
const SECRET_KEY_SHAPE = /^[A-Za-z0-9+/]{32}$/

async function secretStoreKey(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: SECRET_STORE_KEY_SERVICE })
  if (existing && SECRET_KEY_SHAPE.test(existing.password)) return existing.password
  const key = Buffer.from(randomBytes(24)).toString('base64')
  await Keychain.setGenericPassword('secret-store', key, {
    service: SECRET_STORE_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
  return key
}

/**
 * Where the MMKV stores live, excluded from the device backup (ES-BV-042).
 *
 * Null when the platform cannot say — in which case the library's default
 * stands, which is what shipped, so a missing file-system module degrades to
 * the old behaviour rather than to no storage at all.
 */
async function storeDirectory(): Promise<string | null> {
  if (RNPlatform.OS !== 'ios' && RNPlatform.OS !== 'android') return null
  try {
    const { Directory, Paths } = await import('expo-file-system')
    /*
      A directory of our own under the app's documents, flagged.

      `Library/Application Support` would be the tidier home, but the pinned
      `expo-file-system` exposes `document`, `cache` and `bundle` and no way to
      reach Library — and the property that matters here is the exclusion, not
      the path. A flagged directory is out of the iCloud and local backups
      wherever it sits.
    */
    const dir = new Directory(Paths.document, 'mmkv')
    if (!dir.exists) dir.create({ intermediates: true })
    /*
      `NSURLIsExcludedFromBackupKey`, where the platform can set it
      (ES-BV-042).

      It cannot today: the pinned `expo-file-system` exposes no such method, so
      this returns false and the encrypted stores are in the phone's backups.
      That is recorded here rather than hidden behind an optional call that
      silently did nothing, and `apps/mobile/tests/backup-exclusion.test.ts`
      fails the day the API arrives so this stops being a comment.
    */
    excludeFromBackup(dir, RNPlatform.OS === 'ios')
    return dir.uri.replace(/^file:\/\//, '').replace(/\/$/, '')
  } catch {
    return null
  }
}

function timerAlarms(): AlarmScheduler {
  const due = new Map<string, number>()
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<(name: string) => void>()
  const fire = (name: string): void => {
    due.delete(name)
    timers.delete(name)
    for (const l of [...listeners]) l(name)
  }
  const arm = (name: string, at: number): void => {
    const t = timers.get(name)
    if (t) clearTimeout(t)
    timers.set(name, setTimeout(() => fire(name), Math.max(0, at - Date.now())))
  }
  // Timers do not run while the app sleeps; on foreground fire anything overdue.
  AppState.addEventListener('change', (s) => {
    if (s !== 'active') return
    for (const [name, at] of [...due.entries()]) if (at <= Date.now()) fire(name)
  })
  return {
    schedule: async (name, atMs) => {
      due.set(name, atMs)
      arm(name, atMs)
    },
    cancel: async (name) => {
      const t = timers.get(name)
      if (t) clearTimeout(t)
      timers.delete(name)
      due.delete(name)
    },
    onFire: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

export async function createMobilePlatform(): Promise<Platform> {
  await Sodium.ready
  /*
    Out of Documents, and out of the backup (ES-BV-042).

    `react-native-mmkv` defaults to `Documents/mmkv`, and on iOS Documents is
    backed up to iCloud and to an unencrypted local backup unless something
    says otherwise. What is in there is the encrypted vault and the settings —
    ciphertext, since the MMKV key itself is `WHEN_UNLOCKED_THIS_DEVICE_ONLY`
    and therefore never leaves — but ciphertext that has left the device is
    ciphertext somebody can grind at their leisure. Application Support is the
    right place for data the user did not create, and the exclusion flag is one
    call.
  */
  const path = await storeDirectory()
  const local = createMMKV({ id: 'bv-local', ...(path ? { path } : {}) })
  const secret = createMMKV({ id: 'bv-secret', ...(path ? { path } : {}), encryptionKey: await secretStoreKey(), encryptionType: 'AES-256' })
  return {
    kind: 'mobile',
    storage: { local: mmkvStore(local), secret: mmkvStore(secret), session: memoryStore() },
    kdf: {
      argon2id: async (i) =>
        Sodium.crypto_pwhash(i.hashLength, i.password, i.salt, i.iterations, i.memoryKiB * 1024, Sodium.crypto_pwhash_ALG_ARGON2ID13),
    },
    alarms: timerAlarms(),
    keepAlive: { hold: () => () => undefined },
    biometric: {
      available: async () => (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()),
      prompt: async (reason) => (await LocalAuthentication.authenticateAsync({ promptMessage: reason, disableDeviceFallback: false })).success,
    },
    clipboard: {
      write: async (text) => {
        const { setStringAsync } = await import('expo-clipboard')
        await setStringAsync(text)
      },
      writeThenClear: async (text, ms) => {
        const { setStringAsync } = await import('expo-clipboard')
        await setStringAsync(text)
        setTimeout(() => void setStringAsync(''), ms)
      },
    },
    now: () => Date.now(),
    random: randomBytes,
    openUrl: async (url) => {
      await Linking.openURL(url)
    },
    notify: async (n) => {
      const { notifyLocal } = await import('./push')
      await notifyLocal({ title: n.title, body: n.body, ...(n.tag ? { data: { tag: n.tag } } : {}) })
    },
    hidePreview: async (hide) => {
      const ScreenCapture = await import('expo-screen-capture')
      if (hide) await ScreenCapture.preventScreenCaptureAsync('secrets')
      else await ScreenCapture.allowScreenCaptureAsync('secrets')
    },
  }
}

/**
 * The encrypted store on its own, for things that are not the engine's
 * (ES-BV-042) — WalletConnect's pairing and session keys, which otherwise sit
 * in AsyncStorage as a plain file.
 *
 * One instance per process: MMKV keeps its own handle, and two `createMMKV`
 * calls with the same id and key answer the same data.
 */
let secretOnly: ReturnType<typeof mmkvStore> | null = null
export async function secretStore(): Promise<ReturnType<typeof mmkvStore>> {
  if (!secretOnly) {
    const path = await storeDirectory()
    secretOnly = mmkvStore(
      createMMKV({ id: 'bv-secret', ...(path ? { path } : {}), encryptionKey: await secretStoreKey(), encryptionType: 'AES-256' }),
    )
  }
  return secretOnly
}

export const isAndroid = RNPlatform.OS === 'android'
