/**
 * `vault.propose` — a phrase before there is a vault to put it in (§8.1).
 *
 * The master plan puts the words and the backup check before the password.
 * `create` cannot do that, because it needs the password in the same call: the
 * password is the KDF input that seals the file. So minting is split from
 * sealing, and the two properties worth pinning are that it mints something
 * real and that it writes nothing at all.
 */
import { validateMnemonicStr } from '@boltvault/core'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }

describe('vault.propose', () => {
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

  it('mints a real 12-word BIP-39 phrase', async () => {
    const { engine: e } = await fresh()
    const { mnemonic } = await e.engine.vault.propose({})
    expect(mnemonic.split(' ')).toHaveLength(12)
    expect(validateMnemonicStr(mnemonic)).toBe(true)
  })

  it('writes nothing — abandoning at the words step leaves no vault behind', async () => {
    const { engine: e, platform } = await fresh()
    const before = await platform.storage.local.keys()
    await e.engine.vault.propose({})
    expect(await platform.storage.local.keys()).toEqual(before)
    // The decisive one: the vault does not exist, so onboarding can be restarted.
    expect((await e.engine.vault.status()).exists).toBe(false)
  })

  it('gives a different phrase every time', async () => {
    const { engine: e } = await fresh()
    const a = await e.engine.vault.propose({})
    const b = await e.engine.vault.propose({})
    expect(a.mnemonic).not.toBe(b.mnemonic)
  })

  it('refuses once a vault exists, so a stray tab cannot offer to replace one', async () => {
    const { engine: e } = await fresh()
    await e.engine.vault.create({ password: PASSWORD })
    await expect(e.engine.vault.propose({})).rejects.toThrow(/already exists/)
  })

  it('the phrase it minted becomes the vault, and the quiz clears the backup gate', async () => {
    const { engine: e } = await fresh()
    const { mnemonic } = await e.engine.vault.propose({})
    const words = mnemonic.split(' ')
    // The order the rebuilt flow uses: propose → (words, quiz) → password.
    const { seedId } = await e.engine.vault.import({ mnemonic, password: PASSWORD })
    expect((await e.engine.vault.status()).backupComplete).toBe(false)
    /*
      Positions chosen here, not by `backupQuiz` — `confirmBackup` validates the
      words against the stored phrase and accepts any positions, which is what
      lets the quiz happen before the seed exists.
    */
    const answers = [2, 5, 11].map((position) => ({ position, word: words[position - 1] ?? '' }))
    const ok = await e.engine.vault.confirmBackup({ seedId, answers })
    expect(ok.ok).toBe(true)
    expect((await e.engine.vault.status()).backupComplete).toBe(true)
  })

  it('refuses a quiz answered wrongly', async () => {
    const { engine: e } = await fresh()
    const { mnemonic } = await e.engine.vault.propose({})
    const { seedId } = await e.engine.vault.import({ mnemonic, password: PASSWORD })
    const wrong = [1, 2, 3].map((position) => ({ position, word: 'zoo' }))
    expect((await e.engine.vault.confirmBackup({ seedId, answers: wrong })).ok).toBe(false)
    expect((await e.engine.vault.status()).backupComplete).toBe(false)
  })
})
