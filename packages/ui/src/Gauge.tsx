/**
 * Gauge — how far along something is, as a track painted with the current.
 *
 * The share bar under a `BusBar` is the same idea inlined; this is the one you
 * put in front of somebody on purpose, with room for a label at each end. The
 * fee sheet uses it for the climb to the next tier, which is the whole reason
 * it exists: "13,600 of 136,000 BOLT-eq" is a fact, and a bar four fifths empty
 * is an argument.
 *
 * Never colour alone (§7.5): the two captions carry the same information the
 * fill does, so a gauge read with no colour at all still says where you are.
 */
import { View } from 'react-native'
import { Body, Column, Row } from './primitives'
import { CurrentFill } from './Rim'
import { edge } from './tokens'

export interface GaugeProps {
  /** 0..1, clamped. */
  readonly value: number
  /** Sits under the left end — where you are. */
  readonly from?: string | null
  /** Sits under the right end — what you are climbing to. */
  readonly to?: string | null
  readonly height?: number
  readonly testID?: string
}

export function Gauge({ value, from, to, height = 6, testID }: GaugeProps) {
  const pct = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <Column gap={4} testID={testID}>
      <View
        style={{ height, borderRadius: height / 2, backgroundColor: edge, overflow: 'hidden' }}
        accessibilityRole="progressbar"
        accessibilityValue={{ now: Math.round(pct * 100), min: 0, max: 100 }}
      >
        {/*
          A zero-width child of an `overflow: hidden` row still lays out, and on
          web a 0 % gradient briefly paints a hairline before it is clipped.
          Nothing to draw is nothing drawn.
        */}
        {pct > 0 ? (
          <View
            style={{ width: `${pct * 100}%`, height, borderRadius: height / 2, overflow: 'hidden' }}
          >
            <CurrentFill radius={height / 2} />
          </View>
        ) : null}
      </View>
      {from || to ? (
        <Row justifyContent="space-between" gap="$2">
          <Body
            tone="mute"
            size="caption"
            fontSize={11}
            lineHeight={13}
            numberOfLines={1}
            flexShrink={1}
          >
            {from ?? ''}
          </Body>
          <Body
            tone="mute"
            size="caption"
            fontSize={11}
            lineHeight={13}
            numberOfLines={1}
            flexShrink={1}
          >
            {to ?? ''}
          </Body>
        </Row>
      ) : null}
    </Column>
  )
}
