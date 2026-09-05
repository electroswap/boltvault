/**
 * The Legends vessel (master plan §7.12, §8.10): claimable ETN rises as
 * liquid light in a glass vessel between claims; Claim drains it into the
 * readout. The level only moves when the value changes — the vessel never
 * animates idly. Reanimated's CSS-animation API keeps it real CSS on web.
 */
import Animated from 'react-native-reanimated'
import { Column } from './primitives'
import { light, motion, paint } from './tokens'

export interface VesselProps {
  /** 0..1 */
  readonly level: number
  readonly width?: number
  readonly height?: number
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function Vessel({ level, width = 72, height = 120, reducedMotion = false, testID }: VesselProps) {
  const clamped = Math.max(0, Math.min(1, level))
  const fill = Math.round(clamped * (height - 8))
  return (
    <Column width={width} height={height} borderRadius={width / 2} borderWidth={1} borderColor="rgba(95,216,255,0.25)" backgroundColor="rgba(14,22,40,0.7)" overflow="hidden" justifyContent="flex-end" testID={testID} accessibilityLabel={`Vessel ${Math.round(clamped * 100)} percent`}>
      {/* Glass highlight. */}
      <Column position="absolute" top={6} left={8} width={6} height={height * 0.6} borderRadius={3} backgroundColor="rgba(238,248,255,0.12)" />
      <Animated.View
        style={[
          { height: fill, backgroundColor: light.plasma, opacity: 0.85, borderTopLeftRadius: 10, borderTopRightRadius: 10 },
          reducedMotion ? null : { transitionProperty: 'height', transitionDuration: `${motion.sheet * 2}ms` },
        ]}
        testID={testID ? `${testID}-liquid` : undefined}
      >
        <Column height={3} backgroundColor={light.core} opacity={0.6} />
      </Animated.View>
      <Column position="absolute" bottom={4} left={0} right={0} height={2} backgroundColor={paint.arc} opacity={0.15} />
    </Column>
  )
}
