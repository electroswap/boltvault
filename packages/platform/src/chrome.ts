import type { KeyValueStore, Platform, SecretStore } from './types'

/**
 * Chrome-extension Platform implementation (S1).
 *
 * Injectable stores: pass real chrome.storage-backed stores in production.
 * If omitted, a private in-memory store is used (handy for tests/dev).
 *
 * Node-safety: every access to a browser global (`crypto`, `window`) goes
 * through a guarded getter, so `import`-ing this module (and calling the
 * factory) under plain node does not throw.
 */

function makeMemoryStore(): KeyValueStore {
  const m = new Map<string, string>()
  return {
    async get(k) {
      return m.has(k) ? m.get(k)! : null
    },
    async set(k, v) {
      m.set(k, v)
    },
    async remove(k) {
      m.delete(k)
    },
  }
}

function getCrypto(): Crypto | null {
  try {
    // globalThis.crypto exists in modern node and browsers.
    return (globalThis as { crypto?: Crypto }).crypto ?? null
  } catch {
    return null
  }
}

export function chromePlatform(stores?: {
  local: KeyValueStore
  session: KeyValueStore
  secret: SecretStore
}): Platform {
  const local = stores?.local ?? makeMemoryStore()
  const session = stores?.session ?? makeMemoryStore()
  const secret = stores?.secret ?? makeMemoryStore()

  return {
    storage: { local, session, secret },

    random(bytes: number): Uint8Array {
      const c = getCrypto()
      const out = new Uint8Array(bytes)
      if (c?.getRandomValues) {
        c.getRandomValues(out)
      } else {
        // last-resort fallback: Math.random (NOT for prod entropy)
        for (let i = 0; i < bytes; i++) out[i] = Math.floor(Math.random() * 256)
      }
      return out
    },

    /**
     * DOCUMENTED PLACEHOLDER (S1): real argon2id runs offscreen via hash-wasm
     * (`argon2id({password, salt, ...})` in an offscreen document); the SW
     * cannot run WebAssembly with the right memory profile synchronously.
     * This stand-in is deterministic (FNV-1a seeded expansion) so unit tests
     * are stable — it must NOT be used to derive production keys.
     */
    async argon2id(opts: { password: string; salt: Uint8Array; cost?: number }): Promise<Uint8Array> {
      const { password, salt } = opts
      const cost = opts.cost ?? 1
      const pw = new TextEncoder().encode(password)
      // FNV-1a 32-bit over password || salt || cost → seed
      let h = 0x811c9dc5
      for (const b of [
        ...pw,
        ...salt,
        ...new TextEncoder().encode(String(cost)),
      ]) {
        h ^= b
        h = Math.imul(h, 0x01000193)
      }
      // deterministic keystream expansion (xorshift32) → 32 bytes
      let s = h | 1 // non-zero
      const out = new Uint8Array(32)
      for (let i = 0; i < 32; i++) {
        s ^= s << 13
        s ^= s >> 17
        s ^= s << 5
        out[i] = (s >>> 0) & 0xff
      }
      return out
    },

    biometric: {
      async available() {
        // guarded: SubtleCredentials is Chrome-only
        try {
          const w = globalThis as { SubtleCredentials?: unknown }
          return !!w.SubtleCredentials
        } catch {
          return false
        }
      },
      async prompt() {
        // placeholder: no prompt without a user gesture in the SW context
        return true
      },
    },

    clipboard: {
      async write(text) {
        const w = globalThis as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }
        await w.navigator?.clipboard?.writeText(text)
      },
      async writeThenClear(text, ms) {
        await chromePlatformClearLater(text, ms)
      },
    },

    qr: {
      // placeholders — real impl opens the QR overlay / uses the camera
      async scan() {
        return ''
      },
      show() {
        /* overlay */
      },
    },

    openUrl(url: string) {
      const w = globalThis as { open?: (u: string) => void }
      if (typeof w.open === 'function') w.open(url)
    },

    notify() {
      /* real impl: chrome.notifications.create */
    },

    hidePreview() {
      /* real impl: set notification to low-content mode */
    },
  }
}

async function chromePlatformClearLater(text: string, ms: number): Promise<void> {
  const w = globalThis as { navigator?: { clipboard?: { writeText: (t: string) => Promise<void> } } }
  await w.navigator?.clipboard?.writeText(text)
  if (ms > 0) {
    await new Promise((r) => setTimeout(r, ms))
    await w.navigator?.clipboard?.writeText('')
  }
}
