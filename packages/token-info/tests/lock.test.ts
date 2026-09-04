import { describe, expect, it } from 'vitest'
import { lockPctDisplay } from '../src/lock'

describe('lockPctDisplay', () => {
  it('null/undefined → em dash', () => {
    expect(lockPctDisplay(null)).toBe('—')
    expect(lockPctDisplay(undefined)).toBe('—')
  })
  it('formats a fraction as a rounded %', () => {
    expect(lockPctDisplay(0.87)).toBe('87% locked')
    expect(lockPctDisplay(0.5)).toBe('50% locked')
  })
  it('rounds small fractions to 0', () => {
    expect(lockPctDisplay(0.004)).toBe('0% locked')
  })
  it('clamps above 100', () => {
    expect(lockPctDisplay(1.5)).toBe('100% locked')
  })
  it('clamps below 0', () => {
    expect(lockPctDisplay(-0.5)).toBe('0% locked')
  })
  it('formats exactly 1 as 100%', () => {
    expect(lockPctDisplay(1)).toBe('100% locked')
  })
})
