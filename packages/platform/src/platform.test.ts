import { describe, expect, it } from 'vitest'
import { chromePlatform } from './chrome'
import type { KeyValueStore, Platform, SecretStore } from './types'

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

function memStore(): KeyValueStore {
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

describe('chromePlatform (S1)', () => {
  it('random(32) returns a 32-byte Uint8Array', () => {
    const p = chromePlatform()
    const r = p.random(32)
    expect(r).toBeInstanceOf(Uint8Array)
    expect(r.byteLength).toBe(32)
    // two draws are (almost surely) different
    const r2 = p.random(32)
    expect(Buffer.from(r).equals(Buffer.from(r2))).toBe(false)
  })

  it('storage.local round-trips a value (in-memory default store)', async () => {
    const p = chromePlatform()
    expect(await p.storage.local.get('k')).toBe(null)
    await p.storage.local.set('k', 'v')
    expect(await p.storage.local.get('k')).toBe('v')
    await p.storage.local.remove('k')
    expect(await p.storage.local.get('k')).toBe(null)
  })

  it('accepts injectable stores and uses them', async () => {
    const local = memStore()
    const session = memStore()
    const secret: SecretStore = memStore()
    const p = chromePlatform({ local, session, secret })
    await p.storage.local.set('a', '1')
    expect((p.storage.local as KeyValueStore) === local).toBe(true)
    expect(await local.get('a')).toBe('1')
  })

  it('exposes every S1 member (shape check)', () => {
    const p: Platform = chromePlatform()
    expect(typeof p.random).toBe('function')
    expect(typeof p.argon2id).toBe('function')
    expect(typeof p.storage.local.get).toBe('function')
    expect(typeof p.storage.session.get).toBe('function')
    expect(typeof p.storage.secret.get).toBe('function')
    expect(typeof p.biometric.available).toBe('function')
    expect(typeof p.biometric.prompt).toBe('function')
    expect(typeof p.clipboard.write).toBe('function')
    expect(typeof p.clipboard.writeThenClear).toBe('function')
    expect(typeof p.qr.scan).toBe('function')
    expect(typeof p.qr.show).toBe('function')
    expect(typeof p.openUrl).toBe('function')
    expect(typeof p.notify).toBe('function')
    expect(typeof p.hidePreview).toBe('function')
  })

  it('argon2id placeholder is deterministic and salt-sensitive', async () => {
    const p = chromePlatform()
    const salt = new Uint8Array([1, 2, 3])
    const a = await p.argon2id({ password: 'pw', salt })
    const b = await p.argon2id({ password: 'pw', salt })
    const c = await p.argon2id({ password: 'pw2', salt })
    expect(a.byteLength).toBe(32)
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true)
    expect(Buffer.from(a).equals(Buffer.from(c))).toBe(false)
  })

  it('biometric.available resolves boolean without throwing under node', async () => {
    const p = chromePlatform()
    expect(typeof (await p.biometric.available())).toBe('boolean')
  })
})
