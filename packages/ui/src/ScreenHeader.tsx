/**
 * ScreenHeader — the one header every pushed screen uses (plan B1): a 44 px
 * row with an icon-only Back, the title beside it, and a right slot for
 * IconButtons or a chip. Replaces the 56 px "Back" keys that sat at the top
 * of every page.
 */
import type { ReactNode } from 'react'
import { IconButton } from './IconButton'
import { Body, Column, Row } from './primitives'
import { metrics } from './tokens'

export interface ScreenHeaderProps {
  readonly title?: string
  readonly subtitle?: string
  readonly onBack?: () => void
  readonly backLabel?: string
  /** money.spec and friends click `back`; keep it unless a screen has a reason. */
  readonly backTestID?: string
  /** Replaces the title slot (an avatar + symbol on the Token page). */
  readonly leading?: ReactNode
  readonly right?: ReactNode
  readonly testID?: string
}

export function ScreenHeader({
  title,
  subtitle,
  onBack,
  backLabel = 'Back',
  backTestID = 'back',
  leading,
  right,
  testID,
}: ScreenHeaderProps) {
  return (
    <Row minHeight={metrics.header} gap="$2" testID={testID}>
      {onBack ? (
        <IconButton icon="back" label={backLabel} onPress={onBack} testID={backTestID} />
      ) : null}
      <Column flex={1} minWidth={0} justifyContent="center">
        {leading ?? (
          <>
            {title ? (
              <Body size="title" numberOfLines={1}>
                {title}
              </Body>
            ) : null}
            {subtitle ? (
              <Body tone="mute" size="caption" numberOfLines={1}>
                {subtitle}
              </Body>
            ) : null}
          </>
        )}
      </Column>
      {right ? (
        <Row gap="$1" flexShrink={0}>
          {right}
        </Row>
      ) : null}
    </Row>
  )
}
