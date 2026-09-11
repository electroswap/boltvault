/**
 * Home (master plan §8.2; plan B3): the seat, a mini-portfolio console — the
 * total for the chosen chains, how many tokens, the live filament — the rotor
 * of whatever needs attention, and the action grid: everything that is not
 * on the dock. Tapping the total opens the Portfolio. The Grid is drawn by
 * TabShell behind this screen; the holder tier warms it.
 */
import { ActionGrid, Body, BoltMark, ChainMark, Column, EsWordmark, Icon, IconButton, Ignition, Key, LiveFilament, Pill, Plate, Pressable, Rotor, Row, RollingReadout, Seat, ScrollView, metrics, paint, type ActionTileBadge, type IconName, type RotorItem } from '@boltvault/ui'
import { cacheKey, type BridgeStatus, type CampaignView, type Inventory, type TokenDetailView } from '@boltvault/engine'
import { useEffect, useRef, useState } from 'react'
import { ChainScopeSheet, ScopePill, useHomeScope } from '../components/ChainScope'
import { DappSheet, DappStrip, useDappStatus } from '../components/DappStatus'
import { useEngine } from '../engine/EngineProvider'
import { FeeScheduleSheet } from './FeeScheduleSheet'
import { formatBolt, formatChange, formatFiat, formatPct, formatPrice, formatRaw } from '../format'
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
import { useScreenBusy } from '../state/useScreenBusy'

const ETN = 52014

