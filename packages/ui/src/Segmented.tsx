import { Pressable } from 'react-native'
import { Body, Row } from './primitives'
import { Rim } from './Rim'
import { metrics } from './tokens'

export interface SegmentedProps {
  readonly options: readonly { id: string; label: string }[]
  readonly value: string
  readonly onChange: (id: string) => void
  readonly testID?: string
}

/** Tokens · Collectibles · Positions on Home, Swap · Limit on Swap (§8.2, §8.6): a glass track, the chosen segment raised and rimmed. */
export function Segmented({ options, value, onChange, testID }: SegmentedProps) {
  return (
    <Row backgroundColor="$glass" borderRadius="$recessed" borderWidth={1} borderColor="$edge" padding={3} gap={2} testID={testID}>
      {options.map((o) => {
        const active = o.id === value
        return (
          <Pressable key={o.id} onPress={() => onChange(o.id)} accessibilityRole="tab" accessibilityState={{ selected: active }} style={{ flex: 1, minHeight: metrics.hit }}>
            <Row flex={1} justifyContent="center" borderRadius={11} backgroundColor={active ? '$glassRaised' : 'transparent'} overflow="hidden">
              <Body size="caption" tone={active ? 'ink' : 'mute'} fontWeight={active ? '600' : '400'}>
                {o.label}
              </Body>
              {active ? <Rim radius={11} opacity={0.6} /> : null}
            </Row>
          </Pressable>
        )
      })}
    </Row>
  )
}
