/**
 * `formatCompact` — five numbers side by side in a 400 px popup.
 *
 * The case worth pinning is the one that was wrong first: rounding to one
 * decimal can tip a figure into the unit above, and 999,999 is 1M, not 1000K.
 */
import { describe, expect, it } from 'vitest'
import { formatCompact } from '../src/format'

describe('formatCompact', () => {
  it('leaves anything under a thousand alone, decimals and all', () => {
    expect(formatCompact(0)).toBe('0')
    expect(formatCompact(0.45)).toBe('0.45')
    expect(formatCompact(12)).toBe('12')
    expect(formatCompact(999)).toBe('999')
  })

  it('uses K, M, B and T from a thousand up', () => {
    expect(formatCompact(1_000)).toBe('1K')
    expect(formatCompact(1_204)).toBe('1.2K')
    expect(formatCompact(12_483)).toBe('12.5K')
    expect(formatCompact(1_204_663)).toBe('1.2M')
    expect(formatCompact(3.4e9)).toBe('3.4B')
    expect(formatCompact(1.2e12)).toBe('1.2T')
  })

  it('promotes a figure that rounding pushed into the next unit', () => {
    expect(formatCompact(999_999)).toBe('1M')
    expect(formatCompact(999_999_999)).toBe('1B')
  })

  it('never leaves a trailing .0, and keeps a sign', () => {
    expect(formatCompact(2_000)).toBe('2K')
    expect(formatCompact(-1_500)).toBe('−1.5K')
  })

  it('says nothing rather than guessing', () => {
    expect(formatCompact(null)).toBe('—')
    expect(formatCompact(Number.NaN)).toBe('—')
  })

  it('stops at the top of the ladder rather than inventing a unit', () => {
    expect(formatCompact(5e15)).toBe('>999T')
  })
})
