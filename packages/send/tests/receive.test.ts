import { describe, expect, it } from 'vitest'
import {
  buildReceiveUri,
  normalizeAmount,
  receiveAmountWei,
  NATIVE_ASSET,
} from '../src'

const ADDR = '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1'

describe('buildReceiveUri (T4.5, design verify: "ethereum:0x…@52014")', () => {
  it('native receive with chain caption', () => {
    expect(buildReceiveUri(ADDR, { chainId: 52014 })).toBe(`ethereum:${ADDR}@52014`)
  })

  it('native receive with amount + tag', () => {
    const uri = buildReceiveUri(ADDR, { chainId: 52014, amount: '1.5', tag: 'rent' })
    expect(uri).toBe(`ethereum:${ADDR}@52014?amount=1.5&tag=rent`)
  })

  it('ERC-20 receive adds address + asset', () => {
    const token = '0xb2b2b2b2b2B2b2B2B2b2b2B2B2b2B2B2b2b2b2b2'
    const uri = buildReceiveUri(ADDR, { chainId: 52014, token, amount: '2' })
    expect(uri).toContain(`address=${token}`)
    expect(uri).toContain(`asset=${token}`)
    expect(uri).toContain('amount=2')
  })

  it('normalizes amount (drops trailing .0 / zeros)', () => {
    const uri = buildReceiveUri(ADDR, { chainId: 52014, amount: '1.500' })
    expect(uri).toContain('amount=1.5')
  })

  it('no chainId → bare ethereum: URI', () => {
    expect(buildReceiveUri(ADDR)).toBe(`ethereum:${ADDR}`)
  })

  it('throws on a non-address', () => {
    expect(() => buildReceiveUri('0x123', { chainId: 52014 })).toThrow(/not an address/)
  })

  it('message/tag are URL-encoded', () => {
    const uri = buildReceiveUri(ADDR, { chainId: 52014, message: 'a b/c' })
    expect(uri).toContain('message=a%20b%2Fc')
  })

  it('NATIVE_ASSET is the 20-byte zero address', () => {
    expect(NATIVE_ASSET).toBe('0x0000000000000000000000000000000000000000')
  })
})

describe('normalizeAmount', () => {
  it('trims trailing zeros, keeps real fractions', () => {
    expect(normalizeAmount('1.500')).toBe('1.5')
    expect(normalizeAmount('1.0')).toBe('1')
    expect(normalizeAmount('2')).toBe('2')
    expect(normalizeAmount('0.10')).toBe('0.1')
    expect(normalizeAmount('1.2345')).toBe('1.2345')
  })
})

describe('receiveAmountWei', () => {
  it('parses the requested amount to base units', () => {
    expect(receiveAmountWei('1.5', 18)).toBe(1_500_000_000_000_000_000n)
    expect(receiveAmountWei('2', 6)).toBe(2_000_000n)
  })
})
