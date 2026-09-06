/**
 * Home (master plan §8.2; plan B3): the seat, a mini-portfolio console — the
 * total for the chosen chains, how many tokens, the live filament — one slot
 * for whatever needs attention, and the action grid: everything that is not
 * on the dock. Tapping the total opens the Portfolio. The Grid is drawn by
 * TabShell behind this screen; the holder tier warms it.
 */
import { ActionGrid, Body, ChainMark, Column, Icon, IconButton, Ignition, Key, LiveFilament, Pill, Plate, Pressable, Row, RollingReadout, Seat, ScrollView, Skeleton, metrics, paint, radius, type ActionTileBadge, type IconName } from '@boltvault/ui'
import { cacheKey, type BridgeStatus, type CampaignView, type ExploreToken, type Inventory } from '@boltvault/engine'
import { useEffect, useRef, useState } from 'react'
import { ChainScopeSheet, ScopePill, useHomeScope } from '../components/ChainScope'
import { DappSheet, DappStrip, useDappStatus } from '../components/DappStatus'
import { useEngine } from '../engine/EngineProvider'
import { formatChange, formatFiat, formatPrice } from '../format'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { useCached } from '../hooks/useCached'
import { useChainHead } from '../hooks/useChainHead'
import { useHolderTier } from '../hooks/useHolderTier'
import { useNotifications } from '../hooks/useNotifications'
import { useOpenInTab } from '../hooks/useOpenInTab'
import { usePortfolio } from '../hooks/usePortfolio'
import { usePositions } from '../hooks/usePositions'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { takeIgnition } from '../state/ignition'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014

export interface HomeProps {
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly reducedMotionOverride?: boolean
}

interface Tile {
  readonly id: string
  readonly icon: IconName
  readonly label: string
  readonly badge: ActionTileBadge | null
  readonly onPress: () => void
}

