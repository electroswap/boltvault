/**
 * Explore (master plan §8.11): the ElectroSwap market inside the wallet —
 * Tokens · Collectibles · Launch · Farms and one search across all of it.
 * Every list paints the last visit's rows at once and refreshes behind them
 * (plan A2); a first visit shows skeletons, never a blank body. On a token
 * list the star is the pin (plan A5).
 */
import { Body, Column, Icon, IconButton, Input, Pill, Plate, Pressable, Row, ScrollView, Segmented, SkeletonRows, TokenAvatar, metrics, paint } from '@boltvault/ui'
import { cacheKey, type CampaignView, type CollectionView, type ExploreToken, type FarmView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { AddCollectionSheet } from '../components/AddCollectionSheet'
import { AddTokenSheet } from '../components/AddTokenSheet'
import { CampaignCard } from '../components/cards/CampaignCard'
import { CollectionCard } from '../components/cards/CollectionCard'
import { FarmCard } from '../components/cards/FarmCard'
import { FreshnessLine } from '../components/FreshnessLine'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useCached } from '../hooks/useCached'
import { useNotifications } from '../hooks/useNotifications'
import { usePrefs } from '../hooks/usePrefs'
import { formatChange, formatFiat, formatPrice } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014
type Segment = 'tokens' | 'collectibles' | 'launch' | 'farms'
type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Explore({ body, segment: initial = 'tokens', search = false }: { body: BodyKind; segment?: Segment; search?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const host = useHost()
  const { active } = useWalletState()
  const { setActive: setFlow } = useSwapFlow()
  const reducedMotion = useReducedMotion()
  const { unread } = useNotifications()
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [segment, setSegment] = useState<Segment>(initial)
  const [query, setQuery] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [found, setFound] = useState<{ tokens: ExploreToken[]; collections: CollectionView[] } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addCollectionOpen, setAddCollectionOpen] = useState(false)
  const { prefs, set: setPrefs } = usePrefs()
  const showAll = prefs.collectionsShowAll
  const accountId = active?.id

  const tokens = useCached<ExploreToken[]>({
    key: cacheKey('explore', 'tokens', ETN),
    cached: (e) => e.explore.cachedTokens({ chainId: ETN }),
    fresh: (e) => e.explore.tokens({ chainId: ETN }),
    maxAgeMs: 60_000,
  })
  const collections = useCached<CollectionView[]>({
    key: cacheKey('explore', 'collections', ETN, accountId ?? '-', showAll ? 'all' : 'listed'),
    cached: (e) => e.explore.cachedCollections({ chainId: ETN, ...(accountId ? { accountId } : {}), all: showAll }),
    fresh: (e) => e.explore.collections({ chainId: ETN, ...(accountId ? { accountId } : {}), all: showAll }),
    maxAgeMs: 60_000,
  })
  const campaigns = useCached<CampaignView[]>({
    key: cacheKey('launchpad', 'list', ETN, accountId ?? '-'),
    cached: (e) => e.launchpad.cachedList({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
    fresh: (e) => e.launchpad.list({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
  })
  const farms = useCached<FarmView[]>({
    key: cacheKey('farm', 'list', ETN, accountId ?? '-'),
    cached: (e) => e.farm.cachedList({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
    fresh: (e) => e.farm.list({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
  })

  useEffect(() => {
    engine.explore.available().then(setAvailable, () => undefined)
  }, [engine])

  useEffect(() => {
    if (!query.trim()) {
      setFound(null)
      return
    }
    let alive = true
    const id = setTimeout(() => engine.explore.search({ chainId: ETN, query }).then((r) => alive && setFound(r), () => undefined), 250)
    return () => {
      alive = false
      clearTimeout(id)
    }
  }, [engine, query])

  const pin = (address: string, pinned: boolean): void => {
    void engine.tokens.setPrefs({ chainId: ETN, address, pinned: !pinned }).catch(() => undefined)
    setFound((f) => (f ? { ...f, tokens: f.tokens.map((x) => (x.address === address ? { ...x, pinned: !pinned } : x)) } : f))
  }
  const [collecting, setCollecting] = useState<number | null>(null)
  const collect = async (farmId: number): Promise<void> => {
    if (!active) return
    setCollecting(farmId)
    try {
      const r = await engine.farm.collect({ accountId: active.id, chainId: ETN, farmId, asNative: true })
      setFlow(r.flowId)
    } catch {
      // The farm page shows the reason; the card stays quiet.
    } finally {
      setCollecting(null)
    }
  }
  const star = async (kind: 'collection' | 'campaign', address: string, label: string, starred: boolean): Promise<void> => {
    if (starred) await engine.watchlist.unstar({ kind, chainId: ETN, address })
    else await engine.watchlist.star({ kind, chainId: ETN, address, label })
    if (kind === 'collection') collections.refresh()
    else campaigns.refresh()
  }

  const current = segment === 'tokens' ? tokens : segment === 'collectibles' ? collections : segment === 'launch' ? campaigns : farms
  const live = (campaigns.value ?? []).filter((c) => c.phase === 'live')
  return (
    <Column flex={1}>
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="explore">
      <PageHeader
        title={t({ id: 'market.title', message: 'Market' })}
        right={
          <>
            {host.browser ? <IconButton icon="external" label={t({ id: 'explore.browser', message: 'Browser' })} onPress={() => router.navigate('browser')} testID="explore-browser" /> : null}
            <IconButton icon="bell" label={t({ id: 'explore.alerts', message: 'Alerts' })} badge={unread} onPress={() => router.navigate('alerts')} testID="explore-alerts" />
          </>
        }
      />
      <Input value={query} onChange={setQuery} placeholder={t({ id: 'explore.search', message: 'Search tokens, collections, campaigns' })} autoFocus={search} testID="explore-search" />
      {available === false ? (
        <Plate gap="$2" testID="explore-unavailable">
          <Body size="title">{t({ id: 'explore.off.title', message: 'Markets are on Electroneum' })}</Body>
          <Body tone="mute" size="caption">
            {t({ id: 'explore.off.body', message: 'Prices, collections and campaigns come from ElectroSwap, which this build cannot reach yet. Your balances, sends and swaps still work.' })}
          </Body>
        </Plate>
      ) : null}
      {found ? (
        <Column gap="$2" testID="explore-results">
          {found.tokens.map((x) => (
            <TokenRow key={x.address} token={x} onPress={() => router.navigate('token', { chainId: ETN, address: x.address })} onPin={() => pin(x.address, x.pinned)} />
          ))}
          {found.collections.map((c) => (
            <CollectionCard key={c.address} collection={c} onPress={() => router.navigate('collection', { chainId: ETN, address: c.address })} onStar={() => void star('collection', c.address, c.name, c.starred)} />
          ))}
          {found.tokens.length === 0 && found.collections.length === 0 ? (
            <Column gap="$2">
              <Body tone="mute" size="caption">
                {t({ id: 'explore.none', message: 'Nothing matches.' })}
              </Body>
              {/^0x[0-9a-fA-F]{40}$/.test(query.trim()) ? <Pill label={t({ id: 'token.add.pill', message: 'Add token' })} tone="arc" onPress={() => setAddOpen(true)} testID="explore-add-token" /> : null}
            </Column>
          ) : null}
        </Column>
      ) : (
        <>
          <Segmented
            options={[
              { id: 'tokens', label: t({ id: 'explore.tokens', message: 'Tokens' }) },
              { id: 'collectibles', label: t({ id: 'explore.collectibles', message: 'Collectibles' }) },
              { id: 'launch', label: live.length ? t({ id: 'explore.launch.live', message: 'Launch · {n}', values: { n: live.length } }) : t({ id: 'explore.launch', message: 'Launch' }) },
              { id: 'farms', label: t({ id: 'explore.farms', message: 'Farms' }) },
            ]}
            value={segment}
            onChange={(id) => setSegment(id as Segment)}
            size="compact"
            testID="explore-segments"
          />
          <FreshnessLine freshness={current.freshness} observedAt={current.observedAt} refreshing={current.refreshing} reducedMotion={reducedMotion} testID="explore-freshness" />
          {current.freshness === 'loading' ? (
            <SkeletonRows rows={5} reducedMotion={reducedMotion} testID="explore-loading" />
          ) : segment === 'tokens' ? (
            <Column gap="$1" testID="explore-token-list">
              {(tokens.value ?? []).map((x) => (
                <TokenRow key={x.address} token={x} onPress={() => router.navigate('token', { chainId: ETN, address: x.address })} onPin={() => pin(x.address, x.pinned)} />
              ))}
              {(tokens.value ?? []).length === 0 ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'explore.tokens.empty', message: 'No market data yet.' })}
                </Body>
              ) : null}
            </Column>
          ) : segment === 'collectibles' ? (
            <Column gap="$2" testID="explore-collections">
              <Row gap="$2" alignItems="center" flexWrap="wrap">
                <Pill label={showAll ? t({ id: 'explore.collections.all', message: 'Showing everything' }) : t({ id: 'explore.collections.listed', message: 'Listed collections' })} selected={showAll} size="sm" onPress={() => setPrefs({ collectionsShowAll: !showAll })} testID="explore-collections-all" />
                <Pill label={t({ id: 'collection.add.pill', message: 'Add a collection' })} icon={<Icon name="plus" size={14} color={paint.arc} />} tone="arc" size="sm" onPress={() => setAddCollectionOpen(true)} testID="explore-add-collection" />
              </Row>
              {(collections.value ?? []).map((c) => (
                <CollectionCard key={c.address} collection={c} onPress={() => router.navigate('collection', { chainId: ETN, address: c.address })} onStar={() => void star('collection', c.address, c.name, c.starred)} />
              ))}
              {active ? (
                <Pressable onPress={() => router.navigate('rack')} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }} testID="explore-rack">
                  <Body tone="arc" size="caption">
                    {t({ id: 'explore.rack', message: 'Your collection' })}
                  </Body>
                </Pressable>
              ) : null}
            </Column>
          ) : segment === 'launch' ? (
            <Column gap="$2" testID="sky">
              {(campaigns.value ?? []).map((c) => (
                <CampaignCard key={c.pool} campaign={c} onPress={() => router.navigate('campaign', { chainId: ETN, pool: c.pool })} onStar={() => void star('campaign', c.pool, c.token.symbol, c.starred)} />
              ))}
              {(campaigns.value ?? []).length === 0 ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'sky.empty', message: 'No campaigns right now. Star one from a share link to be told when it goes live.' })}
                </Body>
              ) : null}
            </Column>
          ) : (
            <Column gap="$2" testID="explore-farms">
              {(farms.value ?? []).map((f) => (
                <FarmCard key={f.id} farm={f} onPress={() => router.navigate('farm', { chainId: ETN, farmId: f.id })} onCollect={active && f.position ? () => void collect(f.id) : undefined} busy={collecting === f.id} />
              ))}
              {(farms.value ?? []).length === 0 ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'explore.farms.empty', message: 'No farms to show.' })}
                </Body>
              ) : null}
            </Column>
          )}
        </>
      )}
    </ScrollView>
    <AddTokenSheet open={addOpen} onClose={() => setAddOpen(false)} initialAddress={query.trim()} reducedMotion={reducedMotion} />
    <AddCollectionSheet open={addCollectionOpen} onClose={() => setAddCollectionOpen(false)} onAdded={() => collections.refresh()} reducedMotion={reducedMotion} />
    </Column>
  )
}

