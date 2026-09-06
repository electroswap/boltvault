/**
 * ScreenEnter — how a view arrives (style bible › motion): a push slides in
 * from the right and fades up over 180 ms, a pop returns from the left, a
 * tab change rises 6 px. The Grid behind never moves, so the screen reads
 * as a plate placed on a still surface. The direction is locked at mount:
 * the shell remounts this on every navigation by changing its key, and
 * re-renders after that never restart the animation.
 */
import { useState, type ReactNode } from 'react'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { motion } from '../tokens'

export type EnterDirection = 'push' | 'pop' | 'tab' | 'none'

const FROM: Record<Exclude<EnterDirection, 'none'>, { opacity: number; transform: Array<{ translateX: number } | { translateY: number }> }> = {
  push: { opacity: 0, transform: [{ translateX: 14 }] },
  pop: { opacity: 0, transform: [{ translateX: -14 }] },
  tab: { opacity: 0, transform: [{ translateY: 6 }] },
}

export function ScreenEnter({ direction, reducedMotion = false, children, testID }: { direction: EnterDirection; reducedMotion?: boolean; children: ReactNode; testID?: string }) {
  const [locked] = useState(direction)
  if (reducedMotion || locked === 'none') return <>{children}</>
  return (
    <Animated.View
      testID={testID}
      style={{
        flex: 1,
        animationName: { from: FROM[locked], to: { opacity: 1, transform: [{ translateX: 0 }, { translateY: 0 }] } },
        animationDuration: `${locked === 'tab' ? motion.micro : motion.screen}ms`,
        animationTimingFunction: cubicBezier(0.2, 0.8, 0.2, 1),
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}
