/**
 * The BoltVault mark: a bolt in the current, lit like a neon tube.
 *
 * The same polygon `tools/make-icons.mjs` rasterises for the app icon, so the
 * icon on the home screen, the still Android paints while React starts, and
 * the mark on the splash are visibly one thing rather than three drawings that
 * resemble each other. Geometry, not a file — it themes, it scales, and there
 * is nothing to keep in sync.
 *
 * ## The light follows the shape, and it has to do it on both bodies
 *
 * Three spellings of this glow have been tried, and only the third renders
 * everywhere:
 *
 * 1. **A radial disc behind the bolt.** Most of its light lands where the mark
 *    is not, so it read as a violet haze with a small pale bolt sitting in it —
 *    the owner's "not dopamine producing".
 * 2. **Stacked translucent strokes of the path.** Four read as four bands (a
 *    sticker with three borders) and eighteen read as eighteen, because at
 *    these widths a stroked polygon stops being the polygon and becomes a
 *    rounded blob.
 * 3. **`FeGaussianBlur` on copies of the path.** Beautiful on the web — and on
 *    Android it silently did nothing at all, so the phone showed a flat
 *    gradient bolt with no light on it standing where the native splash's
 *    glowing one had been a frame earlier. react-native-svg exports the filter
 *    elements; they do not survive the trip.
 *
 * So: discs of radial gradient laid along the bolt's own spine. A radial
 * gradient is the one soft primitive both bodies certainly draw — `Field`,
 * `Signature` and `Artwork` all lean on it — and enough of them, following the
 * medial axis, hug the silhouette the way a blur would. The raster computes the
 * same falloff from a distance field (`glowAt` in tools/make-icons.mjs), which
 * is what makes the still Android paints and the mark that replaces it read as
 * one object waking up rather than two drawings swapping places.
 */
import Svg, { Circle, Defs, LinearGradient, Path, RadialGradient, Stop } from 'react-native-svg'
import { useId } from 'react'
import { current, light } from './tokens'

/** The unit-square bolt, shared with the icon generator. */
const BOLT = 'M0.58 0.06 L0.24 0.56 L0.47 0.56 L0.40 0.94 L0.76 0.42 L0.53 0.42 Z'

/** The same polygon as points, so the light can be derived from it. */
const POINTS: ReadonlyArray<readonly [number, number]> = [
  [0.58, 0.06],
  [0.24, 0.56],
  [0.47, 0.56],
  [0.4, 0.94],
  [0.76, 0.42],
  [0.53, 0.42],
]

/**
 * Points spaced evenly around the outline.
 *
 * The light goes ON the edge, not behind the middle. A disc centred on the
 * bolt's spine puts its brightest part where the crisp mark covers it, which
 * is why the spine version came back as a dull violet cloud with two bright
 * tips: almost all of it was hidden. Centred on the silhouette, half of each
 * disc falls outside the shape — and that half is the rim a neon tube throws.
 */
function outline(count: number): Array<readonly [number, number]> {
  const segs = POINTS.map((p, i) => {
    const q = POINTS[(i + 1) % POINTS.length] as readonly [number, number]
    return { p, q, len: Math.hypot(q[0] - p[0], q[1] - p[1]) }
  })
  const total = segs.reduce((a, s) => a + s.len, 0)
  const out: Array<readonly [number, number]> = []
  for (let i = 0; i < count; i++) {
    let d = (i / count) * total
    for (const seg of segs) {
      if (d > seg.len) {
        d -= seg.len
        continue
      }
      const t = seg.len === 0 ? 0 : d / seg.len
      out.push([
        seg.p[0] + (seg.q[0] - seg.p[0]) * t,
        seg.p[1] + (seg.q[1] - seg.p[1]) * t,
      ] as const)
      break
    }
  }
  return out
}

const RIM = outline(56)
/** How far the near light reaches from the edge it sits on. */
const RIM_R = 0.125

/** The far light: three wide, faint violet falls, so the mark sits in air rather than on a plate. */
const AURA: ReadonlyArray<readonly [number, number, number]> = [
  [0.5, 0.28, 0.5],
  [0.5, 0.5, 0.58],
  [0.5, 0.72, 0.5],
]

export interface BoltMarkProps {
  readonly size: number
  /** The light around it. 0 is the bare mark; above 1 is a flare. */
  readonly glow?: number
  readonly testID?: string
}

export function BoltMark({ size, glow = 1, testID }: BoltMarkProps) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, '')
  const near = `bm-n-${id}`
  const far = `bm-f-${id}`
  return (
    /*
      The viewBox is bigger than the mark on purpose: at `0 0 1 1` the aura was
      clipped square at all four edges, which is exactly what light does not do.
    */
    <Svg
      width={size}
      height={size}
      viewBox="-0.4 -0.4 1.8 1.8"
      testID={testID}
      accessibilityRole="image"
    >
      <Defs>
        {/*
          The current runs corner to corner of the BOLT, not of the frame. Over
          the frame, the bolt occupies the middle band of the ramp and comes out
          one flat periwinkle; over its own box it spends the whole ramp on the
          thing you can see — cyan at the strike, violet at the tail.
        */}
        <LinearGradient
          id={`bm-g-${id}`}
          x1="0.24"
          y1="0.06"
          x2="0.76"
          y2="0.94"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={current.from} />
          <Stop offset="1" stopColor={current.to} />
        </LinearGradient>
        {/*
          Faint per disc: fifty-six of them overlap along the edge, and what the
          eye reads is the accumulation. At full strength each one they would
          stack into a hard white outline.
        */}
        <RadialGradient id={near} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={light.core} stopOpacity={Math.min(1, 0.28 * glow)} />
          <Stop offset="0.3" stopColor={light.arc} stopOpacity={Math.min(1, 0.22 * glow)} />
          <Stop offset="0.65" stopColor={light.arc} stopOpacity={Math.min(1, 0.08 * glow)} />
          <Stop offset="1" stopColor={light.arc} stopOpacity={0} />
        </RadialGradient>
        <RadialGradient id={far} cx="50%" cy="50%" r="50%">
          <Stop offset="0" stopColor={light.plasma} stopOpacity={Math.min(1, 0.2 * glow)} />
          <Stop offset="0.55" stopColor={light.plasma} stopOpacity={Math.min(1, 0.08 * glow)} />
          <Stop offset="1" stopColor={light.plasma} stopOpacity={0} />
        </RadialGradient>
      </Defs>
      {glow > 0
        ? AURA.map(([x, y, r]) => (
            <Circle key={`a${x}-${y}`} cx={x} cy={y} r={r} fill={`url(#${far})`} />
          ))
        : null}
      {glow > 0
        ? RIM.map(([x, y], i) => (
            <Circle key={`r${i}`} cx={x} cy={y} r={RIM_R} fill={`url(#${near})`} />
          ))
        : null}
      <Path d={BOLT} fill={`url(#bm-g-${id})`} />
    </Svg>
  )
}
