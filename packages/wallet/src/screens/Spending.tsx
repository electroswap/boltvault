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

      {/*
        Getting a preview means posting the signing address and the full
        calldata of every dApp transaction to ElectroSwap's trace node, before
        anything is signed. That is what it costs to see what a transaction
        moves on a chain whose public RPCs cannot trace — worth paying by
        default, not worth charging silently.
      */}
      <Plate gap="$2" testID="spending-preview">
        <Toggle
          value={(settings?.txPreview ?? 'api') === 'api'}
          onChange={(v) => set({ txPreview: v ? 'api' : 'off' })}
          label={t({ id: 'spending.preview', message: 'Preview what a transaction moves' })}
          hint={t({ id: 'spending.preview.hint', message: 'Electroneum’s public nodes cannot simulate, so the preview is done by ElectroSwap: your address and the transaction’s data are sent there before you sign. Turn this off to keep them on your device — you will still be warned when a transaction would fail.' })}
          testID="spending-preview-toggle"
        />
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

      {/*
        What this plate promised and what the product did were two different
        things: the first-time rule arrived as `info`, which is no pause and no
        visible warning, and the large-send rule only greyed a button for a
        second and a half — nothing ever asked the vault to open again. The
        signing sheet performs both now, and this says what it performs,
        including the condition neither can escape: the firewall has to be able
        to read the transaction as a transfer before it can know either thing.
      */}
      <Plate gap="$1" testID="spending-stepups">
        <Body size="title">{t({ id: 'spending.stepups', message: 'Step-ups' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'spending.stepups.body.v2', message: 'A recipient you have never sent to holds the key for ten seconds, with the whole address on screen to check. A send above a tenth of your balance of that token asks you to unlock again — your face, your fingerprint or your password — before the key opens.' })}
        </Body>
        <Body tone="mute" size="caption">
          {t({ id: 'spending.stepups.limits', message: 'Both are always on for a transfer BoltVault can read. A contract call it cannot decode gets the full review sheet instead, because a pause on a transaction nobody can explain would be a comfort, not a check.' })}
        </Body>
      </Plate>

      <FeeScheduleSheet open={sheet} onClose={() => setSheet(false)} accountId={active?.id ?? null} chainId={ETN} />
    </ScrollView>
  )
}
