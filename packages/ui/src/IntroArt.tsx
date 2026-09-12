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
 *
 * **They move.** Owner: "the graphics should be animated." The drawings were
 * stills, and a still on a slide the reader has to sit through reads as a
 * screenshot of an app rather than the app. Slide one's orbits turn at three
 * different rates and its core breathes; slide two runs current out along every
 * arc and pulses a ring off the anchor. Nothing loops fast enough to compete
 * with the copy — this is a scene with weather in it, not an animation to
 * watch. Under reduced motion every layer renders at rest, which is also what
 * the screenshot baselines capture.
 */
import Animated from 'react-native-reanimated'
import { View } from 'react-native'
import Svg, { Circle, Defs, G, Path, RadialGradient, LinearGradient, Stop } from 'react-native-svg'
import { light, paint } from './tokens'

export interface IntroArtProps {
  /** 1: the sealed core. 2: the network. */
  readonly slide: 1 | 2
  readonly size: number
  readonly reducedMotion?: boolean
  readonly testID?: string
}

const FILL = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' } as const

/** A gentle catenary between two points — light hangs, it does not travel in straight lines. */
function sag(x1: number, y1: number, x2: number, y2: number, drop: number): string {
  const mx = (x1 + x2) / 2
  const my = (y1 + y2) / 2 + drop
  return `M${x1} ${y1} Q${mx} ${my} ${x2} ${y2}`
}

/** The three broken orbits, each in its own layer so each can turn at its own rate. */
const ORBITS = [
  { r: 0.42, colour: light.plasma, opacity: 0.18, dash: 0.5, spin: 34_000, reverse: false },
  { r: 0.34, colour: light.arc, opacity: 0.28, dash: 0.38, spin: 22_000, reverse: true },
  { r: 0.27, colour: light.arc, opacity: 0.38, dash: 0.26, spin: 15_000, reverse: false },
] as const

function Orbit({ s, index, still }: { s: number; index: number; still: boolean }) {
  const o = ORBITS[index]
  if (!o) return null
  const c = s / 2
  const ring = (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} pointerEvents="none">
      <Circle cx={c} cy={s * 0.45} r={s * o.r} fill="none" stroke={o.colour} strokeOpacity={o.opacity} strokeWidth={1.1} strokeDasharray={`${s * o.dash} ${s * 0.34}`} strokeLinecap="round" transform={`rotate(${-28 + index * 47} ${c} ${s * 0.45})`} />
    </Svg>
  )
  if (still) return <View style={FILL} pointerEvents="none">{ring}</View>
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        ...FILL,
        animationName: { from: { transform: [{ rotate: '0deg' }] }, to: { transform: [{ rotate: o.reverse ? '-360deg' : '360deg' }] } },
        animationDuration: `${o.spin}ms`,
        animationTimingFunction: 'linear',
        animationIterationCount: 'infinite',
      }}
    >
      {ring}
    </Animated.View>
  )
}

/** The light inside the core, breathing. */
function CoreLight({ s, still }: { s: number; still: boolean }) {
  const c = s / 2
  const light1 = (
    <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} pointerEvents="none">
      <Circle cx={c} cy={s * 0.45} r={s * 0.1} fill={light.arc} fillOpacity={0.22} />
      <Circle cx={c} cy={s * 0.45} r={s * 0.045} fill={light.core} fillOpacity={0.9} />
    </Svg>
  )
  if (still) return <View style={FILL} pointerEvents="none">{light1}</View>
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        ...FILL,
        animationName: {
          from: { opacity: 0.72, transform: [{ scale: 0.94 }] },
          '50%': { opacity: 1, transform: [{ scale: 1.06 }] },
          to: { opacity: 0.72, transform: [{ scale: 0.94 }] },
        },
        animationDuration: '2600ms',
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
      }}
    >
      {light1}
    </Animated.View>
  )
}

/** Ten places, one network. The anchor is first; the rest cool with distance. */
const NODES: ReadonlyArray<readonly [number, number, number, number]> = [
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
]

/**
 * A packet of current running out to one node.
 *
 * A straight run rather than a follow-the-path: at this size the arc's sag is a
 * few pixels, and animating along a real path would mean a worklet per dot on a
 * screen whose whole job is to be read, not watched.
 */
