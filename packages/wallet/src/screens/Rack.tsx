/**
 * The Rack (master plan §8.10, §7.12; plan C3, owner items N2, N4, N6): the
 * account's pieces on glass shelves that size themselves to the body —
 * listed pieces carry a glowing price tag, pieces with an open offer an
 * ember mark. One row of filters: the collection (a picker sheet with
 * counts), All · Listed · Unlisted · Offers, a sort; the offers inbox is a
 * pill in the header. The last visit's shelves paint at once and refresh
 * behind (plan A2); a first visit shows skeleton tiles.
 */
import { Artwork, Body, Column, Icon, Input, Key, Pill, Plate, Pressable, Row, ScrollView, Segmented, SharedElement, Sheet, StatStrip, TileGrid, metrics, paint } from '@boltvault/ui'
import { cacheKey, type AssetView, type Inventory } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { AddCollectionSheet } from '../components/AddCollectionSheet'
import { FreshnessLine } from '../components/FreshnessLine'
import { PageHeader } from '../components/PageHeader'
import { ScreenFooter } from '../components/ScreenFooter'
import { useCached } from '../hooks/useCached'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { pieceSharedId } from '../navigation/transitions'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'
import { useScreenBusy } from '../state/useScreenBusy'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'
type Filter = 'all' | 'listed' | 'unlisted' | 'offers'
type Sort = 'recent' | 'value' | 'name'
const ETN = 52014
const DURATIONS = ['1', '7', '30'] as const
/** The marketplace's own cut (§8.10); creator royalties are per collection and sit on top. */
const MARKETPLACE_FEE = 0.03

/** One piece, identified the way the chain identifies it. */
function keyOf(a: AssetView): string {
  return `${a.address.toLowerCase()}:${a.tokenId}`
}

/**
 * A piece this account can put up for sale.
 *
 * Already-listed pieces are out (a relist cannot raise a price — the engine
 * refuses it and says so), and so are pieces from a collection the user added
 * by address: those are read from the chain and are not in the marketplace
 * index, so there is no order to build.
 */
function listable(a: AssetView): boolean {
  return a.mine && a.listing === null && a.custom !== true
}

function sortPieces(list: readonly AssetView[], sort: Sort): AssetView[] {
  const out = [...list]
  if (sort === 'name') out.sort((a, b) => a.name.localeCompare(b.name))
  else if (sort === 'value') out.sort((a, b) => (b.listing?.priceEtn ?? b.lastPriceEtn ?? 0) - (a.listing?.priceEtn ?? a.lastPriceEtn ?? 0))
  return out
}

