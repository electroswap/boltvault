/**
 * The BoltVault mark: a bolt in the current, lit from behind.
 *
 * The same polygon `tools/make-icons.mjs` rasterises for the app icon, so the
 * icon on the home screen and the mark on the splash are visibly one thing
 * rather than two drawings that resemble each other. Geometry, not a file —
 * it themes, it scales, and there is nothing to keep in sync.
 */
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg'
import { useId } from 'react'
import { current, light } from './tokens'

/** The unit-square bolt, shared with the icon generator. */
const BOLT = 'M0.58 0.06 L0.24 0.56 L0.47 0.56 L0.40 0.94 L0.76 0.42 L0.53 0.42 Z'

export interface BoltMarkProps {
  readonly size: number
  /** The bloom behind it. 0 is the bare mark. */
  readonly glow?: number
  readonly testID?: string
}

export function BoltMark({ size, glow = 1, testID }: BoltMarkProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  return (
    /*
      The viewBox is bigger than the mark on purpose. At `0 0 1 1` the bloom was
      a circle inscribed in the frame, so it was clipped flat at all four edges
      and read as a disc behind the bolt rather than light coming off it.
    */
    <Svg width={size} height={size} viewBox="-0.4 -0.4 1.8 1.8" testID={testID} accessibilityRole="image">
      <Defs>
        <LinearGradient id={`bm-g-${id}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={current.from} />
          <Stop offset="1" stopColor={current.to} />
        </LinearGradient>
        <RadialGradient id={`bm-b-${id}`} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={light.core} stopOpacity={0.5 * glow} />
          <Stop offset="0.22" stopColor={light.arc} stopOpacity={0.62 * glow} />
          <Stop offset="0.55" stopColor={light.plasma} stopOpacity={0.28 * glow} />
          <Stop offset="1" stopColor={light.plasma} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {glow > 0 ? <Circle cx={0.5} cy={0.5} r={0.9} fill={`url(#bm-b-${id})`} /> : null}
      <Path d={BOLT} fill={`url(#bm-g-${id})`} />
      {/* The specular lip the bible puts on every lit surface. */}
      <Path d={BOLT} fill="none" stroke={light.core} strokeOpacity={0.5 * glow} strokeWidth={0.008} strokeLinejoin="round" />
    </Svg>
  )
}
