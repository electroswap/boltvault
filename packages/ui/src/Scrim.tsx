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
  /** How opaque the solid edge is. */
  readonly strength?: number
  /**
   * Which edge is solid. `bottom` (the default) sinks artwork into the page so
   * type can sit on it; `top` does the opposite — it holds the top of a screen
   * near-plain and lets the scene emerge downward.
   *
   * That second one is the Unlock screen's look, which the owner asked for
   * everywhere the circuit runs: "I like the background gradient from dark to
   * circuit on the unlock screen." It is also what the style bible asks for on
   * its own account — "the top third of the frame carries only the aurora and
   * grain", "nothing above 40% luminance under a readout" — which the grid
   * screens were not honouring, because their Field runs at full strength from
   * the very top.
   */
  readonly edge?: 'bottom' | 'top'
  readonly testID?: string
}

export function Scrim({ width, height, strength = 0.92, edge = 'bottom', testID }: ScrimProps) {
  // Each instance needs its own gradient id or they collide in one document.
  const id = `scrim-${useId().replace(/:/g, '')}`
  const solid = edge === 'top'
  return (
    <Svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      testID={testID}
      pointerEvents="none"
    >
      <Defs>
        <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={paint.void} stopOpacity={solid ? strength : 0} />
          <Stop
            offset={solid ? 0.45 : 0.55}
            stopColor={paint.void}
            stopOpacity={strength * (solid ? 0.32 : 0.55)}
          />
          <Stop offset="1" stopColor={paint.void} stopOpacity={solid ? 0 : strength} />
        </LinearGradient>
      </Defs>
      <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
    </Svg>
  )
}
