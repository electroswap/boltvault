/**
 * A collection (master plan §8.10; plan C3, owner items N2, N3, N5): a hero
 * with the banner fading into the night, the avatar overlapping it, the
 * verified check and the dividends pill, a clamp of the description; the
 * numbers as a stat strip; Price · Rarity and a Listed-only pill; the
 * dividends card and a mint plate only when the chain says the collection
 * mints; pieces on a grid that sizes itself to the body.
 */
import { Artwork, Body, Column, IconButton, Key, Pill, Plate, Pressable, Row, ScrollView, Scrim, Segmented, StatStrip, TileGrid, metrics, useWindowDimensions } from '@boltvault/ui'
import type { AssetView, CollectionView, LegendsStatus, NftActivityView } from '@boltvault/engine'
import { useEffect, useRef, useState } from 'react'
import { DividendsCard } from '../components/DividendsCard'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { useLastGood } from '../hooks/useLastGood'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'
import { useScreenBusy } from '../state/useScreenBusy'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Collection({ body, chainId, address, reducedMotion = false }: { body: BodyKind; chainId: number; address: string; reducedMotion?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const { width } = useWindowDimensions()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['legends'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const wide = body === 'extension-tab'
  const contentWidth = Math.min(width, wide ? 680 : width) - inset * 2
  const [loaded, setCollection] = useState<CollectionView | null>(null)
  const [loadedAssets, setAssets] = useState<AssetView[]>([])
  // Navigating away unmounts this screen and the reload is a round trip, so
  // coming back used to blank the hero and the grid before repainting them.
  // Keyed on the collection, so a *different* one still starts empty.
  const collection = useLastGood(`collection:${chainId}:${address}`, loaded)
  const assets = useLastGood(`collection-assets:${chainId}:${address}`, loadedAssets) ?? []
  const [next, setNext] = useState<string | null>(null)
  const [orderBy, setOrderBy] = useState<'PRICE' | 'RARITY'>('PRICE')
  const [listedOnly, setListedOnly] = useState(false)
  const [loadedLegends, setLegends] = useState<LegendsStatus | null>(null)
  // The dividends card is the slowest thing on this screen — legends.status is
  // several dependent multicalls — so on a revisit it keeps the last answer
  // rather than vanishing and sliding the page as it comes back.
  const legends = useLastGood(`legends:${chainId}:${address}:${active?.id ?? '-'}`, loadedLegends)
  const [activity, setActivity] = useState<NftActivityView[]>([])
  const [showActivity, setShowActivity] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)


  // The shell draws one loader over the whole screen while this is true.
  useScreenBusy('collection', collection === null || (collection.paysDividends && active !== null && legends === null))

  useEffect(() => {
    let alive = true
    engine.explore.collection({ chainId, address, ...(active ? { accountId: active.id } : {}) }).then((c) => alive && setCollection(c), () => undefined)
    return () => {
      alive = false
    }
  }, [engine, chainId, address, active, flow?.status])

  // `collection` is null on mount, so `collection?.custom` is undefined and the
  // guard below does not fire — then the collection resolves, `custom` becomes
  // false, the dependency changes and this ran a second, byte-identical
  // NftAssets query. The guard needs the value but must not re-trigger on it,
  // so it reads through a ref.
  const custom = useRef<boolean | undefined>(undefined)
  custom.current = collection?.custom
  useEffect(() => {
    if (custom.current === true) return
    let alive = true
    engine.nft.assets({ chainId, address, orderBy, asc: orderBy === 'PRICE', ...(listedOnly ? { listed: true } : {}), ...(active ? { accountId: active.id } : {}) }).then(
      (page) => {
        if (!alive) return
        setAssets(page.assets)
        setNext(page.next)
      },
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
    }
  }, [engine, chainId, address, orderBy, listedOnly, active, flow?.status])

  // A custom collection has no indexer: its pieces are the account's own, from the Rack's inventory.
  useEffect(() => {
    if (!collection?.custom || !active) return
    let alive = true
    engine.nft.inventory({ accountId: active.id, chainId }).then((inv) => alive && setAssets(inv.assets.filter((a) => a.address.toLowerCase() === address.toLowerCase())), () => undefined)
    return () => {
      alive = false
    }
  }, [engine, chainId, address, active, collection?.custom])

  useEffect(() => {
    if (!collection?.paysDividends || !active) return
    let alive = true
    engine.legends.status({ accountId: active.id, chainId }).then((s) => alive && setLegends(s), () => undefined)
    return () => {
      alive = false
    }
  }, [engine, collection?.paysDividends, active, chainId, flow?.status])

  useEffect(() => {
    if (!showActivity) return
    engine.nft.activity({ chainId, address }).then(setActivity, () => undefined)
  }, [engine, chainId, address, showActivity])

  const more = async (): Promise<void> => {
    if (!next) return
    const page = await engine.nft.assets({ chainId, address, orderBy, asc: orderBy === 'PRICE', ...(listedOnly ? { listed: true } : {}), after: next, ...(active ? { accountId: active.id } : {}) })
    setAssets((xs) => [...xs, ...page.assets])
    setNext(page.next)
  }

  const run = async (fn: () => Promise<{ flowId: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      setActive(r.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (flow) return <FlowPlate flow={flow} body={body} reducedMotion={reducedMotion} titles={{ working: t({ id: 'legends.working', message: 'Working…' }), done: flow.steps.some((s) => s.step === 'mint') ? t({ id: 'legends.minted', message: 'Minted' }) : flow.steps.some((s) => s.step === 'register') ? t({ id: 'legends.activated', message: 'Dividends activated' }) : t({ id: 'legends.claimed', message: 'Claimed' }) }} onDone={dismiss} testID="legends-flow" />

  const mint = collection?.mint ?? null
  const star = collection && !collection.custom ? <IconButton icon="star" label={collection.starred ? t({ id: 'watch.unstar', message: 'Stop alerts' }) : t({ id: 'watch.alerts.on', message: 'Alert me' })} active={collection.starred} onPress={() => void engine.watchlist[collection.starred ? 'unstar' : 'star']({ kind: 'collection', chainId, address, label: collection.name }).then(() => setCollection({ ...collection, starred: !collection.starred }))} testID="collection-star" /> : null
  const removeCustom = collection?.custom ? <IconButton icon="trash" label={t({ id: 'collection.remove', message: 'Remove this collection' })} tone="burn" onPress={() => void engine.nft.removeCollection({ chainId, address }).then(() => router.back())} testID="collection-remove" /> : null

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 12, ...(wide ? { maxWidth: 680, width: '100%', alignSelf: 'center' } : {}) }} testID="collection">
      <PageHeader title={collection?.name ?? ''} right={<>{star}{removeCustom}</>} />
      {/*
        Owner: the loader "should be displayed until all resources (collection
        header, logo, metadata, and dividends - if applicable) have downloaded
        and are ready to render." So the screen waits on the metadata *and*,
        when the collection pays, on the dividends read — otherwise the card
        arrives afterwards and moves the page, which is the jank being
        reported. The art itself is not waited on: Artwork already holds its
        own space and the disk cache makes a second visit instant.
      */}
      {collection ? (
        <Column gap="$3" testID="collection-hero">
          {/* The hero: the banner fades into the night; the avatar overlaps its edge. */}
          <Column>
            {collection.bannerUrl ? (
              <Column position="relative">
                <Artwork uri={collection.bannerUrl} label={collection.name} size={{ width: contentWidth, height: 104 }} />
                {/* Transparent at the top, solid at the bottom, the banner's
                    full width — so the name sits on the picture rather than on
                    a grey bar laid over it. */}
                <Column position="absolute" left={0} right={0} bottom={0}>
                  <Scrim width={contentWidth} height={64} />
                </Column>
              </Column>
            ) : null}
            <Row gap="$3" alignItems="flex-end" marginTop={collection.bannerUrl ? -32 : 0} paddingHorizontal={collection.bannerUrl ? 12 : 0}>
              <Artwork uri={collection.imageUrl} label={collection.name} size={64} />
              <Column flex={1} alignItems="flex-start" paddingBottom={4}>
                <Row gap="$2" alignItems="center">
                  <Body size="title" numberOfLines={1} flexShrink={1}>
                    {collection.name}
                  </Body>
                  {collection.verified ? <Body tone="arc">✓</Body> : null}
                </Row>
                <Row gap="$2" flexWrap="wrap">
                  {collection.paysDividends ? <Pill label={t({ id: 'explore.dividends', message: 'Pays dividends' })} tone="ember" size="xs" /> : null}
                  {collection.custom ? <Pill label={t({ id: 'collection.custom', message: 'Custom' })} size="xs" /> : null}
                  {collection.standard !== 'unknown' ? <Pill label={collection.standard === 'ERC1155' ? 'ERC-1155' : 'ERC-721'} size="xs" /> : null}
                </Row>
              </Column>
            </Row>
          </Column>
          {collection.description ? (
            <Column gap={2}>
              <Body tone="mute" size="caption" numberOfLines={expanded ? undefined : 3}>
                {collection.description}
              </Body>
              {collection.description.length > 140 ? (
                <Pressable onPress={() => setExpanded((v) => !v)} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }} testID="collection-readmore">
                  <Body tone="arc" size="caption">
                    {expanded ? t({ id: 'less', message: 'Less' }) : t({ id: 'readmore', message: 'Read more' })}
                  </Body>
                </Pressable>
              ) : null}
            </Column>
          ) : null}
          {!collection.custom ? (
            <StatStrip
              small
              columns={wide ? 5 : 3}
              cells={[
                { label: t({ id: 'collection.floor', message: 'Floor' }), value: collection.floorEtn !== null ? `${collection.floorEtn} ETN` : '—' },
                { label: t({ id: 'collection.vol', message: '24h volume' }), value: collection.volume24hEtn !== null ? `${Math.round(collection.volume24hEtn)} ETN` : '—' },
                { label: t({ id: 'collection.owners', message: 'Owners' }), value: collection.owners !== null ? String(collection.owners) : '—' },
                { label: t({ id: 'collection.listed', message: 'Listed' }), value: collection.percentListed !== null ? `${Math.round(collection.percentListed)}%` : '—' },
                { label: t({ id: 'collection.supply', message: 'Pieces' }), value: collection.totalSupply !== null ? String(collection.totalSupply) : '—' },
              ]}
              testID="collection-stats"
            />
          ) : (
            <Body tone="mute" size="caption" testID="collection-custom-note">
              {t({ id: 'collection.custom.body', message: 'Added by you. Pieces and images are read from the contract; there is no market data or marketplace here.' })}
            </Body>
          )}
        </Column>
      ) : null}

      {/*
        A collection that pays dividends reserves the card's place as soon as
        we know it does, and fills it when the chain answers. Without this the
        card appeared late and shoved the pieces grid down the page, which is
        the jank the owner filmed on Electric Legends.
      */}
      {legends && active ? <DividendsCard status={legends} busy={busy} reducedMotion={reducedMotion} onActivate={() => void run(() => engine.legends.activate({ accountId: active.id, chainId }))} onClaim={() => void run(() => engine.legends.claim({ accountId: active.id, chainId }))} onPiece={(tokenId) => router.navigate('nft', { chainId, address, tokenId })} /> : null}

      {/* Mint only when the chain says so (owner item N5). */}
      {mint?.mintable && mint.mintableCount > 0 && active ? (
        <Plate role="card" gap="$2" testID="collection-mint">
          <Row justifyContent="space-between" alignItems="center" gap="$3">
            <Column flex={1} alignItems="flex-start">
              <Body fontWeight="600">{t({ id: 'collection.mint.title', message: 'Minting now' })}</Body>
              <Body tone="mute" size="caption">
                {t({ id: 'collection.mint.body', message: '{p} ETN each · {n} left for you · {s} minted', values: { p: formatRaw(mint.priceWei, 18), n: mint.mintableCount, s: mint.totalSupply } })}
              </Body>
            </Column>
            <Key label={t({ id: 'collection.mint.key', message: 'Mint' })} size="compact" disabled={busy || mint.mintableCount === 0} onPress={() => void run(() => engine.nft.mint({ accountId: active.id, chainId, count: 1, address }))} testID="collection-mint-key" />
          </Row>
        </Plate>
      ) : null}

      {!collection?.custom ? (
        <Row gap="$2" alignItems="center">
          <Column width={150}>
            <Segmented
              options={[
                { id: 'PRICE', label: t({ id: 'collection.sort.price', message: 'Price' }) },
                { id: 'RARITY', label: t({ id: 'collection.sort.rarity', message: 'Rarity' }) },
              ]}
              value={orderBy}
              onChange={(id) => setOrderBy(id as 'PRICE' | 'RARITY')}
              size="compact"
              testID="collection-sort"
            />
          </Column>
          <Pill label={t({ id: 'collection.listedOnly', message: 'Listed only' })} selected={listedOnly} size="sm" onPress={() => setListedOnly((v) => !v)} testID="collection-listed" />
        </Row>
      ) : null}
      {error ? <Body tone="burn">{error}</Body> : null}
      {/* Owner: at most two across in the popup; the tab may use its width. */}
      {assets.length > 0 ? (
        <TileGrid target={wide ? 150 : 160} gap={8} minCols={2} maxCols={wide ? 6 : 2} fallbackWidth={contentWidth} testID="collection-grid">
          {(layout) => (
            <Row gap={8} flexWrap="wrap">
              {assets.map((a) => (
                <Pressable key={`${a.address}:${a.tokenId}`} onPress={() => router.navigate('nft', { chainId, address: a.address, tokenId: a.tokenId })} accessibilityRole="button" accessibilityLabel={a.name} style={{ width: layout.size }} testID={`piece-${a.tokenId}`}>
                  <Artwork uri={a.smallImageUrl} label={a.name} size={layout.size} badge={a.listing?.priceEtn !== null && a.listing?.priceEtn !== undefined ? { text: `${a.listing.priceEtn} ETN`, tone: 'arc' } : a.bestBid ? { text: t({ id: 'piece.offer', message: 'Offer' }), tone: 'ember' } : null} />
                  <Body tone="mute" size="caption" numberOfLines={1}>
                    {a.name}
                  </Body>
                </Pressable>
              ))}
            </Row>
          )}
        </TileGrid>
      ) : collection?.custom ? (
        <Body tone="mute" size="caption">
          {t({ id: 'collection.custom.none', message: 'None of this collection’s pieces are in your wallet.' })}
        </Body>
      ) : null}
      {next ? <Key label={t({ id: 'collection.more', message: 'More' })} kind="secondary" size="compact" onPress={() => void more()} testID="collection-more" /> : null}
      {!collection?.custom ? <Pill label={showActivity ? t({ id: 'collection.activity.hide', message: 'Hide activity' }) : t({ id: 'collection.activity', message: 'Activity' })} size="sm" selected={showActivity} onPress={() => setShowActivity((v) => !v)} testID="collection-activity-toggle" /> : null}
      {showActivity ? (
        <Column gap={2} testID="collection-activity">
          {activity.map((ev) => (
            <Row key={`${ev.hash ?? ev.timestamp}-${ev.tokenId ?? ''}-${ev.type}`} justifyContent="space-between" minHeight={32} alignItems="center">
              <Body size="caption">{`${activityLabel(ev.type)} ${ev.name ?? `#${ev.tokenId ?? ''}`}`}</Body>
              <Body tone="mute" size="caption">
                {ev.priceEtn !== null ? `${ev.priceEtn} ETN` : new Date(ev.timestamp * 1000).toLocaleDateString('en-GB')}
              </Body>
            </Row>
          ))}
        </Column>
      ) : null}
    </ScrollView>
  )
}

export function activityLabel(type: NftActivityView['type']): string {
  switch (type) {
    case 'LISTING':
      return t({ id: 'nftact.listed', message: 'Listed' })
    case 'SALE':
      return t({ id: 'nftact.sold', message: 'Sold' })
    case 'CANCEL_LISTING':
      return t({ id: 'nftact.unlisted', message: 'Unlisted' })
    case 'TRANSFER':
      return t({ id: 'nftact.moved', message: 'Moved' })
    case 'BID':
      return t({ id: 'nftact.offer', message: 'Offer on' })
    case 'CANCEL_BID':
      return t({ id: 'nftact.offerCancelled', message: 'Offer withdrawn on' })
  }
}
