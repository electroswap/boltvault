/**
 * A farm in a list (plan C5, owner item F2): the pair's two avatars, the
 * name, V2/V3, "Closed" when it no longer takes deposits; a bare stat strip
 * — APY (the third-party add-on as its caption), TVL, your multiplier or
 * "Deposit to start" — and, when there is DYNO waiting, a surge line with
 * a Collect pill that runs the collect in place.
 */
import { Body, Column, Key, Pill, Plate, Row, StatStrip, TokenAvatar } from '@boltvault/ui'
import type { FarmView } from '@boltvault/engine'
import { formatAmount, formatCompactFiat } from '../../format'
import { t } from '../../i18n'

export function PairAvatars({ farm, size = 28 }: { farm: FarmView; size?: number }) {
  return (
    <Row width={size * 1.7} height={size} position="relative">
      <Column position="absolute" left={0} top={0}>
        <TokenAvatar
          chainId={farm.chainId}
          address={farm.token0}
          symbol={farm.symbol0}
          size={size}
        />
      </Column>
      <Column position="absolute" left={size * 0.7} top={0}>
        <TokenAvatar
          chainId={farm.chainId}
          address={farm.token1}
          symbol={farm.symbol1}
          size={size}
        />
      </Column>
    </Row>
  )
}

export function FarmCard({
  farm,
  onPress,
  onCollect,
  busy = false,
}: {
  farm: FarmView
  onPress: () => void
  onCollect?: () => void
  busy?: boolean
}) {
  const p = farm.position
  const pending = p ? BigInt(p.pendingRewards) : 0n
  // What this farm pays you: the base rate times your combined multiplier
  // (duration x BOLT, both stored scaled by 10,000). No position, no answer.
  const combined = p ? (p.durationMultiplier / 10_000) * (p.boltMultiplier / 10_000) : null
  const yourApy = farm.baseApy !== null && combined !== null ? farm.baseApy * combined : null
  return (
    <Plate role="card" gap="$2" onPress={onPress} cursor="pointer" testID={`farm-card-${farm.id}`}>
      <Row gap="$2" alignItems="center">
        <PairAvatars farm={farm} />
        <Body fontWeight="600" numberOfLines={1} flexShrink={1}>
          {farm.name || `${farm.symbol0}/${farm.symbol1}`}
        </Body>
        {/* Owner: the version sits in the top right, the same on every list. */}
        <Column flex={1} minWidth={0} />
        {!farm.active ? (
          <Pill label={t({ id: 'farm.closed', message: 'Closed' })} tone="ember" size="xs" />
        ) : null}
        <Pill label={farm.version === 3 ? 'V3' : 'V2'} size="xs" />
      </Row>
      {/* Combined multiplier: duration and BOLT are both scaled by 10,000. */}
      <StatStrip
        bare
        small
        cells={[
          {
            label: t({ id: 'farm.stat.apy.base', message: 'Base APY' }),
            value: farm.baseApy !== null ? `${farm.baseApy.toFixed(1)}%` : '—',
            ...(farm.thirdPartyApy !== null && farm.thirdParty
              ? {
                  caption: t({
                    id: 'farm.apy3',
                    message: '+{a}% {s}',
                    values: { a: farm.thirdPartyApy.toFixed(1), s: farm.thirdParty.symbol },
                  }),
                }
              : {}),
          },
          // Owner: show what the farm pays, then what it pays *you* — the base
          // rate times your combined multiplier, with the multipliers that made
          // it as the caption so the number can be checked at a glance.
          {
            label: t({ id: 'farm.stat.apy.yours', message: 'Your APY' }),
            value: yourApy !== null ? `${yourApy.toFixed(1)}%` : '—',
            ...(p
              ? {
                  tone: 'arc' as const,
                  caption: t({
                    id: 'farm.stat.combined',
                    message: '{d}× · BOLT {b}×',
                    values: {
                      d: (p.durationMultiplier / 10_000).toFixed(2),
                      b: (p.boltMultiplier / 10_000).toFixed(2),
                    },
                  }),
                }
              : { caption: farm.active ? t({ id: 'farm.stat.start', message: 'None yet' }) : '' }),
          },
          {
            label: t({ id: 'farm.stat.tvl', message: 'TVL' }),
            value: farm.tvlUsd !== null ? formatCompactFiat(farm.tvlUsd, 'USD') : '—',
          },
        ]}
      />
      {p && pending > 0n ? (
        <Row justifyContent="space-between" alignItems="center">
          <Body tone="surge" size="caption" testID={`farm-card-${farm.id}-pending`}>
            {t({
              id: 'farm.card.collect',
              message: '{d} DYNO to collect',
              values: { d: formatAmount(p.pendingRewards, 18) },
            })}
          </Body>
          {onCollect ? (
            <Key
              label={t({ id: 'farm.collect', message: 'Collect' })}
              kind="secondary"
              size="compact"
              disabled={busy}
              onPress={onCollect}
              testID={`farm-card-${farm.id}-collect`}
            />
          ) : null}
        </Row>
      ) : null}
    </Plate>
  )
}
