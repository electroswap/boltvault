/**
 * The splash, as a piece of motion.
 *
 * ## The still and the strike
 *
 * Android paints one mark from the tap: `@drawable/boltvault_splash`, the same
 * bolt, same size, same dead-centre (`plugins/withNativeSplash.js`). Android 12
 * would otherwise put the adaptive icon in a 240 dp circle for a few frames
 * and then swap to a larger square-cropped bitmap — two drawings. The native
 * plugin uses this mark as both the Android 12 icon and the window, so the
 * still is one object, and the two seconds React needs are part of the splash
 * rather than a hole in it.
 *
 * Then this mounts. The mark does not re-enter — it **discharges**. A white
 * flash off the bolt, a plasma bloom, then concentric rings of current riding
 * out to the corners of the screen: solid, dashed, haloed, the last one slow
 * and almost full-bleed. The circuit wakes in their wake, the name lands under
 * the tail, the lock-up last. The mark itself only recoils.
 *
 * Everything is a Reanimated CSS animation — declarative keyframes, no
 * imperative timeline to keep in step, and the same code drives the web body
 * where the harness screenshots it.
 */
import Animated, { cubicBezier } from 'react-native-reanimated'
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { BoltMark } from './BoltMark'
import { Field } from './scene/Field'
import { light, paint } from './tokens'

/**
 * The mark is the same size here and in the native drawable, so the handoff
 * from the still to the motion is invisible. Fixed rather than a fraction of
 * the screen for exactly that reason: the drawable cannot know the width.
 *
 * 240 dp is Android 12's splash-icon diameter. Anything else and the still
 * Android paints for the first frames is a different object from the still it
 * paints while Hermes evaluates the bundle.
 * `MARK_DP` in apps/mobile/plugins/withNativeSplash.js is the other half.
 */
export const SPLASH_MARK = 240

/**
 * How long the ceremony runs, so a body can hold the splash for exactly that
 * and not a frame longer. The last thing to finish is the outer ring, at
 * 320 + 1500.
 */
export const SPLASH_BEAT = 1850

/** The strike's ease: fast out of the gate, long settle. */
const OUT = cubicBezier(0.16, 1, 0.3, 1)
const FLARE = cubicBezier(0.2, 0.9, 0.1, 1)

function Flash({ size }: { size: number }) {
  const id = `sf-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const box = size * 2.6
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: box,
        height: box,
        animationName: {
          from: { opacity: 0, transform: [{ scale: 0.4 }] },
          '16%': { opacity: 1, transform: [{ scale: 0.85 }] },
          to: { opacity: 0, transform: [{ scale: 1.85 }] },
        },
        animationDuration: '620ms',
        animationTimingFunction: FLARE,
        animationFillMode: 'both',
      }}
    >
      <Svg width={box} height={box} viewBox="0 0 1 1">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={light.core} stopOpacity={1} />
            <Stop offset="0.18" stopColor={light.arc} stopOpacity={0.72} />
            <Stop offset="0.48" stopColor={light.plasma} stopOpacity={0.28} />
            <Stop offset="1" stopColor={light.plasma} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="0.5" cy="0.5" r="0.5" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  )
}

/** A filled shockwave of plasma — the air lighting, not a stroke. */
function Bloom({ size, delay, duration, from = 0.22, to = 1 }: { size: number; delay: number; duration: number; from?: number; to?: number }) {
  const id = `sb-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        animationName: {
          from: { opacity: 0.9, transform: [{ scale: from }] },
          '22%': { opacity: 0.55 },
          to: { opacity: 0, transform: [{ scale: to }] },
        },
        animationDuration: `${duration}ms`,
        animationDelay: `${delay}ms`,
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    >
      <Svg width={size} height={size} viewBox="0 0 1 1">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={light.core} stopOpacity={0.35} />
            <Stop offset="0.28" stopColor={light.arc} stopOpacity={0.22} />
            <Stop offset="0.62" stopColor={light.plasma} stopOpacity={0.16} />
            <Stop offset="1" stopColor={light.plasma} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx="0.5" cy="0.5" r="0.5" fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  )
}

