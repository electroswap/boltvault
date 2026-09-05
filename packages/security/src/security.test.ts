import { describe, expect, it } from 'vitest'
import { poisonCheck } from './poison'
import { phishingCheck, loadScamList } from './phish'
import { decodeReceipt, KNOWN_SPENDERS } from './decode'
import { riskChips } from './risk'

describe('poisonCheck (4+4 rule)', () => {
  const known = '0x1234abcd56789012345678901234567890123456' // first4=0x12 last4=3456... let's compute
  it('hits when recipient shares first4+last4 but differs in the middle', () => {
    const knownAddr = '0x1234aaaa56789012345678901234567890123456'
    // same first 4 hex ("1234") and last 4 hex ("3456"), different middle
    const poisoned = '0x1234bbbb56789012345678901234567890123456'
    const res = poisonCheck(poisoned, [knownAddr])
    expect(res.hit).toBe(true)
    expect(res.match).toBe(knownAddr)
  })

  it('is case-insensitive', () => {
    const knownAddr = '0x1234aaaa56789012345678901234567890123456'
    const poisoned = '0x1234BBBB56789012345678901234567890123456'
    expect(poisonCheck(poisoned, [knownAddr]).hit).toBe(true)
  })

  it('does NOT hit on an exact match (the normal case)', () => {
    const knownAddr = '0x1234aaaa56789012345678901234567890123456'
    expect(poisonCheck(knownAddr, [knownAddr])).toEqual({ hit: false, match: null })
  })

  it('does NOT hit when first 4 differ', () => {
    const knownAddr = '0x1234aaaa56789012345678901234567890123456'
    const other = '0x9999aaaa56789012345678901234567890123456'
    expect(poisonCheck(other, [knownAddr])).toEqual({ hit: false, match: null })
  })

  it('does NOT hit when last 4 differ', () => {
    const knownAddr = '0x1234aaaa56789012345678901234567890123456'
    const other = '0x1234aaaa56789012345678901234567890123499'
    expect(poisonCheck(other, [knownAddr])).toEqual({ hit: false, match: null })
  })

  it('returns the matched known address from a larger history', () => {
    const a = '0x1234aaaa56789012345678901234567890123456'
    const b = '0xdeadbeef56789012345678901234567890abcdef'
    const poisoned = '0x1234cccc56789012345678901234567890123456'
    const res = poisonCheck(poisoned, [b, a])
    expect(res.hit).toBe(true)
    expect(res.match).toBe(a)
  })
})

describe('phishingCheck + loadScamList', () => {
  const scams = ['etn-scam.io', 'https://fake-claim.com']
  it('flags a listed origin (full URL with path) as known-scam', () => {
    expect(phishingCheck('https://etn-scam.io/claim?x=1', scams)).toBe('known-scam')
    expect(phishingCheck('etn-scam.io', scams)).toBe('known-scam')
    expect(phishingCheck('https://fake-claim.com/deep/path', scams)).toBe('known-scam')
  })
  it('returns ok for an unlisted origin', () => {
    expect(phishingCheck('https://github.com', scams)).toBe('ok')
    expect(phishingCheck('https://etn-scam.io.evil.net', scams)).toBe('ok')
  })
  it('loadScamList parses a JSON array', () => {
    expect(loadScamList('["a.io","b.io"]')).toEqual(['a.io', 'b.io'])
  })
  it('loadScamList returns [] on null and on invalid JSON', () => {
    expect(loadScamList(null)).toEqual([])
    expect(loadScamList('not json')).toEqual([])
    expect(loadScamList('{"a":1}')).toEqual([])
  })
})

describe('decodeReceipt (pure categorizer)', () => {
  it('classifies value>0 to an unknown address as SEND', () => {
    const d = decodeReceipt({ to: '0xabc', value: 5n })
    expect(d.category).toBe('SEND')
    expect(d.value).toBe(5n)
  })
  it('classifies value=0 with unknown `to` as UNKNOWN', () => {
    const d = decodeReceipt({ to: '0xabc', value: 0n })
    expect(d.category).toBe('UNKNOWN')
  })
  it('classifies a KNOWN_SPENDERS target (no data) as APPROVAL', () => {
    const spender = KNOWN_SPENDERS[0]!
    const d = decodeReceipt({ to: spender, value: 0n })
    expect(d.category).toBe('APPROVAL')
  })
  it('classifies a KNOWN_SPENDERS target WITH data as SWAP', () => {
    const spender = KNOWN_SPENDERS[0]!
    const d = decodeReceipt({ to: spender, value: 0n, data: '0xdeadbeef' })
    expect(d.category).toBe('SWAP')
  })
})

describe('riskChips', () => {
  it('returns the applicable chips in order', () => {
    const d = decodeReceipt({ to: KNOWN_SPENDERS[0]!, value: 0n })
    const chips = riskChips(d, { poison: true, infiniteApprove: true, unknownTo: true })
    expect(chips).toContain('poison')
    expect(chips).toContain('infinite-approve')
    expect(chips).toContain('unknown-to')
  })
  it('omits infinite-approve for a non-APPROVAL action', () => {
    const d = decodeReceipt({ to: '0xabc', value: 5n })
    const chips = riskChips(d, { poison: false, infiniteApprove: true, unknownTo: false })
    expect(chips).not.toContain('infinite-approve')
  })
  it('returns empty when no flags are set', () => {
    const d = decodeReceipt({ to: '0xabc', value: 5n })
    expect(riskChips(d, { poison: false, infiniteApprove: false, unknownTo: false })).toEqual([])
  })
})
