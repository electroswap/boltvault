import { Pressable } from 'react-native'
import { Body, Row } from './primitives'
import { metrics } from './tokens'

export interface SegmentedProps {
  readonly options: readonly { id: string; label: string }[]
  readonly value: string
  readonly onChange: (id: string) => void
  readonly testID?: string
}

/** Tokens · Collectibles · Positions on Home, Swap · Limit on Swap (§8.2, §8.6). */
export function Segmented({ options, value, onChange, testID }: SegmentedProps) {
  return (
    <Row backgroundColor="$glass" borderRadius="$recessed" padding={3} gap={2} testID={testID}>
      {options.map((o) => {
        const active = o.id === value
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={{ flex: 1, minHeight: metrics.hit }}>
            <Row flex={1} justifyContent="center" borderRadius={9} backgroundColor={active ? '$glassRaised' : 'transparent'} borderWidth={1} borderColor={active ? '$edge' : 'transparent'}>
              <Body size="caption" tone={active ? 'ink' : 'mute'}>
                {o.label}
              </Body>
            </Row>
          </Pressable>
        )
      })}
    </Row>
  )
}
