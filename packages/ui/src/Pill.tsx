/**
 * Pill — a choice or a mark (style bible › materials): a token, a duration,
 * a scope, a filter, "Show all". A 44 px pressable around a 28/36 px chip;
 * selected = a filled tint of the arc with an ink label (never a lit rim —
 * style bible › selected). Without `onPress` it is a static mark and gets
 * no button role.
 */
import type { ReactNode } from 'react'
import { Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import { Icon } from './Icon'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body, Row } from './primitives'
import { edge, metrics, motion, paint } from './tokens'

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
  const reduced = useReducedMotionPref()
  const chip = (
    <Animated.View
      style={{
        height,
        paddingHorizontal: size === 'sm' ? 10 : 12,
        borderRadius: 999,
        borderWidth: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? paint.arcSoft : paint.glassRaised,
        borderColor: selected ? paint.arcEdge : edge,
        opacity: disabled ? 0.5 : 1,
        transitionProperty: ['backgroundColor', 'borderColor'],
        transitionDuration: reduced ? 0 : motion.micro,
        transitionTimingFunction: 'ease-out',
      }}
    >
      <Row gap={6} alignItems="center">
        {icon}
        <Body size="caption" tone={labelTone} fontWeight={selected ? '600' : '400'} numberOfLines={1}>
          {label}
        </Body>
        {chevron ? <Icon name="chevronDown" size={14} color={selected ? paint.ink : paint.mute} /> : null}
      </Row>
    </Animated.View>
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
