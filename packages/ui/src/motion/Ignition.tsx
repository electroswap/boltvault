/**
 * Ignition — the one orchestrated enter (master plan §7.7): on unlock the
 * Field fades in, the filament draws, the readout settles from soft to sharp.
 * 400 ms total. Children mount immediately; this only choreographs opacity
 * and a settle, so nothing is hidden from assistive tech.
 */
import type { ReactNode } from 'react'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { motion } from '../tokens'

export interface IgnitionProps {
  readonly children: ReactNode
  readonly reducedMotion?: boolean
  /** Stagger index: 0 for the Field, 1 filament, 2 readout, 3 plates. */
  readonly order?: number
  /**
   * Whether this really is an ignition. False paints the children at once —
   * the ordinary case, because a screen you have already seen should not
   * re-run the unlock ceremony every time you navigate back to it.
   */
  readonly active?: boolean
  readonly testID?: string
}

export function Ignition({
  children,
  reducedMotion = false,
  order = 0,
  active = true,
  testID,
}: IgnitionProps) {
  if (reducedMotion || !active) return <>{children}</>
  const delay = order * 70
  return (
    <Animated.View
      testID={testID}
      style={{
        animationName: {
          from: { opacity: 0, transform: [{ scale: 0.985 }, { translateY: 4 }] },
          to: { opacity: 1, transform: [{ scale: 1 }, { translateY: 0 }] },
        },
        animationDuration: `${motion.ignition - delay}ms`,
        animationDelay: `${delay}ms`,
        animationTimingFunction: cubicBezier(0.2, 0.8, 0.2, 1),
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}
