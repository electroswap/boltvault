/**
 * The fee-schedule sheet (master plan §8.18): what you pay to swap in the
 * wallet, where you are on the ladder, and what the next rung costs.
 *
 * Reached from the tier entry in Home's rotor, the Swap fee line, Settings ›
 * Spending and About. Children scroll inside the Sheet; Close sits in its
 * footer (plan B1), so it is reachable at any height.
 *
 * Two things changed when the fee stopped being contracts. There is no sink:
 * `PAY_PORTION` sends the fee to an address in the build, so this sheet names
 * that address rather than explaining a contract that no longer exists, and a
 * network with no address configured says in-wallet swap is off rather than
 * "the sink is not set yet". And your own standing comes first — it used to sit
 * under the table as "You: tier 1", which is the answer to a question nobody
 * asked before they had read the table. Now it opens the sheet, with a gauge:
 * a rung you can name, how far you are into it, and what the next one saves.
 */
import { Body, Column, Gauge, Key, Plate, Row, Sheet, StatStrip, shortAddress } from '@boltvault/ui'
import type { FeeScheduleView, HolderTier } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { formatBolt, formatBoltPart, formatPct } from '../format'
import { t } from '../i18n'

/**
 * How far into the current rung this score is, 0..1.
 *
 * Measured from the rung you are standing on, not from zero: a Turbine four
 * fifths of the way to Reactor should see a bar four fifths full, not one that
 * has been pinned near the end since the day they passed 680,000. At the top
 * there is nothing left to climb, so it is full.
 */
function progress(schedule: FeeScheduleView, tier: HolderTier): number {
  if (tier.nextTierAt === null) return 1
  const floor = tier.tier > 0 ? BigInt(schedule.tiers[tier.tier - 1]?.minScore ?? '0') : 0n
  const ceiling = BigInt(tier.nextTierAt)
  const span = ceiling - floor
  if (span <= 0n) return 0
  const into = BigInt(tier.score) - floor
  if (into <= 0n) return 0
  if (into >= span) return 1
  // Basis points rather than Number(bigint): a score is 18 decimals and the
  // division has to happen before it meets a float.
  return Number((into * 10_000n) / span) / 10_000
}

