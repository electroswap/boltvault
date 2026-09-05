import { Pressable } from 'react-native'
import { Body, Column, Row } from './primitives'
import { edge, metrics, paint } from './tokens'

export interface ToggleProps {
  readonly value: boolean
  readonly onChange: (value: boolean) => void
  readonly label: string
  readonly hint?: string
  readonly disabled?: boolean
  readonly testID?: string
}

/** A physical transfer switch, not an iOS toggle: a labelled row with a sliding pip. */
export function Toggle({ value, onChange, label, hint, disabled, testID }: ToggleProps) {
  return (
    <Pressable onPress={() => !disabled && onChange(!value)} accessibilityRole="switch" accessibilityState={{ checked: value, disabled }} accessibilityLabel={label} testID={testID} style={{ minHeight: metrics.hit, opacity: disabled ? 0.5 : 1 }}>
      <Row justifyContent="space-between" gap="$3" minHeight={metrics.hit}>
        <Column flexShrink={1} gap={2}>
          <Body>{label}</Body>
          {hint ? (
            <Body tone="mute" size="caption">
              {hint}
            </Body>
          ) : null}
        </Column>
        <Row width={44} height={26} borderRadius={13} backgroundColor={value ? paint.arc : paint.glassRaisedSolid} borderWidth={1} borderColor={edge} alignItems="center" padding={2}>
          <Row width={20} height={20} borderRadius={10} backgroundColor={value ? paint.void : paint.mute} marginLeft={value ? 18 : 0} />
        </Row>
      </Row>
    </Pressable>
  )
}
