/**
 * Send (master plan §8.4; craft pass 2026-09-06): the chain first, then To,
 * then one amount well — the token as a pill that opens the picker, what
 * the amount is worth, what you hold, MAX — and the Review key pinned under
 * the scroll region. The recipient plate latches once it resolves (address
 * or `.etn` name); the review is the same Approval sheet every signature
 * uses, reached through `internal:send`, so poison, first-time and
 * large-send rules run before the verb arms. The receipt lands in Activity
 * and the Discharge plays here.
 */
import { Body, Column, Discharge, Icon, Input, Key, Pill, Plate, Row, ScrollView, TokenAvatar, metrics, paint, shortAddress, useWindowDimensions } from '@boltvault/ui'
import type { ChainView, ContactView, SendQuote, Settings, TokenView } from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { AmountWell } from '../components/AmountWell'
import { ChainSelectPill, ChainSheet, ManageNetworksKey, useChainBalances } from '../components/ChainSelect'
import { PageHeader } from '../components/PageHeader'
import { ScreenFooter } from '../components/ScreenFooter'
import { TokenPickerSheet } from '../components/TokenPickerSheet'
import { useEngine } from '../engine/EngineProvider'
import { useActivity } from '../hooks/useActivity'
import { usePortfolio } from '../hooks/usePortfolio'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'
import { formatAmountFiat, formatQuantity } from '../format'

const ETN = 52014

