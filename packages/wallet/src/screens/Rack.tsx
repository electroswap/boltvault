/**
 * The Rack (master plan §8.10, §7.12; plan C3, owner items N2, N4, N6): the
 * account's pieces on glass shelves that size themselves to the body —
 * listed pieces carry a glowing price tag, pieces with an open offer an
 * ember mark. One row of filters: the collection (a picker sheet with
 * counts), All · Listed · Unlisted · Offers, a sort; the offers inbox is a
 * pill in the header. The last visit's shelves paint at once and refresh
 * behind (plan A2); a first visit shows skeleton tiles.
 */
import { Artwork, Body, Column, Icon, Key, Pill, Plate, Pressable, Row, ScrollView, Segmented, Sheet, StatStrip, TileGrid, metrics, paint } from '@boltvault/ui'
import { cacheKey, type AssetView, type Inventory } from '@boltvault/engine'
import { useState } from 'react'
import { AddCollectionSheet } from '../components/AddCollectionSheet'
import { FreshnessLine } from '../components/FreshnessLine'
import { PageHeader } from '../components/PageHeader'
import { useCached } from '../hooks/useCached'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'
import { useScreenBusy } from '../state/useScreenBusy'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'
type Filter = 'all' | 'listed' | 'unlisted' | 'offers'
type Sort = 'recent' | 'value' | 'name'
const ETN = 52014

function sortPieces(list: readonly AssetView[], sort: Sort): AssetView[] {
  const out = [...list]
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'value') out.sort((a, b) => (b.listing?.priceEtn ?? b.lastPriceEtn ?? 0) - (a.listing?.priceEtn ?? a.lastPriceEtn ?? 0))
  return out
}

