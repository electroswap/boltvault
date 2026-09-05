/**
 * Seat — the identity plane's front door (master plan §8.1): the account's
 * signature in a ring, its name (`.etn` → label → 0x1F90…7B63), a chevron.
 */
import { Pressable } from 'react-native'
import { Icon } from './Icon'
import { Body, Row } from './primitives'
import { Signature } from './Signature'
import { metrics, paint } from './tokens'

export interface SeatProps {
  readonly address: string
  readonly label: string
  readonly name?: string | null
  readonly onPress?: () => void
  readonly tierMark?: string | null
  readonly testID?: string
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function Seat({ address, label, name, onPress, tierMark, testID }: SeatProps) {
  const title = name ?? label
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Account ${title}`} testID={testID} style={{ minHeight: metrics.hit, justifyContent: 'center' }}>
      <Row gap="$3">
        <Signature address={address} size={40} />
        <Row gap="$2" flexShrink={1}>
          <Body size="title" numberOfLines={1}>
            {title}
          </Body>
          {tierMark ? (
            <Body tone="ember" size="caption">
              {tierMark}
            </Body>
          ) : null}
          <Icon name="chevronDown" size={18} color={paint.mute} />
        </Row>
      </Row>
    </Pressable>
  )
}
