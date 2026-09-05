import type { ReactNode } from 'react'
import { KeyFrame, KeyLabel, Row } from './primitives'
import { CurrentFill, Rim } from './Rim'
import { radius } from './tokens'

export interface KeyProps {
  readonly label: string
  readonly onPress?: () => void
  readonly kind?: 'primary' | 'secondary' | 'danger'
  readonly disabled?: boolean
  readonly testID?: string
  readonly icon?: ReactNode
  /** Icon above the label — the four Home keys in a 360 px popup. */
  readonly stacked?: boolean
}

/**
 * One verb per key, from the closed set in master plan §7.10. The primary is
 * the current (blue into violet) with a glow; the secondary is glass with a
 * lit rim; danger is copper.
 */
export function Key({ label, onPress, kind = 'primary', disabled = false, testID, icon, stacked = false }: KeyProps) {
  return (
    <KeyFrame
      kind={kind}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      testID={testID}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
      flexDirection={stacked ? 'column' : 'row'}
      gap={stacked ? 2 : 8}
      paddingHorizontal={stacked ? '$2' : '$6'}
      height={stacked ? 60 : 56}
      flex={stacked ? 1 : undefined}
    >
      {kind === 'primary' ? <CurrentFill radius={radius.key} /> : null}
      {kind === 'secondary' ? <Rim radius={radius.key} opacity={0.35} /> : null}
      {/* A positioned layer: on the web an absolute SVG paints above in-flow text whatever the order. */}
      <Row flexDirection={stacked ? 'column' : 'row'} alignItems="center" justifyContent="center" gap={stacked ? 2 : 8} zIndex={1}>
        {icon}
        <KeyLabel fontSize={stacked ? '$2' : '$3'}>{label}</KeyLabel>
      </Row>
    </KeyFrame>
  )
}
