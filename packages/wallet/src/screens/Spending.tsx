/**
 * Settings › Spending (master plan §8.14): the swap slippage default, exact
 * token approvals, the wallet fee schedule — your tier, every tier and the
 * sink, read-only — and the spend policy of §3.4 point 6: the large-send
 * threshold in token units, and the send allow-list.
 */
import { Body, Column, Icon, Input, Key, Pill, Plate, Row, ScrollView, Toggle, metrics, paint, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { ContactView, HolderTier, Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { formatBolt, formatPct } from '../format'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'
import { FeeScheduleSheet } from './FeeScheduleSheet'

const ETN = 52014
const SLIPPAGES = [10, 50, 100, 300] as const
/**
 * The thresholds offered, as a share of the balance of the token being sent.
 *
 * A share of a balance is an amount in that token's own units — §3.4 point 6
 * is explicit that it must never be a dollar figure, because prices in this
 * wallet are display-only and a feed must not be what decides when the vault
 * is asked to open again.
 */
const THRESHOLDS = [5, 10, 25, 50] as const
const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const ALLOW_LIST_MAX = 64

export function Spending({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const { active } = useWalletState()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tier, setTier] = useState<HolderTier | null>(null)
  const [sheet, setSheet] = useState(false)
  const [contacts, setContacts] = useState<ContactView[]>([])
  const [draft, setDraft] = useState('')
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.settings.get().then(setSettings, () => undefined)
    engine.contacts.list().then(setContacts, () => undefined)
    if (active) engine.holder.tier({ accountId: active.id, chainId: ETN }).then(setTier, () => undefined)
  }, [engine, active])

  const set = (patch: Partial<Settings>): void => {
    engine.settings.set(patch).then(setSettings, () => undefined)
  }

  const allowList = settings?.sendAllowList ?? []
  const percent = settings?.largeSendPercent ?? 10
  const typed = draft.trim().toLowerCase()
  const typedOk = ADDRESS.test(typed) && !allowList.includes(typed) && allowList.length < ALLOW_LIST_MAX

  const addAddress = (address: string): void => {
    const a = address.trim().toLowerCase()
    if (!ADDRESS.test(a) || allowList.includes(a) || allowList.length >= ALLOW_LIST_MAX) return
    set({ sendAllowList: [...allowList, a] })
    setDraft('')
  }
  const removeAddress = (address: string): void => {
    set({ sendAllowList: allowList.filter((a) => a !== address) })
  }
  /** Address-book entries not already listed — typing forty-two characters is not a control. */
  const suggestions = contacts.filter((c) => ADDRESS.test(c.address) && !allowList.includes(c.address.toLowerCase())).slice(0, 6)

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
      <Plate gap="$2" testID="spending-stepups">
        <Body size="title">{t({ id: 'spending.stepups', message: 'Step-ups' })}</Body>
        <Body tone="mute" size="caption">
          {t({ id: 'spending.stepups.body.v3', message: 'A recipient you have never sent to holds the key for ten seconds, with the whole address on screen to check. A large send asks you to unlock again — your face, your fingerprint or your password — before the key opens.' })}
        </Body>
        <Body size="caption" fontWeight="600">
          {t({ id: 'spending.threshold', message: 'Large means more than' })}
        </Body>
        <Row gap="$2" flexWrap="wrap">
          {THRESHOLDS.map((p) => (
            <Pill
              key={p}
              label={t({ id: 'spending.threshold.pill', message: '{p}% of that token', values: { p } })}
              selected={percent === p}
              onPress={() => set({ largeSendPercent: p })}
              testID={`spending-threshold-${p}`}
            />
          ))}
        </Row>
        {/*
          Why this is a share of the balance and not a figure in dollars: §3.4
          point 6 forbids a fiat threshold outright, because every price in
          this wallet is display-only and a feed that is late, wrong, or rate
          limited would then be deciding whether a signature needs a second
          factor. Sending a tenth of your BOLT is a fact about your BOLT.
        */}
        <Body tone="mute" size="caption">
          {t({ id: 'spending.threshold.body', message: 'Measured against how much of that token you hold, never against a price. A quarter of your ETN is a quarter of your ETN whatever the market is doing.' })}
        </Body>
        <Body tone="mute" size="caption">
          {t({ id: 'spending.stepups.limits', message: 'Both are always on for a transfer BoltVault can read. A contract call it cannot decode gets the full review sheet instead, because a pause on a transaction nobody can explain would be a comfort, not a check.' })}
        </Body>
      </Plate>

      {/*
        The allow-list was a stored boolean that nothing anywhere read — the
        one safeguard in Settings the product named and did not perform. The
        switch now gates a real list, and the firewall refuses a transfer to
        anything not on it.
      */}
      <Plate gap="$2" testID="spending-allowlist">
        <Toggle
          value={settings?.sendWhitelist ?? false}
          onChange={(v) => set({ sendWhitelist: v })}
          label={t({ id: 'spending.allow', message: 'Only send to addresses I have listed' })}
          hint={t({ id: 'spending.allow.hint', message: 'Off. With it on, a send to anything not on the list below is refused — there is no way past it in the moment, which is the point. Your own accounts are always allowed.' })}
          testID="spending-allow-toggle"
        />
        {settings?.sendWhitelist ? (
          <>
            {allowList.length === 0 ? (
              <Body tone="ember" size="caption" testID="spending-allow-empty">
                {t({ id: 'spending.allow.empty', message: 'The list is empty, so only your own accounts can be sent to. Add the addresses you use.' })}
              </Body>
            ) : null}
            {allowList.map((a) => {
              const named = contacts.find((c) => c.address.toLowerCase() === a)
              return (
                <Row key={a} gap="$2" alignItems="center" minHeight={44} testID={`spending-allow-${a}`}>
                  <Column flex={1} minWidth={0} alignItems="flex-start">
                    {named ? <Body numberOfLines={1}>{named.label}</Body> : null}
                    <Body tone="mute" size="caption" numberOfLines={1}>
                      {shortAddress(a)}
                    </Body>
                  </Column>
                  <Key label={t({ id: 'spending.allow.remove', message: 'Remove' })} kind="secondary" size="compact" onPress={() => removeAddress(a)} testID={`spending-allow-remove-${a}`} />
                </Row>
              )
            })}
            <Input value={draft} onChange={setDraft} placeholder="0x…" autoCapitalize="none" label={t({ id: 'spending.allow.add.label', message: 'Add an address' })} testID="spending-allow-input" />
            <Key label={t({ id: 'spending.allow.add', message: 'Add' })} kind="secondary" size="compact" disabled={!typedOk} onPress={() => addAddress(draft)} testID="spending-allow-add" />
            {suggestions.length > 0 ? (
              <Column gap="$1">
                <Body tone="mute" size="caption">
                  {t({ id: 'spending.allow.book', message: 'From your address book' })}
                </Body>
                <Row gap="$2" flexWrap="wrap">
                  {suggestions.map((c) => (
                    <Pill key={c.id} label={c.label} size="sm" onPress={() => addAddress(c.address)} testID={`spending-allow-book-${c.id}`} />
                  ))}
                </Row>
              </Column>
            ) : null}
            <Body tone="mute" size="caption">
              {t({ id: 'spending.allow.body', message: 'This covers sends of coins, tokens and collectibles. Swapping, bridging and anything a site asks you to sign go through the usual review instead — a list of people you pay says nothing about a contract.' })}
            </Body>
          </>
        ) : null}
      </Plate>

      <FeeScheduleSheet open={sheet} onClose={() => setSheet(false)} accountId={active?.id ?? null} chainId={ETN} />
    </ScrollView>
  )
}
