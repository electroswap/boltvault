import { describe, expect, it } from 'vitest'
import {
  normalizeAccount,
  previewAddresses,
  treesDisagree,
} from '../src'

describe('normalizeAccount (S3 caveat)', () => {
  it('index 0: the two trees agree', () => {
    const a = normalizeAccount(0)
    expect(a.index).toBe(0)
    expect(a.bip44).toBe("m/44'/60'/0'/0/0")
    expect(a.ledgerLive).toBe("m/44'/60'/0'/0/0")
    expect(a.bip44).toBe(a.ledgerLive)
    expect(a.treesAgree).toBe(true)
  })

  it('index 1: the two trees disagree', () => {
    const a = normalizeAccount(1)
    expect(a.index).toBe(1)
    // BIP-44 wallet account 1: index is the LAST slot.
    expect(a.bip44).toBe("m/44'/60'/0'/0/1")
    // Ledger Live account 1: index is the HARDENED account slot.
    expect(a.ledgerLive).toBe("m/44'/60'/1'/0/0")
    expect(a.bip44).not.toBe(a.ledgerLive)
    expect(a.treesAgree).toBe(false)
  })

  it('index 5 keeps the two trees distinct', () => {
    const a = normalizeAccount(5)
    expect(a.bip44).toBe("m/44'/60'/0'/0/5")
    expect(a.ledgerLive).toBe("m/44'/60'/5'/0/0")
    expect(a.treesAgree).toBe(false)
  })

  it('treesDisagree is true for i>0 and false for i===0', () => {
    expect(treesDisagree(0)).toBe(false)
    expect(treesDisagree(1)).toBe(true)
    expect(treesDisagree(42)).toBe(true)
  })
})

describe('previewAddresses', () => {
  it('returns two distinct strings for index 1', () => {
    const p = previewAddresses(1)
    expect(p.bip44).toBe("m/44'/60'/0'/0/1")
    expect(p.ledgerLive).toBe("m/44'/60'/1'/0/0")
    expect(p.bip44).not.toBe(p.ledgerLive)
  })

  it('index 0 returns the same string for both trees', () => {
    const p = previewAddresses(0)
    expect(p.bip44).toBe("m/44'/60'/0'/0/0")
    expect(p.ledgerLive).toBe("m/44'/60'/0'/0/0")
  })

  it('supports the 3-preview loop (0,1,2) producing distinct ledger-live paths', () => {
    const previews = [0, 1, 2].map((i) => previewAddresses(i))
    const ledgerLivePaths = previews.map((p) => p.ledgerLive)
    // Each preview is internally well-formed; ledger-live paths are all distinct.
    expect(ledgerLivePaths).toEqual([
      "m/44'/60'/0'/0/0",
      "m/44'/60'/1'/0/0",
      "m/44'/60'/2'/0/0",
    ])
    expect(new Set(ledgerLivePaths).size).toBe(3)
  })
})
