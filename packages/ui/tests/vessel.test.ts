/**
 * The Legends vessel's acceptance criterion is a motion rule (master plan
 * §7.12): "the vessel never animates when nothing has changed". The component
 * honours it by writing the liquid's height as a plain style value with a CSS
 * transition on it — no keyframes, no idle loop — so the rule reduces to one
 * question this can actually ask: does the same level, and does a level that
 * has only drifted, produce the same number of pixels?
 */
import { describe, expect, it } from 'vitest'
import { VESSEL_MIN_FILL, VESSEL_WALL, vesselFill } from '../src/vesselFill'

const H = 120
const USABLE = H - VESSEL_WALL * 2

describe('vesselFill', () => {
  it('is empty at zero and full at one', () => {
    expect(vesselFill(0, H)).toBe(0)
    expect(vesselFill(1, H)).toBe(USABLE)
  })

  it('never animates when nothing has changed', () => {
    expect(vesselFill(0.64, H)).toBe(vesselFill(0.64, H))
  })

  it('ignores drift too small to see — the poll that returns a hair more', () => {
    // Dividends accrue continuously, so a 30 s poll always returns a slightly
    // larger number than the last. 0.64 of a 116 px glass is 74.24 px: until
    // the level buys a whole pixel, the liquid must not move.
    const base = vesselFill(0.64, H)
    expect(base).toBe(74)
    expect(vesselFill(0.6401, H)).toBe(base)
    expect(vesselFill(0.6404, H)).toBe(base)
    expect(vesselFill(0.6415, H)).toBe(base)
  })

  it('does move once the level has moved a visible amount', () => {
    expect(vesselFill(0.7, H)).toBeGreaterThan(vesselFill(0.64, H))
  })

  it('keeps a meniscus for a balance too small to round to a pixel', () => {
    // The first fee ever must not paint as an empty vessel.
    expect(vesselFill(0.0001, H)).toBe(VESSEL_MIN_FILL)
  })

  it('clamps a level outside 0..1 and survives a NaN', () => {
    expect(vesselFill(-1, H)).toBe(0)
    expect(vesselFill(5, H)).toBe(USABLE)
    expect(vesselFill(Number.NaN, H)).toBe(0)
  })

  it('never overflows its glass, at any size', () => {
    for (const height of [8, 13, 40, 64, 78, 120, 200]) {
      const usable = Math.max(0, height - VESSEL_WALL * 2)
      for (const level of [0, 0.01, 0.5, 0.999, 1]) {
        const fill = vesselFill(level, height)
        expect(fill).toBeGreaterThanOrEqual(0)
        expect(fill).toBeLessThanOrEqual(usable)
      }
    }
  })
})
