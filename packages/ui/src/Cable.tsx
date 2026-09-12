/**
 * The Cable (master plan §7.6): a bridge in flight is a pulse travelling a
 * cable between two chain plates and landing on delivery. Idle it is a dim
 * line; delivered it is lit end to end; failed it burns at the origin end.
 * Reduced motion holds the pulse at its last position.
 */
import { useEffect, useState } from 'react'
import Svg, { Circle, Defs, Line, LinearGradient, Stop } from 'react-native-svg'
import { Column } from './primitives'
import { light, paint } from './tokens'

export interface CableProps {
  readonly state: 'idle' | 'pending' | 'dispatched' | 'delivered' | 'failed' | 'timeout'
  readonly width?: number
  readonly height?: number
  readonly reducedMotion?: boolean
  readonly testID?: string
}

const PERIOD_MS = 2_400

export function Cable({
  state,
  width = 120,
  height = 24,
  reducedMotion = false,
  testID,
}: CableProps) {
  const [phase, setPhase] = useState(0)
  const moving = (state === 'pending' || state === 'dispatched') && !reducedMotion
  useEffect(() => {
    if (!moving) return
    const started = Date.now()
    const timer = setInterval(() => setPhase(((Date.now() - started) % PERIOD_MS) / PERIOD_MS), 40)
    return () => clearInterval(timer)
  }, [moving])
  const y = height / 2
  const x0 = 6
  const x1 = width - 6
  const lit =
    state === 'delivered'
      ? 1
      : state === 'dispatched'
        ? 0.55
        : state === 'pending'
          ? 0.25
          : state === 'failed' || state === 'timeout'
            ? 0.15
            : 0.12
  const pulseX =
    state === 'delivered'
      ? x1
      : state === 'pending'
        ? x0 + (x1 - x0) * 0.35 * phase
        : x0 + (x1 - x0) * phase
  const showPulse = state === 'pending' || state === 'dispatched' || state === 'delivered'
  return (
    <Column alignItems="center" justifyContent="center" testID={testID}>
      <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
        <Defs>
          <LinearGradient id="cableLit" x1="0" y1="0" x2="1" y2="0">
            <Stop offset="0%" stopColor={light.core} stopOpacity={lit} />
            <Stop offset="100%" stopColor={light.plasma} stopOpacity={lit} />
          </LinearGradient>
        </Defs>
        <Line
          x1={x0}
          y1={y}
          x2={x1}
          y2={y}
          stroke={paint.mute}
          strokeOpacity={0.35}
          strokeWidth={2}
          strokeLinecap="round"
        />
        <Line
          x1={x0}
          y1={y}
          x2={state === 'failed' || state === 'timeout' ? x0 + 14 : x1}
          y2={y}
          stroke={state === 'failed' || state === 'timeout' ? paint.burn : 'url(#cableLit)'}
          strokeWidth={2}
          strokeLinecap="round"
        />
        {showPulse ? <Circle cx={pulseX} cy={y} r={4} fill={light.core} opacity={0.95} /> : null}
        {showPulse ? <Circle cx={pulseX} cy={y} r={8} fill={light.plasma} opacity={0.35} /> : null}
      </Svg>
    </Column>
  )
}