export function TokenRow({ token, onPress, onPin }: { token: ExploreToken; onPress: () => void; onPin: () => void }) {
  const change = formatChange(token.change24h === null ? null : token.change24h / 100)
  return (
    <Row gap="$2" alignItems="center" minHeight={52} testID={`explore-token-${token.symbol}`}>
      <Row flex={1} gap="$3" alignItems="center" onPress={onPress} cursor="pointer" minHeight={44}>
        <TokenAvatar chainId={token.chainId} address={token.address === 'native' ? '0x0000000000000000000000000000000000000000' : token.address} logoUri={token.logoUri} size={28} />
        <Column flex={1}>
          <Row gap="$2" alignItems="center">
            <Body>{token.symbol}</Body>
            {token.safety === 'BLOCKED' || token.safety === 'STRONG_WARNING' ? <Body tone="burn" size="caption">!</Body> : null}
          </Row>
          <Body tone="mute" size="caption" numberOfLines={1}>
            {token.volume24h !== null ? t({ id: 'explore.vol', message: 'Vol {v}', values: { v: formatFiat(token.volume24h, 'USD') } }) : token.name}
          </Body>
        </Column>
        <Column alignItems="flex-end">
          <Body>{formatPrice(token.price, 'USD')}</Body>
          {change ? (
            <Body tone={change.startsWith('+') ? 'surge' : change.startsWith('−') ? 'burn' : 'mute'} size="caption">
              {change}
            </Body>
          ) : null}
        </Column>
      </Row>
      <IconButton icon="pin" label={token.pinned ? t({ id: 'pin.off', message: 'Unpin from Home' }) : t({ id: 'pin.on', message: 'Pin to Home' })} active={token.pinned} onPress={onPin} testID={`star-token-${token.symbol}`} />
    </Row>
  )
}


/** The Sky (§8.9): live campaigns first, then upcoming, then ended. */

