/**
 * Light on an edge (style bible › materials). `Rim` strokes a plate's outline
 * with the current — cyan at one corner fading to violet at the other — and
 * `CurrentFill` paints a surface with it (the primary key, the filament, the
 * share bars, the tab bar's hairline).
 *
 * BOTH MEASURE NOW. This file used to size the `<Svg>` with `width="100%"
 * height="100%"` and claimed "both size themselves to their parent, so nothing
 * measures." That is true in CSS and false under Yoga, and the extension never
 * caught it because it aliases react-native to react-native-web.
 *
 * React Native enables `YGErrataAll`, so a percentage on an absolutely
 * positioned child resolves against the parent's *content* box — the frame
 * minus its horizontal padding — and is then left-anchored; CSS resolves the
 * same percentage against the padding box. Every rim and gradient on Android
 * was therefore `2 × paddingHorizontal` too narrow and pinned to the left. On a
 * 78 px "Buy" key with $6 padding that leaves a 30 px fill whose rx clamps to
 * half its width: the squashed ellipse with the label hanging off it that the
 * owner photographed. Plates, icon buttons and action tiles had it too.
 *
 * A plain absolute `View` with left/top/right/bottom: 0 and *no* explicit width
 * stretches correctly on both platforms. We measure that and hand the `<Svg>`
 * numeric dimensions and a real viewBox — the same shape as `motion/Charge`,
 * which takes a measured width from `Key` and has always been right.
 */
import { useId, useState } from 'react'
import { View, type LayoutChangeEvent } from 'react-native'
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg'
import { current, rim } from './tokens'

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 } as const
/*
  A pixel of bleed, for a fill that has to cover its frame completely.

  `KeyFrame` paints `current.from` underneath as the one-frame fallback before
  this gradient has measured itself. Android rounds view frames to physical
  pixels, and the rounded SVG canvas can come up a pixel short of the frame it
  sits in — so that cyan fallback showed as a hard vertical line down the right
  edge of every primary key. The owner photographed it on "Create vault".

  The frame clips (`overflow: hidden`), so a pixel over is free; a pixel under
  is a bug you can see from across the room.
*/
const BLEED = { position: 'absolute', left: -1, top: -1, right: -1, bottom: -1 } as const

interface Box {
  readonly width: number
  readonly height: number
}

/**
 * Measures the stretched layer the gradient paints into. Sub-pixel deltas are
 * ignored so a re-layout of the same size cannot loop.
 */
function useBox(): readonly [Box | null, (event: LayoutChangeEvent) => void] {
  const [box, setBox] = useState<Box | null>(null)
  const onLayout = (event: LayoutChangeEvent): void => {
    const { width, height } = event.nativeEvent.layout
    setBox((prev) => (prev !== null && Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5 ? prev : { width, height }))
  }
  return [box, onLayout] as const
}

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
  const [box, onLayout] = useBox()
  // A stroke straddles its path, so the rect sits half a stroke in on every
  // side and spans a whole stroke less. The old code inset the origin but still
  // spanned a full 100%, pushing the right and bottom edges outside the canvas
  // — the left and top drew, the other two were clipped.
  const inset = strokeWidth / 2
  return (
    <View style={FILL} pointerEvents="none" onLayout={onLayout} aria-hidden>
      {box === null ? null : (
        <Svg width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`} pointerEvents="none">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
              <Stop offset="0" stopColor={rim.from} stopOpacity={opacity} />
              <Stop offset="1" stopColor={rim.to} stopOpacity={opacity} />
            </LinearGradient>
          </Defs>
          {topOnly ? (
            <Rect x={0} y={0} width={box.width} height={strokeWidth} fill={`url(#${id})`} />
          ) : (
            <Rect
              x={inset}
              y={inset}
              width={Math.max(0, box.width - strokeWidth)}
              height={Math.max(0, box.height - strokeWidth)}
              rx={Math.max(0, radius - inset)}
              ry={Math.max(0, radius - inset)}
              fill="none"
              stroke={`url(#${id})`}
              strokeWidth={strokeWidth}
            />
          )}
        </Svg>
      )}
    </View>
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
  const [box, onLayout] = useBox()
  return (
    <View style={BLEED} pointerEvents="none" onLayout={onLayout} aria-hidden>
      {box === null ? null : (
        <Svg width={box.width} height={box.height} viewBox={`0 0 ${box.width} ${box.height}`} pointerEvents="none">
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2={vertical ? '0' : '1'} y2={vertical ? '1' : '0'}>
              <Stop offset="0" stopColor={current.from} stopOpacity={opacity} />
              <Stop offset="1" stopColor={current.to} stopOpacity={opacity} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={box.width} height={box.height} rx={radius + 1} ry={radius + 1} fill={`url(#${id})`} />
        </Svg>
      )}
    </View>
  )
}
