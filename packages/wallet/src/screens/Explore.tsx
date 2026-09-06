/**
 * Explore (master plan §8.11): the ElectroSwap market inside the wallet —
 * Tokens · Collectibles · Launch · Farms and one search across all of it.
 * Every list paints the last visit's rows at once and refreshes behind them
 * (plan A2); a first visit shows skeletons, never a blank body. On a token
 * list the star is the pin (plan A5).
 */
import { Artwork, Body, Column, IconButton, Input, Plate, Pressable, Row, ScrollView, Segmented, SkeletonRows, TokenAvatar, metrics, paint } from '@boltvault/ui'
import { cacheKey, type CampaignView, type CollectionView, type ExploreToken, type FarmView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { FreshnessLine } from '../components/FreshnessLine'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useCached } from '../hooks/useCached'
import { useNotifications } from '../hooks/useNotifications'
import { formatChange, formatFiat, formatPct, formatPrice, formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014
type Segment = 'tokens' | 'collectibles' | 'launch' | 'farms'
type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Explore({ body, segment: initial = 'tokens', search = false }: { body: BodyKind; segment?: Segment; search?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const host = useHost()
  const { active } = useWalletState()
  const reducedMotion = useReducedMotion()
  const { unread } = useNotifications()
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [segment, setSegment] = useState<Segment>(initial)
  const [query, setQuery] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [found, setFound] = useState<{ tokens: ExploreToken[]; collections: CollectionView[] } | null>(null)
  const accountId = active?.id

  const tokens = useCached<ExploreToken[]>({
    key: cacheKey('explore', 'tokens', ETN),
    cached: (e) => e.explore.cachedTokens({ chainId: ETN }),
    fresh: (e) => e.explore.tokens({ chainId: ETN }),
    maxAgeMs: 60_000,
  })
  const collections = useCached<CollectionView[]>({
    key: cacheKey('explore', 'collections', ETN, accountId ?? '-'),
    cached: (e) => e.explore.cachedCollections({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
    fresh: (e) => e.explore.collections({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
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
  const star = async (kind: 'collection' | 'campaign', address: string, label: string, starred: boolean): Promise<void> => {
    if (starred) await engine.watchlist.unstar({ kind, chainId: ETN, address })
    else await engine.watchlist.star({ kind, chainId: ETN, address, label })
    if (kind === 'collection') collections.refresh()
    else campaigns.refresh()
  }

  const current = segment === 'tokens' ? tokens : segment === 'collectibles' ? collections : segment === 'launch' ? campaigns : farms
  const live = (campaigns.value ?? []).filter((c) => c.phase === 'live')
  return (
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
            <Body tone="mute" size="caption">
              {t({ id: 'explore.none', message: 'Nothing matches.' })}
            </Body>
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
            <Sky campaigns={campaigns.value ?? []} onOpen={(pool) => router.navigate('campaign', { chainId: ETN, pool })} onStar={(c) => void star('campaign', c.pool, c.token.symbol, c.starred)} />
          ) : (
            <Column gap="$2" testID="explore-farms">
              {(farms.value ?? []).map((f) => (
                <FarmCard key={f.id} farm={f} onPress={() => router.navigate('farm', { chainId: ETN, farmId: f.id })} />
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
  )
}

function Star({ on, onPress, testID }: { on: boolean; onPress: () => void; testID?: string }) {
  return <IconButton icon="star" label={on ? t({ id: 'watch.alerts.off', message: 'Stop alerts' }) : t({ id: 'watch.alerts.on', message: 'Alert me' })} active={on} onPress={onPress} testID={testID} />
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

export function CollectionCard({ collection, onPress, onStar }: { collection: CollectionView; onPress: () => void; onStar: () => void }) {
  return (
    <Plate role="card" gap="$2" onPress={onPress} cursor="pointer" testID={`explore-collection-${collection.address}`}>
      <Row gap="$3" alignItems="center">
        <Artwork uri={collection.imageUrl} label={collection.name} size={44} />
        <Column flex={1}>
          <Row gap="$2" alignItems="center">
            <Body numberOfLines={1}>{collection.name}</Body>
            {collection.verified ? <Body tone="arc" size="caption">✓</Body> : null}
            {collection.paysDividends ? (
              <Body tone="ember" size="caption">
                {t({ id: 'explore.dividends', message: 'Pays dividends' })}
              </Body>
            ) : null}
          </Row>
          <Body tone="mute" size="caption" numberOfLines={1}>
            {[collection.floorEtn !== null ? t({ id: 'explore.floor', message: 'Floor {f} ETN', values: { f: formatRaw(String(Math.round(collection.floorEtn * 1e6)), 6) } }) : null, collection.volume24hEtn !== null ? t({ id: 'explore.vol24', message: '{v} ETN today', values: { v: Math.round(collection.volume24hEtn) } }) : null, collection.percentListed !== null ? t({ id: 'explore.listed', message: '{p}% listed', values: { p: Math.round(collection.percentListed) } }) : null, collection.owned > 0 ? t({ id: 'explore.own', message: 'you own {n}', values: { n: collection.owned } }) : null].filter(Boolean).join(' · ')}
          </Body>
        </Column>
        <Star on={collection.starred} onPress={onStar} testID={`star-collection-${collection.address}`} />
      </Row>
    </Plate>
  )
}

/** The Sky (§8.9): live campaigns first, then upcoming, then ended. */
export function Sky({ campaigns, onOpen, onStar }: { campaigns: CampaignView[]; onOpen: (pool: string) => void; onStar: (c: CampaignView) => void }) {
  const now = Math.floor(Date.now() / 1000)
  const countdown = (c: CampaignView): string => {
    const secs = c.phase === 'upcoming' ? c.starts - now : c.ends - now
    if (secs <= 0) return ''
    const d = Math.floor(secs / 86_400)
    const h = Math.floor((secs % 86_400) / 3600)
    return d > 0 ? t({ id: 'sky.days', message: '{d}d {h}h', values: { d, h } }) : t({ id: 'sky.hours', message: '{h}h {m}m', values: { h, m: Math.floor((secs % 3600) / 60) } })
  }
  const phaseLabel = (c: CampaignView): string => {
    switch (c.phase) {
      case 'live':
        return t({ id: 'sky.live', message: 'Live · ends in {t}', values: { t: countdown(c) } })
      case 'upcoming':
        return t({ id: 'sky.upcoming', message: 'Starts in {t}', values: { t: countdown(c) } })
      case 'awaiting_finalize':
        return t({ id: 'sky.finalizing', message: 'Waiting for the team to finalize' })
      case 'launched':
        return t({ id: 'sky.launched', message: 'Launched' })
      case 'failed':
        return t({ id: 'sky.failed', message: 'Did not reach its target' })
      case 'cancelled':
        return t({ id: 'sky.cancelled', message: 'Cancelled' })
    }
  }
  return (
    <Column gap="$2" testID="sky">
      {campaigns.map((c) => (
        <Plate key={c.pool} role="card" gap="$2" onPress={() => onOpen(c.pool)} cursor="pointer" testID={`sky-${c.pool}`}>
          <Row gap="$3" alignItems="center">
            <Artwork uri={c.logoUrl} label={c.token.symbol} size={44} />
            <Column flex={1}>
              <Row gap="$2" alignItems="center">
                <Body numberOfLines={1}>{c.token.name}</Body>
                <Body tone="mute" size="caption">
                  {c.token.symbol}
                </Body>
              </Row>
              <Body tone={c.phase === 'live' ? 'arc' : 'mute'} size="caption">
                {phaseLabel(c)}
              </Body>
            </Column>
            {c.phase === 'upcoming' || (c.phase === 'live' && c.starred) ? <Star on={c.starred} onPress={() => onStar(c)} testID={`star-campaign-${c.pool}`} /> : null}
          </Row>
          <Row gap="$2" alignItems="center">
            <Column flex={1} height={6} borderRadius={3} backgroundColor="rgba(122, 140, 255, 0.16)" overflow="hidden">
              <Column width={`${Math.round(c.fill * 100)}%`} height={6} backgroundColor={paint.arc} />
            </Column>
            <Body tone="mute" size="caption">
              {t({ id: 'sky.raised', message: '{r} / {t} ETN', values: { r: formatRaw(c.raisedWei, 18), t: formatRaw(c.minEtnToLaunchWei, 18) } })}
            </Body>
          </Row>
        </Plate>
      ))}
      {campaigns.length === 0 ? (
        <Body tone="mute" size="caption">
          {t({ id: 'sky.empty', message: 'No campaigns right now. Star one from a share link to be told when it goes live.' })}
        </Body>
      ) : null}
    </Column>
  )
}

export function FarmCard({ farm, onPress }: { farm: FarmView; onPress: () => void }) {
  const p = farm.position
  return (
    <Plate role="card" gap="$1" onPress={onPress} cursor="pointer" testID={`farm-card-${farm.id}`}>
      <Row justifyContent="space-between" alignItems="center">
        <Row gap="$2" alignItems="center">
          <Body>{farm.name || `${farm.symbol0}/${farm.symbol1}`}</Body>
          <Body tone="mute" size="caption">
            {farm.version === 3 ? 'V3' : 'V2'}
          </Body>
        </Row>
        {p ? (
          <Body tone="arc" size="caption">
            {`${(p.durationMultiplier / 10_000).toFixed(2)}× · ${(p.boltMultiplier / 10_000).toFixed(2)}×`}
          </Body>
        ) : null}
      </Row>
      <Body tone="mute" size="caption">
        {[farm.baseApy !== null ? t({ id: 'farm.apy', message: 'APY {a}%', values: { a: farm.baseApy.toFixed(1) } }) : null, farm.thirdPartyApy !== null && farm.thirdParty ? t({ id: 'farm.apy3', message: '+{a}% {s}', values: { a: farm.thirdPartyApy.toFixed(1), s: farm.thirdParty.symbol } }) : null, farm.tvlUsd !== null ? t({ id: 'farm.tvl', message: 'TVL {v}', values: { v: formatFiat(farm.tvlUsd, 'USD') } }) : null, p && p.pendingRewards !== '0' ? t({ id: 'farm.card.collect', message: '{d} DYNO to collect', values: { d: formatRaw(p.pendingRewards, 18) } }) : null].filter(Boolean).join(' · ') || formatPct(0)}
      </Body>
    </Plate>
  )
}
