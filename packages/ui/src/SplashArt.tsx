/**
 * The splash, as a piece of motion.
 *
 * ## The still and the strike
 *
 * Android paints the same bolt the launcher icon uses — mark alone, on the
 * void, dead centre (`plugins/withNativeSplash.js`). No bloom is baked into
 * that bitmap: a glow in a square PNG is a cropped plate of light, which is
 * what a cold start used to show between the circular Android 12 icon and
 * this screen.
 *
 * Then this mounts. The mark does not re-enter — it **discharges**. A flash
 * off the bolt, then concentric rings of current riding out. Those rings are
 * Views, not SVG: scale and opacity on a circular border run on the UI thread
 * and ease continuously, instead of jumping between CSS keyframes while a
 * thousand-pixel SVG is rasterised. The circuit wakes in their wake, the name
 * lands under the tail, the lock-up last. The mark itself only recoils.
 */
import { useEffect, type ReactNode } from 'react'
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withDelay, withTiming, cubicBezier } from 'react-native-reanimated'
import { BoltMark } from './BoltMark'
import { Field } from './scene/Field'
import { light, paint } from './tokens'

/**
 * Sized so the polygon matches the native still.
 *
 * The Android 12 icon and the windowBackground item are 240 dp of a scale-0.5
 * bolt (the adaptive-icon safe zone). That bolt is 120 dp. BoltMark's viewBox
 * is 1.8 units with the polygon in 1, so 216 dp draws the same 120 dp bolt.
 * `MARK_DP` in apps/mobile/plugins/withNativeSplash.js is the 240.
 */
export const SPLASH_MARK = 216

/**
 * How long the ceremony runs, so a body can hold the splash for exactly that
 * and not a frame longer. The last ring is delay 360 + duration 1400.
 */
export const SPLASH_BEAT = 1800

const OUT = cubicBezier(0.16, 1, 0.3, 1)
const RING_EASE = Easing.bezier(0.16, 1, 0.3, 1)

function Flash({ size }: { size: number }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.value = withTiming(1, { duration: 560, easing: Easing.bezier(0.2, 0.9, 0.1, 1) })
  }, [t])
  const box = size * 2.2
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.16, 1], [0, 0.55, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.45, 1.7]) }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: box,
          height: box,
          borderRadius: box / 2,
          backgroundColor: 'rgba(234, 246, 255, 0.9)',
        },
        style,
      ]}
    />
  )
}

/** A filled circular shockwave — compositor-only, so it stays round. */
function Bloom({ size, delay, duration, color }: { size: number; delay: number; duration: number; color: string }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration, easing: RING_EASE }))
  }, [delay, duration, t])
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.18, 1], [0.55, 0.28, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [0.2, 1]) }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
        },
        style,
      ]}
    />
  )
}

interface RingSpec {
  readonly delay: number
  readonly duration: number
  readonly color: string
  readonly thickness: number
  readonly from: number
  readonly peak: number
}

/**
 * One ring of current. A `View` with `borderRadius` and a transform — the same
 * two properties a compositor can animate without a layout pass.
 */
function Ring({ reach, delay, duration, color, thickness, from, peak }: RingSpec & { reach: number }) {
  const t = useSharedValue(0)
  useEffect(() => {
    t.value = withDelay(delay, withTiming(1, { duration, easing: RING_EASE }))
  }, [delay, duration, t])
  const style = useAnimatedStyle(() => ({
    opacity: interpolate(t.value, [0, 0.1, 0.55, 1], [0, peak, peak * 0.45, 0]),
    transform: [{ scale: interpolate(t.value, [0, 1], [from, 1]) }],
  }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          position: 'absolute',
          width: reach,
          height: reach,
          borderRadius: reach / 2,
          borderWidth: thickness,
          borderColor: color,
        },
        style,
      ]}
    />
  )
}

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

function Recoil({ children }: { children: ReactNode }) {
  return (
    <Animated.View
      style={{
        animationName: {
          from: { transform: [{ scale: 1 }] },
          '20%': { transform: [{ scale: 1.08 }] },
          to: { transform: [{ scale: 1 }] },
        },
        animationDuration: '720ms',
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}

const RINGS: readonly RingSpec[] = [
  { delay: 0, duration: 1000, color: light.core, thickness: 2.5, from: 0.14, peak: 0.95 },
  { delay: 90, duration: 1120, color: light.arc, thickness: 2, from: 0.14, peak: 0.8 },
  { delay: 180, duration: 1240, color: 'rgba(79, 195, 255, 0.45)', thickness: 6, from: 0.16, peak: 0.4 },
  { delay: 270, duration: 1320, color: light.plasma, thickness: 2, from: 0.18, peak: 0.65 },
  { delay: 360, duration: 1440, color: 'rgba(139, 92, 246, 0.4)', thickness: 5, from: 0.2, peak: 0.35 },
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
  const reach = Math.ceil(Math.hypot(width, height) * 0.92)
  const field = <Field scene="circuit" address="0x0000000000000000000000000000000000000e7n" quiet width={width} height={height} reducedMotion={reducedMotion} />
  return (
    <Animated.View style={{ flex: 1, backgroundColor: paint.void, alignItems: 'center', justifyContent: 'center' }} testID={testID}>
      {still ? field : <Wake>{field}</Wake>}

      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none">
        {still ? null : (
          <>
            <Bloom size={reach * 0.55} delay={0} duration={780} color="rgba(234, 246, 255, 0.35)" />
            <Bloom size={reach * 0.85} delay={120} duration={1100} color="rgba(79, 195, 255, 0.18)" />
            {RINGS.map((ring) => (
              <Ring key={`${ring.delay}-${ring.color}`} reach={reach} {...ring} />
            ))}
            <Flash size={mark} />
          </>
        )}
        {/* glow=0: the native still is the launcher bolt, no aura. A vector
            aura in a square Svg is the same cropped plate the bitmap was. */}
        {still ? (
          <BoltMark size={mark} glow={0} testID="splash-mark" />
        ) : (
          <Recoil>
            <BoltMark size={mark} glow={0} testID="splash-mark" />
          </Recoil>
        )}
      </Animated.View>

      {/* The name sits under the mark rather than sharing a column with it, so
          the mark's centre is the screen's centre and the still can match it.
          0.244 is where the bolt's tail ends inside the box: the polygon runs
          to y=0.94 of the unit square, which is 0.744 of the 1.8-unit viewBox,
          which is 0.244 below the box's own centre. */}
      <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: height / 2 + mark * 0.244 + 22, alignItems: 'center' }} pointerEvents="none">
        {still ? name : <Rise delay={280} duration={520}>{name}</Rise>}
      </Animated.View>

      <Animated.View style={{ position: 'absolute', left: 0, right: 0, bottom: 44, alignItems: 'center' }} pointerEvents="none">
        {still ? brand : <Rise delay={560} travel={10} duration={460}>{brand}</Rise>}
      </Animated.View>
    </Animated.View>
  )
}
