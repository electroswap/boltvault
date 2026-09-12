/**
 * What the address book accepts, pinned.
 *
 * The screen advertised `name.etn` in its own placeholder and then refused it:
 * the literal string went to `contacts.add`, which opens with `isAddress()`.
 * `.eth` was worse — the gate rejected the suffix outright, so Save stayed
 * inert with no error to explain it. Reported as: "At address book the wallet
 * does not recognize by ENS name."
 */
import { describe, expect, it } from 'vitest'
import { bookEntryKind } from '../src/screens/addressBookRules'

const ADDRESS = '0x' + 'ab'.repeat(20)

describe('bookEntryKind', () => {
  it('takes a plain address', () => {
    expect(bookEntryKind(ADDRESS)).toBe('address')
    expect(bookEntryKind(`  ${ADDRESS}  `)).toBe('address')
    expect(bookEntryKind(ADDRESS.toUpperCase().replace('0X', '0x'))).toBe('address')
  })

  it('takes both suffixes the resolver knows, in any case', () => {
    expect(bookEntryKind('brad.etn')).toBe('name')
    // The regression: `.eth` resolves on Ethereum and the book would not take it.
    expect(bookEntryKind('brad.eth')).toBe('name')
    expect(bookEntryKind('Brad.ETH')).toBe('name')
    expect(bookEntryKind('  electroswap.etn ')).toBe('name')
  })

  it('refuses a suffix with no name in front of it', () => {
    expect(bookEntryKind('.etn')).toBe('unusable')
    expect(bookEntryKind('.eth')).toBe('unusable')
  })

  it('refuses a name wearing an address prefix', () => {
    // A lookalike, not a lookup: `0x…` in the address slot is an address claim.
    expect(bookEntryKind('0xelectroswap.etn')).toBe('unusable')
    expect(bookEntryKind('0xdeadbeef')).toBe('unusable')
  })

  it('refuses a suffix nothing resolves', () => {
    expect(bookEntryKind('brad.com')).toBe('unusable')
    expect(bookEntryKind('brad')).toBe('unusable')
    expect(bookEntryKind('')).toBe('unusable')
  })

  it('refuses an address of the wrong length', () => {
    expect(bookEntryKind('0x' + 'ab'.repeat(19))).toBe('unusable')
    expect(bookEntryKind('0x' + 'ab'.repeat(21))).toBe('unusable')
  })
})
