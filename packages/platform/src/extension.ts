/**
 * Platform for the WXT/MV3 extension. Receives the `chrome`/`browser` API as a
 * structural argument (`ExtensionApi`) so this file never touches a global and
 * a test can pass a fake.
 *
 * - local  → chrome.storage.local under `bv:local:`
 * - secret → chrome.storage.local under `bv:secret:` (ciphertext only)
 * - session→ chrome.storage.session (TRUSTED_CONTEXTS; in-memory in Chrome)
 * - alarms → chrome.alarms (survives SW restarts; the only correct auto-lock)
 * - keepAlive → a 20 s runtime ping while any hold is outstanding
 * - argon2id → hash-wasm in the service worker ('wasm-unsafe-eval')
 */
import { argon2id as hashWasmArgon2id } from 'hash-wasm'
import { prefixedStore, type KeyValueStore, type Platform } from './index'

export interface StorageAreaLike {
  get(keys: string | string[] | null): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
  remove(keys: string | string[]): Promise<void>
  setAccessLevel?(opts: { accessLevel: 'TRUSTED_CONTEXTS' | 'TRUSTED_AND_UNTRUSTED_CONTEXTS' }): Promise<void>
}

export interface AlarmsLike {
  create(name: string, info: { when: number }): Promise<void> | void
  clear(name: string): Promise<boolean> | boolean | void
  onAlarm: {
    addListener(cb: (alarm: { name: string }) => void): void
    removeListener(cb: (alarm: { name: string }) => void): void
  }
}

export interface ExtensionApi {
  storage: { local: StorageAreaLike; session: StorageAreaLike }
  alarms: AlarmsLike
  runtime: { getPlatformInfo(): Promise<unknown> }
  notifications?: {
    create(id: string, opts: { type: 'basic'; title: string; message: string; iconUrl: string }): Promise<string> | void
  }
  tabs?: { create(opts: { url: string }): Promise<unknown> }
}

function areaStore(area: StorageAreaLike): KeyValueStore {
  return {
    async get(key) {
      const res = await area.get(key)
      const v = res[key]
      return typeof v === 'string' ? v : null
    },
    set: (key, value) => area.set({ [key]: value }),
    remove: (key) => area.remove(key),
    async keys() {
      const all = await area.get(null)
      return Object.keys(all)
    },
  }
}

export interface ExtensionPlatformOptions {
  /** Icon URL for notifications (chrome.runtime.getURL('icon-128.png')). */
  readonly iconUrl?: string
  readonly keepAliveIntervalMs?: number
}

export function createExtensionPlatform(api: ExtensionApi, opts: ExtensionPlatformOptions = {}): Platform {
  // Session storage must not be readable by content scripts.
  void api.storage.session.setAccessLevel?.({ accessLevel: 'TRUSTED_CONTEXTS' })

  const local = areaStore(api.storage.local)
  const session = areaStore(api.storage.session)

  const alarmListeners = new Set<(name: string) => void>()
  api.alarms.onAlarm.addListener((alarm) => {
    for (const l of [...alarmListeners]) l(alarm.name)
  })

  const holds = new Set<string>()
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null
  const syncKeepAlive = (): void => {
    if (holds.size > 0 && keepAliveTimer === null) {
      keepAliveTimer = setInterval(() => {
        void api.runtime.getPlatformInfo()
      }, opts.keepAliveIntervalMs ?? 20_000)
    } else if (holds.size === 0 && keepAliveTimer !== null) {
      clearInterval(keepAliveTimer)
      keepAliveTimer = null
    }
  }

  return {
    kind: 'extension',
    storage: {
      local: prefixedStore(local, 'bv:local'),
      secret: prefixedStore(local, 'bv:secret'),
      session: prefixedStore(session, 'bv:session'),
    },
    kdf: {
      argon2id: (input) =>
        hashWasmArgon2id({
          password: input.password,
          salt: input.salt,
          memorySize: input.memoryKiB,
          iterations: input.iterations,
          parallelism: input.parallelism,
          hashLength: input.hashLength,
          outputType: 'binary',
        }),
    },
    alarms: {
      schedule: async (name, atMs) => {
        await api.alarms.create(name, { when: atMs })
      },
      cancel: async (name) => {
        await api.alarms.clear(name)
      },
      onFire: (listener) => {
        alarmListeners.add(listener)
        return () => {
          alarmListeners.delete(listener)
        }
      },
    },
    keepAlive: {
      hold: (reason) => {
        const token = `${reason}#${Math.random().toString(36).slice(2)}`
        holds.add(token)
        syncKeepAlive()
        return () => {
          holds.delete(token)
          syncKeepAlive()
        }
      },
    },
    biometric: {
      // WebAuthn/passkeys are an unlock factor handled by the engine (M2), not a
      // platform biometric prompt; the extension has no OS biometric API.
      available: async () => false,
      prompt: async () => false,
    },
    clipboard: {
      write: (text) => globalThis.navigator.clipboard.writeText(text),
      writeThenClear: async (text, ms) => {
        await globalThis.navigator.clipboard.writeText(text)
        setTimeout(() => {
          void globalThis.navigator.clipboard.writeText('')
        }, ms)
      },
    },
    now: () => Date.now(),
    random: (n) => {
      const out = new Uint8Array(n)
      globalThis.crypto.getRandomValues(out)
      return out
    },
    openUrl: async (url) => {
      if (api.tabs) await api.tabs.create({ url })
    },
    notify: async (n) => {
      if (!api.notifications) return
      await api.notifications.create(n.tag ?? `bv-${Date.now()}`, {
        type: 'basic',
        title: n.title,
        message: n.body,
        iconUrl: opts.iconUrl ?? '',
      })
    },
    // Extension pages cannot block screenshots; the UI keeps secrets in
    // tab.html and clears them on blur (master plan §3.2).
    hidePreview: async () => {},
  }
}
