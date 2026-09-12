/**
 * Signature — the seat avatar: three arcs whose geometry comes from the
 * account's Field seed, so an account is recognisable by its light. This is
 * the SVG stand-in for the 40 px crop of the live Field (§7.6); the Field
 * component replaces it where the scene is running.
 */
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg'
import { fieldSeed } from './hash'
import { light, paint, rim } from './tokens'

export interface SignatureProps {
  readonly address: string
  readonly size?: number
  readonly ring?: boolean
  readonly testID?: string
}

function arc(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number): [number, number] => [cx + r * Math.cos(a), cy + r * Math.sin(a)]
  const [x0, y0] = p(a0)
  const [x1, y1] = p(a1)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 ${large} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`
}

export function Signature({ address, size = 40, ring = true, testID }: SignatureProps) {
  const [s0, s1, s2, s3] = fieldSeed(address)
  const c = size / 2
  const id = `sig-${address.slice(2, 10).toLowerCase()}`
  const arcs = [
    {
      r: size * (0.2 + s0 * 0.12),
      a0: s1 * Math.PI * 2,
      span: 0.9 + s2 * 1.4,
      color: light.core,
      w: 1.6,
    },
    {
      r: size * (0.3 + s1 * 0.1),
      a0: s2 * Math.PI * 2,
      span: 1.2 + s3 * 1.8,
      color: light.arc,
      w: 1.3,
    },
    {
      r: size * (0.38 + s2 * 0.06),
      a0: s3 * Math.PI * 2,
      span: 0.6 + s0 * 1.2,
      color: light.plasma,
      w: 1.1,
    },
  ]
  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} testID={testID}>
      <Defs>
        <RadialGradient id={id} cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={light.arc} stopOpacity={0.35 + s3 * 0.2} />
          <Stop offset="70%" stopColor={light.plasma} stopOpacity={0.12} />
          <Stop offset="100%" stopColor={paint.void} stopOpacity={1} />
        </RadialGradient>
        <LinearGradient id={`${id}-ring`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={rim.from} stopOpacity={0.9} />
          <Stop offset="1" stopColor={rim.to} stopOpacity={0.9} />
        </LinearGradient>
      </Defs>
      <Circle cx={c} cy={c} r={c} fill={`url(#${id})`} />
      {arcs.map((a, i) => (
        <Path
          key={i}
          d={arc(c, c, a.r, a.a0, a.a0 + a.span)}
          stroke={a.color}
          strokeWidth={a.w}
          strokeLinecap="round"
          fill="none"
          opacity={0.95}
        />
      ))}
      {ring ? (
        <Circle
          cx={c}
          cy={c}
          r={c - 0.75}
          stroke={`url(#${id}-ring)`}
          strokeWidth={1.5}
          fill="none"
        />
      ) : null}
    </Svg>
  )
}
