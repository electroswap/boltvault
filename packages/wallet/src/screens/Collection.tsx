/**
 * A collection (master plan §8.10): the lit header with floor and volume,
 * the pieces sorted by price or rarity with a listed filter, and — for
 * Electric Legends — the dividends vessel and the Mint key.
 */
import { Artwork, Body, Chip, Column, Icon, Key, Plate, Row, ScrollView, metrics, paint } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AssetView, CollectionView, LegendsStatus, NftActivityView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { LegendsVault } from '../components/LegendsVault'
import { useEngine } from '../engine/EngineProvider'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Collection({ body, chainId, address, reducedMotion = false }: { body: BodyKind; chainId: number; address: string; reducedMotion?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['legends'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [collection, setCollection] = useState<CollectionView | null>(null)
  const [assets, setAssets] = useState<AssetView[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [orderBy, setOrderBy] = useState<'PRICE' | 'RARITY'>('PRICE')
  const [listedOnly, setListedOnly] = useState(false)
  const [legends, setLegends] = useState<LegendsStatus | null>(null)
  const [activity, setActivity] = useState<NftActivityView[]>([])
  const [showActivity, setShowActivity] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cols = body === 'extension-popup' ? 3 : 4
  const size = Math.floor(((body === 'extension-popup' ? 360 : 640) - inset * 2 - 8 * (cols - 1)) / cols)

  useEffect(() => {
    let alive = true
    engine.explore.collection({ chainId, address, ...(active ? { accountId: active.id } : {}) }).then((c) => alive && setCollection(c), () => undefined)
    return () => {
      alive = false
    }
  }, [engine, chainId, address, active])

  useEffect(() => {
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

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="collection">
      <PageHeader title={collection?.name ?? ''} right={<>{collection ? (
          <Chip onPress={() => engine.watchlist[collection.starred ? 'unstar' : 'star']({ kind: 'collection', chainId, address, label: collection.name }).then(() => setCollection({ ...collection, starred: !collection.starred }))} cursor="pointer" minHeight={44} justifyContent="center" testID="collection-star">
            <Row gap="$1" alignItems="center">
              <Icon name="star" size={16} color={collection.starred ? paint.ember : paint.mute} />
              <Body tone="mute" size="caption">
                {collection.starred ? t({ id: 'watch.starred', message: 'Starred' }) : t({ id: 'watch.star', message: 'Star' })}
              </Body>
            </Row>
          </Chip>
        ) : null}</>} />
      {collection ? (
        <Column gap="$3">
          {collection.bannerUrl ? <Artwork uri={collection.bannerUrl} label={collection.name} size={{ width: (body === 'extension-popup' ? 360 : 640) - inset * 2, height: 96 }} /> : null}
          <Row gap="$3" alignItems="center">
            <Artwork uri={collection.imageUrl} label={collection.name} size={56} />
            <Column flex={1}>
              <Row gap="$2" alignItems="center">
                <Body size="title" numberOfLines={1}>
                  {collection.name}
                </Body>
                {collection.verified ? <Icon name="check" size={16} color={paint.arc} /> : null}
              </Row>
              {collection.paysDividends ? (
                <Body tone="ember" size="caption">
                  {t({ id: 'collection.dividends', message: 'Pays marketplace dividends to holders' })}
                </Body>
              ) : null}
            </Column>
          </Row>
          {collection.description ? (
            <Body tone="mute" size="caption" numberOfLines={3}>
              {collection.description}
            </Body>
          ) : null}
          <Row gap="$3" flexWrap="wrap" testID="collection-stats">
            <Stat label={t({ id: 'collection.floor', message: 'Floor' })} value={collection.floorEtn !== null ? `${collection.floorEtn} ETN` : '—'} />
            <Stat label={t({ id: 'collection.vol', message: '24h volume' })} value={collection.volume24hEtn !== null ? `${Math.round(collection.volume24hEtn)} ETN` : '—'} />
            <Stat label={t({ id: 'collection.owners', message: 'Owners' })} value={collection.owners !== null ? String(collection.owners) : '—'} />
            <Stat label={t({ id: 'collection.listed', message: 'Listed' })} value={collection.percentListed !== null ? `${Math.round(collection.percentListed)}%` : '—'} />
            <Stat label={t({ id: 'collection.supply', message: 'Pieces' })} value={collection.totalSupply !== null ? String(collection.totalSupply) : '—'} />
          </Row>
        </Column>
      ) : null}

      {legends && active ? (
        <>
          <LegendsVault status={legends} busy={busy} reducedMotion={reducedMotion} onActivate={() => void run(() => engine.legends.activate({ accountId: active.id, chainId }))} onClaim={() => void run(() => engine.legends.claim({ accountId: active.id, chainId }))} onPiece={(tokenId) => router.navigate('nft', { chainId, address, tokenId })} />
          {legends.mint?.mintable ? (
            <Plate gap="$2" testID="collection-mint">
              <Row justifyContent="space-between" alignItems="center">
                <Column>
                  <Body size="title">{t({ id: 'collection.mint', message: 'Mint a Legend' })}</Body>
                  <Body tone="mute" size="caption">
                    {t({ id: 'collection.mint.body', message: '{p} ETN each · {n} left for you · {s} minted', values: { p: formatRaw(legends.mint.priceWei, 18), n: legends.mint.mintableCount, s: legends.mint.totalSupply } })}
                  </Body>
                </Column>
                <Key label={t({ id: 'collection.mint.key', message: 'Mint' })} disabled={busy || legends.mint.mintableCount === 0} onPress={() => void run(() => engine.legends.mint({ accountId: active.id, chainId, count: 1 }))} testID="collection-mint-key" />
              </Row>
            </Plate>
          ) : null}
        </>
      ) : null}

      <Row gap="$2" flexWrap="wrap" alignItems="center">
        <Chip onPress={() => setOrderBy('PRICE')} cursor="pointer" minHeight={44} justifyContent="center" borderColor={orderBy === 'PRICE' ? paint.arc : undefined} testID="collection-sort-price">
          <Body tone={orderBy === 'PRICE' ? 'arc' : 'mute'} size="caption">
            {t({ id: 'collection.sort.price', message: 'Price' })}
          </Body>
        </Chip>
        <Chip onPress={() => setOrderBy('RARITY')} cursor="pointer" minHeight={44} justifyContent="center" borderColor={orderBy === 'RARITY' ? paint.arc : undefined} testID="collection-sort-rarity">
          <Body tone={orderBy === 'RARITY' ? 'arc' : 'mute'} size="caption">
            {t({ id: 'collection.sort.rarity', message: 'Rarity' })}
          </Body>
        </Chip>
        <Chip onPress={() => setListedOnly((v) => !v)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={listedOnly ? paint.arc : undefined} testID="collection-listed">
          <Body tone={listedOnly ? 'arc' : 'mute'} size="caption">
            {t({ id: 'collection.listedOnly', message: 'Listed only' })}
          </Body>
        </Chip>
      </Row>
      {error ? <Body tone="burn">{error}</Body> : null}
      <Row gap={8} flexWrap="wrap" testID="collection-grid">
        {assets.map((a) => (
          <Column key={`${a.address}:${a.tokenId}`} onPress={() => router.navigate('nft', { chainId, address: a.address, tokenId: a.tokenId })} cursor="pointer" testID={`piece-${a.tokenId}`}>
            <Artwork uri={a.smallImageUrl} label={a.name} size={size} badge={a.listing?.priceEtn !== null && a.listing?.priceEtn !== undefined ? { text: `${a.listing.priceEtn} ETN`, tone: 'arc' } : a.bestBid ? { text: t({ id: 'piece.offer', message: 'Offer' }), tone: 'ember' } : null} />
            <Body tone="mute" size="caption" numberOfLines={1}>
              {a.name}
            </Body>
          </Column>
        ))}
      </Row>
      {next ? <Key label={t({ id: 'collection.more', message: 'More' })} kind="secondary" onPress={() => void more()} testID="collection-more" /> : null}
      <Chip onPress={() => setShowActivity((v) => !v)} cursor="pointer" minHeight={44} justifyContent="center" alignSelf="flex-start" testID="collection-activity-toggle">
        <Body tone="mute" size="caption">
          {showActivity ? t({ id: 'collection.activity.hide', message: 'Hide activity' }) : t({ id: 'collection.activity', message: 'Activity' })}
        </Body>
      </Chip>
      {showActivity ? (
        <Column gap="$1" testID="collection-activity">
          {activity.map((ev) => (
            <Row key={`${ev.hash ?? ev.timestamp}-${ev.tokenId ?? ''}-${ev.type}`} justifyContent="space-between" minHeight={36} alignItems="center">
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

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Column minWidth={72}>
      <Body tone="mute" size="caption">
        {label}
      </Body>
      <Body>{value}</Body>
    </Column>
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
