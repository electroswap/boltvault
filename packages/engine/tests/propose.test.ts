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
    const { mnemonic, positions } = await e.engine.vault.propose({})
    const words = mnemonic.split(' ')
    // The order the rebuilt flow uses: propose → (words, quiz) → password.
    const { seedId } = await e.engine.vault.import({ mnemonic, password: PASSWORD })
    expect((await e.engine.vault.status()).backupComplete).toBe(false)
    /*
      The positions come back from `propose` because the seed does not exist
      yet, so `backupQuiz` cannot issue them — and `confirmBackup` accepts only
      positions the wallet itself chose (ES-BV-004). Answering positions of the
      caller's choosing is the per-word oracle that finding is about.
    */
    expect(positions).toHaveLength(3)
    const answers = positions.map((position) => ({ position, word: words[position - 1] ?? '' }))
    const ok = await e.engine.vault.confirmBackup({ seedId, answers })
    expect(ok.ok).toBe(true)
    expect((await e.engine.vault.status()).backupComplete).toBe(true)
  })

  it('refuses a quiz answered wrongly', async () => {
    const { engine: e } = await fresh()
    const { mnemonic, positions } = await e.engine.vault.propose({})
    const { seedId } = await e.engine.vault.import({ mnemonic, password: PASSWORD })
    const wrong = positions.map((position) => ({ position, word: 'zoo' }))
    expect((await e.engine.vault.confirmBackup({ seedId, answers: wrong })).ok).toBe(false)
    expect((await e.engine.vault.status()).backupComplete).toBe(false)
  })

  /*
    ES-BV-004. `confirmBackup` took whatever positions the caller named, needed
    only the session DEK and was not throttled, which makes it a per-word
    oracle: answer `[{p, w} × 3]` for every `w` in the 2048-word list and the
    word at `p` falls out. On the extension any page context that can reach the
    UI namespace could do that on an unlocked wallet, with no password —
    exactly what `revealNeedsPassword` exists to prevent.
  */
  it('will not answer a question it did not ask', async () => {
    const { engine: e } = await fresh()
    const { mnemonic, positions } = await e.engine.vault.propose({})
    const words = mnemonic.split(' ')
    const { seedId } = await e.engine.vault.import({ mnemonic, password: PASSWORD })
    const other = [1, 2, 3, 4].filter((p) => !positions.includes(p)).slice(0, 3)
    // Positions of the caller's choosing are refused outright.
    await expect(e.engine.vault.confirmBackup({ seedId, answers: other.map((position) => ({ position, word: words[position - 1] ?? '' })) })).rejects.toMatchObject({ code: 'invalid_argument' })
    // So is the same position three times, which is how the oracle was driven.
    const one = positions[0] ?? 1
    await expect(e.engine.vault.confirmBackup({ seedId, answers: [one, one, one].map((position) => ({ position, word: 'zoo' })) })).rejects.toMatchObject({ code: 'invalid_argument' })
    expect((await e.engine.vault.status()).backupComplete).toBe(false)
  })

  it('spends the question on any attempt, so a guess costs a fresh quiz', async () => {
    const { engine: e } = await fresh()
    const { mnemonic, positions } = await e.engine.vault.propose({})
    const words = mnemonic.split(' ')
    const { seedId } = await e.engine.vault.import({ mnemonic, password: PASSWORD })
    expect((await e.engine.vault.confirmBackup({ seedId, answers: positions.map((position) => ({ position, word: 'zoo' })) })).ok).toBe(false)
    // The right answer to a question already asked is not accepted either.
    await expect(e.engine.vault.confirmBackup({ seedId, answers: positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })).rejects.toMatchObject({ code: 'invalid_argument' })
    // Ask again, and the right answer stands.
    const again = await e.engine.vault.backupQuiz({ seedId })
    const ok = await e.engine.vault.confirmBackup({ seedId, answers: again.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    expect(ok.ok).toBe(true)
  })
})
