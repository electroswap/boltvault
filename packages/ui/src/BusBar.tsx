/**
 * BusBar — one holding (master plan §7.5): logo, symbol, amount, value, 24 h
 * change, and a fill equal to its share of the scoped portfolio, painted with
 * the current. 52 px tall, tap selects; never drag.
 */
import { Pressable, View } from 'react-native'
import { ChainMark } from './ChainMark'
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
  /**
   * Mark which chain this holding is on.
   *
   * Only worth showing when the list spans chains — with one chain in scope
   * the answer is the same on every row and the badge is noise. With "All
   * chains" it is the difference between two rows that read identically:
   * USDC on Base and USDC on Arbitrum are not the same money.
   */
  readonly chainBadge?: boolean
  /** `card`: on glass with an edge, for a list over the moving Grid (the Portfolio). */
  readonly variant?: 'bar' | 'card'
  readonly onPress?: () => void
  readonly testID?: string
}

export function BusBar({
  chainId,
  address,
  symbol,
  amount,
  value,
  change,
  share,
  logoUri,
  selected,
  mark,
  chainBadge = false,
  variant = 'bar',
  onPress,
  testID,
}: BusBarProps) {
  const card = variant === 'card'
  const up = change?.startsWith('+')
  const down = change?.startsWith('-') || change?.startsWith('−')
  const width = `${Math.max(0, Math.min(1, share)) * 100}%` as const
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${amount} ${symbol}${value ? `, ${value}` : ''}`}
      testID={testID}
    >
      <Column
        height={card ? 56 : metrics.busBar}
        justifyContent="center"
        paddingHorizontal="$3"
        borderRadius="$recessed"
        borderWidth={1}
        borderColor={selected ? '$arc' : card ? '$edge' : 'transparent'}
        backgroundColor={selected || card ? '$glass' : 'transparent'}
      >
        <Row gap="$3">
          {/* The chain rides on the token's own mark rather than taking a column:
              it qualifies the logo, and a row this size has no width to spare. */}
          <View>
            <TokenAvatar
              chainId={chainId}
              address={address}
              symbol={symbol}
              logoUri={logoUri}
              size={32}
            />
            {chainBadge ? (
              <View style={{ position: 'absolute', right: -3, bottom: -3 }} pointerEvents="none">
                <ChainMark chainId={chainId} size={15} ring />
              </View>
            ) : null}
          </View>
          <Column flex={1} gap={2}>
            <Row justifyContent="space-between">
              <Row gap="$2">
                <Body size="body" fontWeight="700">
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
        <View
          style={{
            position: 'absolute',
            left: 56,
            right: 12,
            bottom: 4,
            height: 2,
            borderRadius: 1,
            backgroundColor: edge,
          }}
          pointerEvents="none"
        >
          <View
            style={{
              width,
              height: 2,
              borderRadius: 1,
              overflow: 'hidden',
              opacity: selected ? 1 : 0.75,
            }}
          >
            <CurrentFill radius={1} />
          </View>
        </View>
      </Column>
    </Pressable>
  )
}
