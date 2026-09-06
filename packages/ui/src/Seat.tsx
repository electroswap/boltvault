/**
 * Seat — the identity plane's front door (master plan §8.1): the account's
 * signature in a ring, its name (`.etn` → label → 0x1F90…7B63) with the tier
 * mark and a chevron on the first line, and under it the short address with
 * a copy control of its own. Two lines fit a 44 px header in every body,
 * so the seat never fights the controls at the header's right.
 */
import { Pressable } from 'react-native'
import Animated from 'react-native-reanimated'
import { Icon } from './Icon'
import { useReducedMotionPref } from './motion/MotionContext'
import { Body, Column, Row } from './primitives'
import { Signature } from './Signature'
import { metrics, paint } from './tokens'

export interface SeatProps {
  readonly address: string
  readonly label: string
  readonly name?: string | null
  readonly onPress?: () => void
  readonly tierMark?: string | null
  /** Copies the address; the seat shows "Copied" for a moment. */
  readonly onCopy?: () => void
  readonly copied?: boolean
  readonly testID?: string
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function Seat({ address, label, name, onPress, tierMark, onCopy, copied = false, testID }: SeatProps) {
  const title = name ?? label
  const reduced = useReducedMotionPref()
  const addressLine = (
    <Row gap={4} alignItems="center">
      <Body tone={copied ? 'arc' : 'mute'} size="caption" fontVariant={['tabular-nums']} numberOfLines={1}>
        {copied ? 'Copied' : shortAddress(address)}
      </Body>
      {onCopy ? (
        copied && !reduced ? (
          <Animated.View style={{ animationName: { from: { opacity: 0, transform: [{ scale: 0.5 }] }, to: { opacity: 1, transform: [{ scale: 1 }] } }, animationDuration: '160ms', animationTimingFunction: 'ease-out', animationFillMode: 'both' }}>
            <Icon name="check" size={12} color={paint.arc} />
          </Animated.View>
        ) : (
          <Icon name={copied ? 'check' : 'copy'} size={12} color={copied ? paint.arc : paint.mute} />
        )
      ) : null}
    </Row>
  )
  return (
    <Row gap="$3" alignItems="center" flexShrink={1} minWidth={0}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Account ${title}`} testID={testID} style={{ minHeight: metrics.hit, minWidth: metrics.hit, alignItems: 'center', justifyContent: 'center', marginHorizontal: -2, flexShrink: 0 }}>
        <Signature address={address} size={40} />
      </Pressable>
      <Column alignItems="flex-start" flexShrink={1} minWidth={0}>
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Account ${title}`} testID={testID ? `${testID}-name` : undefined} style={{ minHeight: metrics.hit, justifyContent: 'center', marginVertical: onCopy ? -10 : 0 }}>
          <Row gap={6} alignItems="center">
            <Body size="title" numberOfLines={1} flexShrink={1}>
              {title}
            </Body>
            {tierMark ? (
              <Body tone="ember" size="caption" numberOfLines={1} flexShrink={0}>
                {tierMark}
              </Body>
            ) : null}
            <Icon name="chevronDown" size={16} color={paint.mute} />
          </Row>
        </Pressable>
        {onCopy ? (
          <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={`Copy address ${address}`} testID={testID ? `${testID}-copy` : undefined} style={{ minHeight: metrics.hit, marginVertical: -13, justifyContent: 'center' }}>
            {addressLine}
          </Pressable>
        ) : null}
      </Column>
    </Row>
  )
}
