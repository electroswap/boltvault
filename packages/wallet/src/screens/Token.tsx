/**
 * Token details (master plan §8.3; plan B5): the price and its chart on the
 * Grid with 1D · 1W · 1M · 1Y, what is yours, the verbs, the market in a
 * stat strip, the safety line, about, and a one-row contract card. Market
 * data is display only and arrives stale-first from ElectroSwap; quantities
 * come from the chain. Off Electroneum the chart is a still mute line and
 * the stats read "—" with an honest caption.
 */
import {
  Body,
  Column,
  Icon,
  IconButton,
  Key,
  LineChart,
  Pill,
  Plate,
  Pressable,
  Readout,
  Row,
  ScrollView,
  Segmented,
  SharedElement,
  StatStrip,
  TokenAvatar,
  metrics,
  paint,
  shortAddress,
  useWindowDimensions,
  type IconName,
  type StatCell,
} from '@boltvault/ui'
import {
  cacheKey,
  type AllowanceView,
  type ChainView,
  type ChartDuration,
  type LiquidityView,
  type PriceHistoryView,
  type TokenDetailView,
  type TokenTransactionsView,
  type TokenView,
} from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { ChainCaption } from '../components/ChainSelect'
import { PageHeader } from '../components/PageHeader'
import { TokenTransactions } from '../components/TokenTransactions'
import { useEngine } from '../engine/EngineProvider'
import { formatChange, formatFiat, formatPrice, formatQuantity, formatAmount } from '../format'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { useCached } from '../hooks/useCached'
import { usePortfolio } from '../hooks/usePortfolio'
import { usePrefs } from '../hooks/usePrefs'
import { useSafeOpen } from '../hooks/useSafeOpen'
import { FreshnessLine } from '../components/FreshnessLine'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { tokenSharedId } from '../navigation/transitions'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'

const DURATIONS: readonly ChartDuration[] = ['1D', '1W', '1M', '1Y']
const isEtn = (chainId: number): boolean => chainId === 52014 || chainId === 5201420

/** Info is everything the dossier already said; Transactions is the market's, not yours. */
export type TokenTab = 'info' | 'transactions'
export const isTokenTab = (v: unknown): v is TokenTab => v === 'info' || v === 'transactions'

/** The price without its currency sign, for a caption that sits beside a priced hero. */
const plainPrice = (v: number): string =>
  v >= 1
    ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : v.toLocaleString('en-US', { maximumSignificantDigits: 3 })

function compactFiat(v: number | null, currency: 'USD' | 'ETN'): string {
  if (v === null) return '—'
  const abs = Math.abs(v)
  const s =
    abs >= 1e9
      ? `${(v / 1e9).toFixed(2)}B`
      : abs >= 1e6
        ? `${(v / 1e6).toFixed(2)}M`
        : abs >= 1e3
          ? `${(v / 1e3).toFixed(1)}K`
          : v.toFixed(0)
  return currency === 'USD' ? `$${s}` : `${s} ETN`
}

