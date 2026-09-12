/**
 * @boltvault/platform — the OS capability surface (master plan §2.7 S1).
 *
 * The engine and every pure package depend only on this interface. Each body
 * provides an implementation: `./extension` wraps the chrome/browser API, the
 * Expo app wraps its native modules (lives in apps/mobile so this package
 * never imports react-native), and `./memory` is the in-memory implementation
 * used by tests and tools.
 *
 * Nothing here is allowed to import `chrome`, `browser`, `expo-*` or
 * `react-native*` at module scope — implementations receive their host API as
 * an argument so they stay testable with a fake.
 */

export interface KeyValueStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  remove(key: string): Promise<void>
  /** All keys currently present (used by quarantine and migrations). */
  keys(): Promise<string[]>
}

export interface PlatformStorage {
  /**
   * Durable JSON documents. **Not private**: on the extension this is
   * `chrome.storage.local` (the same area as `secret`, only a different key
   * prefix), and on mobile an unencrypted MMKV file. Anything naming an
   * account, an address or a balance belongs in a DEK-sealed blob
   * (`engine/src/sealed.ts`), not here — see the at-rest audit and §3.2.
   * Reserved for values that must be readable *before* unlock: settings the
   * content script needs at document_start, the KDF parameters needed to
   * unlock, signed public lists, and origin→chain.
   */
  readonly local: KeyValueStore
  /**
   * Unlock material and other in-memory-only state. Extension: storage.session
   * (trusted contexts only, cleared on browser exit). Mobile: process memory.
   */
  readonly session: KeyValueStore
  /**
   * Ciphertext only. Extension: storage.local under a separate prefix. Mobile:
   * app-private storage. The vault DEK never lives here in plaintext.
   */
  readonly secret: KeyValueStore
}

export interface Argon2idInput {
  readonly password: Uint8Array
  readonly salt: Uint8Array
  readonly memoryKiB: number
  readonly iterations: number
  readonly parallelism: number
  readonly hashLength: number
}

export interface Kdf {
  /** RFC 9106 Argon2id. Both bodies must produce byte-identical output. */
  argon2id(input: Argon2idInput): Promise<Uint8Array>
}

export interface AlarmScheduler {
  /** Fire `name` at `atMs` (absolute epoch ms). Re-scheduling replaces. */
  schedule(name: string, atMs: number): Promise<void>
  cancel(name: string): Promise<void>
  onFire(listener: (name: string) => void): () => void
}

export interface KeepAlive {
  /** Keep the host process alive (MV3 SW) until the returned release is called. */
  hold(reason: string): () => void
}

export interface Biometric {
  available(): Promise<boolean>
  prompt(reason: string): Promise<boolean>
}

export interface Clipboard {
  write(text: string): Promise<void>
  /** Write, then overwrite with an empty string after `ms`. */
  writeThenClear(text: string, ms: number): Promise<void>
}

export interface Notification {
  readonly title: string
  readonly body: string
  /** Same tag replaces an earlier notification. */
  readonly tag?: string
}

export type PlatformKind = 'extension' | 'mobile' | 'memory'

export interface Platform {
  readonly kind: PlatformKind
  readonly storage: PlatformStorage
  readonly kdf: Kdf
  readonly alarms: AlarmScheduler
  readonly keepAlive: KeepAlive
  readonly biometric: Biometric
  readonly clipboard: Clipboard
  now(): number
  /** Cryptographically secure random bytes. Never `Math.random`. */
  random(bytes: number): Uint8Array
  openUrl(url: string): Promise<void>
  notify(n: Notification): Promise<void>
  /** Block screenshots / task-switcher previews while secrets are on screen. */
  hidePreview(hide: boolean): Promise<void>
}

export const utf8 = {
  encode: (s: string): Uint8Array => new TextEncoder().encode(s),
  decode: (b: Uint8Array): string => new TextDecoder().decode(b),
}

export function toHex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** Prefix a store so two logical stores can share one physical area. */
export function prefixedStore(inner: KeyValueStore, prefix: string): KeyValueStore {
  const p = `${prefix}:`
  return {
    get: (k) => inner.get(p + k),
    set: (k, v) => inner.set(p + k, v),
    remove: (k) => inner.remove(p + k),
    keys: async () =>
      (await inner.keys()).filter((k) => k.startsWith(p)).map((k) => k.slice(p.length)),
  }
}
