import { describe, expect, it } from 'vitest'
import { safetyChip, safetyLevel } from '../src/safety'

describe('safetyLevel', () => {
  it('maps null/undefined to unknown', () => {
    expect(safetyLevel(null)).toBe('unknown')
    expect(safetyLevel(undefined)).toBe('unknown')
  })
  it('maps >=70 to safe', () => {
    expect(safetyLevel(70)).toBe('safe')
    expect(safetyLevel(100)).toBe('safe')
  })
  it('maps 40..69 to medium', () => {
    expect(safetyLevel(69)).toBe('medium')
    expect(safetyLevel(40)).toBe('medium')
  })
  it('maps (0,40) to risky', () => {
    expect(safetyLevel(39)).toBe('risky')
    expect(safetyLevel(1)).toBe('risky')
  })
  it('maps <=0 (incl. negative) to risky', () => {
    expect(safetyLevel(0)).toBe('risky')
    expect(safetyLevel(-5)).toBe('risky')
  })
})

describe('safetyChip', () => {
  it('labels match the level', () => {
    expect(safetyChip(90)).toEqual({ level: 'safe', label: 'Verified' })
    expect(safetyChip(55)).toEqual({ level: 'medium', label: 'Check contract' })
    expect(safetyChip(10)).toEqual({ level: 'risky', label: 'Unverified' })
    expect(safetyChip(-1)).toEqual({ level: 'risky', label: 'Unverified' })
    expect(safetyChip(null)).toEqual({ level: 'unknown', label: 'No data' })
  })
})