export function Home({ body, reducedMotionOverride }: HomeProps) {
  const router = useRouter()
  const engine = useEngine()
  const host = useHost()
  const reducedMotion = useReducedMotion(reducedMotionOverride)
  const { vault, active, loading } = useWalletState()
  const head = useChainHead(ETN)
  const tier = useHolderTier(active?.id ?? null)
  const scope = useHomeScope()
  const [scopeOpen, setScopeOpen] = useState(false)
  const portfolio = usePortfolio(active?.id ?? null, 5_000, scope.chainIds)
  const { entries } = useActivity(active?.id ?? null)
  const { positions } = usePositions(active?.id ?? null, !!vault?.unlocked)
  const { unread } = useNotifications()
  const openInTab = useOpenInTab()
  const [bridges, setBridges] = useState<BridgeStatus[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [unlimited, setUnlimited] = useState(0)
  const [copied, setCopied] = useState(false)
  const [dappOpen, setDappOpen] = useState(false)
  const accountId = active?.id ?? null
  const unlocked = !!vault?.unlocked
  // The unlock ceremony runs once per unlock, not on every mount of Home.
  const igniteRef = useRef<boolean | null>(null)
  if (igniteRef.current === null && !loading) igniteRef.current = takeIgnition(unlocked)
  const ignite = igniteRef.current ?? false
  const dapp = useDappStatus(unlocked && (host.body === 'extension-popup' || host.body === 'harness'))
  const market = useCached<ExploreToken[]>({
    key: unlocked ? cacheKey('explore', 'tokens', ETN) : null,
    cached: (e) => e.explore.cachedTokens({ chainId: ETN }),
    fresh: (e) => e.explore.tokens({ chainId: ETN }),
    maxAgeMs: 60_000,
  })
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  // The tab lays tiles out as rows and centres the column; the popup and the phone stack them (plan B3).
  const wide = body === 'extension-tab'

  // Badges from data one cached call away (plan B3): live campaigns refresh a minute at a time; offers are read, never fetched, from here.
  const campaigns = useCached<CampaignView[]>({
    key: accountId && unlocked ? cacheKey('launchpad', 'list', ETN, accountId) : null,
    cached: (e) => (accountId ? e.launchpad.cachedList({ chainId: ETN, accountId }) : Promise.resolve(null)),
    fresh: (e) => (accountId ? e.launchpad.list({ chainId: ETN, accountId }) : Promise.reject(new Error('no account'))),
    maxAgeMs: 60_000,
  })
  const inventory = useCached<Inventory>({
    key: accountId && unlocked ? cacheKey('nft', 'inventory', ETN, accountId) : null,
    cached: (e) => (accountId ? e.nft.cachedInventory({ accountId, chainId: ETN }) : Promise.resolve(null)),
  })

  // The home-screen widget reads what Home shows (§7.13); never more.
  useEffect(() => {
    if (!host.widget || !active || !portfolio.snapshot) return
    void host.widget.publish({ address: active.address, label: active.label, tier: tier?.tier ?? 0, total: portfolio.snapshot.total, change24h: portfolio.snapshot.change24h, currency: portfolio.snapshot.currency, at: Date.now() })
  }, [host, active, portfolio.snapshot, tier])

  useEffect(() => {
    engine.flags.get().then((f) => setNotice(f.flags.notice), () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'flags.changed') setNotice(e.flags.flags.notice)
    })
  }, [engine])
  useEffect(() => {
    if (!accountId || !unlocked) return
    let alive = true
    const load = (): void => {
      engine.bridge.list({ accountId }).then((xs) => alive && setBridges(xs), () => undefined)
    }
    load()
    engine.allowances.cached({ accountId, chainId: ETN }).then((c) => alive && setUnlimited(c.rows.filter((r) => r.amount === 'unlimited' || r.amount === 'all').length), () => undefined)
    const off = engine.events.subscribe((e) => {
      if (e.type === 'bridge.changed') load()
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, accountId, unlocked])

  const pendingTx = entries.filter((e) => e.status === 'pending').length
  const bridgeInFlight = bridges.find((b) => b.state === 'pending' || b.state === 'dispatched') ?? null
  const live = (campaigns.value ?? []).filter((c) => c.phase === 'live').length
  const offers = inventory.value?.withOffersCount ?? 0
  const toCollect = (positions?.farms ?? []).reduce((sum, f) => sum + BigInt(f.position?.pendingRewards ?? '0'), 0n)
  const dyno = Number(toCollect) / 1e18
  const total = portfolio.snapshot?.total ?? null
  const currency = portfolio.snapshot?.currency ?? 'USD'
  const totalText = total === null ? '—' : formatFiat(total, currency)
  const change = formatChange(portfolio.snapshot?.change24h ?? null)
  const tokenCount = portfolio.snapshot ? portfolio.snapshot.rows.filter((r) => !r.hidden).length : 0
  const unpriced = portfolio.snapshot?.unpricedCount ?? 0

  const tiles: readonly Tile[] = [
    { id: 'send', icon: 'send', label: t({ id: 'key.send', message: 'Send' }), badge: null, onPress: () => router.navigate('send') },
    { id: 'receive', icon: 'receive', label: t({ id: 'key.receive', message: 'Receive' }), badge: null, onPress: () => router.navigate('receive') },
    { id: 'bridge', icon: 'bridge', label: t({ id: 'key.bridge', message: 'Bridge' }), badge: bridgeInFlight ? { text: t({ id: 'home.badge.arriving', message: 'Arriving' }), tone: 'arc' } : null, onPress: () => router.navigate('bridge', scope.scope !== 'all' && scope.scope !== ETN ? { chainId: scope.scope } : undefined) },
    { id: 'tokens', icon: 'coins', label: t({ id: 'key.tokens', message: 'Tokens' }), badge: null, onPress: () => router.navigate('explore', { segment: 'tokens' }) },
    { id: 'collectibles', icon: 'nft', label: t({ id: 'key.collectibles', message: 'Collectibles' }), badge: offers > 0 ? { text: t({ id: 'home.badge.offers', message: '{n} offers', values: { n: offers } }), tone: 'ember' } : null, onPress: () => router.navigate('explore', { segment: 'collectibles' }) },
    { id: 'launchpad', icon: 'launch', label: t({ id: 'key.launchpad', message: 'Launchpad' }), badge: live > 0 ? { text: t({ id: 'home.badge.live', message: '{n} live', values: { n: live } }), tone: 'arc' } : null, onPress: () => router.navigate('explore', { segment: 'launch' }) },
    { id: 'farms', icon: 'farm', label: t({ id: 'key.farms', message: 'Farms' }), badge: toCollect > 0n ? { text: t({ id: 'home.badge.collect', message: '{d} DYNO', values: { d: dyno >= 10 ? dyno.toFixed(0) : dyno.toFixed(1) } }), tone: 'surge' } : null, onPress: () => router.navigate('explore', { segment: 'farms' }) },
    { id: 'search', icon: 'search', label: t({ id: 'key.search', message: 'Search' }), badge: null, onPress: () => router.navigate('explore', { search: true }) },
    { id: 'alerts', icon: 'bell', label: t({ id: 'key.alerts', message: 'Alerts' }), badge: unread > 0 ? { text: String(unread), tone: 'ember' } : null, onPress: () => router.navigate('alerts') },
  ]
  const etn = (market.value ?? []).find((x) => x.address === 'native' || x.symbol === 'ETN') ?? null
  const etnChange = etn && etn.change24h !== null ? formatChange(etn.change24h / 100) : null
  const copy = host.copy && active ? () => void host.copy?.(active.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => undefined) : undefined

  // One slot (plan B3): the backup gate, else a signed notice, else the accessory that matters most.
  let slot: React.ReactNode = null
  if (vault?.unlocked && !vault.backupComplete && vault.seeds.length > 0) {
    slot = (
      <Plate role="raised" paddingVertical={6} paddingHorizontal={12} minHeight={44} justifyContent="center" testID="backup-gate">
        <Row gap="$2" alignItems="center">
          <Icon name="shield" size={16} color={paint.ember} />
          <Column flex={1} minWidth={0} alignItems="flex-start">
            <Body size="caption" fontWeight="600" numberOfLines={1}>
              {t({ id: 'home.backup.title', message: 'Back up your recovery phrase' })}
            </Body>
            <Body tone="mute" size="caption" fontSize={11} lineHeight={13} numberOfLines={1}>
              {t({ id: 'home.backup.body', message: 'Swapping and signing stay locked until you do.' })}
            </Body>
          </Column>
          <Pill label={t({ id: 'home.backup.key', message: 'Back up' })} tone="ember" size="sm" onPress={() => router.navigate('backup')} testID="backup-key" />
        </Row>
      </Plate>
    )
  } else if (notice) {
    slot = (
      <Plate gap={2} testID="home-notice">
        <Row gap="$2" alignItems="center">
          <Icon name="warn" size={16} color={paint.ember} />
          <Body size="caption" flexShrink={1}>
            {notice}
          </Body>
        </Row>
      </Plate>
    )
  } else if (bridgeInFlight) {
    slot = <Accessory icon="bridge" tone={paint.arc} text={t({ id: 'home.acc.bridge', message: '{s} arriving on {c} in about {m} min', values: { s: bridgeInFlight.symbol, c: scope.chains.find((c) => c.chainId === bridgeInFlight.toChainId)?.name ?? `chain ${bridgeInFlight.toChainId}`, m: bridgeInFlight.toChainId === 1 || bridgeInFlight.fromChainId === 1 ? 20 : 5 } })} onPress={() => router.navigate('bridge')} testID="accessory-bridge" />
  } else if (pendingTx > 0) {
    slot = <Accessory icon="clock" tone={paint.arc} text={t({ id: 'home.acc.pending', message: '{n} transaction pending', values: { n: pendingTx } })} onPress={() => router.setTab('activity')} testID="accessory-pending" />
  } else if (positions?.accessory) {
    const a = positions.accessory
    slot = <Accessory icon={a.kind === 'dividends' ? 'star' : a.kind === 'collect' ? 'farm' : 'bolt'} tone={paint.ember} text={a.text} onPress={() => (a.target === 'legends' ? router.navigate('legends') : a.target.startsWith('farm:') ? router.navigate('farm', { chainId: ETN, farmId: Number(a.target.slice(5)) }) : router.navigate('campaign', { chainId: ETN, pool: a.target.slice(9) }))} testID="accessory-positions" />
  } else if (unlimited > 0) {
    slot = <Accessory icon="approvals" tone={paint.burn} text={t({ id: 'home.acc.unlimited', message: '{n} unlimited approvals', values: { n: unlimited } })} onPress={() => router.navigate('allowances')} testID="accessory-approvals" />
  }

  return (
    <Column flex={1} testID="home">
      <ScrollView contentContainerStyle={{ paddingHorizontal: inset, paddingTop: 12, paddingBottom: 12, gap: 10, ...(wide ? { maxWidth: 680, width: '100%', alignSelf: 'center' } : {}) }}>
        <Ignition active={ignite} reducedMotion={reducedMotion} order={0}>
          <Row justifyContent="space-between" alignItems="center" minHeight={metrics.header} gap="$2">
            {active ? (
              <Seat address={active.address} label={active.label} tierMark={tier && tier.tier > 0 ? t({ id: 'home.tier', message: 'Tier {t}', values: { t: tier.tier } }) : null} onPress={() => router.navigate('accounts')} onCopy={copy} copied={copied} testID="seat" />
            ) : (
              <Body size="title">BoltVault</Body>
            )}
            <Row gap="$1" flexShrink={0}>
              {openInTab ? <IconButton icon="expand" label={t({ id: 'header.expand', message: 'Open in a full tab' })} onPress={() => openInTab()} testID="open-tab" /> : null}
              <IconButton icon="settings" label={t({ id: 'home.settings', message: 'Settings' })} onPress={() => router.navigate('settings')} testID="settings-key" />
            </Row>
          </Row>
        </Ignition>

        {/*
          While the vault's status is still unknown, Home used to render its
          header and nothing else — a blank body for as long as the service
          worker took to answer, then everything at once. The style bible has
          always required the opposite: "a first visit shows a skeleton with
          the current sweeping through it, never a blank body." These are the
          shapes of the console, the action grid and the strip, so nothing
          moves when the real thing replaces them.
        */}
        {loading ? (
          <Column gap={10} testID="home-loading">
            <Skeleton height={96} radius={radius.console} />
            <Skeleton height={216} radius={radius.recessed} />
            <Skeleton height={44} radius={radius.recessed} />
          </Column>
        ) : null}

        {!loading && !vault?.exists ? (
          <Ignition active={ignite} reducedMotion={reducedMotion} order={1}>
            <Plate role="raised" gap="$3" testID="create-plate">
              <Body size="title">{t({ id: 'home.create.title', message: 'Your vault is not created yet' })}</Body>
              <Body tone="mute">
                {t({ id: 'home.create.body', message: 'Create a new recovery phrase or import one you already have. Electroneum is your home chain.' })}
              </Body>
              <Key label={t({ id: 'home.create.key', message: 'Create vault' })} onPress={() => router.navigate('onboarding')} testID="create-vault" />
            </Plate>
          </Ignition>
        ) : null}

        {vault?.exists && !vault.unlocked ? (
          <Ignition active={ignite} reducedMotion={reducedMotion} order={1}>
            <Plate role="raised" gap="$3" testID="locked-plate">
              <Row gap="$2">
                <Icon name="lock" color={paint.mute} size={18} />
                <Body size="title">{t({ id: 'home.locked.title', message: 'Locked' })}</Body>
              </Row>
              <Body tone="mute">{t({ id: 'home.locked.body', message: 'Unlock to see balances and sign.' })}</Body>
              <Key label={t({ id: 'home.locked.key', message: 'Unlock' })} onPress={() => router.navigate('unlock')} testID="unlock" />
            </Plate>
          </Ignition>
        ) : null}

        {unlocked ? (
          <>
            {/* The balance console: the scope, the total with its day, the live filament. */}
            <Ignition active={ignite} reducedMotion={reducedMotion} order={1}>
              <Plate role="console" gap={6} padding={12} testID="home-console">
                <Row justifyContent="space-between" alignItems="center">
                  <ScopePill scope={scope.scope} label={scope.label} onPress={() => setScopeOpen(true)} testID="home-scope" />
                  {portfolio.snapshot ? (
                    <Body tone="mute" size="caption" testID="home-token-count">
                      {tokenCount === 1 ? t({ id: 'home.tokens.one', message: '1 token' }) : t({ id: 'home.tokens.many', message: '{n} tokens', values: { n: tokenCount } })}
                      {unpriced > 0 ? ` · ${t({ id: 'home.unpriced', message: '{n} without price', values: { n: unpriced } })}` : ''}
                    </Body>
                  ) : null}
                </Row>
                <Pressable onPress={() => router.navigate('portfolio')} accessibilityRole="button" accessibilityLabel={t({ id: 'home.portfolio.a11y', message: 'Open your portfolio' })} testID="home-portfolio" style={{ minHeight: 44, justifyContent: 'center' }}>
                  <Row alignItems="flex-end" gap="$2">
                    <RollingReadout value={totalText} hero reducedMotion={reducedMotion} testID="total" />
                    <Column flex={1} minWidth={0} paddingBottom={8} alignItems="flex-start">
                      {change ? (
                        <Body tone={change.startsWith('+') ? 'surge' : change.startsWith('−') ? 'burn' : 'mute'} size="caption" fontWeight="600" numberOfLines={1}>
                          {change} {t({ id: 'home.today', message: 'today' })}
                        </Body>
                      ) : (
                        <Body tone="mute" size="caption" numberOfLines={1}>
                          {portfolio.snapshot ? '' : t({ id: 'home.scope.none', message: 'No balances yet' })}
                        </Body>
                      )}
                    </Column>
                    <Column paddingBottom={10}>
                      <Icon name="chevronRight" size={20} color={paint.mute} />
                    </Column>
                  </Row>
                </Pressable>
                <LiveFilament tick={head?.blockNumber ?? null} live={head?.live ?? false} reducedMotion={reducedMotion} testID="filament" />
              </Plate>
            </Ignition>

            {slot ? (
              <Ignition active={ignite} reducedMotion={reducedMotion} order={2}>
                {slot}
              </Ignition>
            ) : null}

            <Ignition active={ignite} reducedMotion={reducedMotion} order={3}>
              <ActionGrid items={tiles} layout={wide ? 'row' : 'stacked'} testID="keys" />
            </Ignition>

            {/* The status strip: the site under the popup, and ETN's price. */}
            <Ignition active={ignite} reducedMotion={reducedMotion} order={4}>
              <Plate role="card" padding={0} overflow="hidden" testID="home-strip">
                <Row minHeight={44} alignItems="stretch">
                  {dapp !== null || host.body === 'extension-popup' || host.body === 'harness' ? (
                    <>
                      <DappStrip state={dapp} onPress={() => setDappOpen(true)} />
                      <Column width={1} backgroundColor="$edge" marginVertical={8} />
                    </>
                  ) : null}
                  <Pressable onPress={() => router.navigate('explore', { segment: 'tokens' })} accessibilityRole="button" accessibilityLabel={t({ id: 'home.price.a11y', message: 'ETN price' })} testID="home-price" style={{ flexShrink: 0, justifyContent: 'center', paddingHorizontal: 12 }}>
                    <Row gap={6} alignItems="center" justifyContent="flex-end">
                      <ChainMark chainId={ETN} size={14} />
                      <Body size="caption" fontWeight="600" numberOfLines={1}>
                        {etn ? formatPrice(etn.price, 'USD') : '—'}
                      </Body>
                      {etnChange ? (
                        <Body size="caption" tone={etnChange.startsWith('+') ? 'surge' : etnChange.startsWith('−') ? 'burn' : 'mute'}>
                          {etnChange}
                        </Body>
                      ) : null}
                    </Row>
                  </Pressable>
                </Row>
              </Plate>
            </Ignition>
          </>
        ) : null}
      </ScrollView>
      <ChainScopeSheet
        open={scopeOpen}
        onClose={() => setScopeOpen(false)}
        scope={scope.scope}
        enabled={scope.enabled}
        chains={scope.chains}
        accountId={accountId}
        total={total === null ? null : totalText}
        onSelect={(s) => {
          scope.setScope(s)
          setScopeOpen(false)
        }}
        onManage={() => {
          setScopeOpen(false)
          router.navigate('networks')
        }}
        reducedMotion={reducedMotion}
      />
      <DappSheet open={dappOpen} onClose={() => setDappOpen(false)} state={dapp} reducedMotion={reducedMotion} />
    </Column>
  )
}

function Accessory({ icon, tone, text, onPress, testID }: { icon: IconName; tone: string; text: string; onPress: () => void; testID: string }) {
  return (
    <Plate role="card" gap={2} paddingVertical={8} onPress={onPress} cursor="pointer" minHeight={44} justifyContent="center" testID={testID}>
      <Row gap="$2" alignItems="center">
        <Icon name={icon} size={16} color={tone} />
        <Body size="caption" flexShrink={1} numberOfLines={1}>
          {text}
        </Body>
      </Row>
    </Plate>
  )
}
