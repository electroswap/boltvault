import { describe, expect, it } from 'vitest'
import { AddressBook, checkPoison, poisonSet } from '../src'

// Valid EIP-55 checksummed addresses (viem's strict isAddress rejects hand-rolled).
// A and POISON share first4 (a1a1) + last4 (a1a1) but differ in the middle.
const A = '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1'
const B = '0xb2b2b2b2b2B2b2B2B2b2b2B2B2b2B2B2b2b2b2b2'
const POISON = '0xa1a1fFA1A1a1a1A1A1a1A1a1a1a1a1a1a1a1A1a1'

describe('AddressBook (T4.4)', () => {
  it('add/get/remove by address, case-insensitive', () => {
    const book = new AddressBook()
    book.add({ address: A, label: 'Family' })
    expect(book.get(A)?.label).toBe('Family')
    expect(book.get(A.toLowerCase())?.label).toBe('Family')
    expect(book.remove(A.toLowerCase())).toBe(true)
    expect(book.get(A)).toBeUndefined()
  })

  it('knownAddresses lists stored entries', () => {
    const book = new AddressBook([
      { address: A, label: 'a' },
      { address: B, label: 'b' },
    ])
    expect(book.knownAddresses().sort()).toEqual([A, B].sort())
  })
})

describe('checkPoison 4+4 (T4.4, design line 974)', () => {
  it('flags a lookalike sharing first4+last4 with a known address', () => {
    const r = checkPoison(POISON, [A], new Map([[A.toLowerCase(), 'Family']]))
    expect(r.poisoned).toBe(true)
    expect(r.looksLike).toBe(A)
    expect(r.label).toBe('Family')
  })

  it('does not flag an exact match (that IS the known address)', () => {
    expect(checkPoison(A, [A]).poisoned).toBe(false)
  })

  it('does not flag unrelated addresses', () => {
    expect(checkPoison(B, [A]).poisoned).toBe(false)
  })

  it('is case-insensitive', () => {
    const r = checkPoison(POISON.toLowerCase(), [A])
    expect(r.poisoned).toBe(true)
  })

  it('poisonSet merges history + book with labels', () => {
    const book = new AddressBook([{ address: B, label: 'Buddy' }])
    const { set, labels } = poisonSet([A], book)
    expect(set).toContain(A.toLowerCase())
    expect(set).toContain(B.toLowerCase())
    expect(labels.get(B.toLowerCase())).toBe('Buddy')
  })
})