interface RingSpec {
  readonly delay: number
  readonly duration: number
  readonly color: string
  readonly halo?: string
  readonly stroke: number
  readonly haloStroke?: number
  readonly dash?: string
  readonly spin?: number
  readonly from?: number
  readonly peak?: number
}

/**
 * One ring of current riding outward from the strike.
 *
 * A View border was a cheap circle and read as one. SVG lets the stroke carry
 * a halo, a dash, a spin — the same language IntroArt uses for orbits, fired
 * once instead of looping.
 */
function Ring({ reach, delay, duration, color, halo, stroke, haloStroke, dash, spin = 0, from = 0.1, peak = 0.92 }: RingSpec & { reach: number }) {
  const c = 50
  const r = 46
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: reach,
        height: reach,
        animationName: {
          from: { opacity: 0, transform: [{ scale: from }, { rotate: '0deg' }] },
          '9%': { opacity: peak },
          '55%': { opacity: peak * 0.55 },
          to: { opacity: 0, transform: [{ scale: 1 }, { rotate: `${spin}deg` }] },
        },
        animationDuration: `${duration}ms`,
        animationDelay: `${delay}ms`,
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    >
      <Svg width={reach} height={reach} viewBox="0 0 100 100">
        {halo ? <Circle cx={c} cy={c} r={r} fill="none" stroke={halo} strokeWidth={haloStroke ?? stroke * 3.2} strokeOpacity={0.28} strokeLinecap="round" strokeDasharray={dash} /> : null}
        <Circle cx={c} cy={c} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={dash} />
      </Svg>
    </Animated.View>
  )
}

/** A slow breath after the strike, so the hold is not a still. */
function Afterglow({ reach, delay }: { reach: number; delay: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: reach,
        height: reach,
        animationName: {
          from: { opacity: 0, transform: [{ scale: 0.28 }] },
          '12%': { opacity: 0.45 },
          to: { opacity: 0, transform: [{ scale: 0.82 }] },
        },
        animationDuration: '2200ms',
        animationDelay: `${delay}ms`,
        animationTimingFunction: OUT,
        animationIterationCount: 2,
        animationFillMode: 'both',
      }}
    >
      <Svg width={reach} height={reach} viewBox="0 0 100 100">
        <Circle cx="50" cy="50" r="46" fill="none" stroke={light.arc} strokeWidth={1.1} strokeOpacity={0.55} />
        <Circle cx="50" cy="50" r="46" fill="none" stroke={light.core} strokeWidth={0.4} strokeOpacity={0.7} />
      </Svg>
    </Animated.View>
  )
}

