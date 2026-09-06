import { Pressable } from 'react-native'
import { Body, Row } from './primitives'
import { Rim } from './Rim'
import { metrics } from './tokens'

export interface SegmentedProps {
  readonly options: readonly { id: string; label: string }[]
  readonly value: string
  readonly onChange: (id: string) => void
  /** `compact` is a 30 px track (timeframes, slippage); the pressables stay 44 px. */
  readonly size?: 'regular' | 'compact'
  readonly testID?: string
}

/** Tokens · Collectibles · Positions on Home, Swap · Limit on Swap (§8.2, §8.6): a glass track, the chosen segment raised and rimmed. */
export function Segmented({ options, value, onChange, size = 'regular', testID }: SegmentedProps) {
  const compact = size === 'compact'
  return (
    <Row backgroundColor="$glass" borderRadius={compact ? 10 : '$recessed'} borderWidth={1} borderColor="$edge" padding={compact ? 3 : 3} height={compact ? 36 : undefined} gap={2} testID={testID}>
      {options.map((o) => {
        const active = o.id === value
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={{ flex: 1, minHeight: metrics.hit, justifyContent: 'center', ...(compact ? { marginVertical: -7 } : {}) }}>
            <Row flex={compact ? undefined : 1} height={compact ? 30 : undefined} justifyContent="center" borderRadius={compact ? 8 : 11} backgroundColor={active ? '$glassRaised' : 'transparent'} overflow="hidden">
              <Body size="caption" tone={active ? 'ink' : 'mute'} fontWeight={active ? '600' : '400'} fontSize={compact ? 12 : undefined} lineHeight={compact ? 16 : undefined}>
                {o.label}
              </Body>
              {active ? <Rim radius={compact ? 8 : 11} opacity={0.6} /> : null}
            </Row>
          </Pressable>
        )
      })}
    </Row>
  )
}
