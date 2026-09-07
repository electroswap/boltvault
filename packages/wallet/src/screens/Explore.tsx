/**
 * Explore (master plan §8.11): the ElectroSwap market inside the wallet —
 * Tokens · Collectibles · Launch · Farms and one search across all of it.
 * Every list paints the last visit's rows at once and refreshes behind them
 * (plan A2); a first visit shows skeletons, never a blank body. On a token
 * list the star is the pin (plan A5).
 */
import { Body, Column, Icon, IconButton, Input, Pill, Plate, Row, ScrollView, Segmented, TokenAvatar, metrics, paint } from '@boltvault/ui'
import { cacheKey, type CampaignView, type CollectionView, type CollectionWindow, type ExploreToken, type FarmView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { AddCollectionSheet } from '../components/AddCollectionSheet'
import { AddTokenSheet } from '../components/AddTokenSheet'
import { CampaignCard } from '../components/cards/CampaignCard'
import { CollectionCard } from '../components/cards/CollectionCard'
import { CollectionRankRow, type CollectionCurrency } from '../components/cards/CollectionRankRow'
import { FarmCard } from '../components/cards/FarmCard'
import { FreshnessLine } from '../components/FreshnessLine'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useCached } from '../hooks/useCached'
import { useNotifications } from '../hooks/useNotifications'
import { formatChange, formatFiat, formatPrice } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'
import { useScreenBusy } from '../state/useScreenBusy'

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
  const segment: Segment = initial
  const [query, setQuery] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [found, setFound] = useState<{ tokens: ExploreToken[]; collections: CollectionView[] } | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [addCollectionOpen, setAddCollectionOpen] = useState(false)
  const [window, setWindow] = useState<CollectionWindow>('DAY')
  const [ccy, setCcy] = useState<CollectionCurrency>('ETN')
  const accountId = active?.id

  // Only the visible segment fetches. This screen used to mount all four
  // lists on every open regardless of which one was showing, so opening
  // Explore > Tokens still issued TopCollections, Presales and YieldFarms and
  // their multicall batches — and again on every segment tap, because the
  // shell remounts the screen when the segment param changes.
  // `tokens` stays live on Collectibles too: it carries the ETN price.
  const tokens = useCached<ExploreToken[]>({
    key: segment === 'tokens' || segment === 'collectibles' ? cacheKey('explore', 'tokens', ETN) : null,
    cached: (e) => e.explore.cachedTokens({ chainId: ETN }),
    fresh: (e) => e.explore.tokens({ chainId: ETN }),
    maxAgeMs: 60_000,
  })
  const collections = useCached<CollectionView[]>({
    key: segment === 'collectibles' ? cacheKey('explore', 'collections', ETN, accountId ?? '-', window) : null,
    cached: (e) => e.explore.cachedCollections({ chainId: ETN, ...(accountId ? { accountId } : {}), window }),
    fresh: (e) => e.explore.collections({ chainId: ETN, ...(accountId ? { accountId } : {}), window }),
    maxAgeMs: 60_000,
  })
  const campaigns = useCached<CampaignView[]>({
    key: segment === 'launch' ? cacheKey('launchpad', 'list', ETN, accountId ?? '-') : null,
    cached: (e) => e.launchpad.cachedList({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
    fresh: (e) => e.launchpad.list({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
  })
  const farms = useCached<FarmView[]>({
    key: segment === 'farms' ? cacheKey('farm', 'list', ETN, accountId ?? '-') : null,
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

  // The shell draws one loader over the whole screen while this is true.
  useScreenBusy('explore', current.freshness === 'loading')
  const etnUsd = (tokens.value ?? []).find((x) => x.address === 'native' || x.symbol === 'ETN')?.price ?? null
  return (
    <Column flex={1}>
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="explore">
      <PageHeader
        title={segment === 'tokens' ? t({ id: 'explore.tokens', message: 'Tokens' }) : segment === 'collectibles' ? t({ id: 'explore.collections.title', message: 'Collections' }) : segment === 'launch' ? t({ id: 'explore.launchpad', message: 'Launchpad' }) : t({ id: 'explore.farms', message: 'Farms' })}
        right={
          <>
            {segment === 'collectibles' ? <IconButton icon="plus" label={t({ id: 'collection.add.pill', message: 'Add a collection' })} onPress={() => setAddCollectionOpen(true)} testID="explore-add-collection" /> : null}
            {segment === 'tokens' && host.browser ? <IconButton icon="external" label={t({ id: 'explore.browser', message: 'Browser' })} onPress={() => router.navigate('browser')} testID="explore-browser" /> : null}
            {segment === 'tokens' || segment === 'launch' ? <IconButton icon="bell" label={t({ id: 'explore.alerts', message: 'Alerts' })} badge={unread} onPress={() => router.navigate('alerts')} testID="explore-alerts" /> : null}
          </>
        }
      />
      {segment === 'tokens' ? <Input value={query} onChange={setQuery} placeholder={t({ id: 'explore.search', message: 'Search tokens and collections' })} autoFocus={search} testID="explore-search" /> : null}
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
          <FreshnessLine freshness={current.freshness} observedAt={current.observedAt} refreshing={current.refreshing} reducedMotion={reducedMotion} testID="explore-freshness" />
          {current.freshness === 'loading' ? (
            null
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
            <Column gap="$3" testID="explore-collections">
              <Row gap="$2" alignItems="center" justifyContent="space-between">
                <Column width={196}>
                  <Segmented
                    options={[
                      { id: 'DAY', label: '1D' },
                      { id: 'WEEK', label: '1W' },
                      { id: 'MONTH', label: '1M' },
                      { id: 'MAX', label: t({ id: 'collections.all', message: 'All' }) },
                    ]}
                    value={window}
                    onChange={(id) => setWindow(id as CollectionWindow)}
                    size="compact"
                    testID="collections-window"
                  />
                </Column>
                <Column width={104}>
                  <Segmented
                    options={[
                      { id: 'ETN', label: 'ETN' },
                      { id: 'USD', label: 'USD' },
                    ]}
                    value={ccy}
                    onChange={(id) => setCcy(id as CollectionCurrency)}
                    size="compact"
                    testID="collections-currency"
                  />
                </Column>
              </Row>
              <Row gap="$2" alignItems="center" justifyContent="space-between">
                {active ? <Pill label={t({ id: 'explore.rack', message: 'Your collection' })} icon={<Icon name="nft" size={14} color={paint.arc} />} size="sm" onPress={() => router.navigate('rack')} testID="explore-rack" /> : <Row />}
                <Body tone="mute" size="caption">
                  {t({ id: 'explore.collections.verifiedOnly', message: 'Verified collections' })}
                </Body>
              </Row>
              <Column testID="collections-list">
                {(collections.value ?? []).map((c, i, arr) => (
                  <CollectionRankRow key={c.address} rank={i + 1} collection={c} currency={ccy} etnUsd={etnUsd} onPress={() => router.navigate('collection', { chainId: ETN, address: c.address })} last={i === arr.length - 1} />
                ))}
              </Column>
              {(collections.value ?? []).length === 0 ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'explore.collections.empty', message: 'No collections to show.' })}
                </Body>
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
        <TokenAvatar chainId={token.chainId} address={token.address} symbol={token.symbol} logoUri={token.logoUri} size={28} />
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

