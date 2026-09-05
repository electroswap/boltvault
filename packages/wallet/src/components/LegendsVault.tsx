/**
 * The Legends vault plate (master plan §8.10, §7.12): the account's pieces
 * as lit medallions, the glass vessel in which claimable ETN rises between
 * claims, the lifetime paid to holders, the share of the next fee, and the
 * keys — Activate dividends once, then Claim. Copy is "marketplace fees
 * shared with holders", never yield on an investment.
 */
import { Body, Column, Key, Plate, Row, Vessel, Signature } from '@boltvault/ui'
import type { LegendsStatus } from '@boltvault/engine'
import { formatRaw } from '../format'
import { t } from '../i18n'

export interface LegendsVaultProps {
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

export function LegendsVault({ status, compact = false, busy = false, onActivate, onClaim, onOpen, onPiece, reducedMotion = false, testID = 'legends-vault' }: LegendsVaultProps) {
  const claimable = BigInt(status.claimableWei)
  const canClaim = claimable > 0n && status.registeredTokenIds.length > 0
  const needsActivation = status.unregisteredTokenIds.length > 0
  return (
    <Plate role="raised" gap="$3" testID={testID} {...(onOpen ? { onPress: onOpen, cursor: 'pointer' as const } : {})}>
      <Row justifyContent="space-between" alignItems="center">
        <Body size="title">{t({ id: 'legends.title', message: 'Electric Legends dividends' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'legends.count', message: '{n} piece{s}', values: { n: status.ownedTokenIds.length, s: status.ownedTokenIds.length === 1 ? '' : 's' } })}
        </Body>
      </Row>
      <Row gap="$4" alignItems="center">
        <Vessel level={status.vesselLevel} width={compact ? 56 : 72} height={compact ? 96 : 120} reducedMotion={reducedMotion} testID={`${testID}-vessel`} />
        <Column flex={1} gap="$1">
          <Body size="title" testID={`${testID}-claimable`}>
            {t({ id: 'legends.claimable', message: '{a} ETN to claim', values: { a: formatRaw(status.claimableWei, 18) } })}
          </Body>
          <Body tone="mute" size="caption">
            {t({ id: 'legends.body', message: 'Marketplace fees shared with holders. Fees keep flowing in; the vessel fills until you claim.' })}
          </Body>
          <Body tone="mute" size="caption" testID={`${testID}-lifetime`}>
            {t({ id: 'legends.lifetime', message: 'Lifetime paid to Legends holders: {a} ETN', values: { a: formatRaw(status.lifetimePaidWei, 18) } })}
          </Body>
          {status.activeTokenCount > 0 ? (
            <Body tone="mute" size="caption">
              {t({ id: 'legends.share', message: 'Your share of the next fee: {p}%', values: { p: (status.shareOfNextFee * 100).toFixed(3) } })}
            </Body>
          ) : null}
        </Column>
      </Row>
      {!compact && status.ownedTokenIds.length > 0 ? (
        <Row gap="$2" flexWrap="wrap" testID={`${testID}-medallions`}>
          {status.ownedTokenIds.slice(0, 12).map((id) => (
            <Column key={id} alignItems="center" gap={2} onPress={onPiece ? () => onPiece(id) : undefined} cursor={onPiece ? 'pointer' : undefined} minWidth={44} minHeight={44} justifyContent="center">
              <Signature address={`0x${id.padStart(40, '0')}`} size={28} />
              <Body tone={status.registeredTokenIds.includes(id) ? 'arc' : 'mute'} size="caption">
                #{id}
              </Body>
            </Column>
          ))}
        </Row>
      ) : null}
      <Row gap="$2" flexWrap="wrap">
        {needsActivation && onActivate ? <Key label={t({ id: 'legends.activate', message: 'Activate dividends' })} kind="secondary" disabled={busy} onPress={onActivate} testID={`${testID}-activate`} /> : null}
        {onClaim ? <Key label={t({ id: 'legends.claim', message: 'Claim' })} disabled={busy || !canClaim} onPress={onClaim} testID={`${testID}-claim`} /> : null}
      </Row>
      {needsActivation ? (
        <Body tone="ember" size="caption">
          {t({ id: 'legends.activate.body', message: '{n} of your pieces are not earning yet — activate them once and they share every fee from then on.', values: { n: status.unregisteredTokenIds.length } })}
        </Body>
      ) : null}
    </Plate>
  )
}
