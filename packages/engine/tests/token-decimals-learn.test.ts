/**
 * A token the catalog never heard of still has decimals (ES-BV-083).
 *
 * `ctx.tokens` is built from `tokens.universe` — the signed list plus whatever
 * the user added by hand. Anything outside it reached `amountText` in rules.ts
 * with no entry, and that function's fallback is `${amount} units`: the raw
 * integer. The firewall's statement is stored verbatim on the activity row, so
 * the raw figure then showed for ever — which is how a beta tester came to be
 * reading wei under "Your activity" on a token's own page. A device whose token
 * list simply failed to fetch hit it for *every* token, not just obscure ones.
 *
 * The contract knows the answer. What needs pinning is the judgement about what
 * counts as an answer, which is why it is a function of its own rather than
 * four lines inside the call that fetches it.
 */
import { describe, expect, it } from 'vitest'
import { DECIMALS_SELECTOR, decimalsFromCall } from '../src/namespaces/provider'

/** A 32-byte ABI word holding `n`. */
const word = (n: number): string => `0x${n.toString(16).padStart(64, '0')}`

describe('decimalsFromCall', () => {
  it('reads the common scales', () => {
    // 6 is the USDC shape — the case where assuming 18 is wrong by a factor of
    // a trillion, which is the whole reason this is asked rather than guessed.
    expect(decimalsFromCall(word(6))).toBe(6)
    expect(decimalsFromCall(word(18))).toBe(18)
  })

  it('accepts zero places, which is a real answer and not a missing one', () => {
    expect(decimalsFromCall(word(0))).toBe(0)
  })

  it('takes a short answer, since not every node pads to a full word', () => {
    expect(decimalsFromCall('0x12')).toBe(18)
  })

  it('refuses a scale this wallet cannot do arithmetic with', () => {
    // `toRawUnits` in the activity parser draws the same line at 36.
    expect(decimalsFromCall(word(37))).toBeNull()
    expect(decimalsFromCall(word(255))).toBeNull()
  })

  it('refuses an answer that is not a number at all', () => {
    // A contract that returns a string, or a node that returns an error body.
    expect(decimalsFromCall('0xnope')).toBeNull()
    expect(decimalsFromCall('0x')).toBeNull()
    expect(decimalsFromCall('')).toBeNull()
    expect(decimalsFromCall(null)).toBeNull()
  })

  it('asks for decimals() and nothing else', () => {
    // The four-byte selector for `decimals()`. Getting this wrong would read
    // some other method and quietly believe the result.
    expect(DECIMALS_SELECTOR).toBe('0x313ce567')
  })
})
