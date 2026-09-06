/**
 * The fee-schedule sheet (master plan §8.18): every tier from chain, your
 * score and where it comes from, and the distance to the next tier with a
 * Swap-prefilled key. Reached from the Swap fee line, Settings › Spending
 * and About. Children scroll inside the Sheet; Close sits in its footer
 * (plan B1), so it is reachable at any height.
 */
import { Body, Column, Key, Plate, Row, Sheet, shortAddress } from '@boltvault/ui'
import type { FeeScheduleView, HolderTier } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { formatBolt, formatPct } from '../format'
import { t } from '../i18n'

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
        <Body tone="mute" size="caption">
          {t({ id: 'fee.sheet.body', message: 'Every in-wallet swap pays a fee on what you receive. The more BOLT you hold — in your wallet or deposited as a farm boost — the less you pay. The schedule lives on chain; the wallet reads it live.' })}
        </Body>
        {schedule ? (
          <Plate gap="$1" testID="fee-tiers">
            <Row justifyContent="space-between">
              <Body size="caption" tone={tier?.tier === 0 ? 'arc' : 'mute'}>
                {t({ id: 'fee.tier.base', message: 'Under {n} BOLT-eq', values: { n: formatBolt(schedule.tiers[0]?.minScore ?? '0') } })}
              </Body>
              <Body size="caption" tone={tier?.tier === 0 ? 'arc' : 'ink'}>
                {formatPct(schedule.baseBips)}
              </Body>
            </Row>
            {schedule.tiers.map((x, i) => (
              <Row key={x.minScore} justifyContent="space-between">
                <Body size="caption" tone={tier?.tier === i + 1 ? 'arc' : 'mute'}>
                  {t({ id: 'fee.tier.row', message: 'Tier {t} · {n}+ BOLT-eq', values: { t: i + 1, n: formatBolt(x.minScore) } })}
                </Body>
                <Body size="caption" tone={tier?.tier === i + 1 ? 'arc' : 'ink'}>
                  {formatPct(x.bips)}
                </Body>
              </Row>
            ))}
            {schedule.source === 'fallback' ? (
              <Body tone="mute" size="caption">
                {t({ id: 'fee.sheet.fallback', message: 'The schedule contract did not answer; these are the published defaults and you pay the base rate until it does.' })}
              </Body>
            ) : null}
          </Plate>
        ) : null}
        {tier ? (
          <Plate role="raised" gap="$1" testID="fee-you">
            <Body size="title">{t({ id: 'fee.you', message: 'You: tier {t} · {p}', values: { t: tier.tier, p: formatPct(tier.bips) } })}</Body>
            <Body tone="mute" size="caption">
              {t({ id: 'fee.score', message: '{s} BOLT-eq — {w} in your wallet, {f} deposited in farms, {d} from DYNO', values: { s: formatBolt(tier.score), w: formatBolt(tier.breakdown.wallet), f: formatBolt(tier.breakdown.farm), d: formatBolt(tier.breakdown.dyno) } })}
            </Body>
            {tier.nextTierAt && tier.nextTierBips !== null ? (
              <Column gap="$2">
                <Body tone="ember" size="caption" testID="fee-next">
                  {t({ id: 'fee.next', message: '{n} more BOLT-eq for {p}', values: { n: formatBolt((BigInt(tier.nextTierAt) - BigInt(tier.score)).toString()), p: formatPct(tier.nextTierBips) } })}
                </Body>
                {onGetBolt ? <Key label={t({ id: 'fee.getBolt', message: 'Get BOLT' })} kind="secondary" size="compact" onPress={onGetBolt} testID="fee-get-bolt" /> : null}
              </Column>
            ) : (
              <Body tone="arc" size="caption">
                {t({ id: 'fee.top', message: 'Top tier — the lowest fee there is.' })}
              </Body>
            )}
          </Plate>
        ) : null}
        <Body tone="mute" size="caption" testID="fee-sink">
          {schedule?.sink ? t({ id: 'fee.sink', message: 'Fees go to the fee sink {a}. What it does with them is published in About.', values: { a: shortAddress(schedule.sink) } }) : t({ id: 'fee.sink.none', message: 'The fee sink for this network is not set yet; in-wallet swaps stay off until it is.' })}
        </Body>
      </Column>
    </Sheet>
  )
}
