/**
 * M0 mobile Platform: process-memory stores, a real clock, alarms on timers.
 *
 * This is deliberately NOT the custody platform — M2 replaces `secret` and
 * `session` with react-native-keychain (biometry-bound DEK) + MMKV and the KDF
 * with react-native-libsodium (master plan §5.2). Nothing in M0 stores a key.
 */
import type { Platform } from '@boltvault/platform'
import { createMemoryPlatform } from '@boltvault/platform/memory'

export function createMobilePlatform(): Platform {
  const mem = createMemoryPlatform({ now: Date.now() })
  const timers = new Map<string, ReturnType<typeof setTimeout>>()
  const listeners = new Set<(name: string) => void>()
  return {
    ...mem,
    kind: 'mobile',
    now: () => Date.now(),
    alarms: {
      schedule: async (name, atMs) => {
        const existing = timers.get(name)
        if (existing) clearTimeout(existing)
        timers.set(
          name,
          setTimeout(
            () => {
              timers.delete(name)
              for (const l of [...listeners]) l(name)
            },
            Math.max(0, atMs - Date.now()),
          ),
        )
      },
      cancel: async (name) => {
        const t = timers.get(name)
        if (t) clearTimeout(t)
        timers.delete(name)
      },
      onFire: (listener) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      },
    },
  }
}