export function FeeScheduleSheet({ open, onClose, accountId, chainId, onGetBolt, reducedMotion = false }: { open: boolean; onClose: () => void; accountId: string | null; chainId: number; onGetBolt?: () => void; reducedMotion?: boolean }) {
  const engine = useEngine()
  const [schedule, setSchedule] = useState<FeeScheduleView | null>(null)
  const [tier, setTier] = useState<HolderTier | null>(null)
  useEffect(() => {
    if (!open) return
    let alive = true
    engine.holder.schedule({ chainId }).then((s) => alive && setSchedule(s), () => undefined)
    if (accountId) engine.holder.tier({ accountId, chainId }).then((x) => alive && setTier(x), () => undefined)
    return () => {
      alive = false
    }
  }, [engine, open, accountId, chainId])
  return (
    <Sheet open={open} onClose={onClose} title={t({ id: 'fee.sheet.title', message: 'Wallet fee schedule' })} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'close', message: 'Close' })} kind="secondary" size="compact" onPress={onClose} testID="fee-close" />} testID="fee-sheet">
      <Column gap="$3">
        {/* Your standing, first: the rung, the fee, the climb. */}
        {tier && schedule ? (
          <Plate role="raised" gap="$2" testID="fee-you">
            <Row justifyContent="space-between" alignItems="baseline" gap="$2">
              <Body size="title">{t({ id: 'fee.you.v2', message: 'Your tier' })}</Body>
              <Body size="title" tone="ember" testID="fee-you-name">
                {t({ id: 'fee.you.rung', message: '{name} · {p}', values: { name: tier.name, p: formatPct(tier.bips) } })}
              </Body>
            </Row>

            {tier.nextTierAt && tier.nextTierName && tier.nextTierBips !== null ? (
              <Column gap="$2">
                <Gauge
                  value={progress(schedule, tier)}
                  from={t({ id: 'fee.gauge.here', message: '{s} BOLT-eq', values: { s: formatBolt(tier.score) } })}
                  to={t({ id: 'fee.gauge.next', message: '{name} at {s}', values: { name: tier.nextTierName, s: formatBolt(tier.nextTierAt) } })}
                  testID="fee-gauge"
                />
                <Body tone="ember" size="caption" testID="fee-next">
                  {t({ id: 'fee.next.v2', message: '{n} more BOLT-eq and every swap costs {p} instead of {c}.', values: { n: formatBolt((BigInt(tier.nextTierAt) - BigInt(tier.score)).toString()), p: formatPct(tier.nextTierBips), c: formatPct(tier.bips) } })}
                </Body>
                {onGetBolt ? <Key label={t({ id: 'fee.getBolt', message: 'Get BOLT' })} kind="secondary" size="compact" onPress={onGetBolt} testID="fee-get-bolt" /> : null}
              </Column>
            ) : (
              // At the top the bar is full and the right-hand label is the news;
              // it does not also need a sentence of its own under the gauge.
              <Gauge value={1} from={t({ id: 'fee.gauge.here', message: '{s} BOLT-eq', values: { s: formatBolt(tier.score) } })} to={t({ id: 'fee.gauge.top', message: 'Top tier · lowest fee' })} testID="fee-gauge" />
            )}

            {/*
              Where the score came from, as two numbers rather than a sentence.

              It was one mute paragraph running three lines — "{w} BOLT in your
              wallet and {d} BOLT-eq from DYNO. One DYNO counts as…" — which is
              the right information read out in the worst order: the two figures
              that add up to the score buried mid-sentence, and no way to see at
              a glance which half is doing the work. A strip puts them side by
              side under their own labels, and the conversion rate becomes the
              footnote it always was.
            */}
            <StatStrip
              small
              columns={2}
              cells={[
                { label: t({ id: 'fee.from.wallet', message: 'In your wallet' }), value: t({ id: 'fee.from.wallet.v', message: '{n} BOLT', values: { n: formatBoltPart(tier.breakdown.wallet) } }), testID: 'fee-from-wallet' },
                { label: t({ id: 'fee.from.dyno', message: 'From DYNO' }), value: t({ id: 'fee.from.dyno.v', message: '{n} BOLT-eq', values: { n: formatBoltPart(tier.breakdown.dyno) } }), testID: 'fee-from-dyno' },
              ]}
              testID="fee-breakdown"
            />
            <Body tone="mute" size="caption" fontSize={11} lineHeight={14} numberOfLines={1}>
              {schedule.dynoWeightSource === 'average'
                ? t({ id: 'fee.weight.measured.v2', message: '1 DYNO = {n} BOLT · seven-day average', values: { n: formatBolt(schedule.dynoWeight) } })
                : t({ id: 'fee.weight.fixed', message: '1 DYNO = {n} BOLT', values: { n: formatBolt(schedule.dynoWeight) } })}
            </Body>
          </Plate>
        ) : null}

        {/* The whole ladder, with your rung lit. */}
        {schedule ? (
          <Plate gap="$1" testID="fee-tiers">
            <Row justifyContent="space-between">
              <Body size="caption" fontWeight={tier?.tier === 0 ? '700' : '400'} tone={tier?.tier === 0 ? 'arc' : 'mute'}>
                {t({ id: 'fee.tier.base.named', message: '{name} · under {n} BOLT-eq', values: { name: schedule.baseName, n: formatBolt(schedule.tiers[0]?.minScore ?? '0') } })}
              </Body>
              <Body size="caption" tone={tier?.tier === 0 ? 'arc' : 'ink'}>
                {formatPct(schedule.baseBips)}
              </Body>
            </Row>
            {schedule.tiers.map((x, i) => (
              <Row key={x.minScore} justifyContent="space-between">
                <Body size="caption" fontWeight={tier?.tier === i + 1 ? '700' : '400'} tone={tier?.tier === i + 1 ? 'arc' : 'mute'}>
                  {t({ id: 'fee.tier.row.named', message: '{name} · {n}+ BOLT-eq', values: { name: x.name, n: formatBolt(x.minScore) } })}
                </Body>
                <Body size="caption" tone={tier?.tier === i + 1 ? 'arc' : 'ink'}>
                  {formatPct(x.bips)}
                </Body>
              </Row>
            ))}
            {schedule.source === 'fallback' ? (
              <Body tone="mute" size="caption">
                {t({ id: 'fee.sheet.fallback.named', message: 'This network has no fee ladder configured; these are the published defaults.' })}
              </Body>
            ) : null}
          </Plate>
        ) : null}

        {/*
          The explanation goes under the thing it explains. It used to open the
          sheet, which put four lines of mechanism between the title and the one
          fact the reader came for — what they pay, and what the next rung costs.
        */}
        <Body tone="mute" size="caption">
          {t({ id: 'fee.sheet.body.v2', message: 'Every in-wallet swap pays a fee on what you receive. The more BOLT and DYNO you hold, the less you pay — five rungs, from Static to Reactor. The ladder ships inside the wallet, so it is the same at signing time as it is here.' })}
        </Body>

        <Body tone="mute" size="caption" testID="fee-recipient">
          {schedule?.sink
            ? t({ id: 'fee.recipient', message: 'The fee goes to {a}, in the same transaction as the swap. Every payment is on the explorer.', values: { a: shortAddress(schedule.sink) } })
            : t({ id: 'fee.recipient.none', message: 'In-wallet swaps are off on this network — no fee address is set for it in this build.' })}
        </Body>
      </Column>
    </Sheet>
  )
}
