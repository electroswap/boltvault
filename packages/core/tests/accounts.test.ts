import { describe, expect, it } from 'vitest'
import { privateKeyToAddress } from 'viem/accounts'
import {
  accountsFromPlaintext,
  applyAccount,
  buildAccount,
  seedHexFromMnemonic,
  emptyPlaintext,
} from '../src/index.js'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const SEED = seedHexFromMnemonic(TEST_MNEMONIC)
const ADDR_0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'

describe('account factory', () => {
  it('builds an HD account at index 0 with the derived address', () => {
    const c = buildAccount({ kind: 'hd', label: 'Main', index: 0 }, SEED)
    expect(c.account.kind).toBe('hd')
    expect(c.account.address).toBe(ADDR_0)
    expect(c.account.hasKey).toBe(true)
    expect(c.account.index).toBe(0)
  })

  it('requires a seed for HD accounts', () => {
    expect(() => buildAccount({ kind: 'hd', label: 'x', index: 0 }, null)).toThrow(/seed/)
  })

  it('builds an imported account and resolves its address from the key', () => {
    const pk = `0x${'11'.repeat(32)}` as `0x${string}`
    const c = buildAccount({ kind: 'imported', label: 'Imp', privateKey: pk }, SEED)
    expect(c.account.kind).toBe('imported')
    expect(c.account.address).toBe(privateKeyToAddress(pk))
    expect(c.account.hasKey).toBe(true)
  })

  it('builds a watch account (no key)', () => {
    const c = buildAccount({ kind: 'watch', label: 'Watch', address: ADDR_0 }, SEED)
    expect(c.account.kind).toBe('watch')
    expect(c.account.address).toBe(ADDR_0)
    expect(c.account.hasKey).toBe(false)
  })

  it('checksums a watch address passed in lowercase', () => {
    const c = buildAccount({ kind: 'watch', label: 'W', address: ADDR_0.toLowerCase() }, SEED)
    expect(c.account.address).toBe(ADDR_0)
  })

  it('rejects an invalid watch address', () => {
    expect(() =>
      buildAccount({ kind: 'watch', label: 'W', address: '0x1234' }, SEED),
    ).toThrow(/invalid address/)
  })

  it('builds a Ledger account with a device-resolved address', () => {
    const c = buildAccount(
      {
        kind: 'ledger',
        label: 'Ledger',
        path: "m/44'/60'/0'/0/0",
        address: ADDR_0,
        deviceId: 'dev-1',
      },
      SEED,
    )
    expect(c.account.kind).toBe('ledger')
    expect(c.account.hasKey).toBe(false)
    expect(c.account.hardware?.path).toBe("m/44'/60'/0'/0/0")
  })

  it('requires a device-resolved address for hardware accounts', () => {
    expect(() =>
      buildAccount(
        { kind: 'trezor', label: 'T', path: "m/44'/60'/0'/0/0" },
        SEED,
      ),
    ).toThrow(/needs a device-resolved address/)
  })
})

describe('applyAccount + accountsFromPlaintext', () => {
  it('applies an imported account and stores its key', () => {
    const pk = `0x${'22'.repeat(32)}` as `0x${string}`
    const c = buildAccount({ kind: 'imported', label: 'Imp', privateKey: pk }, SEED)
    const pt = applyAccount(emptyPlaintext(), c, { importedKey: pk })
    expect(pt.accounts).toHaveLength(1)
    expect(pt.importedKeys[c.meta.id]).toBe(pk)
  })

  it('applies an HD account (no key stored in plaintext; derived from seed)', () => {
    const c = buildAccount({ kind: 'hd', label: 'Main', index: 0 }, SEED)
    const pt = applyAccount(emptyPlaintext(), c)
    expect(pt.accounts).toHaveLength(1)
    expect(pt.accounts[0]?.kind).toBe('hd')
  })

  it('accountsFromPlaintext returns runtime VaultAccount values with correct hasKey', () => {
    let pt = emptyPlaintext()
    const hd = buildAccount({ kind: 'hd', label: 'Main', index: 0 }, SEED)
    pt = applyAccount(pt, hd)
    const watch = buildAccount({ kind: 'watch', label: 'W', address: ADDR_0 }, SEED)
    pt = applyAccount(pt, watch)
    const all = accountsFromPlaintext(pt)
    expect(all).toHaveLength(2)
    expect(all[0]?.hasKey).toBe(true) // hd
    expect(all[1]?.hasKey).toBe(false) // watch
  })
})
