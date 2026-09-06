/**
 * Charge — the electric moment of a press (style bible › motion): a soft
 * highlight sweeps once across a primary key, left to right, in 260 ms,
 * like current finding its way through. Mount one per press (key it on a
 * press counter); it runs once and stays invisible.
 */
import Animated, { cubicBezier } from 'react-native-reanimated'
import { motion } from '../tokens'

export function Charge({ width, radius = 0 }: { width: number; radius?: number }) {
  const band = Math.max(48, Math.round(width * 0.35))
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: 0,
        width: band,
        borderRadius: radius,
        backgroundColor: 'rgba(255, 255, 255, 0.22)',
        animationName: {
          from: { opacity: 0, transform: [{ translateX: -band }, { skewX: '-12deg' }] },
          '35%': { opacity: 1 },
          to: { opacity: 0, transform: [{ translateX: width + band }, { skewX: '-12deg' }] },
        },
        animationDuration: `${motion.charge}ms`,
        animationTimingFunction: cubicBezier(0.3, 0.7, 0.3, 1),
        animationFillMode: 'forwards',
      }}
    />
  )
}
