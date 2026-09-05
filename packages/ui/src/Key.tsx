import type { ReactNode } from 'react'
import { KeyFrame, KeyLabel } from './primitives'

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

/** One verb per key, from the closed set in master plan §7.10. */
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
      {icon}
      <KeyLabel onDark={kind !== 'primary'} fontSize={stacked ? '$2' : '$3'}>
        {label}
      </KeyLabel>
    </KeyFrame>
  )
}
