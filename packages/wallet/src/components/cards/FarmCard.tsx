/**
 * A farm in a list (plan C5, owner item F2): the pair's two avatars, the
 * name, V2/V3, "Closed" when it no longer takes deposits; a bare stat strip
 * — APY (the third-party add-on as its caption), TVL, your multiplier or
 * "Deposit to start" — and, when there is DYNO waiting, a surge line with
 * a Collect pill that runs the collect in place.
 */
import { Body, Column, Pill, Plate, Row, StatStrip, TokenAvatar } from '@boltvault/ui'
import type { FarmView } from '@boltvault/engine'
import { formatCompactFiat, formatRaw } from '../../format'
import { t } from '../../i18n'

export function PairAvatars({ farm, size = 28 }: { farm: FarmView; size?: number }) {
  return (
    <Row width={size * 1.7} height={size} position="relative">
      <Column position="absolute" left={0} top={0}>
        <TokenAvatar chainId={farm.chainId} address={farm.token0} logoUri={null} size={size} />
      </Column>
      <Column position="absolute" left={size * 0.7} top={0}>
        <TokenAvatar chainId={farm.chainId} address={farm.token1} logoUri={null} size={size} />
      </Column>
    </Row>
  )
}

export function FarmCard({ farm, onPress, onCollect, busy = false }: { farm: FarmView; onPress: () => void; onCollect?: () => void; busy?: boolean }) {
  const p = farm.position
  const pending = p ? BigInt(p.pendingRewards) : 0n
  return (
    <Plate role="card" gap="$2" onPress={onPress} cursor="pointer" testID={`farm-card-${farm.id}`}>
      <Row gap="$2" alignItems="center">
        <PairAvatars farm={farm} />
        <Body fontWeight="600" numberOfLines={1} flexShrink={1}>
          {farm.name || `${farm.symbol0}/${farm.symbol1}`}
        </Body>
        <Pill label={farm.version === 3 ? 'V3' : 'V2'} size="sm" />
        {!farm.active ? <Pill label={t({ id: 'farm.closed', message: 'Closed' })} tone="ember" size="sm" /> : null}
      </Row>
      <StatStrip
        bare
        small
        cells={[
          { label: t({ id: 'farm.stat.apy', message: 'APY' }), value: farm.baseApy !== null ? `${farm.baseApy.toFixed(1)}%` : '—', ...(farm.thirdPartyApy !== null && farm.thirdParty ? { caption: t({ id: 'farm.apy3', message: '+{a}% {s}', values: { a: farm.thirdPartyApy.toFixed(1), s: farm.thirdParty.symbol } }) } : {}) },
          { label: t({ id: 'farm.stat.tvl', message: 'TVL' }), value: farm.tvlUsd !== null ? formatCompactFiat(farm.tvlUsd, 'USD') : '—' },
          { label: t({ id: 'farm.stat.multiplier', message: 'Multiplier' }), value: p ? `${(p.durationMultiplier / 10_000).toFixed(2)}×` : '—', ...(p ? { tone: 'arc' as const, caption: t({ id: 'farm.stat.bolt', message: 'BOLT {m}×', values: { m: (p.boltMultiplier / 10_000).toFixed(2) } }) } : { caption: farm.active ? t({ id: 'farm.stat.start', message: 'None yet' }) : '' }) },
        ]}
      />
      {p && pending > 0n ? (
        <Row justifyContent="space-between" alignItems="center">
          <Body tone="surge" size="caption" testID={`farm-card-${farm.id}-pending`}>
            {t({ id: 'farm.card.collect', message: '{d} DYNO to collect', values: { d: formatRaw(p.pendingRewards, 18) } })}
          </Body>
          {onCollect ? <Pill label={t({ id: 'farm.collect', message: 'Collect' })} tone="surge" size="sm" disabled={busy} onPress={onCollect} testID={`farm-card-${farm.id}-collect`} /> : null}
        </Row>
      ) : null}
    </Plate>
  )
}
