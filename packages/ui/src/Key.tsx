import type { ReactNode } from 'react'
import { KeyFrame, KeyLabel } from './primitives'

export interface KeyProps {
  readonly label: string
  readonly onPress?: () => void
  readonly kind?: 'primary' | 'secondary' | 'danger'
  readonly disabled?: boolean
  readonly testID?: string
  readonly icon?: ReactNode
}

/** One verb per key, from the closed set in master plan §7.10. */
export function Key({ label, onPress, kind = 'primary', disabled = false, testID, icon }: KeyProps) {
  return (
    <KeyFrame
      kind={kind}
      disabled={disabled}
      onPress={disabled ? undefined : onPress}
      testID={testID}
      role="button"
      aria-label={label}
      aria-disabled={disabled}
    >
      {icon}
      <KeyLabel onDark={kind !== 'primary'}>{label}</KeyLabel>
    </KeyFrame>
  )
}
