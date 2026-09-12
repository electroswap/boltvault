/**
 * The Legends vessel (master plan §7.12, §8.10): claimable ETN rises as
 * liquid light in a glass vessel between claims; Claim drains it into the
 * readout.
 *
 * The acceptance criterion is a *motion* criterion — "the vessel never
 * animates when nothing has changed" — so the level is an ordinary style
 * value with a CSS transition on it, never a keyframe animation and never an
 * idle loop. A render that carries the same level writes the same height, and
 * a transition with no change to transition does nothing. `vesselFill` rounds
 * to whole pixels for the same reason: dividends accrue continuously, so a
 * poll returning 0.6404 where the last one said 0.6401 must not make the
 * liquid twitch. The level has to move a pixel before the eye is asked to
 * look.
 *
 * Reanimated's CSS-animation API keeps this real CSS on web and a real
 * Reanimated transition on native, from one declaration.
 */
import Animated from 'react-native-reanimated'
import { useReducedMotionPref } from './motion/MotionContext'
import { Column } from './primitives'
import { light, motion, paint } from './tokens'
import { vesselFill } from './vesselFill'

export interface VesselProps {
  /** 0..1 — the engine's `LegendsStatus.vesselLevel`: claimable ÷ the best claim ever. */
  readonly level: number
  readonly width?: number
  readonly height?: number
  /** Omitted, the shell's motion preference decides (Settings › Reduce motion, or the system). */
  readonly reducedMotion?: boolean
  /** What the liquid *is*, for assistive tech — "3.21 ETN to claim". */
  readonly accessibilityLabel?: string
  readonly testID?: string
}

export function Vessel({
  level,
  width = 72,
  height = 120,
  reducedMotion,
  accessibilityLabel,
  testID,
}: VesselProps) {
  const pref = useReducedMotionPref()
  const reduced = reducedMotion ?? pref
  const fill = vesselFill(level, height)
  const percent = Math.round(Math.max(0, Math.min(1, Number.isFinite(level) ? level : 0)) * 100)
  // A slim tube (the collapsed dividends row) cannot carry the same furniture
  // as a full one: the highlight and the meniscus would be most of its width.
  const slim = width < 28
  const meniscus = slim ? 1.5 : 2
  return (
    <Column
      width={width}
      height={height}
      borderRadius={width / 2}
      borderWidth={1}
      borderColor={paint.arcEdge}
      backgroundColor={paint.well}
      overflow="hidden"
      justifyContent="flex-end"
      testID={testID}
      accessibilityLabel={accessibilityLabel ?? `${percent}%`}
    >
      <Animated.View
        style={[
          { height: fill, backgroundColor: light.plasma, opacity: 0.9 },
          // Twice the sheet duration: liquid is heavy, and the eye should be
          // able to follow the level rather than notice it has jumped.
          reduced
            ? null
            : {
                transitionProperty: 'height',
                transitionDuration: `${motion.sheet * 2}ms`,
                transitionTimingFunction: 'ease-out',
              },
        ]}
        testID={testID ? `${testID}-liquid` : undefined}
      >
        {/* Light collects near the surface: blue at the top of the violet. */}
        <Column height={Math.min(fill, slim ? 8 : 14)} backgroundColor={light.arc} opacity={0.45} />
        <Column
          position="absolute"
          top={0}
          left={0}
          right={0}
          height={meniscus}
          backgroundColor={light.core}
          opacity={0.9}
        />
      </Animated.View>
      {/* The glass: one specular streak down the left wall, and a floor line. */}
      <Column
        position="absolute"
        top={slim ? 4 : 8}
        left={slim ? 3 : 8}
        width={slim ? 2 : 5}
        height={height * 0.5}
        borderRadius={3}
        backgroundColor={light.core}
        opacity={0.14}
      />
      <Column
        position="absolute"
        bottom={0}
        left={0}
        right={0}
        height={1}
        backgroundColor={paint.arc}
        opacity={0.2}
      />
    </Column>
  )
}
