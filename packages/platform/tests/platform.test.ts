import { describe, expect, it } from 'vitest'
import { prefixedStore, utf8 } from '../src/index'
import { createMemoryPlatform, createMemoryStore } from '../src/memory'
import { createExtensionPlatform, type ExtensionApi } from '../src/extension'

describe('memory platform', () => {
  it('fires alarms when the clock passes their time, in order', async () => {
    const p = createMemoryPlatform({ now: 1000 })
    const fired: string[] = []
    p.alarms.onFire((n) => fired.push(n))
    await p.alarms.schedule('b', 3000)
    await p.alarms.schedule('a', 2000)
    await p.clock.advance(500)
    expect(fired).toEqual([])
    await p.clock.advance(2500)
    expect(fired).toEqual(['a', 'b'])
    await p.clock.advance(10_000)
    expect(fired).toEqual(['a', 'b']) // one-shot
  })

  it('cancel prevents firing and re-schedule replaces', async () => {
    const p = createMemoryPlatform({ now: 0 })
    const fired: string[] = []
    p.alarms.onFire((n) => fired.push(n))
    await p.alarms.schedule('lock', 100)
    await p.alarms.cancel('lock')
    await p.clock.advance(200)
    expect(fired).toEqual([])
    await p.alarms.schedule('lock', 300)
    await p.alarms.schedule('lock', 400)
    await p.clock.advance(150) // now 350
    expect(fired).toEqual([])
    await p.clock.advance(100) // now 450
    expect(fired).toEqual(['lock'])
  })

  it('argon2id is real and deterministic', async () => {
    const p = createMemoryPlatform()
    const salt = new Uint8Array(16).fill(7)
    const a = await p.kdf.argon2id({ password: utf8.encode('pw'), salt, memoryKiB: 1024, iterations: 1, parallelism: 1, hashLength: 32 })
    const b = await p.kdf.argon2id({ password: utf8.encode('pw'), salt, memoryKiB: 1024, iterations: 1, parallelism: 1, hashLength: 32 })
    expect(a).toEqual(b)
    expect(a.length).toBe(32)
  })

  it('random never returns zeros and stores round-trip', async () => {
    const p = createMemoryPlatform()
    expect(p.random(32).some((b) => b !== 0)).toBe(true)
    const s = prefixedStore(createMemoryStore(), 'x')
    await s.set('k', 'v')
    expect(await s.get('k')).toBe('v')
    expect(await s.keys()).toEqual(['k'])
    await s.remove('k')
    expect(await s.get('k')).toBeNull()
  })
})

function fakeArea(): { area: ExtensionApi['storage']['local']; data: Record<string, unknown>; accessLevel: string[] } {
  const data: Record<string, unknown> = {}
  const accessLevel: string[] = []
  const area: ExtensionApi['storage']['local'] = {
    async get(keys) {
      if (keys === null) return { ...data }
      const list = Array.isArray(keys) ? keys : [keys]
      const out: Record<string, unknown> = {}
      for (const k of list) if (k in data) out[k] = data[k]
      return out
    },
    async set(items) {
      Object.assign(data, items)
    },
    async remove(keys) {
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k]
    },
    async setAccessLevel(o) {
      accessLevel.push(o.accessLevel)
    },
  }
  return { area, data, accessLevel }
}

describe('extension platform', () => {
  it('prefixes stores, pins session access level, and relays alarms', async () => {
    const local = fakeArea()
    const session = fakeArea()
    const alarmCbs: Array<(a: { name: string }) => void> = []
    const created: Array<{ name: string; when: number }> = []
    const api: ExtensionApi = {
      storage: { local: local.area, session: session.area },
      alarms: {
        create: (name, info) => {
          created.push({ name, when: info.when })
        },
        clear: () => true,
        onAlarm: {
          addListener: (cb) => alarmCbs.push(cb),
          removeListener: () => {},
        },
      },
      runtime: { getPlatformInfo: async () => ({}) },
    }
    const p = createExtensionPlatform(api)
    await p.storage.local.set('settings', '{}')
    await p.storage.secret.set('vault', 'ct')
    await p.storage.session.set('dek', 'x')
    expect(Object.keys(local.data).sort()).toEqual(['bv:local:settings', 'bv:secret:vault'])
    expect(Object.keys(session.data)).toEqual(['bv:session:dek'])
    expect(session.accessLevel).toEqual(['TRUSTED_CONTEXTS'])
    expect(await p.storage.local.keys()).toEqual(['settings'])

    await p.alarms.schedule('vault.autolock', 123)
    expect(created).toEqual([{ name: 'vault.autolock', when: 123 }])
    const fired: string[] = []
    p.alarms.onFire((n) => fired.push(n))
    for (const cb of alarmCbs) cb({ name: 'vault.autolock' })
    expect(fired).toEqual(['vault.autolock'])
  })
})