export function Token({
  chainId,
  address,
  body,
  initialTab,
}: {
  chainId: number
  address: string
  body: 'extension-popup' | 'extension-tab' | 'mobile'
  /** Deep links and the screenshot harness open straight onto a tab; the screen otherwise starts on Info. */
  initialTab?: TokenTab
}) {
  // Every outward link passes the same gate (ES-BV-035).
  const openSafely = useSafeOpen()
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const { width } = useWindowDimensions()
  const { active } = useWalletState()
  const { prefs, set: setPrefs } = usePrefs()
  const portfolio = usePortfolio(active?.id ?? null, 5_000, [chainId])
  const { entries } = useActivity(active?.id ?? null, chainId)
  const [token, setToken] = useState<TokenView | null>(null)
  const [chain, setChain] = useState<ChainView | null>(null)
  const [allowances, setAllowances] = useState<AllowanceView[]>([])
  const [bridgeable, setBridgeable] = useState(false)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<TokenTab>(initialTab ?? 'info')
  /*
    Whether Transactions has EVER been opened, which is what gates the fetch.

    Sticky on purpose, and this is the one subtle thing on the screen. Nothing
    is fetched until the tab is first pressed, because `useCached` does nothing
    at all while its key is null — the same rule Explore states for its
    segments. But the key must not swing back to null on the way to Info: the
    hook resets to its empty state when the key goes away, and on the way back
    in it seeds `refreshing` and then short-circuits on `maxAgeMs` without ever
    clearing it, leaving a loader sweeping over a list that is not loading.
    Once opened, stay opened — it costs nothing, because the hook only reads on
    mount and when the cache says the key changed.
  */
  const [txOpened, setTxOpened] = useState(initialTab === 'transactions')
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const wide = body === 'extension-tab'
  const chartWidth = Math.min(width, wide ? 640 : width) - inset * 2
  const market = isEtn(chainId)
  // Off Electroneum there is no indexer and so no tab control; Info is the whole screen.
  const showTransactions = market && tab === 'transactions'
  const duration = prefs.chartDuration

  useEffect(() => {
    engine.tokens.get({ chainId, address }).then(setToken, () => setToken(null))
    engine.chains.list().then(
      (list) => setChain(list.find((c) => c.chainId === chainId) ?? null),
      () => undefined,
    )
    engine.bridge.routes({ fromChainId: chainId, token: address }).then(
      (rs) => setBridgeable(rs.length > 0),
      () => setBridgeable(false),
    )
    if (active)
      engine.allowances.cached({ accountId: active.id, chainId }).then(
        (c) => setAllowances(c.rows.filter((r) => r.token.toLowerCase() === address.toLowerCase())),
        () => undefined,
      )
    return engine.events.subscribe((e) => {
      if (e.type === 'tokens.changed' && e.chainId === chainId)
        engine.tokens.get({ chainId, address }).then(setToken, () => undefined)
    })
  }, [engine, chainId, address, active])

  // The dossier, the chart's timeframe and the locks: each paints its last-good value at once (plan A2).
  const detail = useCached<TokenDetailView>({
    key: market ? cacheKey('explore', 'tokendetail', chainId, address) : null,
    cached: (e) => e.explore.cachedTokenDetail({ chainId, address }),
    fresh: (e) =>
      e.explore.tokenDetail({ chainId, address }).then((v) => {
        if (!v) throw new Error('no market data')
        return v
      }),
    maxAgeMs: 60_000,
  })
  const history = useCached<PriceHistoryView>({
    key: market ? cacheKey('explore', 'history', chainId, address, duration) : null,
    cached: (e) => e.explore.cachedPriceHistory({ chainId, address, duration }),
    fresh: (e) =>
      e.explore.priceHistory({ chainId, address, duration }).then((v) => {
        if (!v) throw new Error('no market data')
        return v
      }),
    maxAgeMs: 5 * 60_000,
  })
  // The market's trades in this token, and only once the tab has been opened.
  const transactions = useCached<TokenTransactionsView>({
    key: market && txOpened ? cacheKey('explore', 'tokentx', chainId, address) : null,
    cached: (e) => e.explore.cachedTokenTransactions({ chainId, address }),
    fresh: (e) =>
      e.explore.tokenTransactions({ chainId, address }).then((v) => {
        // Null is "we could not ask"; `rows: []` is "nobody has traded it".
        if (!v) throw new Error('no transactions')
        return v
      }),
    maxAgeMs: 60_000,
  })
  const liquidity = useCached<LiquidityView>({
    key: market && address !== 'native' ? cacheKey('explore', 'liquidity', chainId, address) : null,
    cached: (e) => e.explore.cachedLiquidity({ chainId, address }),
    fresh: (e) =>
      e.explore.liquidity({ chainId, address }).then((v) => {
        if (!v) throw new Error('no lock data')
        return v
      }),
    maxAgeMs: 10 * 60_000,
  })

  const row =
    portfolio.snapshot?.rows.find(
      (r) => r.chainId === chainId && r.address.toLowerCase() === address.toLowerCase(),
    ) ?? null
  const currency = portfolio.snapshot?.currency ?? 'USD'
  const isNative = address === 'native'
  const symbol = token?.symbol ?? row?.symbol ?? detail.value?.symbol ?? '…'
  const name = token?.name ?? row?.name ?? detail.value?.name ?? ''
  const derivedPrice =
    row && row.fiat !== null && Number(row.quantity) > 0 ? row.fiat / Number(row.quantity) : null
  const price = detail.value?.price ?? derivedPrice
  const points = history.value?.points ?? []
  const open = points[0]?.v ?? null
  const last = points[points.length - 1]?.v ?? null
  const periodChange =
    open !== null && last !== null && open > 0
      ? last / open - 1
      : duration === '1D' &&
          detail.value?.change24h !== null &&
          detail.value?.change24h !== undefined
        ? detail.value.change24h / 100
        : null
  const changeText = formatChange(periodChange)
  const changeTone: 'surge' | 'burn' | 'mute' =
    periodChange === null ? 'mute' : periodChange > 0 ? 'surge' : periodChange < 0 ? 'burn' : 'mute'
  const stroke: 'current' | 'surge' | 'burn' | 'mute' =
    points.length < 2 ? 'mute' : periodChange !== null && periodChange < 0 ? 'burn' : 'current'
  const custom = token?.source === 'user' || token?.source === 'dapp'
  const tokenActivity = useMemo(
    () =>
      entries.filter(
        (e) =>
          (e.token ?? (e.value !== '0' && !e.to?.startsWith('0x0000') ? 'native' : null)) ===
            address ||
          (isNative && e.category === 'SEND' && !e.token),
      ),
    [entries, address, isNative],
  )
  const explorer = chain?.explorerUrl
    ? isNative
      ? chain.explorerUrl
      : `${chain.explorerUrl}/token/${address}`
    : null

  const copy = async (): Promise<void> => {
    if (!host.copy) return
    await host.copy(address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const d = detail.value
  const safety: { label: string; tone: 'surge' | 'ember' | 'burn'; icon: IconName } | null = d?.spam
    ? {
        label: t({ id: 'token.safety.spam', message: 'Flagged as spam' }),
        tone: 'burn',
        icon: 'warn',
      }
    : d?.safety === 'VERIFIED'
      ? {
          label: t({ id: 'token.safety.verified', message: 'Verified' }),
          tone: 'surge',
          icon: 'shield',
        }
      : d?.safety === 'MEDIUM_WARNING'
        ? {
            label: t({ id: 'token.safety.warning', message: 'Warning' }),
            tone: 'ember',
            icon: 'warn',
          }
        : d?.safety === 'STRONG_WARNING'
          ? {
              label: t({ id: 'token.safety.strong', message: 'Strong warning' }),
              tone: 'burn',
              icon: 'warn',
            }
          : d?.safety === 'BLOCKED'
            ? {
                label: t({ id: 'token.safety.blocked', message: 'Blocked' }),
                tone: 'burn',
                icon: 'warn',
              }
            : null
  const lockText = liquidity.value
    ? liquidity.value.lockedPct > 0
      ? t({
          id: 'token.locks',
          message: '{p}% liquidity locked · {n}',
          values: {
            p: Math.round(liquidity.value.lockedPct),
            n:
              liquidity.value.lockCount === 1
                ? t({ id: 'swap.locks.one', message: '1 lock' })
                : t({
                    id: 'swap.locks.many',
                    message: '{n} locks',
                    values: { n: liquidity.value.lockCount },
                  }),
          },
        })
      : t({ id: 'token.locks.none', message: 'No liquidity locks' })
    : null
  const stats: StatCell[] = [
    {
      label: t({ id: 'token.stat.volume', message: 'Volume 24h' }),
      value: compactFiat(d?.volume24h ?? null, 'USD'),
    },
    {
      label: t({ id: 'token.stat.tvl', message: 'TVL' }),
      value: compactFiat(d?.tvl ?? null, 'USD'),
    },
    {
      label: t({ id: 'token.stat.mcap', message: 'Market cap' }),
      value: compactFiat(d?.marketCap ?? null, 'USD'),
    },
    {
      label: t({ id: 'token.stat.fdv', message: 'FDV' }),
      value: compactFiat(d?.fdv ?? null, 'USD'),
    },
    {
      label: t({ id: 'token.stat.7d', message: '7 days' }),
      value:
        d?.change7d !== null && d?.change7d !== undefined
          ? (formatChange(d.change7d / 100) ?? '—')
          : '—',
      tone:
        d?.change7d !== null && d?.change7d !== undefined
          ? d.change7d > 0
            ? 'surge'
            : d.change7d < 0
              ? 'burn'
              : 'ink'
          : 'ink',
    },
    {
      label: t({ id: 'token.stat.24h', message: '24 hours' }),
      value:
        d?.change24h !== null && d?.change24h !== undefined
          ? (formatChange(d.change24h / 100) ?? '—')
          : '—',
      tone:
        d?.change24h !== null && d?.change24h !== undefined
          ? d.change24h > 0
            ? 'surge'
            : d.change24h < 0
              ? 'burn'
              : 'ink'
          : 'ink',
    },
  ]
  const links: Array<{ label: string; url: string; icon: IconName; a11y?: string }> = [
    ...(d?.homepageUrl
      ? [
          {
            label: t({ id: 'token.link.site', message: 'Website' }),
            url: d.homepageUrl,
            icon: 'globe' as const,
          },
        ]
      : []),
    /*
      The mark is the name here, so the pill does not say it twice.
      "Website" and "Telegram" pair a generic glyph with a word; X's glyph
      *is* the word, and printing both read as "X X" on a phone.
    */
    ...(d?.twitterUrl ? [{ label: '', url: d.twitterUrl, icon: 'x' as const, a11y: 'X' }] : []),
    ...(d?.telegramUrl
      ? [{ label: 'Telegram', url: d.telegramUrl, icon: 'telegram' as const }]
      : []),
  ]

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="token">
        <PageHeader
          leading={
            // Where the bus bar lands (§7.7). The wrapper is a box in the
            // layout, so it carries the row's own flexShrink.
            <SharedElement id={tokenSharedId(chainId, address)} style={{ flexShrink: 1 }}>
              <Row gap="$2" alignItems="center" flexShrink={1}>
                <TokenAvatar
                  chainId={chainId}
                  address={address}
                  symbol={token?.symbol ?? row?.symbol ?? null}
                  logoUri={token?.logoUri ?? row?.logoUri ?? d?.logoUrl ?? null}
                  size={28}
                />
                <Column flexShrink={1} alignItems="flex-start">
                  <Body size="title" numberOfLines={1} testID="token-symbol">
                    {symbol}
                  </Body>
                  <Row gap={6} alignItems="center" marginTop={-2}>
                    <ChainCaption
                      chainId={chainId}
                      name={chain?.name ?? `Chain ${chainId}`}
                      testID="token-chain"
                    />
                    {name && name !== symbol ? (
                      <Body tone="mute" size="caption" numberOfLines={1} flexShrink={1}>
                        {`· ${name}`}
                      </Body>
                    ) : null}
                  </Row>
                </Column>
                {custom ? (
                  <Pill label={t({ id: 'token.custom', message: 'Custom' })} size="sm" />
                ) : null}
              </Row>
            </SharedElement>
          }
          right={
            <>
              {!isNative ? (
                <IconButton
                  icon="pin"
                  /*
                    Named for where it puts things (ES-BV-081). It said "Pin to
                    Home", and Home has no token list — the rows are on
                    Portfolio. It also now does what "pin" means everywhere
                    else: the row sorts to the top, rather than only staying
                    visible at a zero balance.
                  */
                  label={
                    token?.pinned
                      ? t({ id: 'pin.off.v2', message: 'Unpin from Portfolio' })
                      : t({ id: 'pin.on.v2', message: 'Pin to the top of Portfolio' })
                  }
                  active={!!token?.pinned}
                  onPress={() =>
                    void engine.tokens.setPrefs({ chainId, address, pinned: !token?.pinned })
                  }
                  testID="token-pin"
                />
              ) : null}
            </>
          }
        />

        {/*
          How old this price is, when it is old.

          The hero used to render a cached figure with nothing to distinguish
          it from a current one, and `maxAgeMs` means no refresh is even
          attempted inside the window. A price proxy in cooldown could
          therefore show an hour-old number as the answer to "what is this
          worth" — and the decision to swap is made on that number, even though
          the on-chain quote protects the execution.
        */}
        <FreshnessLine
          freshness={detail.freshness}
          observedAt={detail.observedAt}
          lastSuccessAt={detail.lastSuccessAt}
          refreshing={detail.refreshing}
          testID="token-freshness"
        />
        {/* The price on the Grid (plan B5). */}
        <Column gap="$2" testID="token-price-block">
          <Row alignItems="flex-end" gap="$3" flexWrap="wrap">
            <Readout hero testID="token-price">
              {formatPrice(price, currency)}
            </Readout>
            {changeText ? (
              <Body tone={changeTone} size="caption" marginBottom={6} testID="token-change">
                {changeText} ·{' '}
                {duration === '1D'
                  ? t({ id: 'token.today', message: 'today' })
                  : duration === '1W'
                    ? t({ id: 'token.week', message: 'this week' })
                    : duration === '1M'
                      ? t({ id: 'token.month', message: 'this month' })
                      : t({ id: 'token.year', message: 'this year' })}
              </Body>
            ) : !market ? (
              <Body tone="mute" size="caption" marginBottom={6}>
                {t({ id: 'token.market.other', message: 'No market data outside Electroneum' })}
              </Body>
            ) : null}
          </Row>
          <LineChart
            points={points}
            width={chartWidth}
            height={120}
            stroke={stroke}
            area
            baseline={open}
            endDot
            reducedMotion={reducedMotion}
            testID="token-chart"
          />
          <Row justifyContent="space-between" alignItems="center" gap="$3">
            <Column width={wide ? 240 : 192}>
              <Segmented
                options={DURATIONS.map((x) => ({ id: x, label: x }))}
                value={duration}
                onChange={(id) => setPrefs({ chartDuration: id as ChartDuration })}
                size="compact"
                testID="token-duration"
              />
            </Column>
            <Body
              tone="mute"
              size="caption"
              numberOfLines={1}
              flexShrink={1}
              testID="token-high-low"
            >
              {history.value && history.value.high !== null && history.value.low !== null
                ? t({
                    id: 'token.hl',
                    message: 'H {h} · L {l}',
                    values: { h: plainPrice(history.value.high), l: plainPrice(history.value.low) },
                  })
                : market && history.freshness === 'loading'
                  ? '…'
                  : ''}
            </Body>
          </Row>
        </Column>

        {/*
          Info · Transactions (owner ask 2026-09-13), directly under the chart:
          everything the dossier said is Info, and Transactions is the market's
          trades in this token rather than yours.

          `regular` rather than `compact`, deliberately, even though a compact
          track sits forty pixels above it: two controls in the same idiom,
          stacked, read as one control with eight options. The timeframe strip
          parameterises the chart; this one changes what the page is about.
        */}
        {market ? (
          <Segmented
            options={[
              { id: 'info', label: t({ id: 'token.tab.info', message: 'Info' }) },
              {
                id: 'transactions',
                label: t({ id: 'token.tab.transactions', message: 'Transactions' }),
              },
            ]}
            value={tab}
            onChange={(id) => {
              if (!isTokenTab(id)) return
              setTab(id)
              // One-way: see `txOpened`.
              if (id === 'transactions') setTxOpened(true)
            }}
            testID="token-tabs"
          />
        ) : null}

        {showTransactions ? (
          <TokenTransactions
            state={transactions}
            wide={wide}
            explorerUrl={chain?.explorerUrl ?? null}
            chainId={chainId}
            address={address}
            reducedMotion={reducedMotion}
          />
        ) : (
          <>
            {/* Yours */}
            <Plate role="raised" paddingVertical={10} paddingHorizontal="$3" testID="token-balance">
              <Row justifyContent="space-between" alignItems="center">
                <Column>
                  <Body tone="mute" size="caption">
                    {t({ id: 'token.yours', message: 'Yours' })}
                  </Body>
                  <Body size="title">
                    {/*
                  A snapshot that has not arrived is not a balance of zero
                  (ES-BV-047). This screen used to read the home chain's
                  portfolio whatever chain the token was on, so every
                  non-Electroneum token read "0" — a held balance, shown as
                  nothing. The read is scoped now, and until it lands the
                  screen says it does not know yet.
                */}
                    {row
                      ? `${formatQuantity(row.quantity)} ${symbol}`
                      : portfolio.snapshot
                        ? `0 ${symbol}`
                        : '…'}
                  </Body>
                </Column>
                <Column alignItems="flex-end">
                  <Body>{row && row.fiat !== null ? formatFiat(row.fiat, currency) : '—'}</Body>
                  {row && formatChange(row.change24h) ? (
                    <Body tone={(row.change24h ?? 0) >= 0 ? 'surge' : 'burn'} size="caption">
                      {formatChange(row.change24h)} {t({ id: 'home.today', message: 'today' })}
                    </Body>
                  ) : (
                    <Body tone="mute" size="caption">
                      {row ? t({ id: 'token.unpriced', message: 'No price' }) : ''}
                    </Body>
                  )}
                </Column>
              </Row>
            </Plate>

            {/*
          Three verbs, not four.

          A fourth key took the row below the width a label needs: on a narrow
          body "Receive" broke its last letter onto a second line, which the
          owner photographed. Bridging is also not the same kind of act as the
          other three — it is a corridor to another chain, and it now says so on
          a line of its own below, where there is room to name the bridge that
          carries it.
        */}
            <Row gap="$2" testID="token-keys">
              <Column flex={1}>
                <Key
                  label={t({ id: 'key.send', message: 'Send' })}
                  kind="secondary"
                  size="compact"
                  onPress={() => router.navigate('send', { token: address, chainId })}
                  testID="token-send"
                />
              </Column>
              <Column flex={1}>
                <Key
                  label={t({ id: 'key.receive', message: 'Receive' })}
                  kind="secondary"
                  size="compact"
                  onPress={() => router.navigate('receive', { token: address, chainId })}
                  testID="token-receive"
                />
              </Column>
              {market ? (
                <Column flex={1}>
                  <Key
                    label={t({ id: 'key.swap', message: 'Swap' })}
                    kind="secondary"
                    size="compact"
                    onPress={() =>
                      router.setTab(
                        'swap',
                        isNative ? undefined : { tokenIn: 'native', tokenOut: address },
                      )
                    }
                    testID="token-swap"
                  />
                </Column>
              ) : null}
            </Row>

            {bridgeable ? (
              <Plate
                role="recessed"
                paddingVertical={6}
                paddingHorizontal="$3"
                testID="token-bridgeline"
              >
                <Row alignItems="center" gap="$2">
                  <Column flex={1} minWidth={0}>
                    <Body tone="mute" size="caption">
                      {t({
                        id: 'token.bridge.note',
                        message: 'The same asset on other chains, over the Hyperlane Nexus bridge.',
                      })}
                    </Body>
                  </Column>
                  <Key
                    label={t({ id: 'key.bridge', message: 'Bridge' })}
                    kind="secondary"
                    size="compact"
                    onPress={() => router.navigate('bridge', { chainId, token: address })}
                    testID="token-bridge"
                  />
                </Row>
              </Plate>
            ) : null}

            {/* Market */}
            <Column gap="$2" testID="token-market">
              <StatStrip cells={stats} columns={3} small />
              {market && !d && detail.freshness !== 'loading' ? (
                <Body tone="mute" size="caption">
                  {t({
                    id: 'token.market.none',
                    message:
                      'Market data arrives from ElectroSwap once the wallet key is enabled on the API.',
                  })}
                </Body>
              ) : null}
              {safety || lockText ? (
                <Row gap="$2" alignItems="center" flexWrap="wrap" testID="token-safety">
                  {safety ? (
                    <Pill
                      label={safety.label}
                      tone={safety.tone}
                      size="sm"
                      icon={<IconGlyph name={safety.icon} tone={safety.tone} />}
                    />
                  ) : null}
                  {lockText ? (
                    <Body
                      tone={liquidity.value && liquidity.value.lockedPct >= 50 ? 'surge' : 'mute'}
                      size="caption"
                    >
                      {lockText}
                    </Body>
                  ) : null}
                </Row>
              ) : null}
            </Column>

            {/* About */}
            {d?.description || links.length ? (
              <Column gap="$2" testID="token-about">
                {d?.description ? (
                  <Column gap={2}>
                    <Body tone="mute" size="caption" numberOfLines={expanded ? undefined : 4}>
                      {d.description}
                    </Body>
                    {d.description.length > 180 ? (
                      <Pressable
                        onPress={() => setExpanded((v) => !v)}
                        accessibilityRole="button"
                        style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
                        testID="token-readmore"
                      >
                        <Body tone="arc" size="caption">
                          {expanded
                            ? t({ id: 'less', message: 'Less' })
                            : t({ id: 'readmore', message: 'Read more' })}
                        </Body>
                      </Pressable>
                    ) : null}
                  </Column>
                ) : null}
                {links.length ? (
                  <Row gap="$2" flexWrap="wrap">
                    {links.map((l) => (
                      <Pill
                        key={l.url}
                        label={l.label}
                        // The X pill shows only its mark, so it still needs a name.
                        {...(l.a11y ? { accessibilityLabel: l.a11y } : {})}
                        icon={<IconGlyph name={l.icon} tone="mute" />}
                        size="sm"
                        onPress={() => openSafely(l.url)}
                        testID={`token-link-${l.icon}`}
                      />
                    ))}
                  </Row>
                ) : null}
              </Column>
            ) : null}

            {/* The contract, in one row (owner item T2). */}
            {!isNative ? (
              <Plate
                role="recessed"
                paddingVertical={4}
                paddingHorizontal="$3"
                testID="token-contract"
              >
                <Row alignItems="center" gap="$2">
                  <Column flex={1}>
                    <Body size="caption" numberOfLines={1}>
                      {shortAddress(address)}
                    </Body>
                    <Body tone="mute" size="caption">
                      {t({
                        id: 'token.decimals',
                        message: '{n} decimals',
                        values: { n: token?.decimals ?? row?.decimals ?? d?.decimals ?? 18 },
                      })}
                    </Body>
                  </Column>
                  <IconButton
                    icon={copied ? 'check' : 'copy'}
                    label={
                      copied
                        ? t({ id: 'copied', message: 'Copied' })
                        : t({ id: 'token.copyAddress', message: 'Copy address' })
                    }
                    active={copied}
                    onPress={() => void copy()}
                    testID="token-copy"
                  />
                  {explorer && host.openUrl ? (
                    <IconButton
                      icon="external"
                      label={t({ id: 'token.explorer', message: 'Open in explorer' })}
                      onPress={() => openSafely(explorer)}
                      testID="token-explorer"
                    />
                  ) : null}
                  <Pill
                    label={
                      token?.hidden
                        ? t({ id: 'token.hidden', message: 'Hidden' })
                        : t({ id: 'token.hide', message: 'Hide' })
                    }
                    selected={!!token?.hidden}
                    size="sm"
                    onPress={() =>
                      void engine.tokens.setPrefs({ chainId, address, hidden: !token?.hidden })
                    }
                    testID="token-hide"
                  />
                </Row>
                {custom ? (
                  <Key
                    label={t({ id: 'token.remove', message: 'Remove' })}
                    kind="danger"
                    size="compact"
                    onPress={() =>
                      engine.tokens.removeCustom({ chainId, address }).then(() => router.back())
                    }
                    testID="token-remove"
                  />
                ) : null}
              </Plate>
            ) : null}

            {allowances.length ? (
              <Plate gap={4} testID="token-allowances">
                <Body tone="mute" size="caption">
                  {t({ id: 'token.allowances', message: 'Allowances' })}
                </Body>
                {allowances.map((a) => (
                  <Row
                    key={`${a.spender}:${a.standard}`}
                    justifyContent="space-between"
                    minHeight={24}
                    alignItems="center"
                  >
                    <Body size="caption">{a.spenderName ?? shortAddress(a.spender)}</Body>
                    <Body tone={a.amount === 'unlimited' ? 'burn' : 'mute'} size="caption">
                      {/*
                    `amount` is a raw uint256, exactly as on the Allowances
                    screen — and `formatQuantity` reads it as a quantity, so
                    1 000 USDC of allowance rendered as "1.00B" on the one
                    screen somebody reads before deciding whether to revoke.
                    Scaled here the same way, and when the scale is unknown it
                    says so rather than inventing one.
                  */}
                      {a.amount === 'unlimited'
                        ? t({ id: 'allow.unlimited', message: 'Unlimited' })
                        : a.amount === 'all'
                          ? t({ id: 'allow.all', message: 'Every item' })
                          : a.decimals === null
                            ? t({
                                id: 'allow.raw',
                                message: '{n} base units',
                                values: { n: a.amount },
                              })
                            : formatAmount(a.amount, a.decimals)}
                    </Body>
                  </Row>
                ))}
                <Pressable
                  onPress={() => router.navigate('allowances')}
                  accessibilityRole="button"
                  style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}
                  testID="token-allowances-manage"
                >
                  <Body tone="arc" size="caption">
                    {t({ id: 'token.allowances.manage', message: 'Manage approvals' })}
                  </Body>
                </Pressable>
              </Plate>
            ) : null}

            <Column gap={4} testID="token-activity">
              <Body tone="mute" size="caption">
                {t({ id: 'token.activity', message: 'Your activity' })}
              </Body>
              {tokenActivity.length === 0 ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'token.activity.none', message: 'Nothing yet with this token.' })}
                </Body>
              ) : (
                tokenActivity.slice(0, 5).map((e) => (
                  <Plate
                    key={e.id}
                    role="card"
                    paddingVertical={8}
                    paddingHorizontal="$3"
                    onPress={() => router.setTab('activity')}
                    cursor="pointer"
                  >
                    <Row justifyContent="space-between" gap="$2">
                      <Body size="caption" numberOfLines={1} flexShrink={1}>
                        {e.statements[0] ?? e.category}
                      </Body>
                      <Body tone="mute" size="caption">
                        {e.status}
                      </Body>
                    </Row>
                  </Plate>
                ))
              )}
            </Column>
          </>
        )}
      </ScrollView>
    </Column>
  )
}

/** A 14 px glyph for a pill's icon slot. */
function IconGlyph({ name, tone }: { name: IconName; tone: 'surge' | 'ember' | 'burn' | 'mute' }) {
  const color =
    tone === 'surge'
      ? paint.surge
      : tone === 'ember'
        ? paint.ember
        : tone === 'burn'
          ? paint.burn
          : paint.mute
  return <Icon name={name} size={14} color={color} />
}