export function Rack({ body, embedded = false, limit }: { body: BodyKind; embedded?: boolean; limit?: number }) {
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const { active } = useWalletState()

  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const wide = body === 'extension-tab'
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [collection, setCollection] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'collection' | 'sort' | 'add' | null>(null)
  const accountId = active?.id ?? null

  const inv = useCached<Inventory>({
    key: accountId ? cacheKey('nft', 'inventory', ETN, accountId) : null,
    cached: (e) => (accountId ? e.nft.cachedInventory({ accountId, chainId: ETN }) : Promise.resolve(null)),
    fresh: (e) => (accountId ? e.nft.inventory({ accountId, chainId: ETN }) : Promise.reject(new Error('no account'))),
  })
  // The shell draws one loader over the whole screen while this is true.
  useScreenBusy('rack', inv.freshness === 'loading')
  const inventory = inv.value
  const all = inventory?.assets ?? []
  const pieces = sortPieces(
    all.filter((a) => (filter === 'listed' ? a.listing !== null : filter === 'unlisted' ? a.listing === null : filter === 'offers' ? a.bids.length > 0 : true)).filter((a) => (collection ? a.address.toLowerCase() === collection.toLowerCase() : true)),
    sort,
  )
  const shown = limit ? pieces.slice(0, limit) : pieces
  const collectionName = collection ? (inventory?.collections.find((c) => c.address.toLowerCase() === collection.toLowerCase())?.name ?? t({ id: 'rack.collection', message: 'Collection' })) : t({ id: 'rack.all.collections', message: 'All collections' })
  const sortLabel = sort === 'recent' ? t({ id: 'rack.sort.recent', message: 'Recent' }) : sort === 'value' ? t({ id: 'rack.sort.value', message: 'Value' }) : t({ id: 'rack.sort.name', message: 'Name' })
  const offersPill = inventory ? <Pill label={inventory.withOffersCount > 0 ? t({ id: 'rack.offers.n', message: 'Offers · {n}', values: { n: inventory.withOffersCount } }) : t({ id: 'rack.inbox', message: 'Offers' })} tone={inventory.withOffersCount > 0 ? 'ember' : 'mute'} size="sm" onPress={() => router.navigate('offers')} testID="rack-offers" /> : null

  const shelves = (layout: { size: number; cols: number }): React.ReactNode => {
    const rows: AssetView[][] = []
    for (let i = 0; i < shown.length; i += layout.cols) rows.push(shown.slice(i, i + layout.cols))
    return (
      <Column gap={14} testID="rack-shelves">
        {rows.map((row, i) => (
          <Column key={i} gap={0}>
            <Row gap={8} alignItems="flex-end">
              {row.map((a) => (
                <Pressable key={`${a.address}:${a.tokenId}`} onPress={() => router.navigate('nft', { chainId: ETN, address: a.address, tokenId: a.tokenId })} accessibilityRole="button" accessibilityLabel={a.name} testID={`rack-piece-${a.tokenId}`}>
                  <Artwork uri={a.smallImageUrl} label={a.name} size={layout.size} badge={a.listing?.priceEtn !== null && a.listing?.priceEtn !== undefined ? { text: `${a.listing.priceEtn} ETN`, tone: 'arc' } : a.bids.length ? { text: t({ id: 'rack.offer', message: 'Offer' }), tone: 'ember' } : null} />
                </Pressable>
              ))}
            </Row>
            {/* The shelf: a lit glass edge with a soft contact shadow beneath. */}
            <Column height={2} backgroundColor="rgba(238,248,255,0.28)" marginTop={2} borderRadius={1} />
            <Column height={8} backgroundColor="rgba(2,3,8,0.35)" borderBottomLeftRadius={8} borderBottomRightRadius={8} />
          </Column>
        ))}
      </Column>
    )
  }

  const content = (
    <>
      {!embedded ? <PageHeader title={t({ id: 'rack.title', message: 'Your collection' })} right={offersPill} /> : null}
      {!embedded ? <FreshnessLine freshness={inv.freshness} observedAt={inv.observedAt} refreshing={inv.refreshing} reducedMotion={reducedMotion} testID="rack-freshness" /> : null}
      {inventory ? (
        <StatStrip
          bare
          small
          cells={[
            { label: t({ id: 'rack.stat.pieces', message: 'Pieces' }), value: String(inventory.assets.length) },
            { label: t({ id: 'rack.stat.floor', message: 'At floor' }), value: inventory.floorValueEtn !== null ? `${Math.round(inventory.floorValueEtn)} ETN` : '—' },
            { label: t({ id: 'rack.stat.listed', message: 'Listed' }), value: String(inventory.listedCount), tone: inventory.listedCount > 0 ? 'arc' : 'ink' },
          ]}
          testID="rack-header"
        />
      ) : null}
      {embedded && inventory && inventory.withOffersCount > 0 ? offersPill : null}
      {!embedded ? (
        <Column gap="$2">
          <Row gap="$2" alignItems="center">
            <Pill label={collectionName} icon={<Icon name="grid" size={14} color={paint.mute} />} chevron selected={collection !== null} size="sm" onPress={() => setSheet('collection')} testID="rack-collection-pill" />
            <Pill label={sortLabel} icon={<Icon name="sort" size={14} color={paint.mute} />} chevron size="sm" onPress={() => setSheet('sort')} testID="rack-sort-pill" />
          </Row>
          <Segmented
            options={[
              { id: 'all', label: t({ id: 'rack.f.all', message: 'All' }) },
              { id: 'listed', label: t({ id: 'rack.f.listed', message: 'Listed' }) },
              { id: 'unlisted', label: t({ id: 'rack.f.unlisted', message: 'Unlisted' }) },
              { id: 'offers', label: t({ id: 'rack.f.offers', message: 'Offers' }) },
            ]}
            value={filter}
            onChange={(id) => setFilter(id as Filter)}
            size="compact"
            testID="rack-filter"
          />
        </Column>
      ) : null}
      {inv.error && !inventory ? <Body tone="burn">{inv.error}</Body> : null}
      {inventory && inventory.assets.length === 0 ? (
        <Plate gap="$2" testID="rack-empty">
          <Body tone="mute">{t({ id: 'rack.empty', message: 'Nothing on the shelves yet. Explore collections on Electroneum — buying a piece lands it here — or add a collection by address.' })}</Body>
          <Row gap="$2" flexWrap="wrap">
            <Key label={t({ id: 'rack.explore', message: 'Explore collectibles' })} kind="secondary" size="compact" onPress={() => router.navigate('explore', { segment: 'collectibles' })} testID="rack-explore" />
            <Key label={t({ id: 'collection.add.pill', message: 'Add a collection' })} kind="secondary" size="compact" onPress={() => setSheet('add')} testID="rack-add-collection" />
          </Row>
        </Plate>
      ) : null}
      {inventory && inventory.assets.length > 0 && pieces.length === 0 ? (
        <Body tone="mute" size="caption" testID="rack-none">
          {t({ id: 'rack.none', message: 'Nothing matches these filters.' })}
        </Body>
      ) : null}
      {shown.length > 0 ? <TileGrid target={wide ? 150 : 100} gap={8} minCols={2} maxCols={6} fallbackWidth={(wide ? 640 : 400) - inset * 2} testID="rack-grid">{shelves}</TileGrid> : null}
      {embedded && pieces.length > (limit ?? 0) ? <Key label={t({ id: 'rack.open', message: 'Open the Rack' })} kind="secondary" size="compact" onPress={() => router.navigate('rack')} testID="rack-open" /> : null}
      {!embedded && inventory && inventory.assets.length > 0 ? <Pill label={t({ id: 'collection.add.pill', message: 'Add a collection' })} icon={<Icon name="plus" size={14} color={paint.arc} />} tone="arc" size="sm" onPress={() => setSheet('add')} testID="rack-add-collection" /> : null}
    </>
  )
  if (embedded) return <Column gap="$3">{content}</Column>
  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12, ...(wide ? { maxWidth: 680, width: '100%', alignSelf: 'center' } : {}) }} testID="rack">
        {content}
      </ScrollView>
      <Sheet open={sheet === 'collection'} onClose={() => setSheet(null)} title={t({ id: 'rack.pick.collection', message: 'Collection' })} reducedMotion={reducedMotion} testID="rack-collection-sheet">
        <Column gap={2}>
          <Pressable onPress={() => { setCollection(null); setSheet(null) }} accessibilityRole="button" style={{ minHeight: 52, justifyContent: 'center' }} testID="rack-collection-all">
            <Row justifyContent="space-between" alignItems="center">
              <Body fontWeight={collection === null ? '600' : '400'}>{t({ id: 'rack.all.collections', message: 'All collections' })}</Body>
              <Body tone="mute" size="caption">
                {String(all.length)}
              </Body>
            </Row>
          </Pressable>
          {(inventory?.collections ?? []).map((c) => (
            <Pressable key={c.address} onPress={() => { setCollection(c.address); setSheet(null) }} accessibilityRole="button" style={{ minHeight: 52, justifyContent: 'center' }} testID={`rack-collection-${c.address}`}>
              <Row gap="$3" alignItems="center">
                <Artwork uri={c.logoUrl} label={c.name} size={32} />
                <Column flex={1} alignItems="flex-start">
                  <Body fontWeight={collection === c.address ? '600' : '400'} numberOfLines={1}>
                    {c.name}
                  </Body>
                  <Body tone="mute" size="caption">
                    {[c.floorEtn !== null ? t({ id: 'rack.pick.floor', message: 'floor {f} ETN', values: { f: c.floorEtn } }) : null, c.custom ? t({ id: 'collection.custom', message: 'Custom' }) : null].filter(Boolean).join(' · ')}
                  </Body>
                </Column>
                <Body tone="mute" size="caption">
                  {String(c.balance)}
                </Body>
              </Row>
            </Pressable>
          ))}
        </Column>
      </Sheet>
      <Sheet open={sheet === 'sort'} onClose={() => setSheet(null)} title={t({ id: 'rack.sort', message: 'Sort by' })} reducedMotion={reducedMotion} testID="rack-sort-sheet">
        <Column gap={2}>
          {(['recent', 'value', 'name'] as const).map((s) => (
            <Pressable key={s} onPress={() => { setSort(s); setSheet(null) }} accessibilityRole="button" style={{ minHeight: 52, justifyContent: 'center' }} testID={`rack-sort-${s}`}>
              <Row justifyContent="space-between" alignItems="center">
                <Body fontWeight={sort === s ? '600' : '400'}>{s === 'recent' ? t({ id: 'rack.sort.recent', message: 'Recent' }) : s === 'value' ? t({ id: 'rack.sort.value', message: 'Value' }) : t({ id: 'rack.sort.name', message: 'Name' })}</Body>
                {sort === s ? <Icon name="check" size={16} color={paint.arc} /> : null}
              </Row>
            </Pressable>
          ))}
        </Column>
      </Sheet>
      <AddCollectionSheet open={sheet === 'add'} onClose={() => setSheet(null)} onAdded={() => inv.refresh()} reducedMotion={reducedMotion} />
    </Column>
  )
}
