/**
 * `vault.wipe` — the way out of the lock screen (ES-BV-073).
 *
 * The locked screen used to be a dead end: static text saying "there is no
 * reset, restore on a fresh install", on a screen with no other navigation and
 * no in-app way to do it. On a sideloaded Android build "a fresh install" means
 * finding Clear data in system settings, and a beta tester did not: "im stuck
 * here, it seems. No way to go back to 'import phrases' or whatever."
 *
 * Two properties matter, and they pull against each other. It must leave
 * nothing readable behind — a half-wiped wallet is worse than either end state
 * — and it must leave the device able to start again, because starting again is
 * the entire point of pressing it.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const NEXT_PASSWORD = 'another entirely different phrase 91'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

describe('vault.wipe', () => {
  let engine: Engine | null = null
  afterEach(() => {
    engine?.dispose()
    engine = null
  })

  const fresh = async (): Promise<{ engine: Engine; platform: ReturnType<typeof createMemoryPlatform> }> => {
    const platform = createMemoryPlatform()
    const e = createEngine({ platform, kdf: KDF, electroswapUrl: null, pricesUrl: null })
    await e.ready
    engine = e
    return { engine: e, platform }
  }

  it('leaves no vault, and no ciphertext to attack', async () => {
    const { engine: e, platform } = await fresh()
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    await e.engine.contacts.add({ address: `0x${'ab'.repeat(20)}`, label: 'Someone' })
    expect((await e.engine.vault.status()).exists).toBe(true)
    expect((await platform.storage.secret.keys()).length).toBeGreaterThan(0)

    await e.engine.vault.wipe()

    const status = await e.engine.vault.status()
    expect(status.exists).toBe(false)
    expect(status.unlocked).toBe(false)
    expect(status.seeds).toEqual([])
    // The sealed side is what an attacker would take away with the device.
    expect(await platform.storage.secret.keys()).toEqual([])
    expect(await platform.storage.local.keys()).toEqual([])
  })

  it('drops the session key, so the DEK does not outlive the wallet', async () => {
    const { engine: e, platform } = await fresh()
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    expect((await e.engine.vault.status()).unlocked).toBe(true)

    await e.engine.vault.wipe()

    // Whatever the session still holds, none of it may be the key.
    for (const key of await platform.storage.session.keys()) {
      const value = await platform.storage.session.get(key)
      expect(value === null || /^0*$/.test(value)).toBe(true)
    }
  })

  it('leaves the device able to start again — a different phrase, a different password', async () => {
    const { engine: e } = await fresh()
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    const before = (await e.engine.accounts.list())[0]?.address
    expect(before).toBeTruthy()

    await e.engine.vault.wipe()
    /*
      The property the tester actually needed. Before this, `import` on a
      device that already had a vault threw "a vault already exists" — which is
      why the lock screen's advice was to reinstall the app.
    */
    await e.engine.vault.import({ mnemonic: OTHER, password: NEXT_PASSWORD, backedUp: true })

    const status = await e.engine.vault.status()
    expect(status.exists).toBe(true)
    expect(status.unlocked).toBe(true)
    const after = (await e.engine.accounts.list())[0]?.address
    expect(after).toBeTruthy()
    expect(after).not.toBe(before)
  })

  it('takes no password — it is the door for someone who has lost theirs', async () => {
    const { engine: e } = await fresh()
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    await e.engine.vault.lock()
    expect((await e.engine.vault.status()).unlocked).toBe(false)

    // Locked, with nothing supplied, and it still works.
    await e.engine.vault.wipe()
    expect((await e.engine.vault.status()).exists).toBe(false)
  })

  it('is safe to call when there is nothing to wipe', async () => {
    const { engine: e } = await fresh()
    await e.engine.vault.wipe()
    expect((await e.engine.vault.status()).exists).toBe(false)
  })
})
