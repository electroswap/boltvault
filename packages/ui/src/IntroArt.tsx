/**
 * The onboarding slides' artwork (§8.1).
 *
 * Drawn, not shipped. The alternative was rendering three illustrations and
 * bundling them, which costs a download per slide, cannot be tinted, and needs
 * two copies kept in step — `apps/extension/public/` and `apps/mobile/assets/`,
 * the arrangement `tokens/` uses and has already drifted in. Geometry computed
 * from a handful of numbers costs about a kilobyte, reads the palette from
 * `tokens.ts`, and is the same drawing on both bodies.
 *
 * It is also the language the product already speaks: `Signature` seeds an
 * avatar from an address, `Coil` draws a farm's position as two rings, `Cable`
 * animates a bridge as travelling light. The style bible refuses mascots in
 * three separate places and names "navy + violet + a friendly mascot" as the
 * template look to avoid, so the vocabulary here is arcs, nodes and glass.
 *
 * Both scenes are lit as the bible describes: cyan is the near light, violet is
 * the far one and only ever appears as a falloff, and nothing is a flat fill.
 */
import Svg, { Circle, Defs, G, Path, RadialGradient, LinearGradient, Stop } from 'react-native-svg'
import { light, paint } from './tokens'

export interface IntroArtProps {
  /** 1: the sealed core. 2: the network. */
  readonly slide: 1 | 2
  readonly size: number
  readonly testID?: string
}

/** A gentle catenary between two points — light hangs, it does not travel in straight lines. */
function sag(x1: number, y1: number, x2: number, y2: number, drop: number): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2 + drop
  return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`
}

export function IntroArt({ slide, size, testID }: IntroArtProps) {
  const s = size
  const c = s / 2
  return (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} testID={testID} accessibilityRole="image">
      <Defs>
        <RadialGradient id={`ia-bloom-${slide}`} cx="50%" cy="45%" r="60%">
          <Stop offset="0" stopColor={light.arc} stopOpacity={0.22} />
          <Stop offset="0.55" stopColor={light.plasma} stopOpacity={0.1} />
          <Stop offset="1" stopColor={paint.void} stopOpacity={0} />
        </RadialGradient>
        <LinearGradient id={`ia-face-${slide}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={light.arc} stopOpacity={0.55} />
          <Stop offset="1" stopColor={light.plasma} stopOpacity={0.28} />
        </LinearGradient>
        <LinearGradient id={`ia-edge-${slide}`} x1="0" y1="0" x2="1" y2="1">
          <Stop offset="0" stopColor={light.core} stopOpacity={0.95} />
          <Stop offset="1" stopColor={light.plasma} stopOpacity={0.5} />
        </LinearGradient>
      </Defs>

      {/* The bloom the whole scene sits in, so nothing reads as pasted onto the Field. */}
      <Circle cx={c} cy={s * 0.45} r={s * 0.46} fill={`url(#ia-bloom-${slide})`} />

      {slide === 1 ? (
        <G>
          {/*
            A sealed core: one faceted form, lit from inside, with nothing
            entering or leaving it. Three broken orbits, drawn as an instrument
            would draw them rather than as decoration — no padlock, no keyhole.
          */}
          {[0.42, 0.34, 0.27].map((r, i) => (
            <Circle
              key={r}
              cx={c}
              cy={s * 0.45}
              r={s * r}
              fill="none"
              stroke={i === 0 ? light.plasma : light.arc}
              strokeOpacity={0.18 + i * 0.1}
              strokeWidth={1.1}
              strokeDasharray={`${s * (0.5 - i * 0.12)} ${s * 0.34}`}
              strokeLinecap="round"
              transform={`rotate(${-28 + i * 47} ${c} ${s * 0.45})`}
            />
          ))}
          {/* The octahedron: two lit faces and a darker one, so it reads as solid. */}
          <Path d={`M${c} ${s * 0.2} L${c + s * 0.17} ${s * 0.45} L${c} ${s * 0.7} L${c - s * 0.17} ${s * 0.45} Z`} fill={`url(#ia-face-${slide})`} />
          <Path d={`M${c} ${s * 0.2} L${c + s * 0.17} ${s * 0.45} L${c} ${s * 0.7} Z`} fill={paint.void} fillOpacity={0.32} />
          <Path
            d={`M${c} ${s * 0.2} L${c + s * 0.17} ${s * 0.45} L${c} ${s * 0.7} L${c - s * 0.17} ${s * 0.45} Z M${c} ${s * 0.2} L${c} ${s * 0.7}`}
            fill="none"
            stroke={`url(#ia-edge-${slide})`}
            strokeWidth={1.3}
            strokeLinejoin="round"
          />
          {/* The light inside it. */}
          <Circle cx={c} cy={s * 0.45} r={s * 0.045} fill={light.core} fillOpacity={0.9} />
          <Circle cx={c} cy={s * 0.45} r={s * 0.1} fill={light.arc} fillOpacity={0.22} />
        </G>
      ) : (
        <G>
          {/*
            Ten places, one network. The anchor sits forward and brightest; the
            rest cool toward violet with distance, and the arcs pass over and
            under one another so it has depth rather than being a diagram.
          */}
          {(
            [
              [0.5, 0.44, 0.062, 1],
              [0.24, 0.3, 0.032, 0.72],
              [0.76, 0.28, 0.03, 0.66],
              [0.17, 0.58, 0.028, 0.6],
              [0.83, 0.56, 0.027, 0.56],
              [0.36, 0.7, 0.026, 0.52],
              [0.64, 0.72, 0.025, 0.48],
              [0.32, 0.16, 0.021, 0.4],
              [0.68, 0.15, 0.02, 0.36],
              [0.5, 0.82, 0.022, 0.44],
            ] as Array<[number, number, number, number]>
          ).map(([x, y, r, near], i) => {
            const cx = s * x
            const cy = s * y
            const glow = i === 0 ? light.core : light.arc
            return (
              <G key={`${x}-${y}`}>
                {i > 0 ? (
                  <Path d={sag(s * 0.5, s * 0.44, cx, cy, s * (0.05 + (i % 3) * 0.02))} fill="none" stroke={light.plasma} strokeOpacity={0.1 + near * 0.14} strokeWidth={s * 0.018} strokeLinecap="round" />
                ) : null}
                {i > 0 ? (
                  <Path d={sag(s * 0.5, s * 0.44, cx, cy, s * (0.05 + (i % 3) * 0.02))} fill="none" stroke={light.arc} strokeOpacity={0.25 + near * 0.5} strokeWidth={1.1} strokeLinecap="round" />
                ) : null}
                {/* The glass disc each node stands on. */}
                <Circle cx={cx} cy={cy} r={s * r * 2.1} fill={light.plasma} fillOpacity={0.06 + near * 0.06} />
                <Circle cx={cx} cy={cy} r={s * r} fill={glow} fillOpacity={0.35 + near * 0.55} />
                <Circle cx={cx} cy={cy} r={s * r} fill="none" stroke={light.core} strokeOpacity={near * 0.6} strokeWidth={0.9} />
              </G>
            )
          })}
        </G>
      )}
    </Svg>
  )
}
