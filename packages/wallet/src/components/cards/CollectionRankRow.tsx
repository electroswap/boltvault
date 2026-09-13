/**
 * One collection in the ranked list (owner ask 2026-09-06: the Collections
 * page reads like ElectroSwap's trending table): the artwork, the name with
 * its verified check, a line of floor · pieces · owners, and at the right the
 * window's volume with its change. Plain rows on the Grid with hairlines
 * between them, so fifty of them stay a list.
 *
 * The rank number is gone. The list is still ranked — it is ordered by volume,
 * which is the whole point — but printing "1." beside the top row says nothing
 * the position does not, and the 18 px column plus its gap held the artwork off
 * the page margin on every row. Owner: "get rid of the numbers on the
 * collections list, they add no real value ... make sure the collection icons
 * are left aligned." The artwork is now the first thing in the row, so it
 * starts exactly where the screen's own inset does.
 */
import { Artwork, Body, Column, Icon, IconButton, Pressable, Row, paint } from '@boltvault/ui'
import type { CollectionView } from '@boltvault/engine'
import { t } from '../../i18n'

export type CollectionCurrency = 'ETN' | 'USD'

/** "24K ETN", "2.22K ETN", "200 ETN" — or the USD equivalent when an ETN price is known. */
export function formatCollectionValue(etn: number | null, currency: CollectionCurrency, etnUsd: number | null): string {
  if (etn === null) return '—'
  if (currency === 'USD') {
    if (etnUsd === null) return '—'
    const usd = etn * etnUsd
    return usd >= 1e6 ? `$${trim((usd / 1e6).toFixed(2))}M` : usd >= 1e3 ? `$${trim((usd / 1e3).toFixed(usd >= 1e4 ? 1 : 2))}K` : `$${usd.toFixed(usd >= 100 ? 0 : 2)}`
  }
  const v = etn >= 1e6 ? `${trim((etn / 1e6).toFixed(2))}M` : etn >= 1e3 ? `${trim((etn / 1e3).toFixed(etn >= 1e4 ? 0 : 2))}K` : etn >= 100 ? String(Math.round(etn)) : trim(etn.toFixed(2))
  return `${v} ETN`
}

function trim(s: string): string {
  return s.includes('.') ? s.replace(/\.?0+$/, '') : s
}

function compact(n: number | null): string {
  if (n === null) return '—'
  return n >= 1e6 ? `${trim((n / 1e6).toFixed(1))}M` : n >= 1e4 ? `${trim((n / 1e3).toFixed(1))}K` : n.toLocaleString('en-US')
}

export function CollectionRankRow({ collection: c, currency, etnUsd, onPress, onWatch, last = false }: { collection: CollectionView; currency: CollectionCurrency; etnUsd: number | null; onPress: () => void; onWatch?: () => void; last?: boolean }) {
  const change = c.volumeChangePct
  const changeTone: 'surge' | 'burn' | 'mute' = change === null || change === 0 ? 'mute' : change > 0 ? 'surge' : 'burn'
  const line = [
    t({ id: 'collections.floor', message: 'Floor {f}', values: { f: formatCollectionValue(c.floorEtn, currency, etnUsd) } }),
    c.owners !== null ? t({ id: 'collections.owners', message: '{n} owners', values: { n: compact(c.owners) } }) : c.totalSupply !== null ? t({ id: 'collections.pieces', message: '{n} pieces', values: { n: compact(c.totalSupply) } }) : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={c.name} testID={`explore-collection-${c.address}`} style={{ minHeight: 56, justifyContent: 'center' }}>
      <Row gap="$3" alignItems="center" paddingVertical={8} borderBottomWidth={last ? 0 : 1} borderBottomColor="$edge">
        <Artwork uri={c.imageUrl} label={c.name} size={36} />
        <Column flex={1} minWidth={0} alignItems="flex-start">
          <Row gap={4} alignItems="center" alignSelf="stretch">
            <Body fontWeight="600" numberOfLines={1} flexShrink={1} minWidth={0}>
              {c.name}
            </Body>
            {c.verified ? <Icon name="check" size={12} color={paint.arc} /> : null}
            {c.custom ? (
              <Body tone="mute" size="caption" fontSize={11} lineHeight={13}>
                {t({ id: 'collection.custom', message: 'Custom' })}
              </Body>
            ) : null}
            {c.paysDividends ? (
              <Body tone="ember" size="caption" fontSize={11} lineHeight={13}>
                {t({ id: 'explore.dividends.short', message: 'Dividends' })}
              </Body>
            ) : null}
          </Row>
          <Body tone="mute" size="caption" fontSize={12} lineHeight={15} numberOfLines={1}>
            {line}
          </Body>
        </Column>
        <Column alignItems="flex-end" flexShrink={0} gap={1}>
          <Body size="caption" fontWeight="600" fontVariant={['tabular-nums']}>
            {formatCollectionValue(c.volumeEtn ?? c.volume24hEtn, currency, etnUsd)}
          </Body>
          <Body tone={changeTone} size="caption" fontSize={12} lineHeight={15} fontVariant={['tabular-nums']}>
            {change === null ? t({ id: 'collections.volume', message: 'volume' }) : `${change > 0 ? '▲' : change < 0 ? '▼' : ''} ${Math.abs(change).toFixed(change !== 0 && Math.abs(change) < 10 ? 1 : 0)}%`}
          </Body>
        </Column>
        {/*
          The watch star lives on this row too now (ES-BV-081). It existed only
          on search hits and the collection page, so the list people actually
          browse — Explore › Collectibles — was the one place you could not
          start watching something from.
        */}
        {onWatch && !c.custom ? (
          <IconButton
            icon="star"
            activeTone="ember"
            activeFilled
            active={c.starred}
            label={c.starred ? t({ id: 'watch.off', message: 'Stop watching {s}', values: { s: c.name } }) : t({ id: 'watch.on', message: 'Watch {s} for price moves', values: { s: c.name } })}
            onPress={onWatch}
            testID={`watch-collection-${c.address}`}
          />
        ) : null}
      </Row>
    </Pressable>
  )
}
