/**
 * RollingReadout — Oxanium numerals that roll only when a digit changes
 * (master plan §7.4/§7.7). Each character animates independently; unchanged
 * characters stay still, so a static total is never a slot machine.
 * `aria-live` is polite and the whole value is announced, throttled by the
 * caller.
 */
import { useEffect, useRef } from 'react'
import Animated from 'react-native-reanimated'
import { Readout, Row, subRun } from './primitives'
import { motion } from './tokens'
import { amountRuns } from './zeroRun'

/**
 * The value as the cells that roll: one per character, except a compressed run
 * of zeros, which is one cell holding its own count.
 *
 * The readout animates per character, so without this a dust total would roll
 * "0.000000000000000001" as twenty independent cells — the wall this notation
 * exists to remove, rebuilt one digit at a time.
 */
function cellsOf(value: string): readonly (string | number)[] {
  const runs = amountRuns(value)
  if (!runs) return Array.from(value)
  const cells: (string | number)[] = []
  for (const run of runs) {
    if (typeof run === 'number') cells.push(run)
    else cells.push(...run)
  }
  return cells
}

export interface RollingReadoutProps {
  readonly value: string
  readonly hero?: boolean
  readonly reducedMotion?: boolean
  /** Spoken instead of `value` when the glyphs are a stand-in (hidden balances). */
  readonly accessibilityLabel?: string
  readonly testID?: string
}

export function RollingReadout({ value, hero = false, reducedMotion = false, accessibilityLabel, testID }: RollingReadoutProps) {
  const prev = useRef<string>(value)
  const cells = cellsOf(value)
  const changed = new Set<number>()
  if (prev.current !== value) {
    const a = cellsOf(prev.current)
    for (let i = 0; i < cells.length; i++) if (a[i] !== cells[i]) changed.add(i)
  }
  useEffect(() => {
    prev.current = value
  }, [value])

  return (
    <Row accessibilityLiveRegion="polite" accessibilityLabel={accessibilityLabel ?? value} testID={testID}>
      {cells.map((ch, i) => {
        const roll = changed.has(i) && !reducedMotion
        return (
          <Animated.View
            key={`${i}-${ch}`}
            style={
              roll
                ? {
                    animationName: { from: { opacity: 0.2, transform: [{ translateY: -8 }] }, to: { opacity: 1, transform: [{ translateY: 0 }] } },
                    animationDuration: `${motion.roll}ms`,
                    animationTimingFunction: 'ease-out',
                    animationFillMode: 'forwards',
                  }
                : undefined
            }
          >
            {typeof ch === 'number' ? <Readout hero={hero} {...subRun(hero ? 40 : 28)}>{ch}</Readout> : <Readout hero={hero}>{ch}</Readout>}
          </Animated.View>
        )
      })}
    </Row>
  )
}
