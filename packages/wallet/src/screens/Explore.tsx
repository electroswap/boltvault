/**
 * Explore (master plan §8.11): the ElectroSwap market inside the wallet —
 * Tokens · Collectibles · Launch · Farms and one search across all of it.
 * The popup is a list; tab and mobile get the same list with room. Every
 * row opens its dossier or page; every page has its verb.
 */
import { Body, Chip, Column, Icon, Input, Plate, Pressable, Row, ScrollView, Segmented, TokenAvatar, Artwork, metrics, paint } from '@boltvault/ui'
import type { CampaignView, CollectionView, ExploreToken, FarmView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { formatChange, formatFiat, formatPct, formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014
type Segment = 'tokens' | 'collectibles' | 'launch' | 'farms'
type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Explore({ body, segment: initial = 'tokens' }: { body: BodyKind; segment?: Segment }) {
  const engine = useEngine()
  const router = useRouter()
  const host = useHost()
  const { active } = useWalletState()
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [segment, setSegment] = useState<Segment>(initial)
  const [query, setQuery] = useState('')
  const [available, setAvailable] = useState<boolean | null>(null)
  const [tokens, setTokens] = useState<ExploreToken[]>([])
  const [collections, setCollections] = useState<CollectionView[]>([])
  const [campaigns, setCampaigns] = useState<CampaignView[]>([])
  const [farms, setFarms] = useState<FarmView[]>([])
  const [found, setFound] = useState<{ tokens: ExploreToken[]; collections: CollectionView[] } | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    let alive = true
    const load = (): void => {
      setLoading(true)
      const accountId = active?.id
      void Promise.all([
        engine.explore.available(),
        engine.explore.tokens({ chainId: ETN }),
        engine.explore.collections({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
        engine.launchpad.list({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
        engine.farm.list({ chainId: ETN, ...(accountId ? { accountId } : {}) }),
      ]).then(
        ([ok, tk, co, ca, fa]) => {
          if (!alive) return
          setAvailable(ok)
          setTokens(tk)
          setCollections(co)
          setCampaigns(ca)
          setFarms(fa)
          setLoading(false)
        },
        () => alive && setLoading(false),
      )
    }
    load()
    const timer = setInterval(load, 60_000)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [engine, active?.id])

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

  const star = async (kind: 'token' | 'collection' | 'campaign', address: string, label: string, starred: boolean): Promise<void> => {
    if (starred) await engine.watchlist.unstar({ kind, chainId: ETN, address })
    else await engine.watchlist.star({ kind, chainId: ETN, address, label })
    if (kind === 'token') setTokens((xs) => xs.map((x) => (x.address === address ? { ...x, starred: !starred } : x)))
    if (kind === 'collection') setCollections((xs) => xs.map((x) => (x.address === address ? { ...x, starred: !starred } : x)))
    if (kind === 'campaign') setCampaigns((xs) => xs.map((x) => (x.pool === address ? { ...x, starred: !starred } : x)))
  }

  const live = campaigns.filter((c) => c.phase === 'live')
  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="explore">
      <Row justifyContent="space-between" alignItems="center">
        <Body size="title">{t({ id: 'explore.title', message: 'Explore Electroneum' })}</Body>
        {host.browser ? (
          <Pressable onPress={() => router.navigate('browser')} accessibilityRole="button" accessibilityLabel="Browser" testID="explore-browser" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="external" color={paint.mute} />
          </Pressable>
        ) : null}
        <Pressable onPress={() => router.navigate('alerts')} accessibilityRole="button" accessibilityLabel="Alerts" testID="explore-alerts" style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="bell" color={paint.mute} />
        </Pressable>
      </Row>
      <Input value={query} onChange={setQuery} placeholder={t({ id: 'explore.search', message: 'Search tokens, collections, campaigns' })} testID="explore-search" />
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
            <TokenRow key={x.address} token={x} onPress={() => router.navigate('token', { chainId: ETN, address: x.address })} onStar={() => void star('token', x.address, x.symbol, x.starred)} />
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
            testID="explore-segments"
          />
          {segment === 'tokens' ? (
            <Column gap="$1" testID="explore-token-list">
              {tokens.map((x) => (
                <TokenRow key={x.address} token={x} onPress={() => router.navigate('token', { chainId: ETN, address: x.address })} onStar={() => void star('token', x.address, x.symbol, x.starred)} />
              ))}
              {tokens.length === 0 && !loading ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'explore.tokens.empty', message: 'No market data yet.' })}
                </Body>
              ) : null}
            </Column>
          ) : segment === 'collectibles' ? (
            <Column gap="$2" testID="explore-collections">
              {collections.map((c) => (
                <CollectionCard key={c.address} collection={c} onPress={() => router.navigate('collection', { chainId: ETN, address: c.address })} onStar={() => void star('collection', c.address, c.name, c.starred)} />
              ))}
              {active ? <Chip onPress={() => router.navigate('rack')} cursor="pointer" minHeight={44} justifyContent="center" alignSelf="flex-start" testID="explore-rack"><Body tone="arc" size="caption">{t({ id: 'explore.rack', message: 'Your collection →' })}</Body></Chip> : null}
            </Column>
          ) : segment === 'launch' ? (
            <Sky campaigns={campaigns} onOpen={(pool) => router.navigate('campaign', { chainId: ETN, pool })} onStar={(c) => void star('campaign', c.pool, c.token.symbol, c.starred)} />
          ) : (
            <Column gap="$2" testID="explore-farms">
              {farms.map((f) => (
                <FarmCard key={f.id} farm={f} onPress={() => router.navigate('farm', { chainId: ETN, farmId: f.id })} />
              ))}
              {farms.length === 0 && !loading ? (
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
  return (
    <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={on ? 'Unstar' : 'Star'} hitSlop={8} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }} testID={testID}>
      <Icon name="star" size={18} color={on ? paint.ember : paint.mute} />
    </Pressable>
  )
}

export function TokenRow({ token, onPress, onStar }: { token: ExploreToken; onPress: () => void; onStar: () => void }) {
  const change = formatChange(token.change24h === null ? null : token.change24h / 100)
  return (
    <Row gap="$3" alignItems="center" minHeight={52} testID={`explore-token-${token.symbol}`}>
      <Row flex={1} gap="$3" alignItems="center" onPress={onPress} cursor="pointer" minHeight={44}>
        <TokenAvatar chainId={token.chainId} address={token.address === 'native' ? '0x0000000000000000000000000000000000000000' : token.address} logoUri={token.logoUri} size={28} />
        <Column flex={1}>
          <Row gap="$2" alignItems="center">
            <Body>{token.symbol}</Body>
            {token.safety === 'BLOCKED' || token.safety === 'STRONG_WARNING' ? <Icon name="warn" size={14} color={paint.burn} /> : null}
          </Row>
          <Body tone="mute" size="caption" numberOfLines={1}>
            {token.volume24h !== null ? t({ id: 'explore.vol', message: 'Vol {v}', values: { v: formatFiat(token.volume24h, 'USD') } }) : token.name}
          </Body>
        </Column>
        <Column alignItems="flex-end">
          <Body>{token.price !== null ? formatFiat(token.price, 'USD') : '—'}</Body>
          {change ? (
            <Body tone={change.startsWith('+') ? 'ember' : change.startsWith('−') ? 'burn' : 'mute'} size="caption">
              {change}
            </Body>
          ) : null}
        </Column>
      </Row>
      <Star on={token.starred} onPress={onStar} testID={`star-token-${token.symbol}`} />
    </Row>
  )
}

export function CollectionCard({ collection, onPress, onStar }: { collection: CollectionView; onPress: () => void; onStar: () => void }) {
  return (
    <Plate role="raised" gap="$2" onPress={onPress} cursor="pointer" testID={`explore-collection-${collection.address}`}>
      <Row gap="$3" alignItems="center">
        <Artwork uri={collection.imageUrl} label={collection.name} size={44} />
        <Column flex={1}>
          <Row gap="$2" alignItems="center">
            <Body numberOfLines={1}>{collection.name}</Body>
            {collection.verified ? <Icon name="check" size={14} color={paint.arc} /> : null}
            {collection.paysDividends ? (
              <Chip paddingVertical={2}>
                <Body tone="ember" size="caption">
                  {t({ id: 'explore.dividends', message: 'Pays dividends' })}
                </Body>
              </Chip>
            ) : null}
          </Row>
          <Body tone="mute" size="caption" numberOfLines={1}>
            {[collection.floorEtn !== null ? t({ id: 'explore.floor', message: 'Floor {f} ETN', values: { f: formatRaw(String(Math.round(collection.floorEtn * 1e6)), 6) } }) : null, collection.volume24hEtn !== null ? t({ id: 'explore.vol24', message: '{v} ETN today', values: { v: Math.round(collection.volume24hEtn) } }) : null, collection.percentListed !== null ? t({ id: 'explore.listed', message: '{p}% listed', values: { p: Math.round(collection.percentListed) } }) : null, collection.owned > 0 ? t({ id: 'explore.owned', message: 'you own {n}', values: { n: collection.owned } }) : null].filter(Boolean).join(' · ')}
          </Body>
        </Column>
        <Star on={collection.starred} onPress={onStar} testID={`star-collection-${collection.address}`} />
      </Row>
    </Plate>
  )
}

/** The Sky (§8.9): live campaigns as storm cells, then upcoming, then ended. */
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
      {campaigns.map((c) => {
        const glow = c.phase === 'live' ? 0.12 + 0.35 * c.fill : 0.05
        return (
          <Plate key={c.pool} role="raised" gap="$2" onPress={() => onOpen(c.pool)} cursor="pointer" backgroundColor={`rgba(95,216,255,${glow.toFixed(3)})`} testID={`sky-${c.pool}`}>
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
              <Star on={c.starred} onPress={() => onStar(c)} testID={`star-campaign-${c.pool}`} />
            </Row>
            <Row gap="$2" alignItems="center">
              <Column flex={1} height={6} borderRadius={3} backgroundColor="rgba(95,216,255,0.14)" overflow="hidden">
                <Column width={`${Math.round(c.fill * 100)}%`} height={6} backgroundColor={paint.arc} />
              </Column>
              <Body tone="mute" size="caption">
                {t({ id: 'sky.raised', message: '{r} / {t} ETN', values: { r: formatRaw(c.raisedWei, 18), t: formatRaw(c.minEtnToLaunchWei, 18) } })}
              </Body>
            </Row>
          </Plate>
        )
      })}
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
    <Plate role="raised" gap="$1" onPress={onPress} cursor="pointer" testID={`farm-card-${farm.id}`}>
      <Row justifyContent="space-between" alignItems="center">
        <Row gap="$2" alignItems="center">
          <Icon name="farm" size={18} color={p ? paint.arc : paint.mute} />
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
        {[farm.baseApy !== null ? t({ id: 'farm.apy', message: 'APY {a}%', values: { a: farm.baseApy.toFixed(1) } }) : null, farm.thirdPartyApy !== null && farm.thirdParty ? t({ id: 'farm.apy3', message: '+{a}% {s}', values: { a: farm.thirdPartyApy.toFixed(1), s: farm.thirdParty.symbol } }) : null, farm.tvlUsd !== null ? t({ id: 'farm.tvl', message: 'TVL {v}', values: { v: formatFiat(farm.tvlUsd, 'USD') } }) : null, p ? t({ id: 'farm.pending', message: '{d} DYNO to collect', values: { d: formatRaw(p.pendingRewards, 18) } }) : null].filter(Boolean).join(' · ') || formatPct(0)}
      </Body>
    </Plate>
  )
}
