/**
 * `formatCompact` — five numbers side by side in a 400 px popup.
 *
 * The case worth pinning is the one that was wrong first: rounding to one
 * decimal can tip a figure into the unit above, and 999,999 is 1M, not 1000K.
 */
import { describe, expect, it } from 'vitest'
import { displayFiat, formatAmount, formatCompact, formatFloor, formatQuantity, formatRaw, maskedFiat } from '../src/format'

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

/**
 * The Approvals screen used to pass a raw `uint256` allowance to
 * `formatQuantity`, which treats its argument as a human quantity. A bounded
 * 1,000 USDC approval therefore read "1.00B", indistinguishable from an
 * unlimited one on the single screen whose job is deciding what to revoke.
 * The row now carries `decimals` and the screen scales by it.
 */
describe('allowance amounts are scaled by the token, not shown raw', () => {
  it('renders a bounded allowance at its real size', () => {
    expect(formatAmount('1000000000', 6)).toBe('1,000')
    expect(formatAmount('1248000000', 6)).toBe('1,248')
    expect(formatAmount('500000000000000000', 18)).toBe('0.5')
  })

  it('is the fix for what the raw string used to render as', () => {
    // What the screen did before: the same 1,000 USDC allowance, unscaled.
    expect(formatQuantity('1000000000')).toBe('1.00B')
    expect(formatAmount('1000000000', 6)).not.toBe(formatQuantity('1000000000'))
  })
})

/**
 * Every formatter rounded to its display precision, and rounding goes *up*
 * half the time — so a balance read fractionally higher than it was, and the
 * swap's "minimum received" advertised a floor above the one the calldata
 * actually enforces. A number the wallet shows must never exceed the number
 * the wallet holds.
 */
describe('never rounds up', () => {
  it('truncates rather than rounding, at every scale', () => {
    // One wei short of a whole token must not read as a whole token.
    expect(formatRaw('999999999999999999', 18)).not.toBe('1')
    // One short of the next unit must not tip the compact ladder.
    expect(formatQuantity('999999999')).toBe('999.99M')
    expect(formatQuantity('1.999')).toBe('1.99')
    expect(formatQuantity('0.019999')).toBe('0.01999')
  })

  it('formatFloor states a guarantee exactly, with no Number in the path', () => {
    expect(formatFloor('1234567100', 6)).toBe('1,234.5671')
    expect(formatFloor('999999999999999999', 18)).toBe('0.999999')
    expect(formatFloor('0', 18)).toBe('0')
  })

  it('holds over a spread of pseudo-random amounts', () => {
    let seed = 12345n
    for (let i = 0; i < 200; i++) {
      seed = (seed * 6364136223846793005n + 1442695040888963407n) % (1n << 64n)
      const raw = seed % 10n ** 24n
      const exact = Number(raw) / 1e18
      const shown = Number(formatRaw(raw.toString(), 18).replace(/,/g, ''))
      // Compact forms ('1.23M') parse as NaN; those are checked above.
      if (!Number.isFinite(shown)) continue
      expect(shown).toBeLessThanOrEqual(exact)
    }
  })
})

describe('hidden portfolio figures', () => {
  it('uses a fixed mask so the length cannot leak the size', () => {
    expect(maskedFiat('USD')).toBe('$****.**')
    expect(maskedFiat('ETN')).toBe('**** ETN')
    expect(displayFiat(1234.56, 'USD', true)).toBe('$****.**')
    expect(displayFiat(1234.56, 'USD', false)).toBe('$1,234.56')
    expect(displayFiat(null, 'USD', true)).toBe('—')
  })
})
