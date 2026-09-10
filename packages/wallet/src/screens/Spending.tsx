/**
 * Settings › Spending (master plan §8.14): the swap slippage default, exact
 * token approvals, and the wallet fee schedule — your tier, every tier and
 * the sink, read-only. Step-ups and the send allow-list keep their rows.
 */
import { Body, Column, Icon, Pill, Plate, Row, ScrollView, Toggle, metrics, paint, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { HolderTier, Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { formatBolt, formatPct } from '../format'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'
import { FeeScheduleSheet } from './FeeScheduleSheet'

const ETN = 52014
const SLIPPAGES = [10, 50, 100, 300] as const

export function Spending({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const { active } = useWalletState()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tier, setTier] = useState<HolderTier | null>(null)
  const [sheet, setSheet] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.settings.get().then(setSettings, () => undefined)
    if (active) engine.holder.tier({ accountId: active.id, chainId: ETN }).then(setTier, () => undefined)
  }, [engine, active])

  const set = (patch: Partial<Settings>): void => {
    engine.settings.set(patch).then(setSettings, () => undefined)
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="spending">
      <PageHeader title={t({ id: 'settings.spending', message: 'Spending' })} />

      <Plate gap="$2" testID="spending-slippage">
        <Body size="title">{t({ id: 'spending.slippage', message: 'Swap slippage' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'spending.slippage.body', message: 'How far the price may move between your quote and the block that fills it before the swap gives up.' })}
        </Body>
        <Row gap="$2" flexWrap="wrap">
          {SLIPPAGES.map((s) => (
            <Pill key={s} label={formatPct(s)} selected={settings?.slippageBips === s} onPress={() => set({ slippageBips: s })} testID={`spending-slippage-${s}`} />
          ))}
        </Row>
      </Plate>

      <Plate gap="$2" testID="spending-exact">
        <Toggle value={settings?.exactApprovals ?? true} onChange={(v) => set({ exactApprovals: v })} label={t({ id: 'spending.exact', message: 'Exact token approvals' })} hint={t({ id: 'spending.exact.hint', message: 'Allow Permit2 only the amount of each swap. Safer; one more transaction per swap of that token.' })} testID="spending-exact-toggle" />
      </Plate>

      <Plate role="raised" gap="$2" onPress={() => setSheet(true)} cursor="pointer" testID="spending-fee">
        <Row justifyContent="space-between" alignItems="center">
          <Body size="title">{t({ id: 'spending.fee', message: 'Wallet fee schedule' })}</Body>
          <Icon name="chevronRight" size={18} color={paint.mute} />
        </Row>
        {tier ? (
          <Column gap={2}>
            <Body tone="arc" size="caption" testID="spending-tier">
              {t({ id: 'spending.tier.v2', message: 'Your tier: {name} · {p} on swaps', values: { name: tier.name, p: formatPct(tier.bips) } })}
            </Body>
            <Body tone="mute" size="caption">
              {t({ id: 'spending.score', message: '{s} BOLT-eq counted', values: { s: formatBolt(tier.score) } })}
            </Body>
            <Body tone="mute" size="caption">
              {tier.sink ? t({ id: 'spending.recipient', message: 'Fees go to {a}', values: { a: shortAddress(tier.sink) } }) : t({ id: 'spending.recipient.none', message: 'In-wallet swaps are off on this network' })}
            </Body>
          </Column>
        ) : null}
      </Plate>

      <Plate gap="$1" testID="spending-stepups">
        <Body size="title">{t({ id: 'spending.stepups', message: 'Step-ups' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'spending.stepups.body', message: 'A first-time recipient pauses for a second look; a send above a tenth of a token balance asks you to unlock again. Both are always on.' })}
        </Body>
      </Plate>

      <FeeScheduleSheet open={sheet} onClose={() => setSheet(false)} accountId={active?.id ?? null} chainId={ETN} />
    </ScrollView>
  )
}
