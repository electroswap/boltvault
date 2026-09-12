/**
 * The reveal endpoint was the one door with no lock on it (ES-BV-008).
 *
 * `unlock`, `unlockWithPasskey`, `unlockWithDevice`, `verifyPassword` and the
 * backup quiz all spend an attempt from the throttle budget; `reveal()` called
 * `unwrapDek` directly. And because it needed only a v2 file rather than an
 * open session, it answered on a locked vault — so a caller of the UI
 * namespace could grind the password at the KDF's rate through it, and tell a
 * correct password from a wrong seed id by `not_found` versus
 * `wrong_password`, without knowing a seed id at all.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, expect, it } from 'vitest'
import { createEngine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 1024, t: 1, p: 1 }

async function boot() {
  const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
  const e = createEngine({ platform, kdf: KDF, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
  await e.ready
  const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
  const { seedId } = await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD })
  return { platform, e, seedId }
}

describe('revealing a phrase', () => {
  it('needs an open wallet, not just a vault file', async () => {
    const { e, seedId } = await boot()
    await e.engine.vault.lock()
    await expect(e.engine.vault.reveal({ seedId, password: PASSWORD })).rejects.toMatchObject({ code: 'locked' })
    e.dispose()
  })

  it('spends the same budget every other factor test spends', async () => {
    const { e, seedId } = await boot()
    // Five free, then the wait arms. The seed id is real, so the only thing
    // being tested here is the password.
    for (let i = 0; i < 5; i += 1) {
      await expect(e.engine.vault.reveal({ seedId, password: 'not the password' })).rejects.toMatchObject({ code: 'wrong_password' })
    }
    await expect(e.engine.vault.reveal({ seedId, password: 'not the password' })).rejects.toMatchObject({ code: 'throttled' })
    // And the right password is refused too while it cools off: the budget is
    // the wallet's, not the guess's.
    await expect(e.engine.vault.reveal({ seedId, password: PASSWORD })).rejects.toMatchObject({ code: 'throttled' })
    e.dispose()
  })

  it('gives the budget back on a correct password', async () => {
    const { e, seedId } = await boot()
    for (let i = 0; i < 4; i += 1) {
      await expect(e.engine.vault.reveal({ seedId, password: 'not the password' })).rejects.toMatchObject({ code: 'wrong_password' })
    }
    const out = await e.engine.vault.reveal({ seedId, password: PASSWORD })
    expect(out.mnemonic.split(' ').length).toBeGreaterThanOrEqual(12)
    // Four wrong answers then a right one leaves a full budget behind it.
    for (let i = 0; i < 5; i += 1) {
      await expect(e.engine.vault.reveal({ seedId, password: 'not the password' })).rejects.toMatchObject({ code: 'wrong_password' })
    }
    e.dispose()
  })

  it('says how long is left, so a screen can tell the user', async () => {
    const { e, seedId } = await boot()
    for (let i = 0; i < 5; i += 1) {
      await e.engine.vault.reveal({ seedId, password: 'not the password' }).catch(() => undefined)
    }
    await expect(e.engine.vault.reveal({ seedId, password: PASSWORD })).rejects.toMatchObject({
      code: 'throttled',
      data: { seconds: expect.any(Number) },
    })
    e.dispose()
  })
})
