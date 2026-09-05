/**
 * Swap (master plan §8.6): two terminals, a live rate line, the route as a
 * small schematic, and a fee stack that always shows three lines — price
 * impact, the wallet fee with your BOLT tier and where it goes, minimum
 * received. Quotes come from the mini-router on chain and re-rate every
 * block; a quote older than 8 s disarms the key. Swap · Limit at the top.
 * Confirming runs a flow of sheets (approve → permit → swap) and the
 * Discharge lands the result here.
 */
import { Body, Chip, Column, Discharge, Icon, Input, Key, Plate, Pressable, Readout, Rim, Row, ScrollView, Segmented, Sheet, TokenAvatar, metrics, paint, shortAddress, useWindowDimensions } from '@boltvault/ui'
import type { LimitOrderView, LimitQuote, SwapQuote, TokenView } from '@boltvault/engine'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useActivity } from '../hooks/useActivity'
import { useChainHead } from '../hooks/useChainHead'
import { usePortfolio } from '../hooks/usePortfolio'
import { formatPct, formatQuantity, formatRate, formatRaw } from '../format'
import { t } from '../i18n'
import { swapFlowStore, useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'
import { FeeScheduleSheet } from './FeeScheduleSheet'
import { statusLabel, stepLabel } from '../components/FlowPlate'

const ETN = 52014
const QUOTE_STALE_MS = 8_000
const SLIPPAGES = [10, 50, 100] as const
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
  const { entries } = useActivity(active?.id ?? null)
  const head = useChainHead(ETN)
  const { flow: anyFlow, setActive, dismiss } = useSwapFlow()
  const flow = anyFlow && (anyFlow.kind === 'swap' || anyFlow.kind === 'limit' || anyFlow.kind === 'limit_cancel') ? anyFlow : null
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
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
  const [customSlippage, setCustomSlippage] = useState('')
  const [tray, setTray] = useState(false)
  const [picker, setPicker] = useState<'in' | 'out' | null>(null)
  const [quote, setQuote] = useState<SwapQuote | null>(null)
  const [limitQuote, setLimitQuote] = useState<LimitQuote | null>(null)
  const [orders, setOrders] = useState<LimitOrderView[]>([])
  const [feeSheet, setFeeSheet] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [fire, setFire] = useState(0)
  const [coachDismissed, setCoachDismissed] = useState(false)

  useEffect(() => {
    engine.tokens.universe({ chainId: ETN }).then((u) => {
      const visible = u.filter((x) => !x.hidden)
      setTokens(visible)
      if (!initialOut) {
        const usdc = visible.find((x) => x.symbol === 'USDC') ?? visible.find((x) => x.address !== 'native')
        if (usdc) setTokenOut((cur) => cur || usdc.address)
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

  const inView = tokens.find((x) => x.address.toLowerCase() === tokenIn.toLowerCase()) ?? null
  const outView = tokens.find((x) => x.address.toLowerCase() === tokenOut.toLowerCase()) ?? null
  const rowIn = portfolio.snapshot?.rows.find((r) => r.address.toLowerCase() === tokenIn.toLowerCase())
  const rowOut = portfolio.snapshot?.rows.find((r) => r.address.toLowerCase() === tokenOut.toLowerCase())
  const hasSwapped = useMemo(() => entries.some((e) => e.category === 'SWAP'), [entries])
  const fresh = quote ? now - quote.quotedAt <= QUOTE_STALE_MS : false
  const impactTone: 'mute' | 'ember' | 'burn' = quote?.priceImpactPct === null || quote?.priceImpactPct === undefined ? 'mute' : quote.priceImpactPct > 15 ? 'burn' : quote.priceImpactPct > 5 ? 'ember' : 'mute'

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
      <Column flex={1} backgroundColor="$void" testID="swap-flow">
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
            <Body tone="mute" size="caption" fontFamily="$mono" numberOfLines={1} testID="swap-hash">
              {flow.hash}
            </Body>
          ) : null}
          {finished ? <Key label={flow.status === 'done' ? t({ id: 'flow.again', message: 'Back to Swap' }) : t({ id: 'flow.tryAgain', message: 'Try again' })} onPress={dismiss} testID="swap-flow-done" /> : null}
        </ScrollView>
      </Column>
    )
  }

  const feeLine = quote
    ? quote.fee.bips === 0
      ? t({ id: 'swap.fee.zero', message: 'No wallet fee · BOLT tier {t}', values: { t: quote.fee.tier } })
      : t({ id: 'swap.fee.line', message: '{p} · BOLT tier {t} · {a} {s} to {sink}', values: { p: formatPct(quote.fee.bips), t: quote.fee.tier, a: formatRaw(quote.fee.amountRaw, quote.decimalsOut), s: quote.symbolOut, sink: quote.fee.sink ? shortAddress(quote.fee.sink) : '—' } })
    : t({ id: 'swap.fee.idle', message: '0.50% · hold BOLT for less' })
  const nextLine = quote?.fee.nextTierAt && quote.fee.nextTierBips !== null ? t({ id: 'swap.fee.next', message: 'hold {n} BOLT-eq for {p}', values: { n: formatRaw(quote.fee.nextTierAt, 18), p: formatPct(quote.fee.nextTierBips) } }) : null
  const problem = mode === 'swap' ? (quote?.problems[0] ?? null) : (limitQuote?.problems[0] ?? null)
  const canSwap = mode === 'swap' ? !!quote?.ok && fresh && !busy : !!limitQuote?.ok && !busy
  const keyLabel = mode === 'swap' ? (quote && quote.priceImpactPct !== null && quote.priceImpactPct > 15 ? t({ id: 'swap.key.anyway', message: 'Swap anyway' }) : t({ id: 'swap.key', message: 'Swap' })) : t({ id: 'swap.limit.key', message: 'Place order' })

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="swap">
      {limitOn ? (
        <Segmented
          options={[
            { id: 'swap', label: t({ id: 'swap.mode.swap', message: 'Swap' }) },
            { id: 'limit', label: t({ id: 'swap.mode.limit', message: 'Limit' }) },
          ]}
          value={mode}
          onChange={(id) => setMode(id as 'swap' | 'limit')}
          testID="swap-mode"
        />
      ) : null}

      {/* The console: two terminals in one panel, the flip control on their seam (style bible › layout). */}
      <Plate role="console" gap="$2" padding="$3" testID="swap-console">
        {/* You pay */}
        <Plate role="well" gap="$1" padding="$3" testID="terminal-in">
          <Body tone="mute" size="caption">
            {t({ id: 'swap.pay', message: 'You pay' })}
          </Body>
          <Row gap="$2" alignItems="center">
            <Column flex={1}>
              <Input value={amount} onChange={setAmount} placeholder="0" bare big testID="swap-amount-in" />
            </Column>
            <TokenChip chainId={ETN} token={inView} onPress={() => setPicker('in')} testID="swap-token-in" />
          </Row>
          <Row justifyContent="space-between" alignItems="center" minHeight={24}>
            <Body tone="mute" size="caption" testID="swap-balance-in">
              {rowIn ? t({ id: 'swap.balance', message: 'Balance: {q}', values: { q: formatQuantity(rowIn.quantity) } }) : ''}
            </Body>
            {rowIn ? (
              <Pressable onPress={() => setAmount(rowIn.quantity)} accessibilityRole="button" accessibilityLabel={t({ id: 'send.max', message: 'Max' })} style={{ minHeight: 44, minWidth: 44, marginVertical: -10, justifyContent: 'center', alignItems: 'flex-end' }} testID="swap-max">
                <Body tone="arc" size="caption" fontWeight="600">
                  {t({ id: 'send.max', message: 'Max' })}
                </Body>
              </Pressable>
            ) : null}
          </Row>
        </Plate>

        <Row justifyContent="center" marginVertical={-18} zIndex={2}>
          <Chip onPress={flip} cursor="pointer" width={40} height={40} borderRadius={20} padding={0} justifyContent="center" alignItems="center" backgroundColor="$glassRaisedSolid" borderWidth={0} overflow="hidden" testID="swap-flip">
            <Icon name="swap" color={paint.arc} size={18} />
            <Rim radius={20} opacity={0.85} />
          </Chip>
        </Row>

        {/* You receive */}
        <Plate role="well" gap="$1" padding="$3" testID="terminal-out">
          <Body tone="mute" size="caption">
            {mode === 'swap' ? t({ id: 'swap.receive', message: 'You receive' }) : t({ id: 'limit.receive', message: 'You receive at least' })}
          </Body>
          <Row gap="$2" alignItems="center">
            <Column flex={1}>
              {mode === 'swap' ? (
                <Readout numberOfLines={1} testID="swap-amount-out">
                  {quote && quote.amountOutRaw !== '0' ? formatRaw(quote.receiveRaw, quote.decimalsOut) : '—'}
                </Readout>
              ) : (
                <Input value={minOut} onChange={setMinOut} placeholder="0" bare big testID="limit-min-out" />
              )}
            </Column>
            <TokenChip chainId={ETN} token={outView} onPress={() => setPicker('out')} testID="swap-token-out" />
          </Row>
          <Row minHeight={24} alignItems="center">
            <Body tone="mute" size="caption" testID="swap-balance-out">
              {rowOut ? t({ id: 'swap.balance', message: 'Balance: {q}', values: { q: formatQuantity(rowOut.quantity) } }) : ''}
            </Body>
          </Row>
        </Plate>
      </Plate>

      {/* Rate and route */}
      {mode === 'swap' && quote && quote.amountOutRaw !== '0' ? (
        <Plate role="recessed" paddingVertical="$2" paddingHorizontal="$3" flexDirection="row" justifyContent="space-between" alignItems="center" flexWrap="wrap" gap="$2">
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
              <Chip key={d.id} onPress={() => setDuration(d.id)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={duration === d.id ? paint.arc : undefined} testID={`limit-duration-${d.id}`}>
                <Body tone={duration === d.id ? 'arc' : 'mute'} size="caption">
                  {d.label}
                </Body>
              </Chip>
            ))}
          </Row>
        </Plate>
      ) : null}

      {/* The fee stack: three lines, always (§8.6) */}
      <Column gap="$1" testID="fee-stack">
        {mode === 'swap' ? (
          <>
            <Row justifyContent="space-between">
              <Body tone="mute" size="caption">
                {t({ id: 'swap.impact', message: 'Price impact' })}
              </Body>
              <Body tone={impactTone} size="caption" testID="swap-impact">
                {quote?.priceImpactPct !== null && quote?.priceImpactPct !== undefined ? `${quote.priceImpactPct.toFixed(2)}%` : '—'}
              </Body>
            </Row>
            <Plate padding="$2" gap={2} onPress={() => setFeeSheet(true)} cursor="pointer" testID="swap-fee-line">
              <Row justifyContent="space-between">
                <Body tone="mute" size="caption">
                  {t({ id: 'swap.fee', message: 'Wallet fee' })}
                </Body>
                <Body tone={quote?.fee.source === 'fallback' ? 'ember' : 'ink'} size="caption" testID="swap-fee">
                  {feeLine}
                </Body>
              </Row>
              {nextLine ? (
                <Body tone="ember" size="caption" testID="swap-fee-next">
                  {nextLine}
                </Body>
              ) : null}
            </Plate>
            <Row justifyContent="space-between">
              <Body tone="mute" size="caption">
                {t({ id: 'swap.min', message: 'Minimum received' })}
              </Body>
              <Body tone="mute" size="caption" testID="swap-min">
                {quote && quote.amountOutRaw !== '0' ? `${formatRaw(quote.minimumOutRaw, quote.decimalsOut)} ${quote.symbolOut}` : '—'}
              </Body>
            </Row>
          </>
        ) : (
          <Row justifyContent="space-between">
            <Body tone="mute" size="caption">
              {t({ id: 'limit.fee', message: 'Platform fee 0.1% on fill · no wallet fee' })}
            </Body>
          </Row>
        )}
      </Column>

      {/* Slippage tray */}
      {mode === 'swap' ? (
        <Column gap="$2">
          <Row gap="$2" alignItems="center">
            <Chip onPress={() => setTray((v) => !v)} cursor="pointer" minHeight={44} justifyContent="center" testID="swap-slippage">
              <Body tone="mute" size="caption">
                {t({ id: 'swap.slippage', message: 'Slippage {p}', values: { p: formatPct(effectiveSlippage) } })}
              </Body>
            </Chip>
            {quote && quote.taxBips > 0 ? (
              <Body tone="ember" size="caption" testID="swap-tax">
                {t({ id: 'swap.tax', message: '+{p} token tax', values: { p: formatPct(quote.taxBips) } })}
              </Body>
            ) : null}
          </Row>
          {tray ? (
            <Row gap="$2" alignItems="center" flexWrap="wrap" testID="swap-slippage-tray">
              {SLIPPAGES.map((s) => (
                <Chip key={s} onPress={() => setSlippage(s)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={effectiveSlippage === s ? paint.arc : undefined} testID={`swap-slippage-${s}`}>
                  <Body tone={effectiveSlippage === s ? 'arc' : 'mute'} size="caption">
                    {formatPct(s)}
                  </Body>
                </Chip>
              ))}
              <Column width={96}>
                <Input
                  value={customSlippage}
                  onChange={(v) => {
                    setCustomSlippage(v)
                    const n = Number(v)
                    if (Number.isFinite(n) && n > 0 && n <= 50) setSlippage(Math.round(n * 100))
                  }}
                  placeholder="1.5%"
                  testID="swap-slippage-custom"
                />
              </Column>
            </Row>
          ) : null}
        </Column>
      ) : null}

      {/* The coach, once */}
      {mode === 'swap' && !hasSwapped && !coachDismissed ? (
        <Plate gap="$2" testID="swap-coach">
          <Body size="caption">{t({ id: 'swap.coach', message: 'Your first swap of a token takes up to three signatures: allow Permit2 once (the shared allowance contract ElectroSwap uses), permit this exact amount, then the swap itself. ETN in needs only the swap.' })}</Body>
          <Body tone="mute" size="caption">
            {t({ id: 'swap.coach.fee', message: 'The wallet fee comes out of what you receive; holding BOLT lowers it. Tap the fee line for the schedule.' })}
          </Body>
          <Key label={t({ id: 'swap.coach.ok', message: 'Got it' })} kind="secondary" onPress={() => setCoachDismissed(true)} testID="swap-coach-ok" />
        </Plate>
      ) : null}

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
              <Plate key={o.orderId} gap="$1" testID={`limit-order-${o.orderId}`}>
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
                  {o.status === 'open' ? <Key label={t({ id: 'approval.cancel', message: 'Cancel' })} kind="secondary" onPress={() => void cancelOrder(o.orderId)} testID={`limit-cancel-${o.orderId}`} /> : null}
                </Row>
              </Plate>
            ))
          )}
        </Column>
      ) : null}

      <FeeScheduleSheet open={feeSheet} onClose={() => setFeeSheet(false)} accountId={active?.id ?? null} chainId={ETN} onGetBolt={() => {
        const bolt = tokens.find((x) => x.symbol === 'BOLT')
        if (bolt) {
          setTokenOut(bolt.address)
          if (tokenIn.toLowerCase() === bolt.address.toLowerCase()) setTokenIn('native')
        }
        setFeeSheet(false)
      }} />

      <Sheet open={picker !== null} onClose={() => setPicker(null)} title={picker === 'in' ? t({ id: 'swap.pick.in', message: 'You pay' }) : t({ id: 'swap.pick.out', message: 'You receive' })} testID="swap-picker">
        <ScrollView contentContainerStyle={{ padding: 20, gap: 8 }}>
          {tokens.map((x) => {
            const row = portfolio.snapshot?.rows.find((r) => r.address.toLowerCase() === x.address.toLowerCase())
            return (
              <Plate key={x.address} onPress={() => pick(x.address)} cursor="pointer" padding="$3" testID={`swap-pick-${x.symbol}`}>
                <Row gap="$3" alignItems="center" justifyContent="space-between">
                  <Row gap="$3" alignItems="center">
                    <TokenAvatar chainId={ETN} address={x.address === 'native' ? '0x0000000000000000000000000000000000000000' : x.address} logoUri={x.logoUri} size={28} />
                    <Column>
                      <Body>{x.symbol}</Body>
                      <Body tone="mute" size="caption">
                        {x.name}
                      </Body>
                    </Column>
                  </Row>
                  <Body tone="mute" size="caption">
                    {row ? formatQuantity(row.quantity) : ''}
                  </Body>
                </Row>
              </Plate>
            )
          })}
        </ScrollView>
      </Sheet>
    </ScrollView>
  )
}

function TokenChip({ chainId, token, onPress, testID }: { chainId: number; token: TokenView | null; onPress: () => void; testID: string }) {
  return (
    <Chip onPress={onPress} cursor="pointer" minHeight={44} justifyContent="center" testID={testID}>
      <Row gap="$2" alignItems="center">
        {token ? <TokenAvatar chainId={chainId} address={token.address === 'native' ? '0x0000000000000000000000000000000000000000' : token.address} logoUri={token.logoUri} size={20} /> : null}
        <Body size="title">{token?.symbol ?? t({ id: 'swap.pick', message: 'Pick' })}</Body>
        <Icon name="chevronRight" size={14} color={paint.mute} />
      </Row>
    </Chip>
  )
}
