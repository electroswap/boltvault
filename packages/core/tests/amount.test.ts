/**
 * Reading a typed amount without inventing digits (ES-BV-048).
 *
 * viem's `parseUnits` rounds half up, so `parseUnits('1.5', 0)` is `2` — more
 * than was asked for, on a token where one unit may be the whole holding. The
 * form showed "1.5", the sheet showed "2", and nothing said the two were
 * different. Precision a token cannot hold is now a question, not a value.
 */
import { parseUnits } from 'viem'
import { describe, expect, it } from 'vitest'
import { AmountFormatError, AmountPrecisionError, parseAmountStrict, tryParseAmountStrict } from '../src/amount'

describe('parseAmountStrict', () => {
  it('parses what it can hold, exactly', () => {
    expect(parseAmountStrict('1', 18)).toBe(10n ** 18n)
    expect(parseAmountStrict('1.5', 18)).toBe(1_500_000_000_000_000_000n)
    expect(parseAmountStrict('0.000001', 6)).toBe(1n)
    expect(parseAmountStrict('123', 0)).toBe(123n)
    expect(parseAmountStrict('.5', 2)).toBe(50n)
    expect(parseAmountStrict('7.', 2)).toBe(700n)
  })

  it('treats an empty field as zero, the way every amount box starts', () => {
    expect(parseAmountStrict('', 18)).toBe(0n)
    expect(parseAmountStrict('   ', 18)).toBe(0n)
  })

  it('refuses precision the token cannot hold, where parseUnits would round it away', () => {
    // The case from the finding: half-up rounding sends more than was typed.
    expect(parseUnits('1.5', 0)).toBe(2n)
    expect(() => parseAmountStrict('1.5', 0)).toThrow(AmountPrecisionError)
    expect(() => parseAmountStrict('1.0000005', 6)).toThrow(AmountPrecisionError)
    expect(() => parseAmountStrict('0.1', 0)).toThrow(AmountPrecisionError)
    // And it says which token, so the person can decide what they meant.
    expect(new AmountPrecisionError(6, '1.0000005').message).toContain('6 decimal places')
    expect(new AmountPrecisionError(0, '1.5').message).toContain('whole units')
  })

  it('allows trailing zeros past the precision, which carry no value', () => {
    expect(parseAmountStrict('1.500', 2)).toBe(150n)
    expect(parseAmountStrict('1.000000', 0)).toBe(1n)
  })

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['-1', '1e18', '1,5', 'abc', '1.2.3', '0x10', '+2', ' 1 2 '])
      expect(() => parseAmountStrict(bad, 18), bad).toThrow(AmountFormatError)
  })

  it('has an answer-shaped form for callers that would rather branch', () => {
    expect(tryParseAmountStrict('1.5', 0)).toBe(null)
    expect(tryParseAmountStrict('1', 0)).toBe(1n)
  })
})
