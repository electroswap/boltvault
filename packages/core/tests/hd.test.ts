import { describe, expect, it } from 'vitest'
import {
  deriveAccount,
  discoverAccounts,
  generateEntropy,
  hdAccountMeta,
  mnemonicHex,
  seedHexFromMnemonic,
  validateMnemonicStr,
} from '../src/index.js'

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// Known BIP-44 Ethereum vectors for the canonical seed (no passphrase).
// Derived & verified 2026-09-04 with @scure/bip32 + viem.
const ADDR_0 = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
const ADDR_1 = '0x6Fac4D18c912343BF86fa7049364Dd4E424Ab9C0'
const ADDR_2 = '0xb6716976A3ebe8D39aCEB04372f22Ff8e6802D7A'

describe('BIP-39', () => {
  it('validates a 12-word mnemonic', () => {
    expect(validateMnemonicStr(TEST_MNEMONIC)).toBe(true)
    expect(validateMnemonicStr('abandon abandon')).toBe(false)
  })

  it('generates a 128-bit (12 word) mnemonic', () => {
    const e = generateEntropy(128)
    expect(e.entropy.length).toBe(16)
    expect(e.mnemonic.split(' ')).toHaveLength(12)
    expect(validateMnemonicStr(e.mnemonic)).toBe(true)
  })

  it('generates a 256-bit (24 word) mnemonic', () => {
    const e = generateEntropy(256)
    expect(e.entropy.length).toBe(32)
    expect(e.mnemonic.split(' ')).toHaveLength(24)
  })

  it('round-trips mnemonic → entropy hex', () => {
    const hex = mnemonicHex(TEST_MNEMONIC)
    expect(hex).toMatch(/^0x[0-9a-f]{32}$/) // 16 bytes of entropy, hex-prefixed
  })
})

describe('BIP-44 Ethereum derivation (vectors)', () => {
  const seed = seedHexFromMnemonic(TEST_MNEMONIC)
  it('seed is 64 bytes (128 hex, 0x-prefixed)', () => {
    expect(seed).toMatch(/^0x[0-9a-f]{128}$/)
  })

  it('derives the known addresses for indices 0,1,2', () => {
    expect(deriveAccount(seed, 0).address).toBe(ADDR_0)
    expect(deriveAccount(seed, 1).address).toBe(ADDR_1)
    expect(deriveAccount(seed, 2).address).toBe(ADDR_2)
  })

  it('uses the m/44/60/0/0/i path', () => {
    expect(deriveAccount(seed, 0).path).toBe("m/44'/60'/0'/0/0")
  })

  it('hdAccountMeta records kind=hd + index', () => {
    const meta = hdAccountMeta('acct-0', 'Main', 0, seed)
    expect(meta.kind).toBe('hd')
    expect(meta.index).toBe(0)
    expect(meta.address).toBe(ADDR_0)
  })
})

describe('discoverAccounts', () => {
  const seed = seedHexFromMnemonic(TEST_MNEMONIC)
  it('stops after `gap` consecutive empty accounts', async () => {
    // pretend accounts 0 and 2 are "used"; 1,3,4 empty → stops after gap on 3/4
    const used = new Set([0, 2])
    const calls: number[] = []
    const found = await discoverAccounts(
      seed,
      async (acc) => {
        calls.push(acc.index)
        return used.has(acc.index)
      },
      { maxAccounts: 20, gap: 2 },
    )
    expect(found.map((a) => a.index)).toEqual([0, 2])
    // after idx 0 used, idx 1 empty(1), idx2 used(reset), idx3 empty(1), idx4 empty(2)→stop
    expect(calls.length).toBeLessThanOrEqual(6)
  })

  it('returns all used accounts up to maxAccounts when no gap reached', async () => {
    const found = await discoverAccounts(
      seed,
      async (acc) => acc.index < 5, // first 5 "used"
      { maxAccounts: 10, gap: 3 },
    )
    expect(found.map((a) => a.index)).toEqual([0, 1, 2, 3, 4])
  })
})