export function Send({ body, token: initialToken, to: initialTo, requestId: initialRequestId, reducedMotion = false, chainId: initialChainId }: { body: 'extension-popup' | 'extension-tab' | 'mobile'; token?: string; to?: string; requestId?: string; reducedMotion?: boolean; chainId?: number }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { width, height } = useWindowDimensions()
  const { entries } = useActivity(active?.id ?? null)
  const [chainId, setChainId] = useState(initialChainId ?? ETN)
  const portfolio = usePortfolio(active?.id ?? null, 5_000, [chainId])
  const balances = useChainBalances(active?.id ?? null)
  const [chains, setChains] = useState<ChainView[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [tokens, setTokens] = useState<TokenView[]>([])
  const [token, setToken] = useState(initialToken ?? 'native')
  const [to, setTo] = useState(initialTo ?? '')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<SendQuote | null>(null)
  const [contacts, setContacts] = useState<ContactView[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestId, setRequestId] = useState<string | null>(initialRequestId ?? null)
  const [fire, setFire] = useState(0)
  const [saveLabel, setSaveLabel] = useState('')
  const [chainOpen, setChainOpen] = useState(false)
  const [pickerOpen, setPickerOpen] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
    engine.settings.get().then(setSettings, () => undefined)
    engine.contacts.list().then(setContacts, () => undefined)
  }, [engine])
  useEffect(() => {
    engine.tokens.universe({ chainId }).then((u) => setTokens(u.filter((x) => !x.hidden)), () => undefined)
  }, [engine, chainId])

  // Quote as the user types; the engine resolves names and checks balances.
  useEffect(() => {
    if (!active) return
    if (!to.trim() && !amount.trim()) {
      setQuote(null)
      return
    }
    let alive = true
    const id = setTimeout(() => {
      engine.send.quote({ accountId: active.id, chainId, token, to, amount: amount || '0' }).then(
        (q) => alive && setQuote(q),
        () => alive && setQuote(null),
      )
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [engine, active, chainId, token, to, amount])

  const sent = requestId ? entries.find((e) => e.id === requestId) : undefined
  useEffect(() => {
    if (sent?.hash) setFire((n) => n + 1)
  }, [sent?.hash])

  const recents = useMemo(() => {
    const seen = new Set<string>()
    const out: string[] = []
    for (const e of entries) {
      if (e.category !== 'SEND' || !e.to) continue
      const k = e.to.toLowerCase()
      if (seen.has(k) || contacts.some((c) => c.address.toLowerCase() === k)) continue
      seen.add(k)
      out.push(e.to)
      if (out.length >= 3) break
    }
    return out
  }, [entries, contacts])

  const chainName = (id: number): string => chains.find((c) => c.chainId === id)?.name ?? (id === ETN ? 'Electroneum' : `Chain ${id}`)
  const enabled = [ETN, ...(settings?.enabledChains ?? []).filter((c) => c !== ETN)]
  const selected = tokens.find((x) => x.address.toLowerCase() === token.toLowerCase()) ?? tokens[0] ?? null
  const rows = portfolio.snapshot?.rows ?? []
  const currency = portfolio.snapshot?.currency ?? 'USD'
  const row = rows.find((r) => r.address.toLowerCase() === token.toLowerCase())
  const problems = quote?.problems ?? []
  const toProblem = problems.find((p) => /address|name/i.test(p)) ?? null
  const amountProblem = problems.find((p) => /amount|enough/i.test(p)) ?? null
  const latched = quote?.to !== null && quote?.to !== undefined && !toProblem

  const review = async (): Promise<void> => {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      const r = await engine.send.submit({ accountId: active.id, chainId, token, to, amount })
      setRequestId(r.requestId)
      // The sheet replaces this screen while it is up; the route keeps the id so the result renders on return.
      router.replace('send', { token, to, requestId: r.requestId })
      router.navigate('sign', { requestId: r.requestId })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (sent) {
    return (
      <Column flex={1} backgroundColor="$void" testID="send-done">
        <Discharge fire={fire} kind={sent.status === 'failed' ? 'reject' : 'confirm'} width={width} height={height} reducedMotion={reducedMotion} />
        <Column flex={1} padding={inset} gap="$4" justifyContent="center" zIndex={1}>
          <Body size="title">{sent.status === 'failed' ? t({ id: 'send.failed', message: 'The network refused it' }) : sent.status === 'confirmed' ? t({ id: 'send.sent', message: 'Sent' }) : t({ id: 'send.sending', message: 'Sending…' })}</Body>
          <Body tone="mute">{sent.statements[0] ?? ''}</Body>
          {sent.hash ? (
            <Body tone="mute" size="caption" numberOfLines={1}>
              {sent.hash}
            </Body>
          ) : null}
          {quote?.to && !contacts.some((c) => c.address.toLowerCase() === quote.to?.toLowerCase()) ? (
            <Plate gap="$2" testID="send-save">
              <Body tone="mute" size="caption">
                {t({ id: 'send.save', message: 'Save this address for next time' })}
              </Body>
              <Row gap="$2" alignItems="flex-end">
                <Column flex={1}>
                  <Input value={saveLabel} onChange={setSaveLabel} placeholder={t({ id: 'send.save.ph', message: 'Name' })} testID="send-save-label" />
                </Column>
                <Key label={t({ id: 'save', message: 'Save' })} kind="secondary" disabled={!saveLabel.trim()} onPress={() => engine.contacts.add({ address: quote.to ?? '', label: saveLabel, chainId }).then((c) => setContacts((cs) => [...cs, c]))} testID="send-save-key" />
              </Row>
            </Plate>
          ) : null}
          <Key label={t({ id: 'backup.home', message: 'Back to Home' })} onPress={() => router.reset()} testID="send-home" />
        </Column>
      </Column>
    )
  }

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="send">
        <PageHeader title={t({ id: 'send.title', message: 'Send' })} subtitle={active ? t({ id: 'from.account', message: 'from {a}', values: { a: `${active.label} · ${shortAddress(active.address)}` } }) : undefined} />
        <Row>
          <ChainSelectPill chainId={chainId} label={chainName(chainId)} onPress={() => setChainOpen(true)} testID="send-chain" />
        </Row>

        {/* To */}
        <Plate role={latched ? 'raised' : 'recessed'} gap="$2" testID="send-to">
          <Body tone="mute" size="caption">
            {t({ id: 'send.to', message: 'To' })}
          </Body>
          <Input value={to} onChange={setTo} placeholder={t({ id: 'send.to.ph', message: 'Address or name.etn' })} error={to.trim() ? toProblem : null} autoFocus={!initialTo} testID="send-to-input" />
          {latched && quote?.to ? (
            <Row gap="$2" alignItems="center">
              <Icon name="check" size={16} color={paint.arc} />
              <Body tone="arc" size="caption" testID="send-resolved">
                {quote.name ? `${quote.name} · ${shortAddress(quote.to)}` : shortAddress(quote.to)}
              </Body>
            </Row>
          ) : null}
          {contacts.length || recents.length ? (
            <Row gap="$2" flexWrap="wrap">
              {contacts.slice(0, 4).map((c) => (
                <Pill key={c.id} label={c.label} size="sm" onPress={() => setTo(c.address)} testID={`send-contact-${c.id}`} />
              ))}
              {recents.map((a) => (
                <Pill key={a} label={shortAddress(a)} size="sm" onPress={() => setTo(a)} />
              ))}
            </Row>
          ) : null}
        </Plate>

        {/* Amount */}
        <AmountWell
          label={t({ id: 'send.amount', message: 'Amount' })}
          value={amount}
          onChange={setAmount}
          tokenPill={<Pill label={selected?.symbol ?? t({ id: 'swap.pick', message: 'Pick' })} icon={selected ? <TokenAvatar chainId={chainId} address={selected.address} symbol={selected.symbol} logoUri={selected.logoUri} size={18} /> : undefined} chevron tone="ink" onPress={() => setPickerOpen(true)} testID="send-token" />}
          fiat={formatAmountFiat(amount, row, currency)}
          balance={row ? `${formatQuantity(row.quantity)} ${row.symbol}` : null}
          onMax={quote ? () => setAmount(quote.max) : row ? () => setAmount(row.quantity) : undefined}
          error={amount.trim() ? amountProblem : null}
          testID="send-amount"
          inputTestID="send-amount-input"
          maxTestID="send-max"
          balanceTestID="send-balance"
        />
        {quote ? (
          <Body tone="mute" size="caption" testID="send-fee">
            {t({ id: 'send.fee', message: 'Network fee about {fee} {s}', values: { fee: formatWei(quote.feeWei), s: quote.feeSymbol } })}
          </Body>
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
      </ScrollView>

      <ScreenFooter inset={inset} testID="send-footer">
        <Body tone="mute" size="caption" fontSize={11} lineHeight={14}>
          {t({ id: 'send.note', message: 'You will see exactly what moves before you sign. Sending to a contract or a new address asks for a second look.' })}
        </Body>
        <Key label={t({ id: 'send.review', message: 'Review' })} disabled={busy || !quote?.ok} onPress={review} testID="send-review" />
      </ScreenFooter>

      <ChainSheet
        open={chainOpen}
        onClose={() => setChainOpen(false)}
        title={t({ id: 'send.chain.title', message: 'Send on' })}
        options={enabled.map((id) => ({ id, name: chainName(id), ...(id === ETN ? { caption: t({ id: 'home.scope.etn.caption', message: 'Your home chain' }) } : {}), value: balances.get(id) ?? null }))}
        selected={chainId}
        onSelect={(id) => {
          if (id !== 'all' && id !== chainId) {
            setChainId(id)
            setToken('native')
            setAmount('')
          }
          setChainOpen(false)
        }}
        footer={<ManageNetworksKey onPress={() => { setChainOpen(false); router.navigate('networks') }} testID="send-networks" />}
        reducedMotion={reducedMotion}
        testID="send-chain-sheet"
        rowTestID={(id) => `send-chain-${id}`}
      />
      <TokenPickerSheet open={pickerOpen} onClose={() => setPickerOpen(false)} title={t({ id: 'send.pick', message: 'Token to send' })} tokens={tokens} rows={rows} currency={currency} onPick={(address) => { setToken(address); setPickerOpen(false) }} reducedMotion={reducedMotion} />
    </Column>
  )
}

function formatWei(wei: string): string {
  const n = BigInt(wei)
  const whole = n / 10n ** 18n
  const frac = (n % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}
