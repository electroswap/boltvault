/**
 * Scrim — the fade that lets type sit on artwork.
 *
 * Owner: "The grey semi-transparent bar behind the collection logo and name
 * should be a gradient (transparent on top, current color on bottom), and it
 * should span the full width of the banner."
 *
 * A flat translucent band reads as a bar laid over the picture; a gradient
 * reads as the picture sinking into the page, which is what the style bible
 * means by the banner fading into the night. Bottom is `void` at full
 * strength so the name has a solid ground, top is the same colour at zero.
 */
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useId } from 'react'
import { paint } from './tokens'

export interface ScrimProps {
  readonly width: number
  readonly height: number
  /** How opaque the bottom edge is. */
  readonly strength?: number
  readonly testID?: string
}

export function Scrim({ width, height, strength = 0.92, testID }: ScrimProps) {
  // Each instance needs its own gradient id or they collide in one document.
  const id = `scrim-${useId().replace(/:/g, '')}`
  return (
    <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} testID={testID} pointerEvents="none">
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={paint.void} stopOpacity={0} />
          <Stop offset="0.55" stopColor={paint.void} stopOpacity={strength * 0.55} />
          <Stop offset="1" stopColor={paint.void} stopOpacity={strength} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  )
}
