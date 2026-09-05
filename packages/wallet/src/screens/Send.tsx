/**
 * Send (master plan §8.4): To → Amount → Review. The recipient plate latches
 * once it resolves (address or `.etn` name); the review is the same Approval
 * sheet every signature uses, reached through `internal:send`, so poison,
 * first-time and large-send rules run before the verb arms. The receipt
 * lands in Activity and the Discharge plays here.
 */
import { Body, Chip, Column, Discharge, Icon, Input, Key, Plate, Row, ScrollView, TokenAvatar, metrics, paint, shortAddress, useWindowDimensions } from '@boltvault/ui'
import type { ContactView, SendQuote, TokenView } from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useActivity } from '../hooks/useActivity'
import { usePortfolio } from '../hooks/usePortfolio'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'
import { formatQuantity } from '../format'

const ETN = 52014

export function Send({ body, token: initialToken, to: initialTo, requestId: initialRequestId, reducedMotion = false, chainId: initialChainId }: { body: 'extension-popup' | 'extension-tab' | 'mobile'; token?: string; to?: string; requestId?: string; reducedMotion?: boolean; chainId?: number }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { width, height } = useWindowDimensions()
  const portfolio = usePortfolio(active?.id ?? null)
  const { entries } = useActivity(active?.id ?? null)
  const [chainId] = useState(initialChainId ?? ETN)
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
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.tokens.universe({ chainId }).then((u) => setTokens(u.filter((x) => !x.hidden)), () => undefined)
    engine.contacts.list().then(setContacts, () => undefined)
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

  const selected = tokens.find((x) => x.address.toLowerCase() === token.toLowerCase()) ?? tokens[0]
  const row = portfolio.snapshot?.rows.find((r) => r.address.toLowerCase() === token.toLowerCase())
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
            <Body tone="mute" size="caption" fontFamily="$mono" numberOfLines={1}>
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
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="send">
      <Row justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'send.title', message: 'Send' })}</Body>
      </Row>

      {/* Token */}
      <Row gap="$2" flexWrap="wrap" testID="send-tokens">
        {tokens.slice(0, 8).map((x) => (
          <Chip key={x.address} onPress={() => setToken(x.address)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={x.address === selected?.address ? paint.arc : undefined} testID={`send-token-${x.symbol}`}>
            <Row gap="$2" alignItems="center">
              <TokenAvatar chainId={chainId} address={x.address === 'native' ? '0x0000000000000000000000000000000000000000' : x.address} logoUri={x.logoUri} size={20} />
              <Body tone={x.address === selected?.address ? 'arc' : 'mute'} size="caption">
                {x.symbol}
              </Body>
            </Row>
          </Chip>
        ))}
      </Row>

      {/* To */}
      <Plate role={latched ? 'raised' : 'recessed'} gap="$2" testID="send-to">
        <Body tone="mute" size="caption">
          {t({ id: 'send.to', message: 'To' })}
        </Body>
        <Input value={to} onChange={setTo} mono placeholder={t({ id: 'send.to.ph', message: '0x… or name.etn' })} error={to.trim() ? toProblem : null} autoFocus={!initialTo} testID="send-to-input" />
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
              <Chip key={c.id} onPress={() => setTo(c.address)} cursor="pointer" minHeight={44} justifyContent="center" testID={`send-contact-${c.id}`}>
                <Body tone="mute" size="caption">
                  {c.label}
                </Body>
              </Chip>
            ))}
            {recents.map((a) => (
              <Chip key={a} onPress={() => setTo(a)} cursor="pointer" minHeight={44} justifyContent="center">
                <Body tone="mute" size="caption">
                  {shortAddress(a)}
                </Body>
              </Chip>
            ))}
          </Row>
        ) : null}
      </Plate>

      {/* Amount */}
      <Plate gap="$2" testID="send-amount">
        <Row justifyContent="space-between">
          <Body tone="mute" size="caption">
            {t({ id: 'send.amount', message: 'Amount' })}
          </Body>
          <Body tone="mute" size="caption">
            {row ? t({ id: 'send.balance', message: '{q} {s} available', values: { q: formatQuantity(row.quantity), s: row.symbol } }) : ''}
          </Body>
        </Row>
        <Row gap="$2" alignItems="flex-end">
          <Column flex={1}>
            <Input value={amount} onChange={setAmount} placeholder="0" error={amount.trim() ? amountProblem : null} testID="send-amount-input" />
          </Column>
          <Key label={t({ id: 'send.max', message: 'Max' })} kind="secondary" disabled={!quote} onPress={() => quote && setAmount(quote.max)} testID="send-max" />
        </Row>
        {quote ? (
          <Body tone="mute" size="caption" testID="send-fee">
            {t({ id: 'send.fee', message: 'Network fee about {fee} {s}', values: { fee: formatWei(quote.feeWei), s: quote.feeSymbol } })}
          </Body>
        ) : null}
      </Plate>

      {error ? <Body tone="burn">{error}</Body> : null}
      <Key label={t({ id: 'send.review', message: 'Review' })} disabled={busy || !quote?.ok} onPress={review} testID="send-review" />
      <Body tone="mute" size="caption">
        {t({ id: 'send.note', message: 'You will see exactly what moves before you sign. Sending to a contract or a new address asks for a second look.' })}
      </Body>
    </ScrollView>
  )
}

function formatWei(wei: string): string {
  const n = BigInt(wei)
  const whole = n / 10n ** 18n
  const frac = (n % 10n ** 18n).toString().padStart(18, '0').slice(0, 6).replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}