/** A general entrance with real travel — Ignition is deliberately smaller than this. */
function Rise({ children, delay, travel = 18, duration = 480 }: { children: ReactNode; delay: number; travel?: number; duration?: number }) {
  return (
    <Animated.View
      style={{
        animationName: {
          from: { opacity: 0, transform: [{ translateY: travel }, { scale: 0.94 }] },
          to: { opacity: 1, transform: [{ translateY: 0 }, { scale: 1 }] },
        },
        animationDuration: `${duration}ms`,
        animationDelay: `${delay}ms`,
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}

/** The circuit arriving in the shockwave's wake, rather than being there all along. */
function Wake({ children }: { children: ReactNode }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
        animationDuration: '1100ms',
        animationDelay: '80ms',
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}

/** The mark's recoil: it is already on screen, so it must not re-enter. */
function Recoil({ children }: { children: ReactNode }) {
  return (
    <Animated.View
      style={{
        animationName: {
          from: { transform: [{ scale: 1 }] },
          '18%': { transform: [{ scale: 1.14 }] },
          to: { transform: [{ scale: 1 }] },
        },
        animationDuration: '820ms',
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}

function SignatureLine({ delay }: { delay: number }) {
  return (
    <Animated.View
      style={{
        marginTop: 12,
        width: 96,
        height: 2,
        borderRadius: 1,
        backgroundColor: paint.arc,
        animationName: {
          from: { opacity: 0, transform: [{ scaleX: 0.12 }] },
          '40%': { opacity: 0.9, transform: [{ scaleX: 1 }] },
          to: { opacity: 0.28, transform: [{ scaleX: 1 }] },
        },
        animationDuration: '720ms',
        animationDelay: `${delay}ms`,
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    />
  )
}

const RINGS: readonly RingSpec[] = [
  { delay: 20, duration: 980, color: light.core, halo: light.arc, stroke: 2.4, haloStroke: 7, from: 0.08, peak: 1 },
  { delay: 70, duration: 1080, color: light.arc, halo: light.arc, stroke: 1.6, dash: '9 11', spin: 48, from: 0.1, peak: 0.95 },
  { delay: 130, duration: 1180, color: light.plasma, halo: light.plasma, stroke: 2.1, haloStroke: 8, from: 0.12, peak: 0.88 },
  { delay: 190, duration: 1280, color: light.arc, stroke: 1.15, dash: '3 7', spin: -62, from: 0.14, peak: 0.8 },
  { delay: 250, duration: 1400, color: light.core, halo: light.plasma, stroke: 1.4, haloStroke: 6, from: 0.16, peak: 0.75 },
  { delay: 320, duration: 1500, color: light.plasma, stroke: 1.05, from: 0.2, peak: 0.55 },
]

export interface SplashArtProps {
  readonly width: number
  readonly height: number
  /** The product name, under the mark. */
  readonly name: ReactNode
  /** The house lock-up at the foot. */
  readonly brand: ReactNode
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function SplashArt({ width, height, name, brand, reducedMotion = false, testID }: SplashArtProps) {
  const mark = SPLASH_MARK
  const still = reducedMotion
  const reach = Math.ceil(Math.hypot(width, height) * 0.96)
  const field = <Field scene="circuit" address="0x0000000000000000000000000000000000000e7n" quiet width={width} height={height} reducedMotion={reducedMotion} />
  return (
    <Animated.View style={{ flex: 1, backgroundColor: paint.void, alignItems: 'center', justifyContent: 'center' }} testID={testID}>
      {still ? field : <Wake>{field}</Wake>}

      {/* The strike, dead centre — where the native drawable already put it. */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        {still ? null : (
          <>
            <Bloom size={reach} delay={0} duration={920} from={0.18} to={0.72} />
            <Bloom size={reach} delay={180} duration={1100} from={0.24} to={0.9} />
            {RINGS.map((ring) => (
              <Ring key={`${ring.delay}-${ring.duration}`} reach={reach} {...ring} />
            ))}
            <Afterglow reach={reach * 0.62} delay={720} />
            <Flash size={mark} />
          </>
        )}
        {still ? <BoltMark size={mark} testID="splash-mark" /> : <Recoil><BoltMark size={mark} testID="splash-mark" /></Recoil>}
      </Animated.View>

      {/* The name sits under the mark rather than sharing a column with it, so
          the mark's centre is the screen's centre and the still can match it.
          0.244 is where the bolt's tail ends inside the box: the polygon runs
          to y=0.94 of the unit square, which is 0.744 of the 1.8-unit viewBox,
          which is 0.244 below the box's own centre. */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: height / 2 + mark * 0.244 + 22, alignItems: 'center' }} pointerEvents="none">
        {still ? (
          name
        ) : (
          <Rise delay={260} duration={520}>
            {name}
            <SignatureLine delay={0} />
          </Rise>
        )}
      </Animated.View>

      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 44, alignItems: 'center' }} pointerEvents="none">
        {still ? brand : <Rise delay={560} travel={10} duration={460}>{brand}</Rise>}
      </Animated.View>
    </Animated.View>
  )
}
