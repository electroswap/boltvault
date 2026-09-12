/**
 * Swap (master plan §8.6; plan B4): a title row with the slippage pill, the
 * console — two wells with the flip on their seam — a rate line, and a fee
 * plate that always shows price impact, the wallet fee with your BOLT tier,
 * minimum received (or pay-at-most on exact-out) and the locked liquidity
 * behind the pair. Typing in "You pay" is exact-in; typing in "You receive"
 * is exact-out, except when a fee-on-transfer token cannot honour a promised
 * output. Quotes come from the routing service and re-rate every block; a
 * quote older than 8 s disarms the key. The default pair is ETN → BOLT; a
 * token page opens the swap with ETN → that token. Slippage, the token
 * picker, the fee schedule and the first-swap coach are sheets beside the
 * screen. Confirming runs a flow of sheets (approve → permit → swap) and
 * the Discharge lands the result here.
 */
import { Body, ChainMark, Chip, Column, Discharge, Icon, IconButton, Key, Pill, Plate, Pressable, Rim, Row, ScrollView, Segmented, TokenAvatar, metrics, paint, shortAddress, useWindowDimensions } from '@boltvault/ui'
import { cacheKey, type ExploreToken, type LimitOrderView, type LimitQuote, type LiquidityView, type SwapArgs, type SwapQuoteView, type TokenView } from '@boltvault/engine'
import { formatUnits } from 'viem'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { SlippageSheet } from '../components/SlippageSheet'
import { SwapCoachSheet } from '../components/SwapCoachSheet'
import { TokenPickerSheet, type TokenSafety } from '../components/TokenPickerSheet'
import { HomeKey } from '../components/HomeKey'
import { useEngine } from '../engine/EngineProvider'
import { useActivity } from '../hooks/useActivity'
import { useCached } from '../hooks/useCached'
import { useChainHead } from '../hooks/useChainHead'
import { useName } from '../hooks/useNames'
import { usePortfolio } from '../hooks/usePortfolio'
import { usePrefs } from '../hooks/usePrefs'
import { formatAmountFiat, formatFloor, formatInputAmount, formatPct, formatQuantity, formatRate, formatRaw } from '../format'
import { t } from '../i18n'
import { swapFlowStore, useSwapFlow } from '../state/useSwapFlow'
import { useScreenBusy } from '../state/useScreenBusy'
import { useWalletState } from '../state/useWalletState'
import { AmountWell } from '../components/AmountWell'
import { useRouter } from '../navigation/router'
import { FeeScheduleSheet } from './FeeScheduleSheet'
import { statusLabel, stepLabel } from '../components/FlowPlate'

const ETN = 52014

/**
 * The page's side margin, taken from the interface's own `PageWrapper`
 * (`padding: 68px 8px 0px`).
 *
 * Every other screen here uses `metrics.inset`/`insetWide` — 13 and 16 — and
 * on the swap screen that put a third more air down each side than the page
 * the owner reads beside it. This is the one screen with something to match,
 * so it matches, and nothing else moves. Owner: "Less margins on the
 * left/right, center the dialog in the page."
 */
const GUTTER = 8

/**
 * The one vertical gap inside the console.
 *
 * Pay → receive, receive → details, details → key: all this. Measured off the
 * owner's screenshot the three were 13, 5.5 and 11.5 dp, which is what "the
 * gaps look wrong" turns out to mean; the interface runs a single
 * `AutoColumn gap="xs"` (4 px) through the whole card.
 */
const GAP = 6

/**
 * What the seam row takes back so the two wells sit `GAP` apart like everything
 * else.
 *
 * The controls are a 44 px row between two wells in a `gap: GAP` column, so
 * left alone they push the wells `GAP + 44 + GAP` apart — three times any other
 * gap on the card. Pulling `(44 + GAP) / 2` off each side makes the row's own
 * contribution `-GAP`, and the two gaps either side then add back to exactly
 * `GAP`. The circles still overflow into both wells, which is the whole point
 * of a seam control (`MidButtonWrapper` does the same with `margin: -18px 0`).
 */
const SEAM_PULL = -(44 + GAP) / 2

/**
 * The air above the card, which the details reclaim when they open.
 *
 * Owner wants the dialog lower on the page, and also not to have to scroll once
 * the details are showing. Those pull opposite ways, so the space is only there
 * while it is free.
 */
const TOP_AIR = 48

/**
 * The air above and below every line of the details card.
 *
 * Owner: "reduce the gap between line items in the details section." It was 9,
 * which put 18 px between two captions and made four short rows as tall as a
 * terminal. The rows still clear a 44 px tap target where one is pressable —
 * that is set on the `Pressable`, not here.
 */
const ROW_PAD = 5

/**
 * How long the screen waits after a keystroke before asking for a price.
 *
 * Every millisecond here is a millisecond the user spends looking at the
 * previous number, so it is the cheapest latency in the whole path to give
 * back — and now the safest, because a request this does start is cancelled by
 * the next one rather than left running. 250 was chosen when a superseded quote
 * ran to completion and cost a full mini-router call; it no longer does.
 */