export function Rack({ body, embedded = false, limit }: { body: BodyKind; embedded?: boolean; limit?: number }) {
  const router = useRouter()
  const engine = useEngine()
  const reducedMotion = useReducedMotion()
  const { active } = useWalletState()

  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const wide = body === 'extension-tab'
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [collection, setCollection] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'collection' | 'sort' | 'add' | null>(null)
  /*
    Listing several at once.

    There is no marketplace call that lists a basket: every piece is its own
    Seaport order and its own signature, and a collection the conduit cannot
    move yet costs a transaction before any of them. So this is a queue, and
    like the one in Approvals it is shown as a queue — the count is stated
    before the first sheet opens rather than discovered at the fourth, and a
    refusal stops that one order and nothing behind it.
  */
  const [selecting, setSelecting] = useState(false)
  const [picked, setPicked] = useState<readonly string[]>([])
  const [confirm, setConfirm] = useState(false)
  const [price, setPrice] = useState('')
  const [days, setDays] = useState<string>('7')
  /**
   * How many extra permission transactions the basket costs.
   *
   * Counted per PIECE, not per collection, and that is not a slip. Each
   * listing is built as its own flow the moment it is queued, and a flow whose
   * collection is not yet approved carries its own `setApprovalForAll` step —
   * so three pieces from one unapproved collection really do put three of them
   * in the queue. The number here is the number of sheets the user will see,
   * which is the only number worth stating before the first one opens.
   */
  const [permissions, setPermissions] = useState<number | null>(null)
  const [queueing, setQueueing] = useState<{ done: number; total: number } | null>(null)
  const [error, setError] = useState<string | null>(null)
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

  /*
    Resolved against the whole inventory, not against what the filters are
    showing: changing the collection pill mid-selection must not quietly drop
    pieces out of a basket the user has already counted.
  */
  const chosen = all.filter((a) => picked.includes(keyOf(a)))
  const canSelect = !embedded && all.some(listable)
  const priceOk = Number(price) > 0
  /** One order signature each, plus the permission transactions the basket drags in. */
  const signatures = chosen.length + (permissions ?? 0)
  const proceeds = priceOk ? (Number(price) * (1 - MARKETPLACE_FEE)).toFixed(4).replace(/\.?0+$/, '') : null

  const toggle = (a: AssetView): void => {
    const k = keyOf(a)
    setPicked((p) => (p.includes(k) ? p.filter((x) => x !== k) : [...p, k]))
  }
  const leaveSelection = (): void => {
    setSelecting(false)
    setPicked([])
    setConfirm(false)
    setPermissions(null)
  }

  /*
    What the basket will actually cost in signatures, asked once the sheet is
    open and never on the way in — `collectionApproved` is an eth_call per
    collection, and doing it on every tap would put a round trip behind a
    checkbox. Until it answers the sheet says it is still counting rather than
    showing a number that is about to change.
  */
  const pickedKey = [...picked].sort().join(',')
  useEffect(() => {
    if (!confirm || !accountId || chosen.length === 0) return
    let alive = true
    setPermissions(null)
    const collections = [...new Set(chosen.map((a) => a.address))]
    Promise.all(collections.map((address) => engine.nft.collectionApproved({ accountId, chainId: ETN, address }).catch(() => true))).then(
      (flags) => {
        if (!alive) return
        const unapproved = new Set(collections.filter((_, i) => flags[i] === false).map((a) => a.toLowerCase()))
        setPermissions(chosen.filter((a) => unapproved.has(a.address.toLowerCase())).length)
      },
      () => undefined,
    )
    return () => {
      alive = false
    }
    /*
      Keyed on `pickedKey`, deliberately, and not on `chosen`: `chosen` is a
      fresh array on every render, so depending on it would re-run this on
      every paint — and each run clears the count first, which would leave the
      sheet flickering between a number and "counting" forever.
    */
  }, [confirm, accountId, engine, pickedKey])

  /*
    Queued in order, then the first sheet is opened. Every request lands in the
    approval queue the rest of the product uses, so its "{n} more waiting" is
    an honest count of what is left — and one refusal leaves that piece
    unlisted with the rest still queued, which is why it is said here, before
    the first prompt.
  */
  const listChosen = async (): Promise<void> => {
    if (!accountId || chosen.length === 0 || !priceOk) return
    setConfirm(false)
    setError(null)
    setQueueing({ done: 0, total: chosen.length })
    let first: string | null = null
    for (const a of chosen) {
      try {
        const res = await engine.nft.list({ accountId, chainId: ETN, address: a.address, tokenId: a.tokenId, priceEtn: price.trim(), days: Number(days) })
        first ??= res.requestId
      } catch (err) {
        // One piece the marketplace refuses must not swallow the rest.
        setError(err instanceof Error ? err.message : String(err))
      }
      setQueueing((q) => (q ? { ...q, done: q.done + 1 } : q))
    }
    setQueueing(null)
    leaveSelection()
    if (first !== null) router.navigate('sign', { requestId: first })
  }

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
              {/* The thumb on the shelf and the artwork on the piece's page are one object (§7.7, §7.12 "the Rack"). */}
              {row.map((a) => {
                const art = <Artwork uri={a.smallImageUrl} label={a.name} size={layout.size} badge={a.listing?.priceEtn !== null && a.listing?.priceEtn !== undefined ? { text: `${a.listing.priceEtn} ETN`, tone: 'arc' } : a.bids.length ? { text: t({ id: 'rack.offer', message: 'Offer' }), tone: 'ember' } : null} />
                if (!selecting)
                  return (
                    <SharedElement key={keyOf(a)} id={pieceSharedId(ETN, a.address, a.tokenId)}>
                      <Pressable onPress={() => router.navigate('nft', { chainId: ETN, address: a.address, tokenId: a.tokenId })} accessibilityRole="button" accessibilityLabel={a.name} testID={`rack-piece-${a.tokenId}`}>
                        {art}
                      </Pressable>
                    </SharedElement>
                  )
                /*
                  In selection mode the tile is the checkbox. A piece that
                  cannot be listed stays on its shelf — it is still yours —
                  but dimmed and inert, because a control that takes a tap and
                  does nothing is worse than one that is plainly not offered.
                */
                const can = listable(a)
                const on = picked.includes(keyOf(a))
                return (
                  <Column key={keyOf(a)} opacity={can ? 1 : 0.35}>
                    <Pressable
                      onPress={() => can && toggle(a)}
                      disabled={!can}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on, disabled: !can }}
                      accessibilityLabel={a.name}
                      testID={`rack-pick-${a.tokenId}`}
                    >
                      {art}
                    </Pressable>
                    {can ? (
                      <Column position="absolute" top={6} left={6} width={22} height={22} borderRadius={6} borderWidth={1} borderColor={on ? paint.arc : paint.mute} backgroundColor="rgba(2,3,8,0.65)" alignItems="center" justifyContent="center" pointerEvents="none">
                        {on ? <Icon name="check" size={14} color={paint.arc} /> : null}
                      </Column>
                    ) : null}
                  </Column>
                )
              })}
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
      {!embedded ? <FreshnessLine freshness={inv.freshness} observedAt={inv.observedAt} lastSuccessAt={inv.lastSuccessAt} refreshing={inv.refreshing} reducedMotion={reducedMotion} testID="rack-freshness" /> : null}
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
          <Row gap="$2" alignItems="center" flexWrap="wrap">
            <Pill label={collectionName} icon={<Icon name="grid" size={14} color={paint.mute} />} chevron selected={collection !== null} size="sm" onPress={() => setSheet('collection')} testID="rack-collection-pill" />
            <Pill label={sortLabel} icon={<Icon name="sort" size={14} color={paint.mute} />} chevron size="sm" onPress={() => setSheet('sort')} testID="rack-sort-pill" />
            {canSelect ? (
              <Pill
                label={selecting ? t({ id: 'cancel', message: 'Cancel' }) : t({ id: 'rack.select', message: 'Select several' })}
                selected={selecting}
                size="sm"
                onPress={() => (selecting ? leaveSelection() : setSelecting(true))}
                testID="rack-select"
              />
            ) : null}
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
      {/*
        The shelves are short and the wallet knows it.

        The indexer drops pieces it marks as spam, and the collection counts
        beside the picker come from a source that does not, so the two can
        disagree by a lot. Left unsaid, that reads as loss — "just part of my
        collection is shown ... I believe in total around 150, but I have 300+"
        — and the honest answer is that the pieces are still on chain and still
        the user's; what is missing is the indexer's willingness to list them.

        No arithmetic on screen: the engine compares held units against
        collection balances, which is the only comparison that survives an
        ERC-1155 edition, and this line would have to compare rows. The fact is
        what the user was missing, not the subtraction.
      */}
      {!embedded && inventory?.partial ? (
        <Body tone="mute" size="caption" testID="rack-partial">
          {t({
            id: 'rack.partial',
            message:
              'Some pieces this address holds are not on the shelves: the marketplace index leaves them out, usually as suspected spam. They are still yours on chain — add the collection by address to see them here.',
          })}
        </Body>
      ) : null}
      {embedded && pieces.length > (limit ?? 0) ? <Key label={t({ id: 'rack.open', message: 'Open the Rack' })} kind="secondary" size="compact" onPress={() => router.navigate('rack')} testID="rack-open" /> : null}
      {error ? <Body tone="burn" testID="rack-error">{error}</Body> : null}
      {!embedded && inventory && inventory.assets.length > 0 && !selecting ? <Pill label={t({ id: 'collection.add.pill', message: 'Add a collection' })} icon={<Icon name="plus" size={14} color={paint.arc} />} tone="arc" size="sm" onPress={() => setSheet('add')} testID="rack-add-collection" /> : null}
    </>
  )
  if (embedded) return <Column gap="$3">{content}</Column>
  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="rack">
        {content}
      </ScrollView>

      {selecting ? (
        <ScreenFooter inset={inset} testID="rack-footer">
          <Body tone="mute" size="caption" fontSize={11} lineHeight={14}>
            {queueing
              ? t({ id: 'rack.bulk.queueing', message: 'Preparing {d} of {n}…', values: { d: queueing.done, n: queueing.total } })
              : t({ id: 'rack.bulk.note', message: 'Each piece is its own order and its own signature. Pick the ones to sell, then set one price for all of them.' })}
          </Body>
          <Key
            label={chosen.length ? t({ id: 'rack.bulk.key', message: 'List {n}', values: { n: chosen.length } }) : t({ id: 'rack.bulk.none', message: 'Pick the pieces to sell' })}
            disabled={chosen.length === 0 || queueing !== null}
            onPress={() => setConfirm(true)}
            testID="rack-list-selected"
          />
        </ScreenFooter>
      ) : null}

      <Sheet
        open={confirm}
        onClose={() => setConfirm(false)}
        title={t({ id: 'rack.bulk.title', message: 'List {n} pieces', values: { n: chosen.length } })}
        reducedMotion={reducedMotion}
        footer={
          <Column gap="$2">
            <Key label={t({ id: 'rack.bulk.start', message: 'Start signing' })} disabled={!priceOk} onPress={() => void listChosen()} testID="rack-bulk-start" />
            <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" size="compact" onPress={() => setConfirm(false)} testID="rack-bulk-cancel" />
          </Column>
        }
        testID="rack-bulk-sheet"
      >
        <Column gap="$3">
          <Input value={price} onChange={setPrice} placeholder="0" label={t({ id: 'rack.bulk.price', message: 'Price in ETN, for each piece' })} testID="rack-bulk-price" />
          <Row gap="$2" flexWrap="wrap">
            {DURATIONS.map((d) => (
              <Pill key={d} label={t({ id: 'piece.days', message: '{d} days', values: { d } })} selected={days === d} onPress={() => setDays(d)} testID={`rack-bulk-days-${d}`} />
            ))}
          </Row>
          {proceeds ? (
            <Body tone="mute" size="caption" testID="rack-bulk-proceeds">
              {t({ id: 'rack.bulk.proceeds', message: 'You receive {a} ETN per piece after the 3% marketplace fee, less any creator royalty on that collection.', values: { a: proceeds } })}
            </Body>
          ) : null}
          {/*
            The count, before the first sheet rather than after the third.
            `permissions` is null while the collections are still being asked
            whether the marketplace can move them — saying "counting" is better
            than printing a number that is about to grow.
          */}
          <Body size="title" tone="arc" testID="rack-bulk-signatures">
            {permissions === null
              ? t({ id: 'rack.bulk.counting', message: 'Counting what you will be asked to sign…' })
              : permissions === 0
                ? t({ id: 'rack.bulk.sigs', message: '{n} signatures', values: { n: signatures } })
                : t({ id: 'rack.bulk.sigs.plus', message: '{n} sheets — {o} listings and {p} permissions', values: { n: signatures, o: chosen.length, p: permissions } })}
          </Body>
          <Body tone="mute" size="caption">
            {permissions === null || permissions === 0
              ? t({ id: 'rack.bulk.body', message: 'One signature for each piece. Signing a listing is free; it costs nothing on the network until somebody buys.' })
              : t({ id: 'rack.bulk.body.permission.v2', message: '{p} of these pieces come from a collection the marketplace has not been allowed to hand over yet, so each of them also asks for a transaction that allows it — and those cost a network fee. Listing fewer of them at a time, or listing one first, costs you less.', values: { p: permissions } })}
          </Body>
          <Column gap={2}>
            {chosen.map((a, i) => (
              <Body key={keyOf(a)} tone="mute" size="caption" numberOfLines={1}>
                {t({ id: 'rack.bulk.row', message: '{i}. {name}', values: { i: i + 1, name: a.name } })}
              </Body>
            ))}
          </Column>
          <Body tone="mute" size="caption">
            {t({ id: 'rack.bulk.reject', message: 'You will see a sheet for each one in turn. Refusing one leaves that piece unlisted and the rest stay in the queue.' })}
          </Body>
        </Column>
      </Sheet>
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
