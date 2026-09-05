/**
 * The share card (master plan §7.13): the account's Field signature, its
 * name and its holder tier — never a balance. The thing people show someone.
 */
import { Signature } from './Signature'
import { Body, Column, Plate, Row } from './primitives'
import { paint } from './tokens'

export interface ShareCardProps {
  readonly address: string
  readonly name: string
  readonly tier: number
  readonly width?: number
  readonly testID?: string
}

export function ShareCard({ address, name, tier, width = 320, testID }: ShareCardProps) {
  return (
    <Plate role="raised" width={width} padding="$5" gap="$4" testID={testID}>
      <Row gap="$4" alignItems="center">
        <Signature address={address} size={Math.round(width * 0.28)} />
        <Column gap={4} flexShrink={1}>
          <Body size="title" numberOfLines={1}>
            {name}
          </Body>
          <Body tone="mute" size="caption">
            {tier > 0 ? `Tier ${tier} · BOLT holder` : 'BoltVault'}
          </Body>
        </Column>
      </Row>
      <Row justifyContent="space-between" alignItems="center">
        <Body tone="mute" size="caption">
          Electroneum · ElectroSwap
        </Body>
        <Body size="caption" color={paint.arc}>
          boltvault
        </Body>
      </Row>
    </Plate>
  )
}
