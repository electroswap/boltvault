/**
 * RollingReadout — Oxanium numerals that roll only when a digit changes
 * (master plan §7.4/§7.7). Each character animates independently; unchanged
 * characters stay still, so a static total is never a slot machine.
 * `aria-live` is polite and the whole value is announced, throttled by the
 * caller.
 */
import { useEffect, useRef } from 'react'
import Animated from 'react-native-reanimated'
import { Readout, Row } from './primitives'
import { motion } from './tokens'

export interface RollingReadoutProps {
  readonly value: string
  readonly hero?: boolean
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function RollingReadout({
  value,
  hero = false,
  reducedMotion = false,
  testID,
}: RollingReadoutProps) {
  const prev = useRef<string>(value)
  const changed = new Set<number>()
  if (prev.current !== value) {
    const a = prev.current
    for (let i = 0; i < value.length; i++) if (a[i] !== value[i]) changed.add(i)
  }
  useEffect(() => {
    prev.current = value
  }, [value])

  return (
    <Row accessibilityLiveRegion="polite" accessibilityLabel={value} testID={testID}>
      {Array.from(value).map((ch, i) => {
        const roll = changed.has(i) && !reducedMotion
        return (
          <Animated.View
            key={`${i}-${ch}`}
            style={
              roll
                ? {
                    animationName: {
                      from: { opacity: 0.2, transform: [{ translateY: -8 }] },
                      to: { opacity: 1, transform: [{ translateY: 0 }] },
                    },
                    animationDuration: `${motion.roll}ms`,
                    animationTimingFunction: 'ease-out',
                    animationFillMode: 'forwards',
                  }
                : undefined
            }
          >
            <Readout hero={hero}>{ch}</Readout>
          </Animated.View>
        )
      })}
    </Row>
  )
}
