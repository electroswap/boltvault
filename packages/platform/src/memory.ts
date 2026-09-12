/**
 * In-memory Platform for tests and tools. Deterministic clock, alarms that
 * fire when the clock is advanced, argon2id via hash-wasm (real, so vault
 * vectors are exercised), random from Node/Web crypto.
 */
import { argon2id as hashWasmArgon2id } from 'hash-wasm'
import type { AlarmScheduler, KeyValueStore, Platform } from './index'

export function createMemoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const map = new Map<string, string>(Object.entries(initial))
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

export interface MemoryClock {
  now(): number
  /** Move time forward; fires any alarms that became due, in order. */
  advance(ms: number): Promise<void>
  set(ms: number): Promise<void>
}

export interface MemoryPlatform extends Platform {
  readonly clock: MemoryClock
  readonly notifications: Array<{ title: string; body: string; tag?: string }>
  readonly openedUrls: string[]
  readonly clipboardText: { value: string }
  readonly previewHidden: { value: boolean }
  readonly held: Set<string>
  /** Test hook: what `biometric.prompt` resolves to. */
  readonly biometricAnswer: { available: boolean; ok: boolean }
}

export function createMemoryPlatform(opts: { now?: number } = {}): MemoryPlatform {
  let now = opts.now ?? 1_700_000_000_000
  const alarmsDue = new Map<string, number>()
  const alarmListeners = new Set<(name: string) => void>()

  const fireDue = async (): Promise<void> => {
    const due = [...alarmsDue.entries()].filter(([, at]) => at <= now).sort((a, b) => a[1] - b[1])
    for (const [name] of due) {
      alarmsDue.delete(name)
      for (const l of [...alarmListeners]) l(name)
      // let listeners' promises settle before the next alarm
      await Promise.resolve()
    }
  }

  const alarms: AlarmScheduler = {
    schedule: async (name, atMs) => {
      alarmsDue.set(name, atMs)
      if (atMs <= now) await fireDue()
    },
    cancel: async (name) => {
      alarmsDue.delete(name)
    },
    onFire: (listener) => {
      alarmListeners.add(listener)
      return () => {
        alarmListeners.delete(listener)
      }
    },
  }

  const notifications: MemoryPlatform['notifications'] = []
  const openedUrls: string[] = []
  const clipboardText = { value: '' }
  const previewHidden = { value: false }
  const held = new Set<string>()
  const biometricAnswer = { available: false, ok: false }

  return {
    kind: 'memory',
    storage: {
      local: createMemoryStore(),
      session: createMemoryStore(),
      secret: createMemoryStore(),
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
    alarms,
    keepAlive: {
      hold: (reason) => {
        held.add(reason)
        return () => {
          held.delete(reason)
        }
      },
    },
    biometric: {
      available: async () => biometricAnswer.available,
      prompt: async () => biometricAnswer.ok,
    },
    clipboard: {
      write: async (text) => {
        clipboardText.value = text
      },
      writeThenClear: async (text) => {
        clipboardText.value = text
      },
    },
    now: () => now,
    random: (n) => {
      const out = new Uint8Array(n)
      globalThis.crypto.getRandomValues(out)
      return out
    },
    openUrl: async (url) => {
      openedUrls.push(url)
    },
    notify: async (n) => {
      notifications.push(n)
    },
    hidePreview: async (hide) => {
      previewHidden.value = hide
    },
    clock: {
      now: () => now,
      advance: async (ms) => {
        now += ms
        await fireDue()
      },
      set: async (ms) => {
        now = ms
        await fireDue()
      },
    },
    notifications,
    openedUrls,
    clipboardText,
    previewHidden,
    held,
    biometricAnswer,
  }
}
