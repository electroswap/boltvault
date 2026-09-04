import type { KeyValueStore } from '@boltvault/core'

/**
 * chrome.storage → core KeyValueStore adapters (T3.3).
 *
 * `secret` = chrome.storage.local (ciphertext envelope persists), `session` =
 * chrome.storage.session (unlocked seed; auto-cleared on browser close). Both
 * satisfy the platform contract in core, so VaultService stays chrome-agnostic.
 */

function toStore(area: {
  get(key: string): Promise<Record<string, unknown>>
  set(obj: Record<string, unknown>): Promise<void>
  remove(key: string): Promise<void>
}): KeyValueStore {
  return {
    async get(key) {
      const res = await area.get(key)
      const v = res[key]
      return typeof v === 'string' ? v : null
    },
    set(key, value) {
      return area.set({ [key]: value })
    },
    remove(key) {
      return area.remove(key)
    },
  }
}

export const localStore: KeyValueStore = toStore(browser.storage.local)
export const sessionStore: KeyValueStore = toStore(browser.storage.session)
