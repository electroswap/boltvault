/**
 * Electric Legends dividends (master plan §8.10; plan C3, owner item N7):
 * what there is to claim as a readout, how much of your collection is
 * earning as a bar of the current, the lifetime paid and your share as a
 * stat strip, your pieces as medallions, and the two keys — Activate once,
 * then Claim. Copy is "marketplace fees shared with holders", never yield.
 */
import { Body, Column, CurrentFill, Key, Plate, Pressable, Readout, Row, ScrollView, Signature, StatStrip } from '@boltvault/ui'
import type { LegendsStatus } from '@boltvault/engine'
import { formatRaw } from '../format'
import { t } from '../i18n'

export interface DividendsCardProps {
  readonly status: LegendsStatus
  readonly compact?: boolean
  readonly busy?: boolean
  readonly onActivate?: () => void
  readonly onClaim?: () => void
  readonly onOpen?: () => void
  readonly onPiece?: (tokenId: string) => void
  readonly reducedMotion?: boolean
  readonly testID?: string
}

export function DividendsCard({ status, compact = false, busy = false, onActivate, onClaim, onOpen, onPiece, testID = 'dividends' }: DividendsCardProps) {
  const claimable = BigInt(status.claimableWei)
  const owned = status.ownedTokenIds.length
  const earning = status.registeredTokenIds.length
  const canClaim = claimable > 0n && earning > 0
  const needsActivation = status.unregisteredTokenIds.length > 0
  const share = owned > 0 ? earning / owned : 0
  const medallions = status.ownedTokenIds.slice(0, compact ? 6 : 24)
  const more = owned - medallions.length
  return (
    <Plate role="raised" gap="$3" testID={testID} {...(onOpen ? { onPress: onOpen, cursor: 'pointer' as const } : {})}>
      <Row justifyContent="space-between" alignItems="center">
        <Body fontWeight="600">{t({ id: 'legends.title', message: 'Electric Legends dividends' })}</Body>
        <Body tone="mute" size="caption">
          {owned === 1 ? t({ id: 'legends.count.one', message: '1 piece' }) : t({ id: 'legends.count.many', message: '{n} pieces', values: { n: owned } })}
        </Body>
      </Row>
      <Row alignItems="flex-end" gap="$2">
        <Readout hero={!compact} testID={`${testID}-claimable`}>
          {formatRaw(status.claimableWei, 18)}
        </Readout>
        <Body tone="mute" size="caption" marginBottom={compact ? 2 : 6}>
          {t({ id: 'legends.toclaim', message: 'ETN to claim' })}
        </Body>
      </Row>
      {/* The earning bar: how much of your collection shares in every fee. */}
      <Column gap={4} testID={`${testID}-earning`}>
        <Column height={6} borderRadius={3} backgroundColor="rgba(122, 140, 255, 0.16)" overflow="hidden">
          <Column width={`${Math.round(share * 100)}%`} height={6} overflow="hidden" position="relative">
            <CurrentFill />
          </Column>
        </Column>
        <Body tone={needsActivation ? 'ember' : 'mute'} size="caption">
          {owned === 0 ? t({ id: 'legends.earning.none', message: 'Hold a Legend and it shares a third of every marketplace fee.' }) : earning === owned ? t({ id: 'legends.earning.all', message: 'Every piece is earning.' }) : t({ id: 'legends.earning.some', message: '{e} of {n} pieces earning — activate the rest once and they share every fee from then on.', values: { e: earning, n: owned } })}
        </Body>
      </Column>
      {!compact ? (
        <StatStrip
          bare
          small
          cells={[
            { label: t({ id: 'legends.stat.lifetime', message: 'Lifetime paid' }), value: `${formatRaw(status.lifetimePaidWei, 18)} ETN`, caption: t({ id: 'legends.stat.lifetime.caption', message: 'to all holders' }) },
            { label: t({ id: 'legends.stat.share', message: 'Your share' }), value: status.activeTokenCount > 0 ? `${(status.shareOfNextFee * 100).toFixed(3)}%` : '—', caption: t({ id: 'legends.stat.share.caption', message: 'of each fee' }) },
            { label: t({ id: 'legends.stat.active', message: 'Earning' }), value: String(status.activeTokenCount), caption: t({ id: 'legends.stat.active.caption', message: 'Legends in all' }) },
          ]}
          testID={`${testID}-stats`}
        />
      ) : null}
      {!compact && medallions.length > 0 ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} testID={`${testID}-medallions`}>
          {medallions.map((id) => (
            <Pressable key={id} onPress={onPiece ? () => onPiece(id) : undefined} accessibilityRole="button" accessibilityLabel={`#${id}`} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
              <Column alignItems="center" gap={2}>
                <Signature address={`0x${id.padStart(40, '0')}`} size={30} />
                <Body tone={status.registeredTokenIds.includes(id) ? 'arc' : 'mute'} size="caption">
                  #{id}
                </Body>
              </Column>
            </Pressable>
          ))}
          {more > 0 ? (
            <Column minWidth={44} minHeight={44} alignItems="center" justifyContent="center">
              <Body tone="mute" size="caption">
                +{more}
              </Body>
            </Column>
          ) : null}
        </ScrollView>
      ) : null}
      {onClaim || (needsActivation && onActivate) ? (
        <Row gap="$2">
          {onClaim ? (
            <Column flex={1}>
              <Key label={t({ id: 'legends.claim', message: 'Claim' })} size="compact" disabled={busy || !canClaim} onPress={onClaim} testID={`${testID}-claim`} />
            </Column>
          ) : null}
          {needsActivation && onActivate ? (
            <Column flex={1}>
              <Key label={t({ id: 'legends.activate', message: 'Activate dividends' })} kind="secondary" size="compact" disabled={busy} onPress={onActivate} testID={`${testID}-activate`} />
            </Column>
          ) : null}
        </Row>
      ) : null}
    </Plate>
  )
}
