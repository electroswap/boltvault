/**
 * Token details › Transactions (§8.3; owner ask 2026-09-13): recent trades in
 * this one token, market-wide, from the ElectroSwap indexer.
 *
 * This list is the whole of what its tab shows, so it never half-answers:
 * either the API returned rows and they render, or the panel says we cannot
 * fetch them right now. There is deliberately no on-chain fallback — a pool
 * scan is not a transaction feed, and one offered as the other is a number the
 * user would act on.
 *
 * Presentational on purpose. The `useCached` state is owned by `Token.tsx`,
 * which stays mounted across tab presses; holding it here would put the hook
 * behind a component that unmounts every time you look at Info, and the hook
 * resets to nothing when its key goes away.
 */
import { BarLoader, Body, Column, Key, Plate, Row, shortAddress } from '@boltvault/ui'
import type { TokenTransactionRow, TokenTransactionsView } from '@boltvault/engine'
import { useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { agoParts, formatPrice, formatQuantity, formatTradeValue } from '../format'
import type { UseCachedResult } from '../hooks/useCached'
import { useSafeOpen } from '../hooks/useSafeOpen'
import { t } from '../i18n'

/** "2m ago". The boundaries are `agoParts`, in `format.ts`; the words are this screen's. */
function txAgo(timestampSec: number, now: number = Date.now()): string {
  const { unit, value: n } = agoParts(timestampSec, now)
  if (unit === 'now') return t({ id: 'token.tx.ago.now', message: 'just now' })
  if (unit === 'm') return t({ id: 'token.tx.ago.m', message: '{n}m ago', values: { n } })
  if (unit === 'h') return t({ id: 'token.tx.ago.h', message: '{n}h ago', values: { n } })
  return t({ id: 'token.tx.ago.d', message: '{n}d ago', values: { n } })
}

export function TokenTransactions({
  state,
  wide,
  explorerUrl,
  chainId,
  address,
  reducedMotion,
}: {
  readonly state: UseCachedResult<TokenTransactionsView>
  /** The extension's tab body, which has the room for the counter side and the unit price. */
  readonly wide: boolean
  readonly explorerUrl: string | null
  readonly chainId: number
  readonly address: string
  readonly reducedMotion: boolean
}) {
  const engine = useEngine()
  const openSafely = useSafeOpen()
  const [loadingMore, setLoadingMore] = useState(false)
  const [moreFailed, setMoreFailed] = useState(false)
  const view = state.value
  const rows = view?.rows ?? []

  const loadMore = (): void => {
    if (loadingMore) return
    setLoadingMore(true)
    setMoreFailed(false)
    /*
      The engine merges the page into the cached document and the write emits
      `cache.changed`, which the screen's `useCached` is already subscribed to.
      So nothing is set into state here: the list grows because the cache grew.
    */
    engine.explore.moreTokenTransactions({ chainId, address }).then(
      (v) => {
        setLoadingMore(false)
        if (!v) setMoreFailed(true)
      },
      () => {
        setLoadingMore(false)
        setMoreFailed(true)
      },
    )
  }

  return (
    <Column gap="$2" testID="token-transactions">
      <BarLoader
        active={state.freshness === 'loading' || loadingMore}
        reducedMotion={reducedMotion}
        testID="token-tx-loading"
      />

      {/*
        The error the owner asked for. `freshness` is only ever `error` when
        there is no value at all to show beside it — a failed refresh over a
        list we already have leaves the list standing and says so quietly at
        the foot instead.
      */}
      {state.freshness === 'error' ? (
        <Body tone="burn" size="caption" testID="token-tx-error">
          {t({
            id: 'token.tx.error',
            message: 'We’re not able to fetch that information right now.',
          })}
        </Body>
      ) : null}

      {rows.map((r) => (
        <TransactionRow
          key={r.hash}
          row={r}
          wide={wide}
          onOpen={explorerUrl ? () => openSafely(`${explorerUrl}/tx/${r.hash}`) : null}
        />
      ))}

      {/*
        Gated on a value, not on an empty array: a list that has not arrived
        yet is not a token nobody trades.
      */}
      {view && rows.length === 0 && state.freshness !== 'error' ? (
        <Body tone="mute" size="caption" testID="token-tx-none">
          {t({ id: 'token.tx.none', message: 'No trades in this token yet.' })}
        </Body>
      ) : null}

      {moreFailed ? (
        <Body tone="burn" size="caption" testID="token-tx-more-error">
          {t({
            id: 'token.tx.error',
            message: 'We’re not able to fetch that information right now.',
          })}
        </Body>
      ) : null}

      {view && !view.complete && rows.length > 0 ? (
        <Key
          label={t({ id: 'token.tx.more', message: 'Load more' })}
          kind="secondary"
          size="compact"
          disabled={loadingMore}
          onPress={loadMore}
          testID="token-tx-more"
        />
      ) : null}
    </Column>
  )
}

function TransactionRow({
  row,
  wide,
  onOpen,
}: {
  readonly row: TokenTransactionRow
  readonly wide: boolean
  readonly onOpen: (() => void) | null
}) {
  const bought = row.direction === 'buy'
  const subject = `${formatQuantity(row.subjectAmount)} ${row.subjectSymbol}`
  const counter = `${formatQuantity(row.counterAmount)} ${row.counterSymbol}`
  return (
    <Plate
      role="card"
      gap={4}
      minHeight={48}
      paddingVertical={8}
      paddingHorizontal="$3"
      {...(onOpen ? { onPress: onOpen, cursor: 'pointer' } : {})}
      testID={`token-tx-${row.hash}`}
    >
      <Row gap="$3" alignItems="center">
        {/*
          minWidth 0 or the text column refuses to shrink and the value on the
          right eats the line — react-native-web's View is flexShrink: 0.
        */}
        <Column flex={1} minWidth={0}>
          <Row gap="$2" alignItems="baseline">
            <Body size="caption" tone={bought ? 'surge' : 'burn'} fontWeight="600">
              {bought
                ? t({ id: 'token.tx.buy', message: 'Buy' })
                : t({ id: 'token.tx.sell', message: 'Sell' })}
            </Body>
            <Body numberOfLines={1} flexShrink={1}>
              {wide
                ? bought
                  ? t({
                      id: 'token.tx.line.for',
                      message: '{subject} for {counter}',
                      values: { subject, counter },
                    })
                  : t({
                      id: 'token.tx.line.to',
                      message: '{subject} to {counter}',
                      values: { subject, counter },
                    })
                : subject}
            </Body>
          </Row>
          <Body tone="mute" size="caption" numberOfLines={1}>
            {/* The verified `.etn` name rides along in the same payload; there is no second lookup to make. */}
            {`${txAgo(row.timestamp)} · ${row.accountName ?? shortAddress(row.account)}`}
          </Body>
        </Column>
        <Column alignItems="flex-end" flexShrink={0}>
          <Body size="caption">{formatTradeValue(row.valueUsd)}</Body>
          {wide ? (
            <Body tone="mute" size="caption">
              {t({
                id: 'token.tx.at',
                message: 'at {price}',
                values: { price: formatPrice(row.unitPriceUsd, 'USD') },
              })}
            </Body>
          ) : null}
        </Column>
      </Row>
    </Plate>
  )
}