function Packet({ s, index }: { s: number; index: number }) {
  const node = NODES[index]
  if (!node) return null
  const [x, y] = node
  const dx = s * (x - 0.5)
  const dy = s * (y - 0.44)
  const dot = Math.max(2.5, s * 0.016)
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: s * 0.5 - dot,
        top: s * 0.44 - dot,
        width: dot * 2,
        height: dot * 2,
        borderRadius: dot,
        backgroundColor: light.core,
        animationName: {
          from: { opacity: 0, transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 0.5 }] },
          '15%': { opacity: 1, transform: [{ translateX: dx * 0.15 }, { translateY: dy * 0.15 }, { scale: 1 }] },
          '70%': { opacity: 0.9, transform: [{ translateX: dx * 0.7 }, { translateY: dy * 0.7 }, { scale: 1 }] },
          to: { opacity: 0, transform: [{ translateX: dx }, { translateY: dy }, { scale: 0.6 }] },
        },
        animationDuration: `${1500 + (index % 4) * 260}ms`,
        animationDelay: `${index * 230}ms`,
        animationTimingFunction: 'ease-in-out',
        animationIterationCount: 'infinite',
      }}
    />
  )
}

/** The anchor announcing itself: one ring off the middle node, over and over. */
function NodePulse({ s, delay }: { s: number; delay: number }) {
  const base = s * 0.13
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: s * 0.5 - base / 2,
        top: s * 0.44 - base / 2,
        width: base,
        height: base,
        borderRadius: base / 2,
        borderWidth: 1.2,
        borderColor: paint.arc,
        animationName: {
          from: { opacity: 0.75, transform: [{ scale: 0.6 }] },
          to: { opacity: 0, transform: [{ scale: 3.1 }] },
        },
        animationDuration: '2800ms',
        animationDelay: `${delay}ms`,
        animationTimingFunction: 'ease-out',
        animationIterationCount: 'infinite',
      }}
    />
  )
}

export function IntroArt({ slide, size, reducedMotion = false, testID }: IntroArtProps) {
  const s = size
  const c = s / 2
  const still = reducedMotion
  return (
    <View style={{ width: s, height: s }} testID={testID} accessibilityRole="image">
      <Svg width={s} height={s} viewBox={`0 0 ${s} ${s}`} pointerEvents="none">
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
              entering or leaving it — no padlock, no keyhole. The orbits are
              layers above this one so each can turn at its own rate.
            */}
            <Path d={`M${c} ${s * 0.2} L${c + s * 0.17} ${s * 0.45} L${c} ${s * 0.7} L${c - s * 0.17} ${s * 0.45} Z`} fill={`url(#ia-face-${slide})`} />
            <Path d={`M${c} ${s * 0.2} L${c + s * 0.17} ${s * 0.45} L${c} ${s * 0.7} Z`} fill={paint.void} fillOpacity={0.32} />
            <Path
              d={`M${c} ${s * 0.2} L${c + s * 0.17} ${s * 0.45} L${c} ${s * 0.7} L${c - s * 0.17} ${s * 0.45} Z M${c} ${s * 0.2} L${c} ${s * 0.7}`}
              fill="none"
              stroke={`url(#ia-edge-${slide})`}
              strokeWidth={1.3}
              strokeLinejoin="round"
            />
          </G>
        ) : (
          <G>
            {/*
              The arcs and the glass each node stands on; the travelling light
              is a layer above, because a dot moving along a path is a view, not
              a stroke.
            */}
            {NODES.map(([x, y, r, near], i) => {
              const nx = s * x
              const ny = s * y
              const glow = i === 0 ? light.core : light.arc
              return (
                <G key={`${x}-${y}`}>
                  {i > 0 ? <Path d={sag(s * 0.5, s * 0.44, nx, ny, s * (0.05 + (i % 3) * 0.02))} fill="none" stroke={light.plasma} strokeOpacity={0.1 + near * 0.14} strokeWidth={s * 0.018} strokeLinecap="round" /> : null}
                  {i > 0 ? <Path d={sag(s * 0.5, s * 0.44, nx, ny, s * (0.05 + (i % 3) * 0.02))} fill="none" stroke={light.arc} strokeOpacity={0.25 + near * 0.5} strokeWidth={1.1} strokeLinecap="round" /> : null}
                  <Circle cx={nx} cy={ny} r={s * r * 2.1} fill={light.plasma} fillOpacity={0.06 + near * 0.06} />
                  <Circle cx={nx} cy={ny} r={s * r} fill={glow} fillOpacity={0.35 + near * 0.55} />
                  <Circle cx={nx} cy={ny} r={s * r} fill="none" stroke={light.core} strokeOpacity={near * 0.6} strokeWidth={0.9} />
                </G>
              )
            })}
          </G>
        )}
      </Svg>

      {slide === 1 ? (
        <>
          <Orbit s={s} index={0} still={still} />
          <Orbit s={s} index={1} still={still} />
          <Orbit s={s} index={2} still={still} />
          <CoreLight s={s} still={still} />
        </>
      ) : still ? null : (
        <>
          <NodePulse s={s} delay={0} />
          <NodePulse s={s} delay={1400} />
          {NODES.map((_, i) => (i === 0 ? null : <Packet key={i} s={s} index={i} />))}
        </>
      )}
    </View>
  )
}
