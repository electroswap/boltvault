import { describe, expect, it } from 'vitest'
import { sparkline } from '../src/sparkline'

describe('sparkline', () => {
  it('throws on empty series', () => {
    expect(() => sparkline([])).toThrow()
  })
  it('up trend', () => {
    const r = sparkline([1, 2, 3])
    expect(r.trend).toBe('up')
    expect(r.changePct).toBeCloseTo(200, 5)
    expect(r.points).toEqual([1, 2, 3])
  })
  it('down trend', () => {
    const r = sparkline([3, 2, 1])
    expect(r.trend).toBe('down')
    expect(r.changePct).toBeCloseTo(-66.6667, 3)
  })
  it('flat series → changePct 0, flat', () => {
    const r = sparkline([5, 5, 5])
    expect(r.trend).toBe('flat')
    expect(r.changePct).toBe(0)
  })
  it('first point 0 → changePct null, flat', () => {
    const r = sparkline([0, 1])
    expect(r.changePct).toBeNull()
    expect(r.trend).toBe('flat')
  })
  it('tiny change within epsilon → flat', () => {
    const r = sparkline([100, 100.01])
    expect(r.trend).toBe('flat')
  })
  it('copies points (does not alias input)', () => {
    const input = [1, 2, 3]
    const r = sparkline(input)
    r.points.push(99)
    expect(input).toEqual([1, 2, 3])
  })
})
