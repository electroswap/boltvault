/**
 * Discharge — a 250 ms arc crossing the field on a successful sign/confirm,
 * or a burn flicker at the plate edge on reject (master plan §7.6). Rendered
 * as an SVG stroke that draws itself; the Field brightening is a uniform the
 * scene reads from the same `pulse` prop.
 */
import { useEffect, useState } from 'react'
import Animated from 'react-native-reanimated'
import Svg, { Path } from 'react-native-svg'
import { light, motion, paint } from '../tokens'

export interface DischargeProps {
  /** Increment to fire one discharge. */
  readonly fire: number
  readonly kind?: 'confirm' | 'reject'
  readonly width: number
  readonly height: number
  readonly reducedMotion?: boolean
  readonly testID?: string
}

function boltPath(w: number, h: number, seed: number): string {
  // A jagged path from the bottom-left key area to the top-right readout area.
  const pts: Array<[number, number]> = []
  const n = 7
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = w * (0.12 + 0.76 * t)
    const jitter =
      i === 0 || i === n ? 0 : (((seed * 9301 + i * 49297) % 233280) / 233280 - 0.5) * h * 0.18
    const y = h * (0.85 - 0.7 * t) + jitter
    pts.push([x, y])
  }
  return pts.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ')
}

export function Discharge({
  fire,
  kind = 'confirm',
  width,
  height,
  reducedMotion = false,
  testID,
}: DischargeProps) {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    if (fire <= 0) return
    setVisible(true)
    const t = setTimeout(() => setVisible(false), reducedMotion ? 120 : motion.discharge + 200)
    return () => clearTimeout(t)
  }, [fire, reducedMotion])
  if (!visible) return null
  const color = kind === 'confirm' ? light.core : paint.burn
  const halo = kind === 'confirm' ? light.arc : paint.burn
  return (
    <Animated.View
      pointerEvents="none"
      testID={testID}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width,
        height,
        animationName: reducedMotion
          ? { from: { opacity: 0.6 }, to: { opacity: 0 } }
          : { '0%': { opacity: 0 }, '20%': { opacity: 1 }, '100%': { opacity: 0 } },
        animationDuration: `${reducedMotion ? 120 : motion.discharge + 200}ms`,
        animationFillMode: 'forwards',
      }}
    >
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        {kind === 'confirm' ? (
          <>
            <Path
              d={boltPath(width, height, fire)}
              stroke={halo}
              strokeWidth={6}
              strokeOpacity={0.25}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
            <Path
              d={boltPath(width, height, fire)}
              stroke={color}
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              fill="none"
            />
          </>
        ) : (
          <Path d={`M0 ${height - 1} H${width}`} stroke={color} strokeWidth={2} />
        )}
      </Svg>
    </Animated.View>
  )
}
