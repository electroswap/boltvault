/**
 * Mobile Platform (master plan §5.2, v1 exact):
 *
 * - local  → MMKV `bv-local` (non-secret documents)
 * - secret → MMKV `bv-secret`, encrypted with a random key that lives in the
 *            OS keychain (`WHEN_UNLOCKED_THIS_DEVICE_ONLY`, no biometry — it
 *            guards ciphertext at rest, not the vault DEK)
 * - session→ process memory only (the unlocked DEK never touches disk)
 * - kdf    → react-native-libsodium `crypto_pwhash` (RFC 9106 Argon2id;
 *            byte-identical to hash-wasm in the extension — CI vector)
 * - biometric → expo-local-authentication (used to gate the device wrap key,
 *            see device-key.ts)
 * - alarms → timers, re-checked on foreground so a background sleep still
 *            locks on time
 */
import type { AlarmScheduler, KeyValueStore, Platform } from '@boltvault/platform'
import * as LocalAuthentication from 'expo-local-authentication'
import { AppState, Linking, Platform as RNPlatform } from 'react-native'
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

/** The MMKV encryption key for the secret store, minted once and kept in the keychain. */
async function secretStoreKey(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: SECRET_STORE_KEY_SERVICE })
  if (existing && existing.password) return existing.password
  const key = Array.from(randomBytes(16), (b) => b.toString(16).padStart(2, '0')).join('')
  await Keychain.setGenericPassword('secret-store', key, {
    service: SECRET_STORE_KEY_SERVICE,
    accessible: Keychain.ACCESSIBLE.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  })
  return key
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
  const local = createMMKV({ id: 'bv-local' })
  const secret = createMMKV({ id: 'bv-secret', encryptionKey: await secretStoreKey() })
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

export const isAndroid = RNPlatform.OS === 'android'
