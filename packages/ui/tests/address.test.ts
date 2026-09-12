/**
 * How an address is written on screen (ES-BV-033).
 *
 * EIP-55 casing is a checksum a person can see, and the wallet rendered
 * everything lowercase — throwing away the one tell that survives a copy-paste
 * from the wrong place. The short form was `0x` plus four hex either end,
 * which is exactly the shape an address-poisoning generator is built to
 * satisfy: minutes of ordinary hardware.
 */
import { describe, expect, it } from 'vitest'
import { checksum, differingAt, fullAddress, shortAddress } from '../src/address'

/* The EIP-55 specification's own vectors. */
const VECTORS = [
  '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
  '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
  '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
  '0xD1220A0cf47c7B9Be7A2E6BA89F429762e7b9aDb',
]

describe('checksum', () => {
  it('matches the EIP-55 vectors, from any input casing', () => {
    for (const v of VECTORS) {
      expect(checksum(v.toLowerCase())).toBe(v)
      expect(checksum(v.toUpperCase().replace('0X', '0x'))).toBe(v)
      expect(checksum(v)).toBe(v)
    }
  })

  it('returns anything that is not an address unchanged', () => {
    for (const s of ['', 'vitalik.eth', 'Mum', '0x1234', 'not an address'])
      expect(checksum(s)).toBe(s)
  })
})

describe('shortAddress', () => {
  it('shows six hex either side, checksummed', () => {
    // Four and four is grindable in minutes; six and six is not.
    expect(shortAddress(VECTORS[0] as string)).toBe('0x5aAeb6…1BeAed')
    const short = shortAddress(VECTORS[1] as string)
    expect(short.split('…')[0]).toHaveLength(8)
    expect(short.split('…')[1]).toHaveLength(6)
    expect(short).toMatch(/[A-F]/)
  })

  it('leaves a name alone rather than truncating it into something else', () => {
    expect(shortAddress('vitalik.eth')).toBe('vitalik.eth')
  })
})

describe('fullAddress and differingAt', () => {
  it('gives the whole checksummed string', () => {
    expect(fullAddress((VECTORS[2] as string).toLowerCase())).toBe(VECTORS[2])
  })

  it('says which of the forty characters differ, ignoring casing', () => {
    const a = '0x1111111111111111111111111111111111111111'
    const b = '0x1111111111111111111111111111111111111112'
    expect(differingAt(a, b)).toEqual([39])
    expect(differingAt(a, a)).toEqual([])
    expect(differingAt(a, 'not an address')).toEqual([])
  })
})
