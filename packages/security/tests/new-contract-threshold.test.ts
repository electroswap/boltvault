/**
 * How new "very new" is (§3.4's `NEW_CONTRACT`).
 *
 * The number is configurable so ops can retune it without shipping a wallet,
 * which means it arrives from outside — and anything arriving from outside that
 * governs a warning has to be clamped. A served zero would switch the warning
 * off, and that is the one failure a user cannot notice: nothing appears, and
 * nothing appearing is exactly what a safe contract looks like.
 *
 * So the bundled default is a floor. A served value may make the wallet more
 * careful and never less.
 */
import { describe, expect, it } from 'vitest'
import { assess, clampNewContractDays, emptyContext, NEW_CONTRACT_DEFAULT_DAYS, NEW_CONTRACT_MAX_DAYS } from '../src'

const ME = '0x1111111111111111111111111111111111111111' as const
const CONTRACT = '0x2222222222222222222222222222222222222222' as const
const ETN = 52014

/** A transaction to `CONTRACT`, assessed with an age and a threshold. */
function codes(ageDays: number, newContractAfterDays: number): string[] {
  const a = assess({
    origin: 'https://dapp.example',
    chainId: ETN,
    account: ME,
    request: { kind: 'transaction', tx: { from: ME, to: CONTRACT, value: 0n, data: '0xdeadbeef', chainId: ETN } },
    context: emptyContext({
      contracts: { [CONTRACT.toLowerCase()]: { hasCode: true, ageDays, verified: true } },
      newContractAfterDays,
    }),
  })
  return a.rules.map((r) => r.code)
}

describe('the threshold the rule compares against', () => {
  it('flags a contract younger than the threshold and leaves an older one alone', () => {
    expect(codes(3, 7)).toContain('NEW_CONTRACT')
    expect(codes(9, 7)).not.toContain('NEW_CONTRACT')
  })

  it('follows the configured number rather than a hard-coded week', () => {
    // Ten days old: not new under the default, new under a thirty-day policy.
    expect(codes(10, NEW_CONTRACT_DEFAULT_DAYS)).not.toContain('NEW_CONTRACT')
    expect(codes(10, 30)).toContain('NEW_CONTRACT')
  })
})

describe('clamping what was served', () => {
  it('never goes below the bundled default, however low the served value', () => {
    for (const served of [0, -1, 1, 6, NEW_CONTRACT_DEFAULT_DAYS - 0.5]) {
      expect(clampNewContractDays(served), String(served)).toBe(NEW_CONTRACT_DEFAULT_DAYS)
    }
  })

  it('accepts a higher value, because more caution is allowed', () => {
    expect(clampNewContractDays(30)).toBe(30)
    expect(clampNewContractDays(NEW_CONTRACT_MAX_DAYS)).toBe(NEW_CONTRACT_MAX_DAYS)
  })

  it('stops at the ceiling, past which it is noise rather than newness', () => {
    expect(clampNewContractDays(NEW_CONTRACT_MAX_DAYS + 1)).toBe(NEW_CONTRACT_MAX_DAYS)
    expect(clampNewContractDays(10_000)).toBe(NEW_CONTRACT_MAX_DAYS)
  })

  it('falls back to the default when nothing usable was served', () => {
    for (const served of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(clampNewContractDays(served), String(served)).toBe(NEW_CONTRACT_DEFAULT_DAYS)
    }
  })

  it('takes whole days, so a fractional policy cannot widen the window by rounding up', () => {
    expect(clampNewContractDays(30.9)).toBe(30)
  })

  it('defaults to what §3.4 fixes it at', () => {
    expect(NEW_CONTRACT_DEFAULT_DAYS).toBe(7)
    expect(emptyContext({}).newContractAfterDays).toBe(NEW_CONTRACT_DEFAULT_DAYS)
  })
})
