import { describe, expect, it } from 'vitest'
import { hasTag, normalizeTags, SWAP_TAG } from '../src/tags'

describe('normalizeTags', () => {
  it('trims and drops empty', () => {
    expect(normalizeTags(['  a ', '', ' b'])).toEqual(['a', 'b'])
  })
  it('dedupes case-insensitively, keeps first', () => {
    expect(normalizeTags(['Swap', 'swap', 'SWAP'])).toEqual(['Swap'])
  })
  it('preserves order of first occurrence', () => {
    expect(normalizeTags(['b', 'a', 'c'])).toEqual(['b', 'a', 'c'])
  })
  it('caps at 4', () => {
    expect(normalizeTags(['a', 'b', 'c', 'd', 'e', 'f'])).toEqual(['a', 'b', 'c', 'd'])
  })
  it('returns empty for all-empty input', () => {
    expect(normalizeTags(['', '  '])).toEqual([])
  })
})

describe('SWAP_TAG / hasTag', () => {
  it('SWAP_TAG constant', () => {
    expect(SWAP_TAG).toBe('swap')
  })
  it('hasTag is case-insensitive', () => {
    expect(hasTag(['Swap', 'staking'], 'swap')).toBe(true)
    expect(hasTag(['Swap'], 'SWAP')).toBe(true)
    expect(hasTag(['staking'], 'swap')).toBe(false)
  })
  it('hasTag trims', () => {
    expect(hasTag(['  swap '], 'swap')).toBe(true)
  })
})
