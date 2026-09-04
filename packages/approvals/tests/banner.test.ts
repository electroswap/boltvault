import { describe, it, expect } from 'vitest'
import { isInfinite, infiniteApprovals, bannerCopy } from '../src/banner'
import type { AllowanceState } from '../src/banner'

const TOKEN = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
const SPENDER = '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617'

function state(allowance: bigint): AllowanceState {
  return { token: TOKEN, spender: SPENDER, allowance }
}

describe('isInfinite', () => {
  it('2^255 is infinite', () => {
    expect(isInfinite(2n ** 255n)).toBe(true)
  })
  it('a normal allowance is not infinite', () => {
    expect(isInfinite(1000n)).toBe(false)
  })
  it('just below the threshold is not infinite', () => {
    expect(isInfinite(2n ** 255n - 1n)).toBe(false)
  })
  it('the uint256 max is infinite', () => {
    expect(isInfinite((1n << 256n) - 1n)).toBe(true)
  })
})

describe('infiniteApprovals', () => {
  it('filters to infinite states only', () => {
    const states = [
      state(2n ** 255n),
      state(1000n),
      state((1n << 256n) - 1n),
      state(0n),
    ]
    const inf = infiniteApprovals(states)
    expect(inf).toHaveLength(2)
    expect(inf.every((s) => isInfinite(s.allowance))).toBe(true)
  })

  it('returns empty for no infinite states', () => {
    expect(infiniteApprovals([state(1000n), state(0n)])).toHaveLength(0)
  })
})

describe('bannerCopy', () => {
  it('null for zero', () => {
    expect(bannerCopy(0)).toBeNull()
  })

  it('counts and mentions "infinite" for 3', () => {
    const copy = bannerCopy(3)
    expect(copy).toContain('3')
    expect(copy).toContain('infinite')
    expect(copy).toContain('Revoke to reclaim control')
  })

  it('singular for 1', () => {
    expect(bannerCopy(1)).toBe(
      '1 infinite approval — anyone can move this token. Revoke to reclaim control.',
    )
  })
})
