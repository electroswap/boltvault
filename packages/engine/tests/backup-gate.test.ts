/**
 * Who the backup gate is actually for (§8.1).
 *
 * `backupComplete` shuts swapping and limit orders and puts a banner on Home
 * until every seed in the vault has been backed up. That is right for a phrase
 * the wallet minted and the user has never written down, and wrong for a phrase
 * the user typed in from the paper it is already on. The wallet could not tell
 * the two apart, so it asked a beta tester to back up the words they had just
 * finished entering: "I have imported with seed phrase, but still it asked me
 * to back-up my recovery phrase which seems silly because I just entered it (I
 * already have a backup)."
 *
 * The distinction is now a flag the caller sets, and these pin both sides of
 * it — including the case where the gate's reach went furthest: a second seed
 * added to a vault that was already clear.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const OTHER = 'legal winner thank year wave sausage worth useful legal winner thank yellow'

describe('the backup gate tells restoring from creating', () => {
  let engine: Engine | null = null
  afterEach(() => {
    engine?.dispose()
    engine = null
  })

  const fresh = async (): Promise<Engine> => {
    const e = createEngine({ platform: createMemoryPlatform(), kdf: KDF, electroswapUrl: null, pricesUrl: null })
    await e.ready
    engine = e
    return e
  }

  it('a restored phrase is already backed up: no banner, no gate', async () => {
    const e = await fresh()
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    const status = await e.engine.vault.status()
    expect(status.seeds).toHaveLength(1)
    expect(status.seeds[0]?.backedUp).toBe(true)
    expect(status.backupComplete).toBe(true)
  })

  it('the flag defaults off, so onboarding’s create path still earns the gate through the quiz', async () => {
    const e = await fresh()
    // Exactly what `sealCreate` does: propose mints the words, import seals
    // them, and only `confirmBackup` clears the gate.
    const { mnemonic, positions } = await e.engine.vault.propose({})
    const { seedId } = await e.engine.vault.import({ mnemonic, password: PASSWORD })
    expect((await e.engine.vault.status()).backupComplete).toBe(false)

    const words = mnemonic.split(' ')
    const answers = positions.map((position) => ({ position, word: words[position - 1] ?? '' }))
    const done = await e.engine.vault.confirmBackup({ seedId, answers })
    expect(done.ok).toBe(true)
    expect((await e.engine.vault.status()).backupComplete).toBe(true)
  })

  it('a second recovery phrase does not re-arm the gate for the first', async () => {
    const e = await fresh()
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    /*
      The reach worth pinning. `backupComplete` is `seeds.every(backedUp)`, so
      before this an added phrase — always one the user pasted in — flipped the
      whole vault back to "not backed up" and shut swapping for the seed that
      had been cleared long ago.
    */
    await e.engine.accounts.addSeed({ mnemonic: OTHER })
    const status = await e.engine.vault.status()
    expect(status.seeds).toHaveLength(2)
    expect(status.seeds.every((s) => s.backedUp)).toBe(true)
    expect(status.backupComplete).toBe(true)
  })
})
