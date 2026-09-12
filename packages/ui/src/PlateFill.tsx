/**
 * A plate's own gradient, and the light catching its lip.
 *
 * The style bible is explicit that this is not decoration: *"Depth on this
 * brand comes from gradients and light, never from grey shadow"*, and *"every
 * glass surface is a 160–165deg fall, never a flat fill"*. It gives the exact
 * ramps, which are the ones below.
 *
 * `Plate` painted a flat `backgroundColor` for every role, so BoltVault's
 * surfaces were the one place in the product family not doing this — the swap
 * interface implements the same table in `theme/plates.ts`, which is why the
 * owner could see the difference side by side: "the input/output containers
 * have a gradient background".
 *
 * Measured, like `Rim`: a percentage on an absolutely positioned child resolves
 * against the parent's *content* box under Yoga and its padding box in CSS, so
 * a percentage-sized gradient is inset by the padding on Android and not on the
 * web. The `<Svg>` gets numeric dimensions and a real viewBox instead.
 */
import { useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { useId } from 'react'

/*
  `zIndex: -1`, and `Plate` makes its frame a stacking context to hold it.

  An absolutely positioned child paints in a later phase than its parent's
  in-flow content, so on the web this gradient went OVER anything that is not
  itself a positioned box — the QR on Receive, raw text, an <svg>. (Most of the
  product is nested react-native-web Views, which are position: relative, so
  they kept painting above it and the fault only showed on a handful of
  screens.) Negative z-index puts it back in the phase between the frame's own
  background and its children, which is where a background belongs.
*/
const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, zIndex: -1 } as const

/** The bible's plate ramps, verbatim. `sheen` is the 1px lip along the top edge. */
const RAMPS = {
  raised: {
    deg: 165,
    from: 'rgba(24,33,86,0.72)',
    mid: null,
    to: 'rgba(13,18,52,0.78)',
    sheen: 0.07,
  },
  console: {
    deg: 165,
    from: 'rgba(26,36,92,0.78)',
    mid: 'rgba(13,18,52,0.82)',
    to: 'rgba(8,11,36,0.86)',
    sheen: 0.08,
  },
  well: { deg: 160, from: 'rgba(20,28,74,0.72)', mid: null, to: 'rgba(6,9,30,0.86)', sheen: 0.06 },
  recessed: {
    deg: 160,
    from: 'rgba(18,25,68,0.6)',
    mid: null,
    to: 'rgba(10,14,42,0.7)',
    sheen: 0.06,
  },
  card: {
    deg: 160,
    from: 'rgba(18,25,68,0.55)',
    mid: null,
    to: 'rgba(10,14,42,0.66)',
    sheen: 0.06,
  },
  tile: {
    deg: 165,
    from: 'rgba(24,33,86,0.72)',
    mid: null,
    to: 'rgba(13,18,52,0.78)',
    sheen: 0.07,
  },
} as const

export type PlateFillRole = keyof typeof RAMPS

/** A CSS-style angle as the SVG unit vector `x1,y1 → x2,y2`. */
function vector(deg: number): { x1: number; y1: number; x2: number; y2: number } {
  const r = ((deg - 90) * Math.PI) / 180
  const dx = Math.cos(r)
  const dy = Math.sin(r)
  return { x1: 0.5 - dx / 2, y1: 0.5 - dy / 2, x2: 0.5 + dx / 2, y2: 0.5 + dy / 2 }
}

export function PlateFill({ role, radius }: { role: PlateFillRole; radius: number }) {
  const ramp = RAMPS[role]
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const [box, setBox] = useState<{ width: number; height: number } | null>(null)
  const onLayout = (e: LayoutChangeEvent): void => {
    const { width, height } = e.nativeEvent.layout
    setBox((prev) =>
      prev !== null && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5
        ? prev
        : { width, height },
    )
  }
  const v = vector(ramp.deg)
  return (
    <View style={FILL} pointerEvents="none" onLayout={onLayout} aria-hidden>
      {box === null ? null : (
        <Svg
          width={box.width}
          height={box.height}
          viewBox={`0 0 ${box.width} ${box.height}`}
          pointerEvents="none"
        >
          <Defs>
            <LinearGradient id={`pf-${id}`} x1={v.x1} y1={v.y1} x2={v.x2} y2={v.y2}>
              {[
                <Stop key="from" offset="0" stopColor={ramp.from} />,
                ...(ramp.mid === null
                  ? []
                  : [<Stop key="mid" offset="0.55" stopColor={ramp.mid} />]),
                <Stop key="to" offset="1" stopColor={ramp.to} />,
              ]}
            </LinearGradient>
          </Defs>
          <Rect
            x={0}
            y={0}
            width={box.width}
            height={box.height}
            rx={radius}
            ry={radius}
            fill={`url(#pf-${id})`}
          />
          {/* The lip: one pixel of white along the top, inside the radius. */}
          <Rect
            x={radius * 0.6}
            y={0}
            width={Math.max(0, box.width - radius * 1.2)}
            height={1}
            fill="#FFFFFF"
            fillOpacity={ramp.sheen}
          />
        </Svg>
      )}
    </View>
  )
}