const QUOTE_DEBOUNCE_MS = 160
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
  const router = useRouter()
  const { active } = useWalletState()
  /*
    Which account is spending, the way every other money screen says it.

    The craft pass put the account under the title on Send, Swap and Bridge
    (the milestone log); Swap stated its chain and never its account, so the
    one screen that spends from a wallet you may hold four of did not say which
    one it was spending from. Same descriptor, same caption scale as
    `ScreenHeader`'s subtitle — the name stands in for the short address when
    one resolves (§8.1).
  */
  const accountName = useName(active?.address)
  const { width, height } = useWindowDimensions()
  const portfolio = usePortfolio(active?.id ?? null)
  const { entries, loaded: activityLoaded } = useActivity(active?.id ?? null)
  const head = useChainHead(ETN)
  const { prefs, loaded: prefsLoaded, set: setPrefs } = usePrefs()
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
  /**
   * The amount the user typed, and which well they typed it in.
   *
   * Exact-out is not a separate mode or a pill: typing in "You receive" is
   * exact-out, typing in "You pay" is exact-in, the same way the web interface
   * treats `independentField`. Fee-on-transfer tokens cannot honour an exact
   * output, so that well is disabled when the quote reports a tax.
   */
  const [tradeType, setTradeType] = useState<'exactIn' | 'exactOut'>('exactIn')
  const [amount, setAmount] = useState('')
  const quoteNow = useRef(false)
  const maxGen = useRef(0)
  const [minOut, setMinOut] = useState('')
  const [duration, setDuration] = useState<string>('604800')
  const [slippage, setSlippage] = useState<number | null>(null)
  const [slippageOpen, setSlippageOpen] = useState(false)
  const [picker, setPicker] = useState<'in' | 'out' | null>(null)
  const [quote, setQuote] = useState<SwapQuoteView | null>(null)
  const [limitQuote, setLimitQuote] = useState<LimitQuote | null>(null)
  const [orders, setOrders] = useState<LimitOrderView[]>([])
  const [feeSheet, setFeeSheet] = useState(false)
  /*
    The details card starts closed.

    It opened by default when it was still two always-open plates wearing a new
    header; as a disclosure it should behave like one, and the interface's does
    (`SwapDetailsDropdown`). The figures are one tap away, and the lock on the
    seam is a second way in — see `openDetails`.
  */
  const [details, setDetails] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  /*
    The ES overlay from the click until the signing sheet has a preview.

    `execute`/`place` wait on the first sheet, then this screen still has to
    hand the flow to the shell and unmount. Clearing `busy` in `finally` lifted
    the loader onto the "Swapping…" panel for that gap. Stay busy on success
    so the overlay covers the handoff; Approval takes the flag the moment it
    mounts, and unmounting here clears ours.
  */
  useScreenBusy('swap', busy)
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
  const swapArgs = useCallback((): SwapArgs => {
    const base = {
      accountId: active?.id ?? '',
      chainId: ETN,
      tokenIn,
      tokenOut,
      slippageBips: effectiveSlippage,
    }
    return tradeType === 'exactOut'
      ? { ...base, amountOut: amount, tradeType: 'exactOut' as const }
      : { ...base, amountIn: amount, tradeType: 'exactIn' as const }
  }, [active?.id, tokenIn, tokenOut, effectiveSlippage, amount, tradeType])
  // Quote as the user types and again on every block while the pair is set (§8.6: rerated per block).
  useEffect(() => {
    if (!active || !tokenOut || slippage === null) return
    if (mode === 'swap') {
      if (!amount.trim()) {
        setQuote(null)
        return
      }
      /*
        The debounce, and what happens to the one already in flight.

        `alive` was only a guard against a late answer painting over a newer
        one. It still is — but the request it belongs to now stops as well: the
        engine's `Quoter` aborts whatever it was asking about this pair the
        moment a new amount arrives, and a superseded quote returns a skeleton
        instead of falling through to the mini-router. So a fast typist leaves
        no fetches running behind them and no RPC spent on amounts they have
        already replaced. Owner: "cancel in flight requests if the input/output
        number is updated."

        `QUOTE_DEBOUNCE_MS` is the wait before asking at all, and it is time the
        user spends looking at a stale number, so it is as short as it can be
        without asking on every keypress.
      */
      let alive = true
      const wait = quoteNow.current ? 0 : QUOTE_DEBOUNCE_MS
      quoteNow.current = false
      const id = setTimeout(() => {
        engine.swap.quote(swapArgs()).then(
          (q) => alive && setQuote(q),
          (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
        )
      }, wait)
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
  }, [engine, active, mode, tokenIn, tokenOut, amount, swapArgs, minOut, duration, effectiveSlippage, slippage, head?.blockNumber])

  useEffect(() => {
    if (flow?.status === 'done') setFire((n) => n + 1)
  }, [flow?.status])

  /*
    Token safety, from the same feed Explore reads (§8.3). It is display-only
    everywhere else in the product, and the swap path never consulted it at
    all, so a token the market has marked BLOCKED could be bought in two taps.
    What a screen can do about that is refuse to offer the verb and say why.

    This is not a gate and must not be read as one: it fails open when the
    market feed is unreachable, and it guards one screen rather than the code
    that builds the transaction — a dApp, a deep link or a second surface
    reaches `swap.execute` without passing here at all. The real refusal
    belongs in `SwapService.quote`/`execute` (and `LimitService.place`), which
    the wallet package may not edit.
  */
  const exploreTokens = useCached<ExploreToken[]>({
    key: cacheKey('explore', 'tokens', ETN),
    cached: (e) => e.explore.cachedTokens({ chainId: ETN }),
    fresh: (e) => e.explore.tokens({ chainId: ETN }),
    maxAgeMs: 10 * 60_000,
  })
  const safety = useMemo(() => {
    const m = new Map<string, TokenSafety>()
    for (const x of exploreTokens.value ?? []) if (x.safety) m.set(x.address.toLowerCase(), x.safety)
    return m
  }, [exploreTokens.value])

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

  useEffect(() => {
    maxGen.current += 1
  }, [tokenIn, tokenOut])

  /*
    Native MAX fills the balance less 120% of the quoted network fee. When we
    do not have that number yet, ask once at the full balance (that quote is
    refused, which is the point) and take `maxSpendableRaw` off it rather than
    inventing a reserve.
  */
  const fillPayMax = useCallback(() => {
    if (!rowIn) return
    quoteNow.current = true
    if (rowIn.address !== 'native') {
      setTradeType('exactIn')
      setAmount(rowIn.quantity)
      return
    }
    const ready = spendableNative(quote)
    if (ready) {
      setTradeType('exactIn')
      setAmount(ready)
      return
    }
    const gen = ++maxGen.current
    const quantity = rowIn.quantity
    void engine.swap
      .quote({
        accountId: active?.id ?? '',
        chainId: ETN,
        tokenIn,
        tokenOut,
        slippageBips: effectiveSlippage,
        amountIn: quantity,
        tradeType: 'exactIn',
      })
      .then(
        (q) => {
          if (gen !== maxGen.current) return
          quoteNow.current = true
          setTradeType('exactIn')
          setAmount(spendableNative(q) ?? quantity)
        },
        () => {
          if (gen !== maxGen.current) return
          quoteNow.current = true
          setTradeType('exactIn')
          setAmount(quantity)
        },
      )
  }, [rowIn, quote, engine, active?.id, tokenIn, tokenOut, effectiveSlippage])

  const typePay = useCallback((value: string) => {
    maxGen.current += 1
    if (tradeType !== 'exactIn') setQuote(null)
    setTradeType('exactIn')
    setAmount(value)
  }, [tradeType])

  const typeReceive = useCallback((value: string) => {
    maxGen.current += 1
    if (tradeType !== 'exactOut') setQuote(null)
    setTradeType('exactOut')
    setAmount(value)
  }, [tradeType])

  /*
    A fee-on-transfer token cannot honour an exact output. The engine already
    refuses to quote one; this keeps the well from asking again — and if the
    user typed an output amount before the tax probe landed, moves that trade
    back to exact-in with the quoted spend as the new typed amount.
  */
  useEffect(() => {
    if (!quote || quote.taxBips <= 0 || tradeType !== 'exactOut') return
    setTradeType('exactIn')
    setAmount(quote.amountInRaw !== '0' ? formatInputAmount(quote.amountInRaw, quote.decimalsIn) : '')
  }, [quote, tradeType])

  /*
    A quote is a quote OF a pair, so changing what the trade is made of drops
    it: the figures on screen belong to the tokens that were there a moment ago.
  */
  const resetQuote = useCallback(() => {
    setQuote(null)
  }, [])

  const flip = useCallback(() => {
    /*
      The number stays with the token, so the independent field flips with the
      wells — unless the new output cannot honour an exact amount. Then we keep
      exact-in and put the previous receive estimate in "You pay", the same
      way the web interface's `switchCurrencies` does for a fee-on-transfer
      token.
    */
    const fot = (quote?.taxBips ?? 0) > 0
    if (fot && tradeType === 'exactIn') {
      if (quote && quote.amountOutRaw !== '0') setAmount(formatInputAmount(quote.receiveRaw, quote.decimalsOut))
    } else {
      setTradeType((cur) => (cur === 'exactIn' ? 'exactOut' : 'exactIn'))
    }
    setTokenIn(tokenOut)
    setTokenOut(tokenIn)
    resetQuote()
  }, [tokenIn, tokenOut, resetQuote, quote, tradeType])

  const pick = (address: string): void => {
    if (picker === 'in') {
      if (address.toLowerCase() === tokenOut.toLowerCase()) setTokenOut(tokenIn)
      setTokenIn(address)
    } else if (picker === 'out') {
      if (address.toLowerCase() === tokenIn.toLowerCase()) setTokenIn(tokenOut)
      setTokenOut(address)
    }
    resetQuote()
    setPicker(null)
  }

  const run = async (): Promise<void> => {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      const r =
        mode === 'swap'
          ? await engine.swap.execute(swapArgs())
          : await engine.limit.place({ accountId: active.id, chainId: ETN, tokenIn, tokenOut, amountIn: amount, minOut, durationSeconds: Number(duration) })
      const f = await engine.swap.flow({ flowId: r.flowId })
      if (f) swapFlowStore.upsert(f)
      setActive(r.flowId)
      // No sheet to hand to — nothing to cover. A signing request keeps us
      // busy until this screen unmounts under the overlay.
      if (!r.requestId) setBusy(false)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
              {q.tradeType === 'exactOut'
                ? t({ id: 'swap.summary.out', message: 'at most {a} {s} → {b} {u}', values: { a: formatRaw(q.maximumInRaw, q.decimalsIn), s: q.symbolIn, b: formatRaw(q.receiveRaw, q.decimalsOut), u: q.symbolOut } })
                : t({ id: 'swap.summary', message: '{a} {s} → at least {b} {u}', values: { a: formatRaw(q.amountInRaw, q.decimalsIn), s: q.symbolIn, b: formatFloor(q.minimumOutRaw, q.decimalsOut), u: q.symbolOut } })}
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

  const feeMain = quote ? (quote.fee.bips === 0 ? t({ id: 'swap.fee.zero.v2', message: 'No wallet fee · {name}', values: { name: quote.fee.name } }) : t({ id: 'swap.fee.main.v2', message: '{p} · {name}', values: { p: formatPct(quote.fee.bips), name: quote.fee.name } })) : t({ id: 'swap.fee.idle', message: '0.50% · hold BOLT for less' })
  const feeDetail = quote && quote.fee.bips > 0 && quote.amountOutRaw !== '0' ? t({ id: 'swap.fee.detail', message: '{a} {s} to {to}', values: { a: formatRaw(quote.fee.amountRaw, quote.decimalsOut), s: quote.symbolOut, to: quote.fee.sink ? shortAddress(quote.fee.sink) : '—' } }) : null
  const nextLine = quote?.fee.nextTierAt && quote.fee.nextTierBips !== null ? t({ id: 'swap.fee.next', message: 'hold {n} BOLT-eq for {p}', values: { n: formatRaw(quote.fee.nextTierAt, 18), p: formatPct(quote.fee.nextTierBips) } }) : null
  const lockText = liquidity.value
    ? liquidity.value.lockedPct > 0
      ? t({ id: 'swap.locks', message: '{p}% locked · {n}', values: { p: Math.round(liquidity.value.lockedPct), n: liquidity.value.lockCount === 1 ? t({ id: 'swap.locks.one', message: '1 lock' }) : t({ id: 'swap.locks.many', message: '{n} locks', values: { n: liquidity.value.lockCount } }) } })
      : t({ id: 'swap.locks.none', message: 'No locks' })
    : lockToken && liquidity.freshness === 'loading'
      ? '…'
      : t({ id: 'swap.locks.unknown', message: 'No lock data' })
  const lockTone: 'surge' | 'ember' | 'mute' = liquidity.value ? (liquidity.value.lockedPct >= 50 ? 'surge' : liquidity.value.lockedPct > 0 ? 'ember' : 'mute') : 'mute'
  /*
    The lock treatment, taken from the interface as closely as it goes.

    `pages/Swap/index.tsx` there: `SwapSection locked` swaps both terminals'
    borders to `theme.success`, and a second seam control appears beside the
    flip arrow — `MidButtonWrapper success`, a 40 px circle filled with that
    same green, ringed 4 px in the panel's own colour, holding a dark padlock.
    Owner, on the first attempt: "the locked liquidity treatment is different, I
    want as close as possible." It was a pill reading "100%"; it is the circle
    now, on the left of the flip exactly as it sits there.

    `theme.success` in the interface is #3EE6A5 — the same value as `paint.surge`
    here, so the green is literally the same green. The one thing still ours is
    that the colour follows `lockTone`: at 12% locked the rim is ember, so it
    agrees with the "Liquidity locked" row instead of calling 12% and 90% the
    same reassurance.
  */
  const lockedPct = mode === 'swap' && liquidity.value ? liquidity.value.lockedPct : 0
  const lockPaint = lockedPct > 0 ? (lockTone === 'surge' ? paint.surge : paint.ember) : null
  /*
    The lock rim at full strength.

    It was the surge green at 55% alpha (`…8c`), which over the well's navy
    measured rgb(39,133,111) against the interface's rgb(65,245,172) for the
    same border — the same hue, a third of the light. Owner: "Green border
    around the input/output looks too dark." `SwapSection locked` there takes
    `theme.success` flat, so this does too.
  */
  const lockRim = lockPaint
  const problem = mode === 'swap' ? (quote?.problems[0] ?? null) : (limitQuote?.problems[0] ?? null)
  /*
    A blocked token takes the key away on either side of the trade: buying one
    and selling into one are the same transaction from the router's point of
    view, and both are how the loss happens.
  */
  const blockedSide = safety.get(tokenOut.toLowerCase()) === 'BLOCKED' ? outView : safety.get(tokenIn.toLowerCase()) === 'BLOCKED' ? inView : null
  const warnedSide = blockedSide !== null ? null : safety.get(tokenOut.toLowerCase()) === 'STRONG_WARNING' ? outView : safety.get(tokenIn.toLowerCase()) === 'STRONG_WARNING' ? inView : null
  const canSwap = blockedSide === null && (mode === 'swap' ? !!quote?.ok && fresh && !busy : !!limitQuote?.ok && !busy)
  const priced = quote && quote.amountOutRaw !== '0'
  /*
    Fee-on-transfer: the same gate the web interface uses. Either side charging
    a transfer tax makes the output amount a guess rather than a promise, so
    the receive well stays a quote of what you pay, not a field you type into.
  */
  const fotLocked = mode === 'swap' && (quote?.taxBips ?? 0) > 0
  const payText = tradeType === 'exactIn' ? amount : priced ? formatInputAmount(quote.amountInRaw, quote.decimalsIn) : ''
  const receiveText = tradeType === 'exactOut' ? amount : priced ? formatInputAmount(quote.receiveRaw, quote.decimalsOut) : ''
  /*
    Which token "Details" is about.

    The pair's subject is what you are buying, so it is the output side — except
    when the output is ETN or its wrapper, where "details" would be a page about
    the chain's own coin and the interesting half of the trade is what you are
    selling. Owner: "Details takes the user to the token details page (of the
    output token, unless the output is ETN/WETN, in which case Details goes to
    the input token)."

    WETN is spotted by symbol rather than by address: `@boltvault/chains` holds
    the address but is not a dependency of this package, and the token universe
    this screen already has says the same thing.
  */
  const isEtnSide = (address: string, view: TokenView | null): boolean => address === 'native' || view?.symbol?.toUpperCase() === 'WETN'
  const detailsToken = !isEtnSide(tokenOut, outView) ? tokenOut : !isEtnSide(tokenIn, inView) ? tokenIn : null
  /** Is there anything to say above the key? If not, the box that would say it is not rendered at all. */
  const notices = Boolean(blockedSide || warnedSide || fotLocked || (problem && (amount.trim() || minOut.trim())) || error || (mode === 'swap' && quote?.ok && !fresh))
  const keyLabel = mode === 'swap' ? (quote && quote.priceImpactPct !== null && quote.priceImpactPct > 15 ? t({ id: 'swap.key.anyway', message: 'Swap anyway' }) : t({ id: 'swap.key', message: 'Swap' })) : t({ id: 'swap.limit.key', message: 'Place order' })

  return (
    <Column flex={1}>
      {/*
        The dialog, laid out the way the interface lays its own out.

        `PageWrapper` there is `max-width: 480px; margin: 0 auto` with 8 px of
        side padding, and everything — header, both terminals, the details row
        and the Swap button — lives inside the one `SwapWrapper` card. This
        screen had the console at a 16 px inset, the details as a second plate
        below it, and the key pinned to the bottom of the *window* by
        `ScreenFooter`, which is what put half a phone of empty space between
        the card and the button the owner was reaching for. Owner: "Less
        margins on the left/right, center the dialog in the page, bring the
        swap button up."
      */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: GUTTER, paddingVertical: inset, gap: 10 }} testID="swap">
        <Column width="100%" maxWidth={metrics.dialog} alignSelf="center" gap={10}>
        {/*
          The screen header, one line shorter than it was.

          It carried the title, the account, the chain on its own third line AND
          the slippage pill — four things stacked above a card that starts with
          four more. Owner: "the top of the screen feels very crowded." The
          chain takes the slippage's old place on the right (owner: "Chain
          selector moves to where the slippage settings currently is"), which
          buys back the third line, and slippage moves inside the card where the
          interface keeps it.

          It is a mark, not a control: this screen is Electroneum-only, so a
          chevron would promise a choice that does not exist. `Pill` without
          `onPress` is exactly that — a static mark with no button role.
        */}
        <Row alignItems="flex-start" minHeight={metrics.header} gap="$2">
          <HomeKey />
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
            /*
              The chain rides on the TITLE's line, not on the row, so the
              account gets the full width underneath it.

              Sharing one row three ways left the caption about 200 px on a
              narrow body and it truncated an already-shortened address into
              "0x9858……". The title is two words; the chain pill is three; they
              fit together, and the line that has to hold a label and an address
              then has the card's whole width to do it in.
            */
            <Column flex={1} minWidth={0} gap={2}>
              <Row justifyContent="space-between" alignItems="center" gap="$2">
                <Body size="title">{t({ id: 'swap.title', message: 'Swap' })}</Body>
                <Pill label="Electroneum" icon={<ChainMark chainId={ETN} size={14} />} size="sm" tone="ink" testID="swap-chain" />
              </Row>
              {active ? (
                <Body tone="mute" size="caption" numberOfLines={1} testID="swap-account">
                  {t({ id: 'from.account', message: 'from {a}', values: { a: `${active.label} · ${accountName ?? shortAddress(active.address)}` } })}
                </Body>
              ) : null}
            </Column>
          )}
        </Row>

        {/*
          Air above the card, given back when the details open.

          Owner: "I want the whole dialog to be moved down so the top of the
          page feels less crowded" — and then: "When details is expanded, any
          extra space above the swap dialog should be reclaimed if needed to
          hopefully not have to scroll on the page." So the air is exactly that:
          a spacer that exists while the card is short and collapses the moment
          it grows.
        */}
        <Column height={details ? 0 : TOP_AIR} />

        {/*
          The console: two wells, the seam controls between them, the details
          row and the key, all in one panel — `SwapWrapper` holds exactly this
          set, and its inner padding is 8, not 10.

          One `gap` for every child, so the distance from pay to receive, from
          receive to the details row, and from the details row to the key are
          the same number. Owner: "Vertical gap between the input container,
          output container, details, and swap button should be made
          consistent." The seam is what made that hard, and `SEAM_PULL` is what
          settles it — see there.
        */}
        <Plate role="console" gap={GAP} padding={8} testID="swap-console">
          {/*
            The card's own header, as the interface has it: "Swap  Details" at
            the left and the gear at the right (`SwapHeader`). Swap is a label,
            not a tab — this screen is the swap — and Details opens the token's
            page, which is where the interface's own Details tab goes.
          */}
          {mode === 'swap' ? (
            <Row justifyContent="space-between" alignItems="center" paddingLeft={6} minHeight={metrics.hit}>
              <Row gap="$3" alignItems="center">
                <Body size="title">{t({ id: 'swap.title', message: 'Swap' })}</Body>
                {detailsToken ? (
                  <Pressable
                    onPress={() => router.navigate('token', { chainId: ETN, address: detailsToken })}
                    accessibilityRole="button"
                    accessibilityLabel={t({ id: 'swap.tokenDetails.a11y', message: 'Token details' })}
                    style={{ minHeight: metrics.hit, justifyContent: 'center' }}
                    testID="swap-token-details"
                  >
                    <Body size="title" tone="mute">
                      {t({ id: 'swap.details.tab', message: 'Details' })}
                    </Body>
                  </Pressable>
                ) : null}
              </Row>
              <IconButton icon="settings" label={t({ id: 'swap.slippage', message: 'Slippage {p}', values: { p: formatPct(effectiveSlippage) } })} onPress={() => setSlippageOpen(true)} testID="swap-slippage" />
            </Row>
          ) : null}
          <AmountWell
            label={t({ id: 'swap.pay', message: 'You pay' })}
            value={payText}
            onChange={typePay}
            {...(inView ? { decimals: inView.decimals } : {})}
            louder
            tokenPill={<TokenPill token={inView} onPress={() => setPicker('in')} testID="swap-token-in" />}
            fiat={formatAmountFiat(payText, rowIn, currency)}
            balance={rowIn ? `${formatQuantity(rowIn.quantity)} ${rowIn.symbol}` : null}
            onMax={rowIn ? fillPayMax : undefined}
            accent={lockRim}
            testID="terminal-in"
            inputTestID="swap-amount-in"
            maxTestID="swap-max"
            balanceTestID="swap-balance-in"
          />

          {/*
            The seam controls, as the interface arranges them: the lock on the
            left and the flip on the right, both 36 px circles ringed 4 px in the
            console's own colour so they read as punched through the seam rather
            than laid on top of it (`MidButtonWrapper`: `border: 4px solid
            theme.surface1`).
          */}
          <Row justifyContent="center" alignItems="center" gap={2} marginVertical={SEAM_PULL} zIndex={2}>
            {/*
              The lock opens the details, where the figure it stands for lives.
              The interface's opens a tooltip carrying the lock's end date; ours
              has a row saying "100% locked · 1 lock", and a mark that says
              something is true should take you to the thing that says it.
            */}
            {lockPaint ? (
              <Pressable
                onPress={() => setDetails(true)}
                accessibilityRole="button"
                accessibilityLabel={t({ id: 'swap.locked.a11y', message: 'Liquidity locked: {v}', values: { v: lockText } })}
                style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }}
                testID="swap-lock-badge"
              >
                <Column width={40} height={40} borderRadius={20} alignItems="center" justifyContent="center" backgroundColor="$glassRaisedSolid">
                  <Column width={32} height={32} borderRadius={16} alignItems="center" justifyContent="center" backgroundColor={lockPaint}>
                    <Icon name="lock" size={15} color={paint.void} />
                  </Column>
                </Column>
              </Pressable>
            ) : null}
            <Pressable onPress={flip} accessibilityRole="button" accessibilityLabel={t({ id: 'swap.flip', message: 'Swap direction' })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="swap-flip">
              <Column width={40} height={40} borderRadius={20} alignItems="center" justifyContent="center" backgroundColor="$glassRaisedSolid">
                <Chip width={32} height={32} borderRadius={16} padding={0} justifyContent="center" alignItems="center" backgroundColor="$glassRaisedSolid" borderWidth={0} overflow="hidden">
                  <Icon name="swap" color={paint.arc} size={16} />
                  <Rim radius={16} opacity={0.85} />
                </Chip>
              </Column>
            </Pressable>
          </Row>

          {mode === 'swap' ? (
            /*
              The receive terminal is an input, the same as "You pay".

              Typing here is exact-output: the engine prices `tradeType: 'exactOut'`
              and the routing service answers `EXACT_OUTPUT`. There is no pill —
              the owner did not want an "Exact amount" control, and the web
              interface has none either. Fee-on-transfer tokens cannot honour a
              promised output (`taxBips > 0`), so the well is disabled then,
              matching `numericalInputSettings.disabled` on the site.
            */
            <AmountWell
              label={t({ id: 'swap.receive', message: 'You receive' })}
              value={receiveText}
              onChange={typeReceive}
              disabled={fotLocked}
              louder
              tokenPill={<TokenPill token={outView} onPress={() => setPicker('out')} testID="swap-token-out" />}
              fiat={priced ? formatAmountFiat(receiveText.replace(/,/g, ''), rowOut, currency) : null}
              balance={rowOut ? `${formatQuantity(rowOut.quantity)} ${rowOut.symbol}` : null}
              accent={lockRim}
              testID="terminal-out"
              inputTestID="swap-amount-out"
              balanceTestID="swap-balance-out"
            />
          ) : (
            <AmountWell
              label={t({ id: 'limit.receive', message: 'You receive at least' })}
              value={minOut}
              onChange={setMinOut}
              louder
              tokenPill={<TokenPill token={outView} onPress={() => setPicker('out')} testID="swap-token-out" />}
              fiat={formatAmountFiat(minOut, rowOut, currency)}
              balance={rowOut ? `${formatQuantity(rowOut.quantity)} ${rowOut.symbol}` : null}
              testID="terminal-out"
              inputTestID="limit-min-out"
              balanceTestID="swap-balance-out"
            />
          )}

          {/*
            The details card, in the interface's shape: the rate is the row you
            always see, with the route beside it and a chevron at the end, and
            the rest of the figures live under it.

            It used to be two plates — a rate strip and a four-row fee stack,
            both always open — which is most of why the two screens did not look
            alike however closely the console matched. `SwapDetailsDropdown`
            there is one card: "1 BOLT = 2.31282 ETN" and a chevron, then price
            impact, max slippage, network cost, order routing — and it is a
            child of `SwapWrapper`, not a plate floating below it, which is why
            it sits inside the console here now.
          */}
          {/*
            Same well as the terminals, one border — the current rim, not `$edge`.

            Owner: "the rate container should be the same width as the
            input/output containers." The nested look was this plate's `$edge`
            hairline plus a second SVG rim inset by a pixel. Turning the rim
            off left the grey hairline, which is the wrong colour next to the
            console. `borderWidth={0}` drops that; `rim` is the same stroke
            the console and the flip chip use.
          */}
          {mode === 'swap' ? (
          <Plate role="well" borderWidth={0} rim={0.7} gap={0} padding={0} testID="fee-stack">
            <Pressable
              onPress={() => setDetails((d) => !d)}
              accessibilityRole="button"
              accessibilityLabel={t({ id: 'swap.details.a11y', message: 'Swap details' })}
              style={{ minHeight: 44, justifyContent: 'center', paddingHorizontal: 12, paddingVertical: 2 }}
              testID="swap-details-toggle"
            >
              <Row justifyContent="space-between" alignItems="center" gap="$2" minHeight={40}>
                <Body tone={fresh ? 'ink' : 'mute'} size="caption" fontWeight="600" flexShrink={1} numberOfLines={1} testID="swap-rate">
                  {/*
                    "Rate", not "Details" — the card's own header now has a
                    Details link, and one card saying Details twice, three rows
                    apart, meaning two different things, is worse than a
                    placeholder that says what the row will hold.
                  */}
                  {quote && quote.amountOutRaw !== '0' ? (formatRate(quote.rate, quote.symbolIn, quote.symbolOut) ?? '') : t({ id: 'swap.rate.idle', message: 'Rate' })}
                </Body>
                <Row gap="$1" alignItems="center" flexShrink={0}>
                  <Row gap="$1" alignItems="center" testID="swap-route">
                    {(quote?.route.hops ?? []).map((h, i) => (
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
                  <Icon name={details ? 'chevronUp' : 'chevronDown'} size={16} color={paint.mute} />
                </Row>
              </Row>
            </Pressable>
            {details ? <Column height={1} backgroundColor="$edge" marginHorizontal={12} marginVertical={4} /> : null}
            {details ? (
            <Column paddingHorizontal={12} paddingBottom={2}>
            <FeeRow label={t({ id: 'swap.impact', message: 'Price impact' })} value={quote?.priceImpactPct !== null && quote?.priceImpactPct !== undefined ? `${quote.priceImpactPct.toFixed(2)}%` : '—'} tone={impactTone} testID="swap-impact" />
            {/*
              Where the price came from (ES-BV-003).

              The served `amountOut` sets the floor written into the calldata,
              and the price-impact figure above is measured against a probe on
              that same served route — so it agrees with the service by
              construction. Saying which of the two priced this swap is the
              cheapest honest thing the screen can do about that; the
              confirming on-chain call happens when the user says yes.
            */}
            <FeeRow
              label={t({ id: 'swap.priced', message: 'Priced by' })}
              /*
                The flow's quote wins once there is one (ES-BV-003, gap 2).

                `execute()` prices the served route on chain before it encodes
                anything and writes the result back to the flow. Reading only
                the keystroke quote here meant the row kept saying "ElectroSwap
                routing" for a swap the wallet had in fact re-priced itself,
                which is the one case the row exists to report.
              */
              value={(flow?.quote ?? quote)?.route.source === 'api' ? t({ id: 'swap.priced.api', message: 'ElectroSwap routing' }) : t({ id: 'swap.priced.chain', message: 'On chain' })}
              tone="mute"
              testID="swap-priced-by"
            />
            {/*
              No negative margin. It was `marginVertical: -8` to keep a 44 px
              target from spacing the rows out, and the price it paid was that
              the fee's second and third lines rendered OUTSIDE the row's box —
              the owner photographed "0.006179 BOLT to 0xD6Cf…69d0" lying across
              "Minimum received". A tap target may overlap its neighbours; text
              may not.
            */}
            <Pressable onPress={() => setFeeSheet(true)} accessibilityRole="button" accessibilityLabel={t({ id: 'swap.fee.a11y', message: 'Wallet fee schedule' })} style={{ minHeight: 44, justifyContent: 'center', paddingVertical: ROW_PAD }} testID="swap-fee-line">
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
            <FeeRow label={quote?.tradeType === 'exactOut' ? t({ id: 'swap.max', message: 'Pay at most' }) : t({ id: 'swap.min', message: 'Minimum received' })} value={priced ? (quote.tradeType === 'exactOut' ? `${formatRaw(quote.maximumInRaw, quote.decimalsIn)} ${quote.symbolIn}` : `${formatRaw(quote.minimumOutRaw, quote.decimalsOut)} ${quote.symbolOut}`) : '—'} tone="mute" testID={quote?.tradeType === 'exactOut' ? 'swap-max-in' : 'swap-min'} />
            <FeeRow label={t({ id: 'swap.locked', message: 'Liquidity locked' })} value={lockText} tone={lockTone} testID="swap-locks" />
            {quote && quote.taxBips > 0 ? <FeeRow label={t({ id: 'swap.tax.label', message: 'Token tax' })} value={t({ id: 'swap.tax', message: '+{p} token tax', values: { p: formatPct(quote.taxBips) } })} tone="ember" testID="swap-tax" /> : null}
            {/*
              Said, not assumed and not fatal. The detector reverts for any
              token with no V2 pair against WETN, which is an ordinary thing for
              a token to be — but a tax that could not be measured is still a
              tax the figures above do not account for.
            */}
            {quote?.taxUnknown ? <FeeRow label={t({ id: 'swap.tax.label', message: 'Token tax' })} value={t({ id: 'swap.tax.unknown', message: 'could not be checked' })} tone="ember" testID="swap-tax-unknown" /> : null}
            </Column>
            ) : null}
          </Plate>
          ) : (
            <Body tone="mute" size="caption" paddingHorizontal="$3" paddingVertical={6}>
              {t({ id: 'limit.fee', message: 'Platform fee 0.1% on fill · no wallet fee' })}
            </Body>
          )}

          {/*
            Whatever has to be read before the key is pressed.

            Its own child of the console, rather than a box wrapping the key as
            well: the key has to be exactly as wide as the terminals above it
            (owner: "the button should be the same width as the input/output
            containers"), and it cannot be while it sits inside something with
            side padding of its own. Text keeps the padding; the key does not.

            Rendered only when it has something to say. An empty `Column` is
            still a child, and a child in a `gap` column still takes a gap on
            each side — so with nothing to warn about, the details card and the
            key sat 12 px apart while every other pair sat 6. Measured, not
            guessed: `fee-stack` bottom 476, `swap-act` 482→482, `swap-key` top
            488. Owner: "the gap between the rate and the swap button is
            inconsistent with the other gaps."
          */}
          {notices ? (
          <Column gap="$2" paddingHorizontal={4} testID="swap-act">
            {blockedSide ? (
              <Body tone="burn" size="caption" testID="swap-blocked">
                {t({
                  id: 'swap.blocked',
                  message: '{s} is marked unsafe to trade. Its contract behaves in a way that takes money from the people who hold it — BoltVault will not swap it. Pick another token.',
                  values: { s: blockedSide.symbol },
                })}
              </Body>
            ) : null}
            {warnedSide ? (
              <Body tone="ember" size="caption" testID="swap-warned">
                {t({
                  id: 'swap.warned',
                  message: 'Strong warning on {s}. The market flags this token as risky to hold; read its page before you trade it.',
                  values: { s: warnedSide.symbol },
                })}
              </Body>
            ) : null}
            {fotLocked ? (
              <Body tone="mute" size="caption" testID="swap-exact-out-locked">
                {t({
                  id: 'swap.exactOut.fot',
                  message: 'A token in this pair charges a fee when it moves, so an exact output cannot be promised. Set the amount you pay instead.',
                })}
              </Body>
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
          </Column>
          ) : null}

          {/*
            The verb, flush with the terminals and reading like one.

            `ButtonError`/`ButtonPrimary` is the last child of the interface's
            own card, directly under the details row, and its label is set well
            above body size. Owner: "I want the 'Swap' text in the button to be
            a bit bigger, and the button should be the same width as the
            input/output containers" — so it is a direct child of the console,
            taking the console's padding as its margin exactly as the wells do.
          */}
          <Key label={keyLabel} loud disabled={!canSwap} onPress={run} testID="swap-key" />
        </Plate>

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
        </Column>
      </ScrollView>

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
      <TokenPickerSheet open={picker !== null} onClose={() => setPicker(null)} title={picker === 'in' ? t({ id: 'swap.pick.in', message: 'You pay' }) : t({ id: 'swap.pick.out', message: 'You receive' })} tokens={tokens} rows={rows} currency={currency} onPick={pick} safety={safety} reducedMotion={reducedMotion} />
      <SlippageSheet open={slippageOpen} onClose={() => setSlippageOpen(false)} value={effectiveSlippage} onChange={setSlippage} reducedMotion={reducedMotion} />
      <SwapCoachSheet open={coachOpen} onDismiss={() => setPrefs({ swapCoachDismissed: true })} reducedMotion={reducedMotion} />
    </Column>
  )
}

/**
 * One line of the details card.
 *
 * Padding rather than a height. Every row used to set `minHeight` and the card
 * set a gap, so a row with one line of value and a row with three were centred
 * in boxes of different sizes and the space between the *words* came out
 * different on every pair — which is what the owner saw. Fixed padding and a
 * height that follows the content puts the same air above and below every line
 * whatever is in it.
 */
function FeeRow({ label, value, tone, testID }: { label: string; value: string; tone: 'mute' | 'ink' | 'ember' | 'burn' | 'surge'; testID: string }) {
  return (
    <Row justifyContent="space-between" alignItems="center" paddingVertical={ROW_PAD} gap="$2">
      <Body tone="mute" size="caption">
        {label}
      </Body>
      <Body tone={tone} size="caption" textAlign="right" flexShrink={1} testID={testID}>
        {value}
      </Body>
    </Row>
  )
}

/**
 * The token selector, at the interface's own size.
 *
 * `CurrencySelect` there is a 36 px pill holding a 24 px `CurrencyLogo` and a
 * symbol set at 18 px on a phone (`StyledTokenName`). Ours was a 13 px caption
 * beside an 18 px mark, which measured about a third shorter than the page the
 * owner was holding it against. Owner: "bigger font for token selectors."
 */
function TokenPill({ token, onPress, testID }: { token: TokenView | null; onPress: () => void; testID: string }) {
  return <Pill strong size="lg" label={token?.symbol ?? t({ id: 'swap.pick', message: 'Pick' })} icon={token ? <TokenAvatar chainId={ETN} address={token.address} symbol={token.symbol} logoUri={token.logoUri} size={24} /> : undefined} chevron tone="ink" onPress={onPress} accessibilityLabel={token?.symbol ?? t({ id: 'swap.pick', message: 'Pick' })} testID={testID} />
}

/** Native MAX: the balance less 120% of the quoted network fee. Null until a quote has measured that fee. */
function spendableNative(quote: SwapQuoteView | null): string | null {
  if (!quote || quote.tokenIn !== 'native' || !quote.maxSpendableRaw || quote.maxSpendableRaw === '0') return null
  try {
    return formatUnits(BigInt(quote.maxSpendableRaw), quote.decimalsIn)
  } catch {
    return null
  }
}
