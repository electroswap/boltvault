/**
 * BusBar — one holding (master plan §7.5): logo, symbol, amount, value, 24 h
 * change, and a fill equal to its share of the scoped portfolio, painted with
 * the current. 52 px tall, tap selects; never drag.
 */
import { Pressable, View } from 'react-native'
import { Body, Column, Row } from './primitives'
import { CurrentFill } from './Rim'
import { TokenAvatar } from './TokenAvatar'
import { edge, metrics } from './tokens'

export interface BusBarProps {
  readonly chainId: number
  readonly address: string
  readonly symbol: string
  readonly amount: string
  readonly value?: string | null
  /** Signed percentage text, e.g. "+2.1%"; colour never carries it alone. */
  readonly change?: string | null
  /** 0..1 share of the scoped portfolio value. */
  readonly share: number
  readonly logoUri?: string | null
  readonly selected?: boolean
  readonly mark?: string | null
  readonly onPress?: () => void
  readonly testID?: string
}

export function BusBar({ chainId, address, symbol, amount, value, change, share, logoUri, selected, mark, onPress, testID }: BusBarProps) {
  const up = change?.startsWith('+')
  const down = change?.startsWith('-') || change?.startsWith('−')
  const width = `${Math.max(0, Math.min(1, share)) * 100}%` as const
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`${amount} ${symbol}${value ? `, ${value}` : ''}`} testID={testID}>
      <Column
        height={metrics.busBar}
        justifyContent="center"
        paddingHorizontal="$3"
        borderRadius="$recessed"
        borderWidth={1}
        borderColor={selected ? '$arc' : 'transparent'}
        backgroundColor={selected ? '$glass' : 'transparent'}
      >
        <Row gap="$3">
          <TokenAvatar chainId={chainId} address={address} logoUri={logoUri} size={32} />
          <Column flex={1} gap={2}>
            <Row justifyContent="space-between">
              <Row gap="$2">
                <Body size="body" fontWeight="600">
                  {symbol}
                </Body>
                {mark ? (
                  <Body tone="mute" size="caption">
                    {mark}
                  </Body>
                ) : null}
              </Row>
              <Body size="body" fontWeight="600">
                {amount}
              </Body>
            </Row>
            <Row justifyContent="space-between">
              <Row gap="$2">
                <Body tone="mute" size="caption">
                  {value ?? 'no price'}
                </Body>
                {change ? (
                  <Body tone={up ? 'surge' : down ? 'burn' : 'mute'} size="caption">
                    {change}
                  </Body>
                ) : null}
              </Row>
            </Row>
          </Column>
        </Row>
        <View style={{ position: 'absolute', left: 56, right: 12, bottom: 4, height: 2, borderRadius: 1, backgroundColor: edge }} pointerEvents="none">
          <View style={{ width, height: 2, borderRadius: 1, overflow: 'hidden', opacity: selected ? 1 : 0.75 }}>
            <CurrentFill radius={1} />
          </View>
        </View>
      </Column>
    </Pressable>
  )
}
