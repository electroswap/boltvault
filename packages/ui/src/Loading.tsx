/**
 * How the wallet waits.
 *
 * Owner: "I also don't like the skeleton style loader that's used throughout.
 * I prefer a centered pulsing ES logo (mobile logo from ../interface) for full
 * page loading, and the progress bar style loader for smaller components (like
 * the homepage under the balance)."
 *
 * So there are exactly two, and the choice is about scale, not taste:
 *
 *   PageLoader   a whole screen has nothing yet — the ES mark, centred,
 *                breathing. It is the brand doing the waiting, which also
 *                answers "there's very little ElectroSwap branding anywhere".
 *   BarLoader    one part of a screen is behind — a 2 px indeterminate sweep
 *                on a track that is always there, so nothing moves when it
 *                stops.
 *
 * Grey block skeletons are gone. They imitate content that is not there and
 * they were the loudest thing on screen.
 */
import { Image, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body, Column } from './primitives'
import { current, edge, metrics, motion, paint } from './tokens'

/** Where the vendored brand files live; the extension serves its public dir. */
let brandBase = '/brand/'

export function setBrandBase(next: string): void {
  brandBase = next.endsWith('/') ? next : `${next}/`
}

/** The compact mark. */
export const esMarkUri = (): string => `${brandBase}es-mark.svg`
/** The full lock-up, mark and wordmark. */
export const esWordmarkUri = (): string => `${brandBase}es-wordmark.svg`

export interface PageLoaderProps {
  /** Optional line under the mark; keep it to a few words. */
  readonly label?: string | null
  readonly reducedMotion?: boolean
  readonly testID?: string
}

/**
 * A screen with nothing to show yet. Centred, so it reads as "the app is
 * working" rather than "this content is shaped like blocks".
 */
export function PageLoader({ label = null, reducedMotion, testID }: PageLoaderProps) {
  const reduced = useReducedMotionPref() || reducedMotion === true
  return (
    <Column flex={1} alignItems="center" justifyContent="center" gap="$3" testID={testID ?? 'page-loading'}>
      <Animated.View
        style={
          reduced
            ? { opacity: 0.75 }
            : {
                // Breathing, not spinning: a spinner says "this may fail",
                // a slow pulse says "this is coming".
                animationName: { from: { opacity: 0.45, transform: [{ scale: 0.97 }] }, to: { opacity: 1, transform: [{ scale: 1.03 }] } },
                animationDuration: '1400ms',
                animationDirection: 'alternate',
                animationIterationCount: 'infinite',
                animationTimingFunction: 'ease-in-out',
              }
        }
      >
        <Image source={{ uri: esMarkUri() }} style={{ width: 72, height: 45 }} accessibilityLabel="ElectroSwap" accessibilityIgnoresInvertColors />
      </Animated.View>
      {label !== null && label !== '' ? (
        <Body tone="mute" size="caption">
          {label}
        </Body>
      ) : null}
    </Column>
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
export function EsWordmark({ width = 168, opacity = 0.9, testID }: EsWordmarkProps) {
  // 629 x 155.5 in the source; keep the ratio so it never distorts.
  const height = Math.round((width * 155.5) / 629.64)
  return <Image source={{ uri: esWordmarkUri() }} style={{ width, height, opacity }} accessibilityLabel="ElectroSwap" accessibilityIgnoresInvertColors testID={testID} />
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
