import { describe, expect, it } from 'vitest'
import {
  ETN_COIN_TYPE,
  bip44Path,
  ledgerLivePath,
  parseBipString,
  pathToBipString,
} from '../src'

describe('bip44Path', () => {
  it('builds the zero account/index path', () => {
    expect(bip44Path(0, 0)).toEqual({
      purpose: 44,
      coinType: 60,
      account: 0,
      change: 0,
      index: 0,
    })
  })

  it('uses ETN coin type 60 by default and purpose 44', () => {
    expect(ETN_COIN_TYPE).toBe(60)
    const p = bip44Path(2, 5)
    expect(p.purpose).toBe(44)
    expect(p.coinType).toBe(60)
    expect(p.account).toBe(2)
    expect(p.change).toBe(0)
    expect(p.index).toBe(5)
  })

  it('honors a custom coinType', () => {
    const p = bip44Path(1, 0, { coinType: 600 })
    expect(p.coinType).toBe(600)
  })

  it('throws on negative account', () => {
    expect(() => bip44Path(-1, 0)).toThrow()
  })

  it('throws on negative index', () => {
    expect(() => bip44Path(0, -3)).toThrow()
  })

  it('throws on non-integer account or index', () => {
    expect(() => bip44Path(1.5, 0)).toThrow()
    expect(() => bip44Path(0, 2.25)).toThrow()
  })
})

describe('ledgerLivePath', () => {
  it('puts the account in the account slot with change/index 0', () => {
    expect(ledgerLivePath(2)).toEqual({
      purpose: 44,
      coinType: 60,
      account: 2,
      change: 0,
      index: 0,
    })
  })
})

describe('pathToBipString', () => {
  it('renders bip44Path(0,3) with hardened purpose/coin/account', () => {
    expect(pathToBipString(bip44Path(0, 3))).toBe("m/44'/60'/0'/0/3")
  })

  it('renders bip44Path(2,0)', () => {
    expect(pathToBipString(bip44Path(2, 0))).toBe("m/44'/60'/2'/0/0")
  })

  it('renders ledgerLivePath(2)', () => {
    expect(pathToBipString(ledgerLivePath(2))).toBe("m/44'/60'/2'/0/0")
  })

  it('renders the zero path', () => {
    expect(pathToBipString(bip44Path(0, 0))).toBe("m/44'/60'/0'/0/0")
  })
})

describe('parseBipString', () => {
  it('round-trips pathToBipString for several paths', () => {
    const cases: Array<Parameters<typeof pathToBipString>[0]> = [
      bip44Path(0, 0),
      bip44Path(0, 3),
      bip44Path(2, 0),
      bip44Path(7, 12),
      ledgerLivePath(2),
      ledgerLivePath(0),
    ]
    for (const p of cases) {
      const s = pathToBipString(p)
      const parsed = parseBipString(s)
      expect(parsed).toEqual(p)
    }
  })

  it('parses a hardened string into the struct', () => {
    expect(parseBipString("m/44'/60'/0'/0/3")).toEqual({
      purpose: 44,
      coinType: 60,
      account: 0,
      change: 0,
      index: 3,
    })
  })

  it('throws on malformed input', () => {
    expect(() => parseBipString("44'/60'/0'/0/0")).toThrow()
    expect(() => parseBipString("m/44'/60'/0'")).toThrow()
  })
})
