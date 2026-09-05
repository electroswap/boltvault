/**
 * Light on an edge (style bible › materials). `Rim` strokes a plate's outline
 * with the current — cyan at one corner fading to violet at the other — and
 * `CurrentFill` paints a surface with it (the primary key, the filament, the
 * share bars, the tab bar's hairline). Both are SVG so the same component
 * renders on the phone and in the extension; both size themselves to their
 * parent, so nothing measures.
 */
import { useId } from 'react'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { current, rim } from './tokens'

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const

/** A gradient id that is unique per instance and safe inside `url(#…)`. */
function useGradientId(prefix: string): string {
  return `${prefix}${useId().replace(/[^a-zA-Z0-9]/g, '')}`
}

export interface RimProps {
  readonly radius: number
  /** 0..1 — consoles 0.7, raised plates 0.45, secondary keys 0.35. */
  readonly opacity?: number
  readonly strokeWidth?: number
  /** Only the top edge (a sheet rising from the bottom). */
  readonly topOnly?: boolean
}

export function Rim({ radius, opacity = 0.5, strokeWidth = 1, topOnly = false }: RimProps) {
  const id = useGradientId('rim')
  const inset = strokeWidth / 2
  return (
    <Svg width="100%" height="100%" style={FILL} pointerEvents="none" aria-hidden>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={rim.from} stopOpacity={opacity} />
          <Stop offset="1" stopColor={rim.to} stopOpacity={opacity} />
        </LinearGradient>
      </Defs>
      {topOnly ? (
        <Rect x={0} y={0} width="100%" height={strokeWidth} fill={`url(#${id})`} />
      ) : (
        <Rect x={inset} y={inset} width="100%" height="100%" rx={Math.max(0, radius - inset)} ry={Math.max(0, radius - inset)} fill="none" stroke={`url(#${id})`} strokeWidth={strokeWidth} />
      )}
    </Svg>
  )
}

export interface CurrentFillProps {
  readonly radius?: number
  readonly opacity?: number
  /** Left→right (default) or top→bottom. */
  readonly vertical?: boolean
}

export function CurrentFill({ radius = 0, opacity = 1, vertical = false }: CurrentFillProps) {
  const id = useGradientId('cur')
  return (
    <Svg width="100%" height="100%" style={FILL} pointerEvents="none" aria-hidden>
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
          <Stop offset="0" stopColor={current.from} stopOpacity={opacity} />
          <Stop offset="1" stopColor={current.to} stopOpacity={opacity} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width="100%" height="100%" rx={radius} ry={radius} fill={`url(#${id})`} />
    </Svg>
  )
}
