/**
 * Pill — a choice or a mark (style bible › materials): a token, a duration,
 * a scope, a filter, "Show all". A 44 px pressable around a 28/36 px chip;
 * selected = the lit rim and an ink label. Without `onPress` it is a static
 * mark and gets no button role.
 */
import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import { Icon } from './Icon'
import { Body, Chip, Row } from './primitives'
import { Rim } from './Rim'
import { metrics, paint } from './tokens'

export interface PillProps {
  readonly label: string
  readonly icon?: ReactNode
  readonly chevron?: boolean
  readonly selected?: boolean
  readonly tone?: 'ink' | 'mute' | 'arc' | 'ember' | 'surge' | 'burn'
  readonly size?: 'sm' | 'md'
  readonly disabled?: boolean
  readonly onPress?: () => void
  readonly accessibilityLabel?: string
  readonly testID?: string
}

export function Pill({ label, icon, chevron = false, selected = false, tone, size = 'md', disabled = false, onPress, accessibilityLabel, testID }: PillProps) {
  const height = size === 'sm' ? 28 : 36
  const labelTone = selected ? 'ink' : (tone ?? 'mute')
  const chip = (
    <Chip height={height} paddingHorizontal={size === 'sm' ? 10 : 12} paddingVertical={0} justifyContent="center" borderColor={selected ? 'transparent' : '$edge'} opacity={disabled ? 0.5 : 1}>
      <Row gap={6} zIndex={1}>
        {icon}
        <Body size="caption" tone={labelTone} fontWeight={selected ? '600' : '400'} numberOfLines={1}>
          {label}
        </Body>
        {chevron ? <Icon name="chevronDown" size={14} color={selected ? paint.ink : paint.mute} /> : null}
      </Row>
      {selected ? <Rim radius={999} opacity={0.6} /> : null}
    </Chip>
  )
  if (!onPress) return <Row testID={testID}>{chip}</Row>
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ selected, disabled }}
      testID={testID}
      style={{ minHeight: metrics.hit, justifyContent: 'center', alignSelf: 'flex-start' }}
    >
      {chip}
    </Pressable>
  )
}
