/**
 * Swap (master plan §8.6; plan B4): a title row with the slippage pill, the
 * console — two wells with the flip on their seam — a rate line, and a fee
 * plate that always shows price impact, the wallet fee with your BOLT tier,
 * minimum received and the locked liquidity behind the pair. Quotes come
 * from the mini-router on chain and re-rate every block; a quote older than
 * 8 s disarms the key. The default pair is ETN → BOLT; a token page opens
 * the swap with ETN → that token. Slippage, the token picker, the fee
 * schedule and the first-swap coach are sheets beside the screen.
 * Confirming runs a flow of sheets (approve → permit → swap) and the
 * Discharge lands the result here.
 */
import { Body, Chip, Column, Discharge, Icon, Key, Pill, Plate, Pressable, Rim, Row, ScrollView, Segmented, TokenAvatar, metrics, paint, shortAddress, useWindowDimensions } from '@boltvault/ui'
import { cacheKey, type LimitOrderView, type LimitQuote, type LiquidityView, type SwapQuote, type TokenView } from '@boltvault/engine'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { SlippageSheet } from '../components/SlippageSheet'
import { SwapCoachSheet } from '../components/SwapCoachSheet'
import { TokenPickerSheet } from '../components/TokenPickerSheet'
import { useEngine } from '../engine/EngineProvider'
import { useActivity } from '../hooks/useActivity'
import { useCached } from '../hooks/useCached'
import { useChainHead } from '../hooks/useChainHead'
import { usePortfolio } from '../hooks/usePortfolio'
import { usePrefs } from '../hooks/usePrefs'
import { formatAmountFiat, formatPct, formatQuantity, formatRate, formatRaw } from '../format'
import { t } from '../i18n'
import { swapFlowStore, useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'
import { AmountWell } from '../components/AmountWell'
import { ChainCaption } from '../components/ChainSelect'
import { ScreenFooter } from '../components/ScreenFooter'
import { FeeScheduleSheet } from './FeeScheduleSheet'
import { statusLabel, stepLabel } from '../components/FlowPlate'

const ETN = 52014
const QUOTE_STALE_MS = 8_000
const DURATIONS = [
  { id: '86400', label: '1 day' },
  { id: '604800', label: '7 days' },
  { id: '2592000', label: '30 days' },
] as const

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export interface SwapProps {
  readonly body: BodyKind
  readonly tokenIn?: string
  readonly tokenOut?: string
  readonly reducedMotion?: boolean
}

export function Swap({ body, tokenIn: initialIn, tokenOut: initialOut, reducedMotion = false }: SwapProps) {
  const engine = useEngine()
  const { active } = useWalletState()
  const { width, height } = useWindowDimensions()
  const portfolio = usePortfolio(active?.id ?? null)
  const { entries, loaded: activityLoaded } = useActivity(active?.id ?? null)
  const head = useChainHead(ETN)
  const { prefs, loaded: prefsLoaded, set: setPrefs } = usePrefs()
  const { flow: anyFlow, setActive, dismiss } = useSwapFlow()
  const flow = anyFlow && (anyFlow.kind === 'swap' || anyFlow.kind === 'limit' || anyFlow.kind === 'limit_cancel') ? anyFlow : null
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const wide = body === 'extension-tab'
  const [mode, setMode] = useState<'swap' | 'limit'>('swap')
  // Limit orders are a build feature (off by default); without it the screen is Swap only.
  const [limitOn, setLimitOn] = useState(false)
  useEffect(() => {
    engine.about.get().then((a) => setLimitOn(a.features.limitOrders), () => undefined)
  }, [engine])
  const [tokens, setTokens] = useState<TokenView[]>([])
  const [tokenIn, setTokenIn] = useState(initialIn ?? 'native')
  const [tokenOut, setTokenOut] = useState(initialOut ?? '')
  const [amount, setAmount] = useState('')
  const [minOut, setMinOut] = useState('')
  const [duration, setDuration] = useState<string>('604800')
  const [slippage, setSlippage] = useState<number | null>(null)
  const [slippageOpen, setSlippageOpen] = useState(false)
  const [picker, setPicker] = useState<'in' | 'out' | null>(null)
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [limitQuote, setLimitQuote] = useState<LimitQuote | null>(null)
  const [orders, setOrders] = useState<LimitOrderView[]>([])
  const [feeSheet, setFeeSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [fire, setFire] = useState(0)

  useEffect(() => {
    engine.tokens.universe({ chainId: ETN }).then((u) => {
      const visible = u.filter((x) => !x.hidden)
      setTokens(visible)
      // ETN → BOLT by default (plan B4, owner item W5); a token page prefills its own pair.
      if (!initialOut) {
        const bolt = visible.find((x) => x.symbol === 'BOLT') ?? visible.find((x) => x.address !== 'native')
        if (bolt) setTokenOut((cur) => cur || bolt.address)
      }
    }, () => undefined)
    engine.settings.get().then((s) => setSlippage((cur) => cur ?? s.slippageBips), () => undefined)
  }, [engine, initialOut])

  useEffect(() => {
    if (!active) return
    engine.limit.list({ accountId: active.id, chainId: ETN }).then(setOrders, () => undefined)
  }, [engine, active, flow?.status])

  // The clock for staleness; ticks with the head so the key disarms 8 s after the last quote.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])

  const effectiveSlippage = slippage ?? 50
  // Quote as the user types and again on every block while the pair is set (§8.6: rerated per block).
  useEffect(() => {
    if (!active || !tokenOut || slippage === null) return
    if (mode === 'swap') {
      if (!amount.trim()) {
        setQuote(null)
        return
      }
      let alive = true
      const id = setTimeout(() => {
        engine.swap.quote({ accountId: active.id, chainId: ETN, tokenIn, tokenOut, amountIn: amount, slippageBips: effectiveSlippage }).then(
          (q) => alive && setQuote(q),
          (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
        )
      }, 250)
      return () => {
        alive = false
        clearTimeout(id)
      }
    }
    if (!amount.trim() && !minOut.trim()) {
      setLimitQuote(null)
      return
    }
    let alive = true
    const id = setTimeout(() => {
      engine.limit.quote({ accountId: active.id, chainId: ETN, tokenIn, tokenOut, amountIn: amount || '0', minOut: minOut || '0', durationSeconds: Number(duration) }).then(
        (q) => alive && setLimitQuote(q),
        (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
      )
    }, 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [engine, active, mode, tokenIn, tokenOut, amount, minOut, duration, effectiveSlippage, slippage, head?.blockNumber])

  useEffect(() => {
    if (flow?.status === 'done') setFire((n) => n + 1)
  }, [flow?.status])

  // Locked liquidity behind the pair (owner item W3): the token side, never ETN itself.
  const lockToken = tokenOut && tokenOut !== 'native' ? tokenOut : tokenIn !== 'native' ? tokenIn : null
  const liquidity = useCached<LiquidityView>({
    key: lockToken ? cacheKey('explore', 'liquidity', ETN, lockToken) : null,
    cached: (e) => (lockToken ? e.explore.cachedLiquidity({ chainId: ETN, address: lockToken }) : Promise.resolve(null)),
    fresh: (e) =>
      lockToken
        ? e.explore.liquidity({ chainId: ETN, address: lockToken }).then((v) => {
            if (!v) throw new Error('no lock data')
            return v
          })
        : Promise.reject(new Error('no token')),
    maxAgeMs: 10 * 60_000,
  })

  const inView = tokens.find((x) => x.address.toLowerCase() === tokenIn.toLowerCase()) ?? null
  const outView = tokens.find((x) => x.address.toLowerCase() === tokenOut.toLowerCase()) ?? null
  const rows = portfolio.snapshot?.rows ?? []
  const currency = portfolio.snapshot?.currency ?? 'USD'
  const rowIn = rows.find((r) => r.address.toLowerCase() === tokenIn.toLowerCase())
  const rowOut = rows.find((r) => r.address.toLowerCase() === tokenOut.toLowerCase())
  const hasSwapped = useMemo(() => entries.some((e) => e.category === 'SWAP'), [entries])
  const fresh = quote ? now - quote.quotedAt <= QUOTE_STALE_MS : false
  const impactTone: 'mute' | 'ember' | 'burn' = quote?.priceImpactPct === null || quote?.priceImpactPct === undefined ? 'mute' : quote.priceImpactPct > 15 ? 'burn' : quote.priceImpactPct > 5 ? 'ember' : 'mute'
  const coachOpen = mode === 'swap' && prefsLoaded && activityLoaded && !hasSwapped && !prefs.swapCoachDismissed

  const flip = useCallback(() => {
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    setQuote(null)
  }, [tokenIn, tokenOut])

  const pick = (address: string): void => {
    if (picker === 'in') {
      if (address.toLowerCase() === tokenOut.toLowerCase()) setTokenOut(tokenIn)
      setTokenIn(address)
    } else if (picker === 'out') {
      if (address.toLowerCase() === tokenIn.toLowerCase()) setTokenIn(tokenOut)
      setTokenOut(address)
    }
    setPicker(null)
  }

  const run = async (): Promise<void> => {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      const r =
        mode === 'swap'
          ? await engine.swap.execute({ accountId: active.id, chainId: ETN, tokenIn, tokenOut, amountIn: amount, slippageBips: effectiveSlippage })
          : await engine.limit.place({ accountId: active.id, chainId: ETN, tokenIn, tokenOut, amountIn: amount, minOut, durationSeconds: Number(duration) })
      const f = await engine.swap.flow({ flowId: r.flowId })
      if (f) swapFlowStore.upsert(f)
      setActive(r.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const cancelOrder = async (orderId: string): Promise<void> => {
    if (!active) return
    setError(null)
    try {
      const r = await engine.limit.cancel({ accountId: active.id, chainId: ETN, orderId })
      setActive(r.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  // A flow in progress or just finished takes the screen: steps, then the Discharge.
  if (flow && flow.accountId === active?.id) {
    const finished = flow.status !== 'running'
    const q = flow.quote
    return (
      <Column flex={1} testID="swap-flow">
        {finished ? <Discharge fire={fire} kind={flow.status === 'done' ? 'confirm' : 'reject'} width={width} height={height} reducedMotion={reducedMotion} /> : null}
        <ScrollView contentContainerStyle={{ padding: inset, gap: 14, flexGrow: 1, justifyContent: 'center' }} style={{ zIndex: 1 }}>
          <Body size="title" testID="swap-flow-title">
            {flow.status === 'done'
              ? flow.kind === 'swap'
                ? t({ id: 'swap.done', message: 'Swapped' })
                : flow.kind === 'limit'
                  ? t({ id: 'limit.placed', message: 'Order placed' })
                  : t({ id: 'limit.cancelled', message: 'Order cancelled' })
              : flow.status === 'rejected'
                ? t({ id: 'flow.rejected.title', message: 'Nothing was signed' })
                : flow.status === 'failed'
                  ? t({ id: 'flow.failed.title', message: 'The network refused it' })
                  : flow.kind === 'swap'
                    ? t({ id: 'swap.working', message: 'Swapping…' })
                    : t({ id: 'limit.working', message: 'Placing your order…' })}
          </Body>
          {q ? (
            <Body tone="mute" testID="swap-flow-summary">
              {t({ id: 'swap.summary', message: '{a} {s} → at least {b} {u}', values: { a: formatRaw(q.amountInRaw, q.decimalsIn), s: q.symbolIn, b: formatRaw(q.minimumOutRaw, q.decimalsOut), u: q.symbolOut } })}
            </Body>
          ) : null}
          <Plate gap="$2" testID="swap-steps">
            {flow.steps.map((s, i) => (
              <Row key={`${s.step}-${i}`} justifyContent="space-between" alignItems="center" minHeight={28}>
                <Row gap="$2" alignItems="center">
                  <Icon name={s.status === 'confirmed' ? 'check' : s.status === 'rejected' || s.status === 'failed' ? 'close' : 'chevronRight'} size={16} color={s.status === 'confirmed' ? paint.arc : s.status === 'rejected' || s.status === 'failed' ? paint.burn : paint.mute} />
                  <Body tone={s.status === 'signing' ? 'ink' : 'mute'}>{stepLabel(s.step)}</Body>
                </Row>
                <Body tone={s.status === 'confirmed' ? 'arc' : s.status === 'rejected' || s.status === 'failed' ? 'burn' : 'mute'} size="caption" testID={`swap-step-${s.step}`}>
                  {statusLabel(s.status)}
                </Body>
              </Row>
            ))}
          </Plate>
          {flow.error ? <Body tone="burn">{flow.error}</Body> : null}
          {flow.hash ? (
            <Body tone="mute" size="caption" numberOfLines={1} testID="swap-hash">
              {flow.hash}
            </Body>
          ) : null}
          {finished ? <Key label={flow.status === 'done' ? t({ id: 'flow.again', message: 'Back to Swap' }) : t({ id: 'flow.tryAgain', message: 'Try again' })} onPress={dismiss} testID="swap-flow-done" /> : null}
        </ScrollView>
      </Column>
    )
  }

  const feeMain = quote ? (quote.fee.bips === 0 ? t({ id: 'swap.fee.zero', message: 'No wallet fee · BOLT tier {t}', values: { t: quote.fee.tier } }) : t({ id: 'swap.fee.main', message: '{p} · BOLT tier {t}', values: { p: formatPct(quote.fee.bips), t: quote.fee.tier } })) : t({ id: 'swap.fee.idle', message: '0.50% · hold BOLT for less' })
  const feeDetail = quote && quote.fee.bips > 0 && quote.amountOutRaw !== '0' ? t({ id: 'swap.fee.detail', message: '{a} {s} to {sink}', values: { a: formatRaw(quote.fee.amountRaw, quote.decimalsOut), s: quote.symbolOut, sink: quote.fee.sink ? shortAddress(quote.fee.sink) : '—' } }) : null
  const nextLine = quote?.fee.nextTierAt && quote.fee.nextTierBips !== null ? t({ id: 'swap.fee.next', message: 'hold {n} BOLT-eq for {p}', values: { n: formatRaw(quote.fee.nextTierAt, 18), p: formatPct(quote.fee.nextTierBips) } }) : null
  const lockText = liquidity.value
    ? liquidity.value.lockedPct > 0
      ? t({ id: 'swap.locks', message: '{p}% locked · {n}', values: { p: Math.round(liquidity.value.lockedPct), n: liquidity.value.lockCount === 1 ? t({ id: 'swap.locks.one', message: '1 lock' }) : t({ id: 'swap.locks.many', message: '{n} locks', values: { n: liquidity.value.lockCount } }) } })
      : t({ id: 'swap.locks.none', message: 'No locks' })
    : lockToken && liquidity.freshness === 'loading'
      ? '…'
      : t({ id: 'swap.locks.unknown', message: 'No lock data' })
  const lockTone: 'surge' | 'ember' | 'mute' = liquidity.value ? (liquidity.value.lockedPct >= 50 ? 'surge' : liquidity.value.lockedPct > 0 ? 'ember' : 'mute') : 'mute'
  const problem = mode === 'swap' ? (quote?.problems[0] ?? null) : (limitQuote?.problems[0] ?? null)
  const canSwap = mode === 'swap' ? !!quote?.ok && fresh && !busy : !!limitQuote?.ok && !busy
  const receiveText = quote && quote.amountOutRaw !== '0' ? formatRaw(quote.receiveRaw, quote.decimalsOut) : '—'
  const keyLabel = mode === 'swap' ? (quote && quote.priceImpactPct !== null && quote.priceImpactPct > 15 ? t({ id: 'swap.key.anyway', message: 'Swap anyway' }) : t({ id: 'swap.key', message: 'Swap' })) : t({ id: 'swap.limit.key', message: 'Place order' })

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 10, ...(wide ? { maxWidth: 560, width: '100%', alignSelf: 'center' } : {}) }} testID="swap">
        {/* Title row: Swap (or Swap · Limit) and the slippage pill (owner item W2). */}
        <Row justifyContent="space-between" alignItems="center" minHeight={40}>
          {limitOn ? (
            <Column width={180}>
              <Segmented
                options={[
                  { id: 'swap', label: t({ id: 'swap.mode.swap', message: 'Swap' }) },
                  { id: 'limit', label: t({ id: 'swap.mode.limit', message: 'Limit' }) },
                ]}
                value={mode}
                onChange={(id) => setMode(id as 'swap' | 'limit')}
                size="compact"
                testID="swap-mode"
              />
            </Column>
          ) : (
            <Column alignItems="flex-start">
              <Body size="title">{t({ id: 'swap.title', message: 'Swap' })}</Body>
              <ChainCaption chainId={ETN} name="Electroneum" testID="swap-chain" />
            </Column>
          )}
          {mode === 'swap' ? <Pill icon={<Icon name="tune" size={14} color={paint.mute} />} label={formatPct(effectiveSlippage)} size="sm" onPress={() => setSlippageOpen(true)} accessibilityLabel={t({ id: 'swap.slippage', message: 'Slippage {p}', values: { p: formatPct(effectiveSlippage) } })} testID="swap-slippage" /> : null}
        </Row>

        {/* The console: two wells in one panel, the flip control on their seam (style bible › layout). */}
        <Plate role="console" gap="$2" padding={10} testID="swap-console">
          <AmountWell
            label={t({ id: 'swap.pay', message: 'You pay' })}
            value={amount}
            onChange={setAmount}
            tokenPill={<TokenPill token={inView} onPress={() => setPicker('in')} testID="swap-token-in" />}
            fiat={formatAmountFiat(amount, rowIn, currency)}
            balance={rowIn ? `${formatQuantity(rowIn.quantity)} ${rowIn.symbol}` : null}
            onMax={rowIn ? () => setAmount(rowIn.quantity) : undefined}
            testID="terminal-in"
            inputTestID="swap-amount-in"
            maxTestID="swap-max"
            balanceTestID="swap-balance-in"
          />

          <Row justifyContent="center" marginVertical={-18} zIndex={2}>
            <Pressable onPress={flip} accessibilityRole="button" accessibilityLabel={t({ id: 'swap.flip', message: 'Swap direction' })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="swap-flip">
              <Chip width={36} height={36} borderRadius={18} padding={0} justifyContent="center" alignItems="center" backgroundColor="$glassRaisedSolid" borderWidth={0} overflow="hidden">
                <Icon name="swap" color={paint.arc} size={18} />
                <Rim radius={18} opacity={0.85} />
              </Chip>
            </Pressable>
          </Row>

          {mode === 'swap' ? (
            <AmountWell
              label={t({ id: 'swap.receive', message: 'You receive' })}
              value={receiveText}
              readOnly
              tokenPill={<TokenPill token={outView} onPress={() => setPicker('out')} testID="swap-token-out" />}
              fiat={quote && quote.amountOutRaw !== '0' ? formatAmountFiat(formatRaw(quote.receiveRaw, quote.decimalsOut).replace(/,/g, ''), rowOut, currency) : null}
              balance={rowOut ? `${formatQuantity(rowOut.quantity)} ${rowOut.symbol}` : null}
              testID="terminal-out"
              inputTestID="swap-amount-out"
              balanceTestID="swap-balance-out"
            />
          ) : (
            <AmountWell
              label={t({ id: 'limit.receive', message: 'You receive at least' })}
              value={minOut}
              onChange={setMinOut}
              tokenPill={<TokenPill token={outView} onPress={() => setPicker('out')} testID="swap-token-out" />}
              fiat={formatAmountFiat(minOut, rowOut, currency)}
              balance={rowOut ? `${formatQuantity(rowOut.quantity)} ${rowOut.symbol}` : null}
              testID="terminal-out"
              inputTestID="limit-min-out"
              balanceTestID="swap-balance-out"
            />
          )}
        </Plate>

        {/* Rate and route */}
        {mode === 'swap' && quote && quote.amountOutRaw !== '0' ? (
          <Plate role="recessed" paddingVertical={6} paddingHorizontal="$3" minHeight={36} flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="$2">
            <Body tone={fresh ? 'ink' : 'mute'} size="caption" testID="swap-rate">
              {formatRate(quote.rate, quote.symbolIn, quote.symbolOut) ?? ''}
            </Body>
            <Row gap="$1" alignItems="center" testID="swap-route">
              {quote.route.hops.map((h, i) => (
                <Row key={`${h.tokenIn}-${i}`} gap="$1" alignItems="center">
                  {i > 0 ? <Icon name="chevronRight" size={12} color={paint.mute} /> : null}
                  <Chip paddingVertical={2}>
                    <Body tone="mute" size="caption">
                      {h.kind === 'v3' ? `V3 ${((h.fee ?? 0) / 10_000).toFixed(2).replace(/0$/, '')}%` : 'V2'}
                    </Body>
                  </Chip>
                </Row>
              ))}
            </Row>
          </Plate>
        ) : null}
        {mode === 'limit' && limitQuote ? (
          <Plate gap="$1" testID="limit-distance">
            <Body tone="mute" size="caption">
              {limitQuote.marketRate ? t({ id: 'limit.market', message: 'Market: {r}', values: { r: formatRate(limitQuote.marketRate, limitQuote.symbolIn, limitQuote.symbolOut) ?? '—' } }) : t({ id: 'limit.market.none', message: 'No market rate for this pair right now.' })}
            </Body>
            {limitQuote.distancePct !== null ? (
              <Body tone={limitQuote.distancePct >= 0 ? 'arc' : 'ember'} size="caption">
                {limitQuote.distancePct >= 0 ? t({ id: 'limit.above', message: '{p}% above market — fills when the price gets there', values: { p: limitQuote.distancePct.toFixed(2) } }) : t({ id: 'limit.below', message: '{p}% below market — a swap would pay more right now', values: { p: Math.abs(limitQuote.distancePct).toFixed(2) } })}
              </Body>
            ) : null}
            <Row gap="$2" flexWrap="wrap">
              {DURATIONS.map((d) => (
                <Pill key={d.id} label={d.label} selected={duration === d.id} onPress={() => setDuration(d.id)} testID={`limit-duration-${d.id}`} />
              ))}
            </Row>
          </Plate>
        ) : null}

        {/* The fee plate: four lines, always (§8.6; plan B4). */}
        {mode === 'swap' ? (
          <Plate role="recessed" gap={2} paddingVertical="$2" paddingHorizontal="$3" testID="fee-stack">
            <FeeRow label={t({ id: 'swap.impact', message: 'Price impact' })} value={quote?.priceImpactPct !== null && quote?.priceImpactPct !== undefined ? `${quote.priceImpactPct.toFixed(2)}%` : '—'} tone={impactTone} testID="swap-impact" />
            <Pressable onPress={() => setFeeSheet(true)} accessibilityRole="button" accessibilityLabel={t({ id: 'swap.fee.a11y', message: 'Wallet fee schedule' })} style={{ minHeight: 44, justifyContent: 'center', marginVertical: -8 }} testID="swap-fee-line">
              <Row justifyContent="space-between" alignItems="flex-start" gap="$2">
                <Row gap={4} alignItems="center">
                  <Body tone="mute" size="caption">
                    {t({ id: 'swap.fee', message: 'Wallet fee' })}
                  </Body>
                  <Icon name="info" size={12} color={paint.mute} />
                </Row>
                <Column alignItems="flex-end" flexShrink={1} testID="swap-fee">
                  <Body tone={quote?.fee.source === 'fallback' ? 'ember' : 'ink'} size="caption" textAlign="right">
                    {feeMain}
                  </Body>
                  {feeDetail ? (
                    <Body tone="mute" size="caption" textAlign="right">
                      {feeDetail}
                    </Body>
                  ) : null}
                  {nextLine ? (
                    <Body tone="ember" size="caption" textAlign="right" testID="swap-fee-next">
                      {nextLine}
                    </Body>
                  ) : null}
                </Column>
              </Row>
            </Pressable>
            <FeeRow label={t({ id: 'swap.min', message: 'Minimum received' })} value={quote && quote.amountOutRaw !== '0' ? `${formatRaw(quote.minimumOutRaw, quote.decimalsOut)} ${quote.symbolOut}` : '—'} tone="mute" testID="swap-min" />
            <FeeRow label={t({ id: 'swap.locked', message: 'Liquidity locked' })} value={lockText} tone={lockTone} testID="swap-locks" />
            {quote && quote.taxBips > 0 ? <FeeRow label={t({ id: 'swap.tax.label', message: 'Token tax' })} value={t({ id: 'swap.tax', message: '+{p} token tax', values: { p: formatPct(quote.taxBips) } })} tone="ember" testID="swap-tax" /> : null}
          </Plate>
        ) : (
          <Body tone="mute" size="caption">
            {t({ id: 'limit.fee', message: 'Platform fee 0.1% on fill · no wallet fee' })}
          </Body>
        )}


        {/* Open orders */}
        {mode === 'limit' ? (
          <Column gap="$2" testID="limit-orders">
            <Body size="title">{t({ id: 'limit.open', message: 'Open orders' })}</Body>
            {orders.length === 0 ? (
              <Body tone="mute" size="caption">
                {t({ id: 'limit.none', message: 'No open orders. An order waits on chain until the price reaches your target or it expires.' })}
              </Body>
            ) : (
              orders.map((o) => (
                <Plate key={o.orderId} role="card" gap="$1" testID={`limit-order-${o.orderId}`}>
                  <Row justifyContent="space-between">
                    <Body size="caption">{t({ id: 'limit.row', message: '{a} {s} → at least {b} {u}', values: { a: formatRaw(o.amountInExact, o.decimalsIn), s: o.symbolIn, b: formatRaw(o.amountOutMin, o.decimalsOut), u: o.symbolOut } })}</Body>
                    <Body tone="mute" size="caption">
                      {o.status}
                    </Body>
                  </Row>
                  <Row justifyContent="space-between" alignItems="center">
                    <Body tone="mute" size="caption">
                      {t({ id: 'limit.expires', message: 'Expires {d}', values: { d: new Date(o.expiresAt * 1000).toLocaleDateString('en-GB') } })}
                    </Body>
                    {o.status === 'open' ? <Key label={t({ id: 'approval.cancel', message: 'Cancel' })} kind="secondary" size="compact" onPress={() => void cancelOrder(o.orderId)} testID={`limit-cancel-${o.orderId}`} /> : null}
                  </Row>
                </Plate>
              ))
            )}
          </Column>
        ) : null}
      </ScrollView>

      <ScreenFooter inset={inset} maxWidth={wide ? 560 : undefined} testID="swap-footer">
        {problem && (amount.trim() || minOut.trim()) ? (
          <Body tone="burn" size="caption" testID="swap-problem">
            {problem}
          </Body>
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
        {mode === 'swap' && quote?.ok && !fresh ? (
          <Body tone="mute" size="caption" testID="swap-stale">
            {t({ id: 'swap.stale', message: 'Re-quoting…' })}
          </Body>
        ) : null}
        <Key label={keyLabel} disabled={!canSwap} onPress={run} testID="swap-key" />
      </ScreenFooter>

      {/* Sheets are siblings of the screen's ScrollView (plan B1). */}
      <FeeScheduleSheet
        open={feeSheet}
        onClose={() => setFeeSheet(false)}
        accountId={active?.id ?? null}
        chainId={ETN}
        reducedMotion={reducedMotion}
        onGetBolt={() => {
          const bolt = tokens.find((x) => x.symbol === 'BOLT')
          if (bolt) {
            setTokenOut(bolt.address)
            if (tokenIn.toLowerCase() === bolt.address.toLowerCase()) setTokenIn('native')
          }
          setFeeSheet(false)
        }}
      />
      <TokenPickerSheet open={picker !== null} onClose={() => setPicker(null)} title={picker === 'in' ? t({ id: 'swap.pick.in', message: 'You pay' }) : t({ id: 'swap.pick.out', message: 'You receive' })} tokens={tokens} rows={rows} currency={currency} onPick={pick} reducedMotion={reducedMotion} />
      <SlippageSheet open={slippageOpen} onClose={() => setSlippageOpen(false)} value={effectiveSlippage} onChange={setSlippage} reducedMotion={reducedMotion} />
      <SwapCoachSheet open={coachOpen} onDismiss={() => setPrefs({ swapCoachDismissed: true })} reducedMotion={reducedMotion} />
    </Column>
  )
}

function FeeRow({ label, value, tone, testID }: { label: string; value: string; tone: 'mute' | 'ink' | 'ember' | 'burn' | 'surge'; testID: string }) {
  return (
    <Row justifyContent="space-between" alignItems="center" minHeight={22} gap="$2">
      <Body tone="mute" size="caption">
        {label}
      </Body>
      <Body tone={tone} size="caption" textAlign="right" flexShrink={1} testID={testID}>
        {value}
      </Body>
    </Row>
  )
}

function TokenPill({ token, onPress, testID }: { token: TokenView | null; onPress: () => void; testID: string }) {
  return <Pill label={token?.symbol ?? t({ id: 'swap.pick', message: 'Pick' })} icon={token ? <TokenAvatar chainId={ETN} address={token.address === 'native' ? '0x0000000000000000000000000000000000000000' : token.address} logoUri={token.logoUri} size={18} /> : undefined} chevron tone="ink" onPress={onPress} accessibilityLabel={token?.symbol ?? t({ id: 'swap.pick', message: 'Pick' })} testID={testID} />
}
