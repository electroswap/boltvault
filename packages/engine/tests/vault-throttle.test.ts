/**
 * What a wrong guess costs (ES-BV-008, ES-BV-010, ES-BV-011).
 *
 * Unlock, reveal and every factor-management method had no attempt counter, no
 * back-off and no lockout: the only price of a guess was Argon2id, which is a
 * few per second. Someone with the browser profile or the phone could script
 * the UI port and grind a weak password, silently, for as long as they liked —
 * and the password could be one character, because the policy lived in a
 * screen rather than in the engine.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 1024, t: 1, p: 1 }

describe('guessing at the vault', () => {
  let engine: Engine

  beforeEach(async () => {
    engine = createEngine({ platform: createMemoryPlatform({ now: 1_700_000_000_000 }), kdf: KDF, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
    await engine.ready
    await engine.engine.vault.create({ password: PASSWORD })
    await engine.engine.vault.lock()
  })

  afterEach(() => engine.dispose())

  it('stops answering after a handful of wrong passwords, and says for how long', async () => {
    for (let i = 0; i < 5; i += 1)
      await expect(engine.engine.vault.unlock({ password: `wrong guess number ${i}` })).rejects.toMatchObject({ code: 'wrong_password' })
    // The sixth is refused before the KDF runs at all.
    const throttled = await engine.engine.vault.unlock({ password: 'wrong again entirely' }).catch((e: unknown) => e)
    expect(throttled).toMatchObject({ code: 'throttled' })
    expect((throttled as { data?: { seconds?: number } }).data?.seconds).toBeGreaterThan(0)
    // And the right password is refused too: the wallet is cooling off, not
    // deciding who is asking.
    await expect(engine.engine.vault.unlock({ password: PASSWORD })).rejects.toMatchObject({ code: 'throttled' })
  })

  it('forgets the failures as soon as one attempt succeeds', async () => {
    for (let i = 0; i < 4; i += 1)
      await expect(engine.engine.vault.unlock({ password: `wrong guess number ${i}` })).rejects.toMatchObject({ code: 'wrong_password' })
    expect((await engine.engine.vault.unlock({ password: PASSWORD })).accounts).toHaveLength(1)
    await engine.engine.vault.lock()
    // A fresh budget, not one attempt from the wall.
    for (let i = 0; i < 5; i += 1)
      await expect(engine.engine.vault.unlock({ password: `wrong guess number ${i}` })).rejects.toMatchObject({ code: 'wrong_password' })
  })

  it('refuses a password this wallet would not seal a vault under, on every path', async () => {
    await engine.engine.vault.unlock({ password: PASSWORD })
    for (const weak of ['x', 'short', 'aaaaaaaaaaaaaaaa'])
      await expect(engine.engine.vault.changePassword({ current: PASSWORD, next: weak })).rejects.toMatchObject({ code: 'invalid_argument' })
    // A fresh device importing a vault is the same policy.
    const other = createEngine({ platform: createMemoryPlatform({ now: 1_700_000_000_000 }), kdf: KDF, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
    await other.ready
    await expect(other.engine.vault.create({ password: 'aaaaaaaaaaaa' })).rejects.toMatchObject({ code: 'invalid_argument' })
    other.dispose()
  })
})
