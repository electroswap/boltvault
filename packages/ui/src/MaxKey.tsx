/**
 * MaxKey — the MAX control inside an amount well.
 *
 * Owner: "MAX should not be a pill." A pill is the shape this product uses
 * for a *choice* — a token, a duration, a scope, a filter. MAX is not a
 * choice, it is a verb, and dressing it as a pill made every amount well look
 * like it held two selectable chips. So it is a small square-shouldered key:
 * a quiet glass surface, a hairline, an arc label, radius 8 — smaller than
 * the well's 12 it sits in, which is the concentric rule.
 *
 * Deliberately not a variant of Pill: Pill is correctly a pill everywhere
 * else, and this is a different material, not a different size.
 */
import { Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body } from './primitives'
import { edge, metrics, motion, paint } from './tokens'

export interface MaxKeyProps {
  readonly label: string
  readonly onPress: () => void
  readonly disabled?: boolean
  readonly accessibilityLabel?: string
  readonly testID?: string
}

export function MaxKey({ label, onPress, disabled = false, accessibilityLabel, testID }: MaxKeyProps) {
  const reduced = useReducedMotionPref()
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled }}
      testID={testID}
      // The 44 px hit target is kept, but it no longer forces the row taller:
      // the well's own padding supplies the slack.
      style={{ minHeight: metrics.hit, justifyContent: 'center', alignSelf: 'center', marginVertical: -11 }}
    >
      <Animated.View
        style={{
          height: 24,
          paddingHorizontal: 8,
          borderRadius: 8,
          borderWidth: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: paint.glassRaised,
          borderColor: edge,
          opacity: disabled ? 0.5 : 1,
          transitionProperty: ['backgroundColor', 'borderColor'],
          transitionDuration: reduced ? 0 : motion.micro,
          transitionTimingFunction: 'ease-out',
        }}
      >
        <Body size="caption" tone="arc" fontWeight="600" numberOfLines={1}>
          {label}
        </Body>
      </Animated.View>
    </Pressable>
  )
}
