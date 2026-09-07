/**
 * How the wallet waits.
 *
 *   PageLoader   a screen has nothing to show yet — the ES mark on the
 *                current, with an arc travelling around it. Use `overlay` so
 *                it covers the screen and centres against the screen rather
 *                than against whatever content happens to exist.
 *   BarLoader    one part of a screen is behind — a sweep on a track that is
 *                always drawn, so nothing moves when it stops.
 *
 * Owner notes this answers:
 *  - "a centered pulsing ES logo for full page loading, and the progress bar
 *    style loader for smaller components"
 *  - "The ES loader should be centered both horizontally and vertically
 *    everywhere, it starts centered ... then ends up flashing and moving
 *    toward the top" — because a flex child centres inside whatever height it
 *    is given, and inside a scroll view's content that is the content's
 *    height. `overlay` takes it out of flow entirely.
 *  - "it should be displayed until all resources have downloaded and are ready
 *    to render ... it's almost as if the loader should actually be an overlay
 *    until the rest of the page is rendered" — exactly so; the screen mounts
 *    and lays out underneath while this covers it, which is also why nothing
 *    jumps when it lifts.
 *  - "Make the loader look premium" — so: no opacity blink (a mark fading to
 *    half looks like a broken image). The mark holds steady on a breathing
 *    glow while a gradient arc travels around it. Calm, brand-first, and the
 *    only moving part is light.
 */
import { View } from 'react-native'
import Animated from 'react-native-reanimated'
import Svg, { Circle, Defs, LinearGradient, Stop } from 'react-native-svg'
import { SvgImage } from './SvgImage'
import { useId } from 'react'
import { ES_MARK_SVG, ES_MARK_URI, ES_WORDMARK_SVG, ES_WORDMARK_URI } from './brand'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body, Column } from './primitives'
import { current, edge, glow, metrics, motion, paint } from './tokens'

/**
 * The marks come from the bundle, not from a file the page has to fetch — a
 * loader whose logo arrives after its animation has started is not a loader,
 * it is two things happening. See brand.ts.
 *
 * They are drawn through SvgImage, which splits by body: React Native has no
 * SVG decoder on Android and fails silently, which is why the owner saw no ES
 * logo anywhere on the phone. react-native-svg is already a dependency of ui,
 * the extension and the mobile app — and this file already used it for the
 * Halo — so one path serves both bodies.
 */
export const esMarkUri = (): string => ES_MARK_URI
export const esWordmarkUri = (): string => ES_WORDMARK_URI

export interface PageLoaderProps {
  /** Optional line under the mark; keep it to a few words. */
  readonly label?: string | null
  /** Mark width in px. The default is the full-page size. */
  readonly size?: number
  /**
   * Cover the screen instead of taking part in the layout. This is the form
   * to use on a screen: it centres against the viewport, hides the half-built
   * page underneath, and lifts without moving anything.
   */
  readonly overlay?: boolean
  readonly reducedMotion?: boolean
  readonly testID?: string
}

/** The travelling arc: one gradient stroke with a gap, turning slowly. */
function Halo({ size, reduced }: { size: number; reduced: boolean }) {
  const id = `halo-${useId().replace(/:/g, '')}`
  const box = Math.round(size * 1.55)
  const r = box / 2 - 3
  const circumference = 2 * Math.PI * r
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', width: box, height: box, alignItems: 'center', justifyContent: 'center' },
        reduced
          ? { opacity: 0.5 }
          : {
              animationName: { from: { transform: [{ rotate: '0deg' }] }, to: { transform: [{ rotate: '360deg' }] } },
              animationDuration: '2600ms',
              animationTimingFunction: 'linear',
              animationIterationCount: 'infinite',
            },
      ]}
    >
      <Svg width={box} height={box}>
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="1" y2="1">
            <Stop offset="0" stopColor={current.from} stopOpacity={0} />
            <Stop offset="0.55" stopColor={current.from} stopOpacity={0.9} />
            <Stop offset="1" stopColor={current.to} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        {/* The track keeps the ring's shape whether or not the arc is over it. */}
        <Circle cx={box / 2} cy={box / 2} r={r} stroke={edge} strokeWidth={2} fill="none" />
        <Circle cx={box / 2} cy={box / 2} r={r} stroke={`url(#${id})`} strokeWidth={2} strokeLinecap="round" fill="none" strokeDasharray={`${circumference * 0.28} ${circumference}`} />
      </Svg>
    </Animated.View>
  )
}

