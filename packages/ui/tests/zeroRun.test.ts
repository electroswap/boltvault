/**
 * The zero-run notation.
 *
 * Owner, on one wei of BOLT in the token screen's "Yours" plate: it "takes up
 * the entire row". `0.000000000000000001 BOLT` is twenty characters of which
 * nineteen say only "keep counting"; the notation says the count once, small
 * and low, and spends the row on the digits that decide something.
 *
 * The rules worth pinning are the ones that would be wrong quietly: a dollar
 * figure is not a token amount, the `0.00001` inside `10.00001` is not a run
 * of its own, and what survives the run is cut rather than rounded.
 */
import { describe, expect, it } from 'vitest'
import { amountRuns, ZERO_RUN_DIGITS, ZERO_RUN_MIN } from '../src/zeroRun'

describe('amountRuns', () => {
  it('compresses the balance that started this', () => {
    expect(amountRuns('0.000000000000000001 BOLT')).toEqual(['0.0', 17, '1', ' BOLT'])
  })

  it('counts every zero after the point, including the one it draws', () => {
    // "0.0₄1" is 0.00001 — four zeros hidden, one printed, five in the number.
    expect(amountRuns('0.000012345')).toEqual(['0.0', 4, '12345'])
    expect(amountRuns('0.0000012345')).toEqual(['0.0', 5, '12345'])
  })

  it('leaves a number a person can already read alone', () => {
    expect(amountRuns('0.001234')).toBeNull()
    expect(amountRuns('0.0001234')).toBeNull()
    expect(amountRuns('1.25 ETN')).toBeNull()
    expect(amountRuns('Send')).toBeNull()
    expect(amountRuns('0')).toBeNull()
  })

  it('starts exactly at the threshold', () => {
    expect(amountRuns(`0.${'0'.repeat(ZERO_RUN_MIN - 1)}1`)).toBeNull()
    expect(amountRuns(`0.${'0'.repeat(ZERO_RUN_MIN)}1`)).toEqual(['0.0', ZERO_RUN_MIN, '1'])
  })

  it('cuts the tail at six significant figures rather than rounding it up', () => {
    expect(amountRuns('0.000001234567891')).toEqual(['0.0', 5, '123456'])
    expect(amountRuns('0.000009999999999')).toEqual(['0.0', 5, '999999'])
    expect(String(amountRuns('0.000001234567891')?.[2]).length).toBe(ZERO_RUN_DIGITS)
  })

  it('leaves a dollar figure as a dollar figure', () => {
    // The owner asked for this on token amounts, not USD.
    expect(amountRuns('$0.00001234')).toBeNull()
    expect(amountRuns('$0.000000001')).toBeNull()
  })

  it('never reads a run out of the middle of a larger number', () => {
    expect(amountRuns('10.00001234')).toBeNull()
    expect(amountRuns('1,000.00001234')).toBeNull()
  })

  it('keeps a negative sign, which is not a digit', () => {
    expect(amountRuns('−0.00000123')).toEqual(['−0.0', 5, '123'])
  })

  it('compresses both amounts in a sentence, and keeps the words between them', () => {
    // The words ride along on the head of the run that follows them.
    expect(amountRuns('0.0000012 ETN → at least 0.00000034 USDC')).toEqual(['0.0', 5, '12', ' ETN → at least 0.0', 6, '34', ' USDC'])
  })

  it('is reusable — the expression keeps no state between calls', () => {
    const once = amountRuns('0.000000000000000001 BOLT')
    expect(amountRuns('0.000000000000000001 BOLT')).toEqual(once)
    expect(amountRuns('0.000000000000000001 BOLT')).toEqual(once)
  })
})
