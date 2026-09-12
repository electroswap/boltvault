/**
 * ScreenEnter — how a view arrives: a 150 ms ease fade onto the still Field.
 *
 * The previous screen unmounts immediately so it cannot steal presses or
 * smear through the next page. The Grid behind never moves — every screen
 * is a plate placed on that surface — so this only fades the incoming plate.
 *
 * The shell remounts this on every navigation by changing its key. Direction
 * is locked at that mount so later renders cannot restart the animation, and
 * a shared-element move passes `none` so the two do not argue about pixels.
 */
import { useState, type ReactNode } from 'react'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { motion } from '../tokens'

export type EnterDirection = 'push' | 'pop' | 'tab' | 'none'

/** CSS `ease` — the same curve a `transition: opacity 150ms ease` would use. */
const EASE = cubicBezier(0.25, 0.1, 0.25, 1)

export function ScreenEnter({
  direction,
  reducedMotion = false,
  children,
  testID,
}: {
  direction: EnterDirection
  reducedMotion?: boolean
  children: ReactNode
  testID?: string
}) {
  const [locked] = useState(direction)
  if (reducedMotion || locked === 'none') return <>{children}</>
  return (
    <Animated.View
      testID={testID}
      style={{
        flex: 1,
        overflow: 'hidden',
        animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
        animationDuration: `${motion.screen}ms`,
        animationTimingFunction: EASE,
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}
