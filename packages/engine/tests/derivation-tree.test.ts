/**
 * Two derivation trees, chosen where the choice means something (ES-BV-075).
 *
 * Onboarding used to put this in front of every import: three BIP-44 addresses
 * and three Ledger Live ones under "Which addresses do you recognise?", with no
 * selection control and nothing consuming an answer — import took BIP-44 index
 * 0 whatever the user thought they were picking. A tester who had made their
 * wallet in BoltVault an hour earlier: "I don't recognize any of these
 * addresses, it's super confusing! I'd rather you just import the first one,
 * and then let me choose to add more accounts from either derivation in account
 * management."
 *
 * So the question moved to the accounts sheet. What has to hold now is that the
 * tree is recorded, that it survives being stored, and above all that the key
 * follows the address — deriving an account on one tree and signing for it on
 * the other would produce valid signatures for an address holding nothing.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('derivation trees', () => {
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

  it('agrees on the first address and diverges after it', async () => {
    const e = await fresh()
    const preview = await e.engine.accounts.previewDerivations({ mnemonic: PHRASE, count: 3 })
    // The reason importing the first address is right for everybody.
    expect(preview.bip44[0]).toBe(preview.ledgerLive[0])
    expect(preview.bip44[1]).not.toBe(preview.ledgerLive[1])
  })

  it('adds the account the chosen tree actually names', async () => {
    const e = await fresh()
    const { seedId } = await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    const preview = await e.engine.accounts.previewDerivations({ mnemonic: PHRASE, count: 3 })

    const nextBip44 = await e.engine.accounts.derive({ seedId })
    expect(nextBip44.address).toBe(preview.bip44[1])

    const nextLedger = await e.engine.accounts.derive({ seedId, tree: 'ledgerLive' })
    expect(nextLedger.address).toBe(preview.ledgerLive[1])
  })

  it('counts indices per tree, so neither skips an address', async () => {
    const e = await fresh()
    const { seedId } = await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    const preview = await e.engine.accounts.previewDerivations({ mnemonic: PHRASE, count: 4 })

    /*
      A shared counter would have made this the third address of whichever tree
      was asked second — the import already occupies index 0 of bip44, and
      ledgerLive has to start from its own 1.
    */
    await e.engine.accounts.derive({ seedId, tree: 'ledgerLive' })
    const second = await e.engine.accounts.derive({ seedId, tree: 'ledgerLive' })
    expect(second.address).toBe(preview.ledgerLive[2])

    const bip = await e.engine.accounts.derive({ seedId })
    expect(bip.address).toBe(preview.bip44[1])
  })

  it('signs with the key that belongs to the address', async () => {
    const e = await fresh()
    const { seedId } = await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    const ledger = await e.engine.accounts.derive({ seedId, tree: 'ledgerLive' })

    /*
      The property that matters most. `privateKeyFor` used to derive with
      `deriveAccount(seedHex, index)` unconditionally, so a Ledger Live account
      would have been signed for with the BIP-44 key at the same index — a
      valid signature from the wrong address.
    */
    const key = await e.vault.privateKeyFor(ledger.id)
    expect(key).toBeTruthy()
    const { privateKeyToAddress } = await import('viem/accounts')
    expect(privateKeyToAddress(key as `0x${string}`).toLowerCase()).toBe(ledger.address.toLowerCase())

    // And the BIP-44 account at the same index is a different key entirely,
    // which is what makes the line above worth asserting.
    const bip = await e.engine.accounts.derive({ seedId })
    const bipKey = await e.vault.privateKeyFor(bip.id)
    expect(bipKey).not.toBe(key)
    expect(privateKeyToAddress(bipKey as `0x${string}`).toLowerCase()).toBe(bip.address.toLowerCase())
  })

  it('keeps deriving the same addresses for accounts stored before the tree existed', async () => {
    const e = await fresh()
    const { seedId } = await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    const preview = await e.engine.accounts.previewDerivations({ mnemonic: PHRASE, count: 2 })
    // No `tree` passed anywhere: exactly what an older vault's accounts look
    // like, and they must still be BIP-44.
    const next = await e.engine.accounts.derive({ seedId })
    expect(next.address).toBe(preview.bip44[1])
    const list = await e.engine.accounts.list()
    expect(list[0]?.address).toBe(preview.bip44[0])
  })
})
