/**
 * Seat — the identity plane's front door (master plan §8.1): the account's
 * signature in a ring, its name (`.etn` → label → 0x1F90…7B63) with a chevron
 * on the first line, and under it the short address with a copy control of its
 * own. Two lines fit a 44 px header in every body, so the seat never fights
 * the controls at the header's right.
 *
 * The holder tier used to ride here as a `tierMark`. It reads as part of the
 * account's name in a header that is already two lines and a chevron deep, and
 * "Tier 1" beside your address answers nothing you can act on. It is an entry
 * in Home's rotor now, where it has room to say what the rung is called and
 * what the next one saves.
 */
import { Pressable } from 'react-native'
import { Icon } from './Icon'
import { Body, Column, Row } from './primitives'
import { Signature } from './Signature'
import { metrics, paint } from './tokens'

export interface SeatProps {
  readonly address: string
  readonly label: string
  readonly name?: string | null
  readonly onPress?: () => void
  /** Copies the address; the seat shows "Copied" for a moment. */
  readonly onCopy?: () => void
  readonly copied?: boolean
  readonly testID?: string
}

export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

export function Seat({ address, label, name, onPress, onCopy, copied = false, testID }: SeatProps) {
  const title = name ?? label
  // The icon now lives in its own control beside this, so the line is text only.
  const addressLine = (
    <Body tone={copied ? 'arc' : 'mute'} size="caption" fontVariant={['tabular-nums']} numberOfLines={1}>
      {copied ? 'Copied' : shortAddress(address)}
    </Body>
  )
  return (
    <Row gap="$3" alignItems="center" flexShrink={1} minWidth={0}>
      <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Account ${title}`} testID={testID} style={{ minHeight: metrics.hit, minWidth: metrics.hit, alignItems: 'center', justifyContent: 'center', marginHorizontal: -2, flexShrink: 0 }}>
        <Signature address={address} size={40} />
      </Pressable>
      {/*
        Owner: "clicking even on the lower half of the wallet name triggers the
        address being copied ... Only the copy icon should trigger that, and the
        rest should nav to account management."
        The two controls used to be stacked 44 px targets pulled together with
        negative margins, so they overlapped and the copy target reached up over
        the name. Now the name *and* the address text are one tall target that
        opens accounts, and copy is only the icon.
      */}
      <Column alignItems="flex-start" flexShrink={1} minWidth={0}>
        <Row gap={4} alignItems="center" flexShrink={1} minWidth={0}>
          <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Account ${title}`} testID={testID ? `${testID}-name` : undefined} style={{ minHeight: metrics.hit, justifyContent: 'center', flexShrink: 1, minWidth: 0 }}>
            <Column alignItems="flex-start" gap={1}>
              <Row gap={6} alignItems="center">
                <Body size="title" numberOfLines={1} flexShrink={1}>
                  {title}
                </Body>
                <Icon name="chevronDown" size={16} color={paint.mute} />
              </Row>
              {onCopy ? addressLine : null}
            </Column>
          </Pressable>
          {onCopy ? (
            <Pressable onPress={onCopy} accessibilityRole="button" accessibilityLabel={`Copy address ${address}`} testID={testID ? `${testID}-copy` : undefined} style={{ minHeight: metrics.hit, minWidth: metrics.hit, alignItems: 'flex-start', justifyContent: 'flex-end', paddingBottom: 4, flexShrink: 0 }}>
              {/* 44×44 to satisfy the hit-target law (§7.5); the glyph hugs the
                left so the slack falls into the header's empty middle and copy
                still reads as sitting beside the address. */}
            <Icon name={copied ? 'check' : 'copy'} size={14} color={copied ? paint.arc : paint.mute} />
            </Pressable>
          ) : null}
        </Row>
      </Column>
    </Row>
  )
}
