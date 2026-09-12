/**
 * The splash, as a piece of motion.
 *
 * ## What this is fixing
 *
 * The owner filmed a cold start and the frame-by-frame read like this: 0.75 s
 * of a **pure white** window (Expo's generated `splashscreen_logo` is a white
 * bitmap and the launch theme uses it as `windowBackground`), then 1.4 s of an
 * empty dark screen while Hermes evaluated a 5,000-module bundle, then the
 * splash appeared *fully formed and completely still* for one second, then a
 * hard cut to Home. Three and a half seconds, of which the brand was on screen
 * for one, motionless. "Not dopamine producing" is generous.
 *
 * ## The idea
 *
 * The wait becomes the show, and there is only ever one mark.
 *
 * Android paints `@drawable/boltvault_splash` — the same bolt, same size, same
 * dead-centre position (`plugins/withNativeSplash.js`) — from the instant the
 * icon is tapped. So the brand is on screen at 0 ms and the two seconds React
 * needs are *part of the splash* rather than a hole in it.
 *
 * Then this mounts, and the mark does not re-enter — it **discharges**. It is
 * already there, so an entrance would read as a jump; instead the world ignites
 * around it: a white flash off the bolt, three shockwaves riding outward, the
 * circuit lighting up in their wake, the name landing under them with a sweep
 * of current across it, the lock-up last. The mark itself only recoils.
 *
 * Everything is a Reanimated CSS animation — declarative keyframes, no
 * imperative timeline to keep in step, and the same code drives the web body
 * where the harness screenshots it.
 */
import Animated, { cubicBezier } from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useId } from 'react'
import type { ReactNode } from 'react'
import { BoltMark } from './BoltMark'
import { Field } from './scene/Field'
import { light, paint } from './tokens'

/**
 * The mark is the same size here and in the native drawable, so the handoff
 * from the still to the motion is invisible. Fixed rather than a fraction of
 * the screen for exactly that reason: the drawable cannot know the width.
 * `MARK_DP` in apps/mobile/plugins/withNativeSplash.js is the other half.
 */
export const SPLASH_MARK = 340

/**
 * How long the ceremony runs, so a body can hold the splash for exactly that
 * and not a frame longer. The last thing to finish is the third shockwave, at
 * 230 + 900.
 */
export const SPLASH_BEAT = 1150

/** The strike's ease: fast out of the gate, long settle. */
const OUT = cubicBezier(0.16, 1, 0.3, 1)
const FLARE = cubicBezier(0.2, 0.9, 0.1, 1)

function Flash({ size }: { size: number }) {
  const id = `sf-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const box = size * 2.2
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: box,
        height: box,
        animationName: {
          from: { opacity: 0, transform: [{ scale: 0.55 }] },
          '18%': { opacity: 0.95, transform: [{ scale: 0.9 }] },
          to: { opacity: 0, transform: [{ scale: 1.9 }] },
        },
        animationDuration: '560ms',
        animationTimingFunction: FLARE,
        animationFillMode: 'both',
      }}
    >
      <Svg width={box} height={box} viewBox="0 0 1 1">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={light.core} stopOpacity={0.95} />
            <Stop offset="0.25" stopColor={light.arc} stopOpacity={0.6} />
            <Stop offset="0.6" stopColor={light.plasma} stopOpacity={0.22} />
            <Stop offset="1" stopColor={light.plasma} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Rect x={0} y={0} width={1} height={1} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  )
}

/** One ring of current riding outward from the strike. */
function Shockwave({ size, delay }: { size: number; delay: number }) {
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        width: size,
        height: size,
        borderRadius: size / 2,
        borderWidth: 2,
        borderColor: paint.arc,
        animationName: {
          from: { opacity: 0, transform: [{ scale: 0.34 }] },
          '12%': { opacity: 0.85 },
          to: { opacity: 0, transform: [{ scale: 2.7 }] },
        },
        animationDuration: '900ms',
        animationDelay: `${delay}ms`,
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    />
  )
}

/** A general entrance with real travel — Ignition is deliberately smaller than this. */
function Rise({
  children,
  delay,
  travel = 18,
  duration = 480,
}: {
  children: ReactNode
  delay: number
  travel?: number
  duration?: number
}) {
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
        animationDuration: '900ms',
        animationDelay: '140ms',
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
          '22%': { transform: [{ scale: 1.09 }] },
          to: { transform: [{ scale: 1 }] },
        },
        animationDuration: '700ms',
        animationTimingFunction: OUT,
        animationFillMode: 'both',
      }}
    >
      {children}
    </Animated.View>
  )
}

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

export function SplashArt({
  width,
  height,
  name,
  brand,
  reducedMotion = false,
  testID,
}: SplashArtProps) {
  const mark = SPLASH_MARK
  const still = reducedMotion
  const field = (
    <Field
      scene="circuit"
      address="0x0000000000000000000000000000000000000e7n"
      quiet
      width={width}
      height={height}
      reducedMotion={reducedMotion}
    />
  )
  return (
    <Animated.View
      style={{
        flex: 1,
        backgroundColor: paint.void,
        alignItems: 'center',
        justifyContent: 'center',
      }}
      testID={testID}
    >
      {still ? field : <Wake>{field}</Wake>}

      {/* The strike, dead centre — where the native drawable already put it. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: 0,
          bottom: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
        pointerEvents="none"
      >
        {still ? null : (
          <>
            <Shockwave size={mark} delay={30} />
            <Shockwave size={mark} delay={130} />
            <Shockwave size={mark} delay={230} />
            <Flash size={mark} />
          </>
        )}
        {still ? (
          <BoltMark size={mark} testID="splash-mark" />
        ) : (
          <Recoil>
            <BoltMark size={mark} testID="splash-mark" />
          </Recoil>
        )}
      </Animated.View>

      {/* The name sits under the mark rather than sharing a column with it, so
          the mark's centre is the screen's centre and the still can match it.
          0.244 is where the bolt's tail ends inside the box: the polygon runs
          to y=0.94 of the unit square, which is 0.744 of the 1.8-unit viewBox,
          which is 0.244 below the box's own centre. */}
      <Animated.View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          top: height / 2 + mark * 0.244 + 22,
          alignItems: 'center',
        }}
        pointerEvents="none"
      >
        {still ? (
          name
        ) : (
          <Rise delay={240} duration={480}>
            {name}
          </Rise>
        )}
      </Animated.View>

      <Animated.View
        style={{ position: 'absolute', left: 0, right: 0, bottom: 44, alignItems: 'center' }}
        pointerEvents="none"
      >
        {still ? (
          brand
        ) : (
          <Rise delay={520} travel={10} duration={420}>
            {brand}
          </Rise>
        )}
      </Animated.View>
    </Animated.View>
  )
}
