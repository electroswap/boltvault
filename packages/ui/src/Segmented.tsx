import { Pressable, View } from 'react-native'
import Animated from 'react-native-reanimated'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body, Row } from './primitives'
import { innerRadius, metrics, motion, paint, radius } from './tokens'

export interface SegmentedProps {
  readonly options: readonly { id: string; label: string }[]
  readonly value: string
  readonly onChange: (id: string) => void
  /** `compact` is a 30 px track (timeframes, slippage); the pressables stay 44 px. */
  readonly size?: 'regular' | 'compact'
  readonly testID?: string
}

/** A glass track; the chosen segment is a filled tint of the arc with an ink label (style bible › selected). */
export function Segmented({ options, value, onChange, size = 'regular', testID }: SegmentedProps) {
  const compact = size === 'compact'
  const reduced = useReducedMotionPref()
  return (
    <Row
      backgroundColor="$glass"
      borderRadius={compact ? 10 : '$recessed'}
      borderWidth={1}
      borderColor="$edge"
      padding={compact ? 3 : 3}
      height={compact ? 36 : undefined}
      gap={2}
      testID={testID}
    >
      {options.map((o) => {
        const active = o.id === value
        return (
          <Pressable
            key={o.id}
            onPress={() => onChange(o.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            style={{
              flex: 1,
              minHeight: metrics.hit,
              justifyContent: 'center',
              ...(compact ? { marginVertical: -7 } : {}),
            }}
          >
            <View
              style={{
                flex: compact ? undefined : 1,
                height: compact ? 30 : undefined,
                justifyContent: 'center',
                alignItems: 'center',
                borderRadius: compact ? innerRadius(10, 3) : innerRadius(radius.recessed, 3),
                overflow: 'hidden',
              }}
            >
              <Animated.View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: 0,
                  bottom: 0,
                  borderRadius: compact ? innerRadius(10, 3) : innerRadius(radius.recessed, 3),
                  borderWidth: 1,
                  backgroundColor: paint.arcSoft,
                  borderColor: paint.arcEdge,
                  opacity: active ? 1 : 0,
                  transitionProperty: 'opacity',
                  transitionDuration: reduced ? 0 : motion.micro,
                  transitionTimingFunction: 'ease-out',
                }}
              />
              <Body
                size="caption"
                tone={active ? 'ink' : 'mute'}
                fontWeight={active ? '600' : '400'}
                fontSize={compact ? 12 : undefined}
                lineHeight={compact ? 16 : undefined}
                paddingVertical={compact ? 0 : 10}
              >
                {o.label}
              </Body>
            </View>
          </Pressable>
        )
      })}
    </Row>
  )
}