export function PageLoader({ label = null, size = 130, overlay = false, reducedMotion, testID }: PageLoaderProps) {
  const reduced = useReducedMotionPref() || reducedMotion === true
  // 477 x 296 in the source; keep the ratio.
  const height = Math.round((size * 296.07) / 477.78)
  const body = (
    <Column alignItems="center" justifyContent="center" gap="$4">
      <View style={{ alignItems: 'center', justifyContent: 'center' }}>
        <Animated.View
          pointerEvents="none"
          style={[
            {
              position: 'absolute',
              width: size * 1.6,
              height: size * 1.6,
              borderRadius: size,
              backgroundColor: glow.plate,
            },
            reduced ? { opacity: 0.5 } : { animationName: { from: { opacity: 0.28 }, to: { opacity: 0.7 } }, animationDuration: '1800ms', animationDirection: 'alternate', animationIterationCount: 'infinite', animationTimingFunction: 'ease-in-out' },
          ]}
        />
        <Halo size={size} reduced={reduced} />
        {/* The mark itself never blinks; only the light around it moves. */}
        <SvgImage xml={ES_MARK_SVG} uri={ES_MARK_URI} width={size} height={height} label="ElectroSwap" />
      </View>
      {label !== null && label !== '' ? (
        <Body tone="mute" size="caption">
          {label}
        </Body>
      ) : null}
    </Column>
  )
  if (!overlay) {
    return (
      <Column flex={1} alignItems="center" justifyContent="center" testID={testID ?? 'page-loading'}>
        {body}
      </Column>
    )
  }
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', backgroundColor: paint.void, zIndex: 20 }} testID={testID ?? 'page-loading'}>
      {body}
    </View>
  )
}

export interface EsWordmarkProps {
  readonly width?: number
  readonly opacity?: number
  readonly testID?: string
}

/**
 * The full ElectroSwap lock-up. Kept here rather than exposing `Image` to
 * packages/wallet, which composes ui primitives and never react-native.
 */
export function EsWordmark({ width = 202, opacity = 0.9, testID }: EsWordmarkProps) {
  // 629 x 155.5 in the source; keep the ratio so it never distorts.
  const height = Math.round((width * 155.5) / 629.64)
  return (
    <View style={{ opacity }} testID={testID}>
      <SvgImage xml={ES_WORDMARK_SVG} uri={ES_WORDMARK_URI} width={width} height={height} label="ElectroSwap" />
    </View>
  )
}

export interface BarLoaderProps {
  /** False leaves the track in place and stops the sweep, so nothing shifts. */
  readonly active?: boolean
  readonly reducedMotion?: boolean
  readonly testID?: string
}

/**
 * One part of a screen is behind. The track is always drawn, so a component
 * does not change height when its data lands — the flaw in a block skeleton
 * is that it is a different shape from the thing it stands for.
 */
export function BarLoader({ active = true, reducedMotion, testID }: BarLoaderProps) {
  const reduced = useReducedMotionPref() || reducedMotion === true
  return (
    <View style={{ height: metrics.filament, borderRadius: 1, backgroundColor: active ? edge : 'transparent', overflow: 'hidden' }} testID={testID ?? 'bar-loading'} accessibilityElementsHidden>
      {active ? (
        <Animated.View
          pointerEvents="none"
          style={
            reduced
              ? { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: paint.arc, opacity: 0.35 }
              : {
                  position: 'absolute',
                  top: 0,
                  bottom: 0,
                  width: '45%',
                  backgroundColor: current.from,
                  animationName: { from: { left: '-45%' }, to: { left: '100%' } },
                  animationDuration: `${motion.roll * 4}ms`,
                  animationTimingFunction: 'linear',
                  animationIterationCount: 'infinite',
                }
          }
        />
      ) : null}
    </View>
  )
}