/** How much of a tall screen's slack each interval above the grid may take. */
const SPREAD = 20

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
  const portfolio = usePortfolio(active?.id ?? null, 5_000, scope.loaded ? scope.chainIds : null)
  const { entries } = useActivity(active?.id ?? null)
  const { positions } = usePositions(active?.id ?? null, !!vault?.unlocked)
  const { unread } = useNotifications()
  const openInTab = useOpenInTab()
  const [bridges, setBridges] = useState<BridgeStatus[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const [unlimited, setUnlimited] = useState(0)
  const [copied, setCopied] = useState(false)
  const [dappOpen, setDappOpen] = useState(false)
  const [feeOpen, setFeeOpen] = useState(false)
  const accountId = active?.id ?? null
  const unlocked = !!vault?.unlocked
  // The unlock ceremony runs once per unlock, not on every mount of Home.
  const igniteRef = useRef<boolean | null>(null)
  if (igniteRef.current === null && !loading) igniteRef.current = takeIgnition(unlocked)
  const ignite = igniteRef.current ?? false
  const dapp = useDappStatus(unlocked && (host.body === 'extension-popup' || host.body === 'harness'))
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  /** No vault yet: Home is a title screen, not a list with one card on it. */
  const firstRun = !loading && !vault?.exists
  /*
    A phone has room; the popup does not. Ten pixels between plates is right in
    a 400x600 window and reads as cramped on a 6.7-inch screen, which is half of
    what "top heavy" was.
  */
  const gap = body === 'mobile' ? 14 : 10
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

  // The shell draws one loader over the whole screen while this is true.
  useScreenBusy('home', loading)

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
    /*
      Swap and Activity are dock tabs on a phone and tiles here.

      The full tab has no dock (see TabShell), so without this they would have
      no door at all — and a tile is the better shape for them anyway: at this
      size "Swap" beside Send and Receive reads as one of the things you came
      to do, rather than a third of a strip of icons along the bottom edge.
    */
    ...(wide
      ? ([
          { id: 'swap', icon: 'swap', label: t({ id: 'tab.swap', message: 'Swap' }), badge: null, onPress: () => router.setTab('swap') },
          { id: 'activity', icon: 'activity', label: t({ id: 'tab.activity', message: 'Activity' }), badge: pendingTx > 0 ? { text: t({ id: 'home.badge.pending', message: '{n} pending', values: { n: pendingTx } }), tone: 'arc' } : null, onPress: () => router.setTab('activity') },
        ] as Tile[])
      : []),
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
  /*
    ETN's own price does not come from the market list.

    `topTokens` is the traded-token table, and on mainnet it returns nine rows —
    BOLT, PDY, DYNO, FUGAZI, CLUB, CORE, USDC, USDT, DCNT — with neither ETN nor
    WETN among them. Scanning it for the coin therefore always found nothing and
    printed a dash beside a portfolio that plainly had prices. The extension
    looked right only because its fixtures carry a literal ETN row; the phone,
    on live data, showed the truth.

    The API answers for the coin under the NATIVE sentinel
    (`token(address: "NATIVE")` → ETN, 0.0011571 at the time of writing), which
    is exactly what `explore.tokenDetail` asks for when given 'native'.
  */
  const etnDetail = useCached<TokenDetailView | null>({
    // `tokendetail`, not `detail`: the key has to be the one the engine writes
    // (`DETAIL_SPEC`), or the `cache.changed` event for this resource names a
    // key nothing here is listening for and the tile never picks the new price
    // up — it sits on whatever the last `fresh()` returned.
    key: unlocked ? cacheKey('explore', 'tokendetail', ETN, 'native') : null,
    cached: (e) => e.explore.cachedTokenDetail({ chainId: ETN, address: 'native' }),
    fresh: (e) => e.explore.tokenDetail({ chainId: ETN, address: 'native' }),
    maxAgeMs: 60_000,
  })
  const etn = etnDetail.value ?? null
  const etnChange = etn && etn.change24h !== null ? formatChange(etn.change24h / 100) : null
  const copy = host.copy && active ? () => void host.copy?.(active.address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500) }, () => undefined) : undefined

  /*
    The strip under the console (plan B3).

    It used to be one slot and a cascade — the backup gate, else a notice, else
    the single most urgent thing — so anything below the winner was invisible
    until the winner was dealt with, and the holder tier, which is always true,
    had nowhere to go and rode beside the address instead.

    The gate is still exclusive, because it is a gate: while it stands, swapping
    and signing are off and there is nothing else worth reading. Everything else
    turns in the `Rotor`, with the tier as its constant last entry — the one
    that is an invitation rather than a chore, and the one that pays for itself
    if it is ever acted on.
  */
  let gate: React.ReactNode = null
  if (vault?.unlocked && !vault.backupComplete && vault.seeds.length > 0) {
    gate = (
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
  }

  const rotor: RotorItem[] = []
  if (notice) rotor.push({ id: 'notice', icon: 'warn', tone: paint.ember, text: notice, testID: 'home-notice' })
  if (bridgeInFlight) rotor.push({ id: 'bridge', icon: 'bridge', tone: paint.arc, text: t({ id: 'home.acc.bridge', message: '{s} arriving on {c} in about {m} min', values: { s: bridgeInFlight.symbol, c: scope.chains.find((c) => c.chainId === bridgeInFlight.toChainId)?.name ?? `chain ${bridgeInFlight.toChainId}`, m: bridgeInFlight.toChainId === 1 || bridgeInFlight.fromChainId === 1 ? 20 : 5 } }), onPress: () => router.navigate('bridge'), testID: 'accessory-bridge' })
  if (pendingTx > 0) rotor.push({ id: 'pending', icon: 'clock', tone: paint.arc, text: t({ id: 'home.acc.pending', message: '{n} transaction pending', values: { n: pendingTx } }), onPress: () => router.setTab('activity'), testID: 'accessory-pending' })
  /*
    The second line, built here rather than in the engine.

    `text` says what is waiting; `sub` says where it came from, which is the
    part that makes it worth opening. Both could be built beside each other in
    `PositionsService`, and the engine's are the strings that are not
    translated — so the new one is built where `t()` is, off the same snapshot
    the entry came from.
  */
  const earning = (positions?.farms ?? []).filter((f) => BigInt(f.position?.pendingRewards ?? '0') > 0n)
  const bestApy = earning.reduce<number | null>((best, f) => (f.baseApy !== null && (best === null || f.baseApy > best) ? f.baseApy : best), null)
  const legends = positions?.legends ?? null
  const subFor = (kind: string): string | null => {
    if (kind === 'dividends' && legends) {
      const paid = BigInt(legends.lifetimePaidWei)
      const pieces = legends.activeTokenCount === 1 ? t({ id: 'home.acc.div.one', message: '1 Legends piece' }) : t({ id: 'home.acc.div.many', message: '{n} Legends pieces', values: { n: legends.activeTokenCount } })
      // Only once there is a lifetime to speak of: "0 ETN paid so far" is a discouragement, not a fact worth the line.
      return paid > 0n ? t({ id: 'home.acc.div.sub', message: '{pieces} · {p} ETN paid so far', values: { pieces, p: formatRaw(legends.lifetimePaidWei, 18) } }) : pieces
    }
    if (kind === 'collect' && earning.length > 0) {
      const where = earning.length === 1 ? (earning[0]?.name ?? '') : t({ id: 'home.acc.collect.many', message: 'across {n} farms', values: { n: earning.length } })
      return bestApy !== null ? t({ id: 'home.acc.collect.sub', message: '{where} · {a}% APY, still earning', values: { where, a: bestApy.toFixed(1) } }) : where
    }
    return null
  }
  for (const a of positions?.accessories ?? []) {
    rotor.push({
      id: `pos:${a.kind}:${a.target}`,
      icon: a.kind === 'dividends' ? 'star' : a.kind === 'collect' ? 'farm' : 'bolt',
      tone: paint.ember,
      text: a.text,
      sub: subFor(a.kind),
      onPress: () => (a.target === 'legends' ? router.navigate('legends') : a.target.startsWith('farm:') ? router.navigate('farm', { chainId: ETN, farmId: Number(a.target.slice(5)) }) : router.navigate('campaign', { chainId: ETN, pool: a.target.slice(9) })),
      testID: `accessory-${a.kind}`,
    })
  }
  if (unlimited > 0) rotor.push({ id: 'approvals', icon: 'approvals', tone: paint.burn, text: t({ id: 'home.acc.unlimited', message: '{n} unlimited approvals', values: { n: unlimited } }), onPress: () => router.navigate('allowances'), testID: 'accessory-approvals' })
  if (tier) {
    rotor.push({
      id: 'tier',
      icon: 'bolt',
      tone: paint.ember,
      text: t({ id: 'home.acc.tier', message: '{name} tier · {p} wallet fee', values: { name: tier.name, p: formatPct(tier.bips) } }),
      // The nudge is the point: a rung you can name, and what it costs to reach it.
      sub:
        tier.nextTierAt && tier.nextTierName && tier.nextTierBips !== null
          ? t({ id: 'home.acc.tier.next', message: '{n} more BOLT-eq for {next} at {p}', values: { n: formatBolt((BigInt(tier.nextTierAt) - BigInt(tier.score)).toString()), next: tier.nextTierName, p: formatPct(tier.nextTierBips) } })
          : t({ id: 'home.acc.tier.top', message: 'Top tier — the lowest fee there is.' }),
      onPress: () => setFeeOpen(true),
      testID: 'accessory-tier',
    })
  }

  return (
    <Column flex={1} testID="home">
      {/*
        `flexGrow: 1` always, so the column can use the room a phone has.

        Home was laid out as a list that happened to start at the top: on a
        tall screen everything bunched into the first two thirds and the last
        third was bare circuit, with the ETN price stranded in the middle of it.
        Owner: "the home feels a bit top heavy with space available toward the
        bottom ... move the ETN price above the dock." With a growing container
        the strip can be pushed to the foot by one flexible spacer, and the
        sections above it can breathe. On a short body (the 600 px popup) the
        content is taller than the box, `flexGrow` does nothing, and nothing
        moves.
      */}
      <ScrollView contentContainerStyle={{ paddingHorizontal: inset, paddingTop: 12, paddingBottom: 12, gap, flexGrow: 1 }}>
        <Ignition active={ignite} reducedMotion={reducedMotion} order={0}>
          <Row justifyContent="space-between" alignItems="center" minHeight={metrics.header} gap="$2">
            {active ? (
              <Seat address={active.address} label={active.label} onPress={() => router.navigate('accounts')} onCopy={copy} copied={copied} testID="seat" />
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
          null
        ) : null}

        {/*
          A first run is not Home with one card on it.

          It was: the header, a plate at the top, and two thirds of a phone
          screen of empty circuit under it — the first thing anyone sees of
          this product, and it read as a page that had failed to load. Owner:
          "the page that's on looks super boring for the first page they land
          on in a new app. Logo should be above the ... container, and the
          ElectroSwap logo should be at the bottom."

          So it becomes a title screen: the mark, the one decision, and whose
          wallet this is — the same three-part lock-up as Unlock and the
          splash, which is what makes them feel like one product rather than
          three screens that happen to share a palette. The dock is gone here
          too (`TabShell`), so this really is the whole screen.
        */}
        {firstRun ? (
          <Column flex={1} justifyContent="center" gap="$5" paddingBottom="$4" testID="first-run">
            <Ignition active={ignite} reducedMotion={reducedMotion} order={1}>
              <Column alignItems="center" gap="$2">
                <BoltMark size={168} testID="first-run-mark" />
              </Column>
            </Ignition>
            <Ignition active={ignite} reducedMotion={reducedMotion} order={2}>
              <Plate role="raised" gap="$3" testID="create-plate">
                <Body size="title">{t({ id: 'home.create.title', message: 'Your vault is not created yet' })}</Body>
                <Body tone="mute">
                  {t({ id: 'home.create.body', message: 'Create a new recovery phrase or import one you already have. Electroneum is your home chain.' })}
                </Body>
                <Key label={t({ id: 'home.create.key', message: 'Create vault' })} onPress={() => router.navigate('onboarding')} testID="create-vault" />
              </Plate>
            </Ignition>
          </Column>
        ) : null}

        {/* Whose wallet this is, at the foot — the same place Unlock and the splash put it. */}
        {firstRun ? (
          <Ignition active={ignite} reducedMotion={reducedMotion} order={3}>
            <Column alignItems="center" paddingTop="$2" testID="first-run-brand">
              <EsWordmark />
            </Column>
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

            <Column flex={1} maxHeight={SPREAD} />

            {gate ? (
              <Ignition active={ignite} reducedMotion={reducedMotion} order={2}>
                {gate}
              </Ignition>
            ) : rotor.length > 0 ? (
              <Ignition active={ignite} reducedMotion={reducedMotion} order={2}>
                <Rotor items={rotor} reducedMotion={reducedMotion} testID="home-rotor" />
              </Ignition>
            ) : null}

            {/*
              The second of two equal shares. Owner: "justify the vertical
              spacing between the mini-portfolio, the rotor and the actions
              menu" — so the slack above the rotor and the slack above the grid
              grow together, and the three blocks sit at even intervals instead
              of the console and the rotor being paired against a lonely grid.
              Capped, so a screen with a lot of room does not turn into three
              plates at the corners.
            */}
            <Column flex={1} maxHeight={SPREAD} />

            <Ignition active={ignite} reducedMotion={reducedMotion} order={3}>
              <ActionGrid items={tiles} layout={wide ? 'row' : 'stacked'} testID="keys" />
            </Ignition>

            {/*
              The give. Everything above it keeps its natural height and this
              takes what is left, which puts the strip on the dock's shoulder
              instead of leaving a third of the screen bare under it.
            */}
            <Column flex={1} minHeight={8} />

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
        total={
          /*
            The figure on the "All chains" row has to be the all-chains figure.
            This passed whatever the *current* scope totalled, so viewing one
            chain and opening the sheet labelled that chain's total as every
            chain's — right beside a per-chain row, from `useChainBalances`,
            that disagreed with it. Nothing is better than a wrong caption.
          */
          scope.scope === 'all' && total !== null ? totalText : null
        }
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
      {/* The tier entry's door. Get BOLT hands over to Swap with BOLT on the receiving side. */}
      <FeeScheduleSheet
        open={feeOpen}
        onClose={() => setFeeOpen(false)}
        accountId={accountId}
        chainId={ETN}
        reducedMotion={reducedMotion}
        onGetBolt={() => {
          setFeeOpen(false)
          router.setTab('swap')
        }}
      />
    </Column>
  )
}

