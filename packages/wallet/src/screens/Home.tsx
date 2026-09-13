/**
 * Home (master plan §8.2; plan B3): the seat, a mini-portfolio console — the
 * total for the chosen chains, how many tokens, the live filament — the rotor
 * of whatever needs attention, and the action grid: everything that is not
 * on the dock. Tapping the total opens the Portfolio. The Grid is drawn by
 * TabShell behind this screen; the holder tier warms it.
 */
import { fnv1a32 } from '@boltvault/ui'
import {
  ActionGrid,
  Body,
  BoltMark,
  ChainMark,
  Column,
  EsWordmark,
  Icon,
  IconButton,
  Ignition,
  Key,
  LiveFilament,
  Pill,
  Plate,
  Pressable,
  Rotor,
  Row,
  Seat,
  ScrollView,
  edge,
  metrics,
  paint,
  radius,
  type ActionTileBadge,
  type IconName,
  type RotorItem,
} from '@boltvault/ui'
import {
  cacheKey,
  type BridgeStatus,
  type CampaignView,
  type Inventory,
  type TokenDetailView,
} from '@boltvault/engine'
import { useEffect, useRef, useState } from 'react'
import { ChainScopeSheet, ScopePill, useHomeScope } from '../components/ChainScope'
import { agoLabel } from '../components/FreshnessLine'
import { PortfolioBalance } from '../components/PortfolioBalance'
import { PortfolioHistory } from '../components/PortfolioHistory'
import { DappSheet, DappStrip, useDappStatus } from '../components/DappStatus'
import { useEngine } from '../engine/EngineProvider'
import { FeeScheduleSheet } from './FeeScheduleSheet'
import { displayFiat, formatBolt, formatChange, formatPct, formatPrice, formatRaw } from '../format'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { useCached } from '../hooks/useCached'
import { useChainHead } from '../hooks/useChainHead'
import { useHolderTier } from '../hooks/useHolderTier'
import { useName } from '../hooks/useNames'
import { useNotifications } from '../hooks/useNotifications'
import { useOpenInTab } from '../hooks/useOpenInTab'
import { usePortfolio } from '../hooks/usePortfolio'
import { usePrefs } from '../hooks/usePrefs'
import { usePositions } from '../hooks/usePositions'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { takeIgnition } from '../state/ignition'
import { useWalletState } from '../state/useWalletState'
import { useScreenBusy } from '../state/useScreenBusy'

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

/** Past this, the hero total says when it was read (ES-BV-046). */
const STALE_TOTAL_MS = 60_000

export function Home({ body, reducedMotionOverride }: HomeProps) {
  const router = useRouter()
  const engine = useEngine()
  const host = useHost()
  const reducedMotion = useReducedMotion(reducedMotionOverride)
  const { vault, active, loading, refresh: refreshWallet } = useWalletState()
  const head = useChainHead(ETN)
  const tier = useHolderTier(active?.id ?? null)
  /*
    The seat has always been able to show a name ahead of the label — §8.1 and
    the component's own docstring say `.etn` → label → 0x1F90…7B63 — and nothing
    ever resolved one, so only the middle rung was ever used. Null leaves the
    label exactly where it was.
  */
  const seatName = useName(active?.address)
  const scope = useHomeScope()
  const { prefs, set: setPrefs } = usePrefs()
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
  const dapp = useDappStatus(
    unlocked && (host.body === 'extension-popup' || host.body === 'harness'),
  )
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  // The status strip's other half; only the extension ever has one.
  const hasDappStrip = dapp !== null || host.body === 'extension-popup' || host.body === 'harness'
  /**
   * No vault yet: Home is a title screen, not a list with one card on it.
   *
   * `vault !== null` matters. A null status is "not answered yet", not "no
   * vault" — and it used to read as the latter, so any path that left the
   * status unset while loading finished drew "Your vault is not created yet"
   * over a header showing a real account. The race that did it is fixed in
   * `useWalletState` (the reply's two halves are judged separately now), but a
   * refused `vault.status()` reaches the same place by a different road. The
   * CTA now needs the vault to have actually said it does not exist.
   */
  const firstRun = !loading && vault !== null && !vault.exists
  /**
   * And the other side of that coin, which had no branch at all.
   *
   * Home's three bodies are `firstRun`, locked, and unlocked, and every one of
   * them needs a vault status to be true. Tightening `firstRun` was right, but
   * it left `!loading && vault === null` rendering a header and then nothing —
   * a blank page over the circuit background, which is exactly what the owner
   * photographed on the signed APK before `useWalletState` started sharing its
   * answer (ES-BV-088). The shared store is the fix for the cause; this is the
   * floor under it, because "the engine did not answer" is a real state and a
   * wallet that draws nothing is indistinguishable from a wallet that crashed.
   */
  const statusUnknown = !loading && vault === null
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
    cached: (e) =>
      accountId ? e.launchpad.cachedList({ chainId: ETN, accountId }) : Promise.resolve(null),
    fresh: (e) =>
      accountId
        ? e.launchpad.list({ chainId: ETN, accountId })
        : Promise.reject(new Error('no account')),
    maxAgeMs: 60_000,
  })
  const inventory = useCached<Inventory>({
    key: accountId && unlocked ? cacheKey('nft', 'inventory', ETN, accountId) : null,
    cached: (e) =>
      accountId ? e.nft.cachedInventory({ accountId, chainId: ETN }) : Promise.resolve(null),
  })

  // The home-screen widget reads what Home shows (§7.13); never more.

  // The shell draws one loader over the whole screen while this is true.
  useScreenBusy('home', loading)

  /** Settings › the widget may show the total (§7.13). Off until it is asked for. */
  const [widgetTotal, setWidgetTotal] = useState(false)
  useEffect(() => {
    engine.settings.get().then(
      (v) => setWidgetTotal(v.widgetShowsTotal),
      () => undefined,
    )
    return engine.events.subscribe((e) => {
      if (e.type === 'settings.changed') setWidgetTotal(e.settings.widgetShowsTotal)
    })
  }, [engine])

  /*
    The widget snapshot is a plaintext file, so what goes into it is what a
    stolen phone gives up while the wallet is locked (§7.13, ATT-BV-033). The
    address is replaced by the hash the Field is drawn from, and the total is
    there only when the user asked for it.
  */
  useEffect(() => {
    if (!host.widget || !active || !portfolio.snapshot) return
    const showTotal = widgetTotal
    void host.widget.publish({
      /*
        Seeded from the account id, not the address (ES-BV-056).

        The widget snapshot is a file, and a file can leave the device in a
        backup. `fnv1a32(address)` is thirty-two bits over a value an attacker
        can enumerate — every address they care about, hashed, compared — so
        the file said which account it belonged to. The account id is eight
        random bytes this install chose and publishes nowhere else, and the
        seed's only job is to pick an identicon.
      */
      seed: fnv1a32(active.id),
      label: active.label,
      tier: tier?.tier ?? 0,
      total: showTotal ? portfolio.snapshot.total : null,
      change24h: showTotal ? portfolio.snapshot.change24h : null,
      currency: portfolio.snapshot.currency,
      at: Date.now(),
    })
  }, [host, active, portfolio.snapshot, tier, widgetTotal])

  // Locked is locked: the widget stops showing an account that is no longer open.
  useEffect(() => {
    if (!host.widget || unlocked) return
    void host.widget.clear?.()
  }, [host, unlocked])

  useEffect(() => {
    engine.flags.get().then(
      (f) => setNotice(f.flags.notice),
      () => undefined,
    )
    return engine.events.subscribe((e) => {
      if (e.type === 'flags.changed') setNotice(e.flags.flags.notice)
    })
  }, [engine])
  useEffect(() => {
    if (!accountId || !unlocked) return
    let alive = true
    const load = (): void => {
      engine.bridge.list({ accountId }).then(
        (xs) => alive && setBridges(xs),
        () => undefined,
      )
    }
    load()
    engine.allowances.cached({ accountId, chainId: ETN }).then(
      (c) =>
        alive &&
        setUnlimited(c.rows.filter((r) => r.amount === 'unlimited' || r.amount === 'all').length),
      () => undefined,
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'bridge.changed') load()
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, accountId, unlocked])

  const pendingTx = entries.filter((e) => e.status === 'pending').length
  const bridgeInFlight =
    bridges.find((b) => b.state === 'pending' || b.state === 'dispatched') ?? null
  const live = (campaigns.value ?? []).filter((c) => c.phase === 'live').length
  const offers = inventory.value?.withOffersCount ?? 0
  const toCollect = (positions?.farms ?? []).reduce(
    (sum, f) => sum + BigInt(f.position?.pendingRewards ?? '0'),
    0n,
  )
  const dyno = Number(toCollect) / 1e18
  const total = portfolio.snapshot?.total ?? null
  const currency = portfolio.snapshot?.currency ?? 'USD'
  const hidden = prefs.hideBalances
  const totalText = displayFiat(total, currency, hidden)
  const change = formatChange(portfolio.snapshot?.change24h ?? null)
  const tokenCount = portfolio.snapshot
    ? portfolio.snapshot.rows.filter((r) => !r.hidden).length
    : 0
  const unpriced = portfolio.snapshot?.unpricedCount ?? 0
  /*
    The total's age, said out loud once it stops being current (ES-BV-046).
    `stale` covers a remembered snapshot and a build that could not read
    everything; the clock covers a scope whose refreshes keep failing.
  */
  const observedAt = portfolio.snapshot?.observedAt ?? null
  const ageLabel =
    observedAt !== null &&
    observedAt > 0 &&
    (portfolio.snapshot?.stale === true || Date.now() - observedAt > STALE_TOTAL_MS)
      ? agoLabel(observedAt)
      : null

  /*
    Nine tiles, and no dock anywhere (owner: "I want to get rid of the bottom
    dock ... replace 'Alerts' with 'Activity', remove 'Search' and add 'Swap'
    as the first action").

    Swap leads because it is the thing people come to do; Activity takes the
    place Alerts had, being the one of the two you open daily. Search goes
    because every list it reached has its own field, and Alerts keeps a door of
    its own as the bell beside the settings key — a notification you have not
    read is a thing that came to you, which is a header's job rather than a
    tile's.

    Nine, and the browser is not a tenth. It went in here once, taking
    Activity's cell on the phone on the reasoning that the dock carried
    Activity anyway — which is exactly backwards, because there is no dock:
    the tile *is* Activity's only door. The browser gets the address bar at the
    foot instead (below), which is both more room and a truer shape for it.
  */
  const tiles: readonly Tile[] = [
    {
      id: 'swap',
      icon: 'swap',
      label: t({ id: 'tab.swap', message: 'Swap' }),
      badge: null,
      onPress: () => router.setTab('swap'),
    },
    {
      id: 'send',
      icon: 'send',
      label: t({ id: 'key.send', message: 'Send' }),
      badge: null,
      onPress: () => router.navigate('send'),
    },
    {
      id: 'receive',
      icon: 'receive',
      label: t({ id: 'key.receive', message: 'Receive' }),
      badge: null,
      onPress: () => router.navigate('receive'),
    },
    {
      id: 'bridge',
      icon: 'bridge',
      label: t({ id: 'key.bridge', message: 'Bridge' }),
      badge: bridgeInFlight
        ? { text: t({ id: 'home.badge.arriving', message: 'Arriving' }), tone: 'arc' }
        : null,
      onPress: () =>
        router.navigate(
          'bridge',
          scope.scope !== 'all' && scope.scope !== ETN ? { chainId: scope.scope } : undefined,
        ),
    },
    {
      id: 'tokens',
      icon: 'coins',
      label: t({ id: 'key.tokens', message: 'Tokens' }),
      badge: null,
      onPress: () => router.navigate('explore', { segment: 'tokens' }),
    },
    {
      id: 'collectibles',
      icon: 'nft',
      label: t({ id: 'key.collectibles', message: 'Collectibles' }),
      badge:
        offers > 0
          ? {
              text: t({ id: 'home.badge.offers', message: '{n} offers', values: { n: offers } }),
              tone: 'ember',
            }
          : null,
      onPress: () => router.navigate('explore', { segment: 'collectibles' }),
    },
    {
      id: 'launchpad',
      icon: 'launch',
      label: t({ id: 'key.launchpad', message: 'Launchpad' }),
      badge:
        live > 0
          ? {
              text: t({ id: 'home.badge.live', message: '{n} live', values: { n: live } }),
              tone: 'arc',
            }
          : null,
      onPress: () => router.navigate('explore', { segment: 'launch' }),
    },
    {
      id: 'farms',
      icon: 'farm',
      label: t({ id: 'key.farms', message: 'Farms' }),
      badge:
        toCollect > 0n
          ? {
              text: t({
                id: 'home.badge.collect',
                message: '{d} DYNO',
                values: { d: dyno >= 10 ? dyno.toFixed(0) : dyno.toFixed(1) },
              }),
              tone: 'surge',
            }
          : null,
      onPress: () => router.navigate('explore', { segment: 'farms' }),
    },
    {
      id: 'activity',
      icon: 'activity',
      label: t({ id: 'tab.activity', message: 'Activity' }),
      badge:
        pendingTx > 0
          ? {
              text: t({
                id: 'home.badge.pending',
                message: '{n} pending',
                values: { n: pendingTx },
              }),
              tone: 'arc',
            }
          : null,
      onPress: () => router.setTab('activity'),
    },
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
  const copy =
    host.copy && active
      ? () =>
          void host.copy?.(active.address).then(
            () => {
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            },
            () => undefined,
          )
      : undefined

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
      <Plate
        role="raised"
        paddingVertical={6}
        paddingHorizontal={12}
        minHeight={44}
        justifyContent="center"
        testID="backup-gate"
      >
        <Row gap="$2" alignItems="center">
          <Icon name="shield" size={16} color={paint.ember} />
          <Column flex={1} minWidth={0} alignItems="flex-start">
            <Body size="caption" fontWeight="600" numberOfLines={1}>
              {t({ id: 'home.backup.title', message: 'Back up your recovery phrase' })}
            </Body>
            <Body tone="mute" size="caption" fontSize={11} lineHeight={13} numberOfLines={1}>
              {t({
                id: 'home.backup.body',
                message: 'Swapping and signing stay locked until you do.',
              })}
            </Body>
          </Column>
          <Pill
            label={t({ id: 'home.backup.key', message: 'Back up' })}
            tone="ember"
            size="sm"
            onPress={() => router.navigate('backup')}
            testID="backup-key"
          />
        </Row>
      </Plate>
    )
  }

  /*
    Nothing in it at all.

    Every row the snapshot carries is a balance, so "unfunded" is simply no row
    with anything in it — which is different from a zero TOTAL, because a wallet
    holding an unpriced token totals nothing and is not empty. It waits for a
    real snapshot: `null` is "we have not looked yet", and telling somebody
    their wallet is empty before reading the chain is a lie with a 50% chance.
    A watch-only account is excluded — you cannot fund an address you do not
    hold the key to from here. And an EMPTY row list is not an empty wallet:
    the snapshot always carries the native coin, so no rows at all means the
    read failed, and a failed read must not be reported as "you have nothing".
  */
  /*
    And a read that failed is not a zero balance either (ES-BV-045). During an
    endpoint outage every row came back at zero and the wallet told the user
    to add funds to a wallet that was not empty. A snapshot that names any
    chain it could not read says so instead.
  */
  const unreadChains = portfolio.snapshot?.errors ?? []
  const unfunded =
    !!portfolio.snapshot &&
    active?.kind !== 'watch' &&
    unreadChains.length === 0 &&
    portfolio.snapshot.rows.length > 0 &&
    portfolio.snapshot.rows.every((r) => !r.unread && BigInt(r.raw || '0') === 0n)

  const rotor: RotorItem[] = []
  if (notice)
    rotor.push({
      id: 'notice',
      icon: 'warn',
      tone: paint.ember,
      text: notice,
      testID: 'home-notice',
    })
  /*
    First in the rotor, because with an empty wallet there is nothing else it
    could be showing that matters more — and because this is the advice the
    onboarding's last page used to give on its way out: ETN from an exchange
    that supports the smart chain, not from the old app.
  */
  if (unreadChains.length > 0) {
    rotor.push({
      id: 'unread',
      icon: 'warn',
      tone: paint.ember,
      text: t({ id: 'home.acc.unread', message: 'Some balances could not be read' }),
      sub: t({ id: 'home.acc.unread.sub', message: 'The network did not answer. The total below is incomplete.' }),
      testID: 'accessory-unread',
    })
  }
  if (unfunded) {
    rotor.push({
      id: 'fund',
      icon: 'receive',
      tone: paint.arc,
      text: t({ id: 'home.acc.fund', message: 'Add funds to get started' }),
      sub: t({ id: 'home.acc.fund.sub', message: 'ETN from an exchange, or bridge USDC in' }),
      onPress: () => router.navigate('receive'),
      testID: 'accessory-fund',
    })
  }
  if (bridgeInFlight)
    rotor.push({
      id: 'bridge',
      icon: 'bridge',
      tone: paint.arc,
      text: t({
        id: 'home.acc.bridge',
        message: '{s} arriving on {c} in about {m} min',
        values: {
          s: bridgeInFlight.symbol,
          c:
            scope.chains.find((c) => c.chainId === bridgeInFlight.toChainId)?.name ??
            `chain ${bridgeInFlight.toChainId}`,
          m: bridgeInFlight.toChainId === 1 || bridgeInFlight.fromChainId === 1 ? 20 : 5,
        },
      }),
      onPress: () => router.navigate('bridge'),
      testID: 'accessory-bridge',
    })
  if (pendingTx > 0)
    rotor.push({
      id: 'pending',
      icon: 'clock',
      tone: paint.arc,
      text: t({
        id: 'home.acc.pending',
        message: '{n} transaction pending',
        values: { n: pendingTx },
      }),
      onPress: () => router.setTab('activity'),
      testID: 'accessory-pending',
    })
  /*
    The second line, built here rather than in the engine.

    `text` says what is waiting; `sub` says where it came from, which is the
    part that makes it worth opening. Both could be built beside each other in
    `PositionsService`, and the engine's are the strings that are not
    translated — so the new one is built where `t()` is, off the same snapshot
    the entry came from.
  */
  const earning = (positions?.farms ?? []).filter(
    (f) => BigInt(f.position?.pendingRewards ?? '0') > 0n,
  )
  const bestApy = earning.reduce<number | null>(
    (best, f) => (f.baseApy !== null && (best === null || f.baseApy > best) ? f.baseApy : best),
    null,
  )
  const legends = positions?.legends ?? null
  const subFor = (kind: string): string | null => {
    if (kind === 'dividends' && legends) {
      const paid = BigInt(legends.lifetimePaidWei)
      const pieces =
        legends.activeTokenCount === 1
          ? t({ id: 'home.acc.div.one', message: '1 Legends piece' })
          : t({
              id: 'home.acc.div.many',
              message: '{n} Legends pieces',
              values: { n: legends.activeTokenCount },
            })
      // Only once there is a lifetime to speak of: "0 ETN paid so far" is a discouragement, not a fact worth the line.
      return paid > 0n
        ? t({
            id: 'home.acc.div.sub',
            message: '{pieces} · {p} ETN paid so far',
            values: { pieces, p: formatRaw(legends.lifetimePaidWei, 18) },
          })
        : pieces
    }
    if (kind === 'collect' && earning.length > 0) {
      const where =
        earning.length === 1
          ? (earning[0]?.name ?? '')
          : t({
              id: 'home.acc.collect.many',
              message: 'across {n} farms',
              values: { n: earning.length },
            })
      return bestApy !== null
        ? t({
            id: 'home.acc.collect.sub',
            message: '{where} · {a}% APY, still earning',
            values: { where, a: bestApy.toFixed(1) },
          })
        : where
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
      onPress: () =>
        a.target === 'legends'
          ? router.navigate('legends')
          : a.target.startsWith('farm:')
            ? router.navigate('farm', { chainId: ETN, farmId: Number(a.target.slice(5)) })
            : router.navigate('campaign', { chainId: ETN, pool: a.target.slice(9) }),
      testID: `accessory-${a.kind}`,
    })
  }
  if (unlimited > 0)
    rotor.push({
      id: 'approvals',
      icon: 'approvals',
      tone: paint.burn,
      text: t({
        id: 'home.acc.unlimited',
        message: '{n} unlimited approvals',
        values: { n: unlimited },
      }),
      onPress: () => router.navigate('allowances'),
      testID: 'accessory-approvals',
    })
  if (tier) {
    rotor.push({
      id: 'tier',
      icon: 'bolt',
      tone: paint.ember,
      text: t({
        id: 'home.acc.tier',
        message: '{name} tier · {p} wallet fee',
        values: { name: tier.name, p: formatPct(tier.bips) },
      }),
      // The nudge is the point: a rung you can name, and what it costs to reach it.
      sub:
        tier.nextTierAt && tier.nextTierName && tier.nextTierBips !== null
          ? t({
              id: 'home.acc.tier.next',
              message: '{n} more BOLT-eq for {next} at {p}',
              values: {
                n: formatBolt((BigInt(tier.nextTierAt) - BigInt(tier.score)).toString()),
                next: tier.nextTierName,
                p: formatPct(tier.nextTierBips),
              },
            })
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
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: inset,
          paddingTop: 12,
          paddingBottom: 12,
          gap,
          flexGrow: 1,
        }}
      >
        <Ignition active={ignite} reducedMotion={reducedMotion} order={0}>
          <Row
            justifyContent="space-between"
            alignItems="center"
            minHeight={metrics.header}
            gap="$2"
          >
            {active ? (
              <Seat
                address={active.address}
                label={active.label}
                name={seatName}
                onPress={() => router.navigate('accounts')}
                onCopy={copy}
                copied={copied}
                testID="seat"
              />
            ) : (
              <Body size="title">BoltVault</Body>
            )}
            <Row gap="$1" flexShrink={0}>
              {openInTab ? (
                <IconButton
                  icon="expand"
                  label={t({ id: 'header.expand', message: 'Open in a full tab' })}
                  onPress={() => openInTab()}
                  testID="open-tab"
                />
              ) : null}
              {/* Alerts lost its tile to Activity; the bell is the better place for it anyway. */}
              <IconButton
                icon="bell"
                label={t({ id: 'key.alerts', message: 'Alerts' })}
                badge={unread > 0 ? String(unread) : undefined}
                onPress={() => router.navigate('alerts')}
                testID="alerts-key"
              />
              <IconButton
                icon="settings"
                label={t({ id: 'home.settings', message: 'Settings' })}
                onPress={() => router.navigate('settings')}
                testID="settings-key"
              />
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
        {loading ? null : null}

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
                <Body size="title">
                  {t({ id: 'home.create.title', message: 'Your vault is not created yet' })}
                </Body>
                <Body tone="mute">
                  {t({
                    id: 'home.create.body',
                    message:
                      'Create a new recovery phrase or import one you already have. Electroneum is your home chain.',
                  })}
                </Body>
                <Key
                  label={t({ id: 'home.create.key', message: 'Create vault' })}
                  onPress={() => router.navigate('onboarding')}
                  testID="create-vault"
                />
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

        {statusUnknown ? (
          <Ignition active={ignite} reducedMotion={reducedMotion} order={1}>
            <Plate role="raised" gap="$3" testID="status-unknown-plate">
              <Row gap="$2">
                <Icon name="warn" color={paint.mute} size={18} />
                <Body size="title">
                  {t({ id: 'home.unknown.title', message: 'Cannot reach the wallet' })}
                </Body>
              </Row>
              <Body tone="mute">
                {t({
                  id: 'home.unknown.body',
                  message:
                    'The wallet service did not answer. Nothing has changed — your keys and balances are untouched.',
                })}
              </Body>
              <Key
                label={t({ id: 'home.unknown.key', message: 'Try again' })}
                onPress={() => refreshWallet()}
                testID="status-unknown-retry"
              />
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
              <Body tone="mute">
                {t({ id: 'home.locked.body', message: 'Unlock to see balances and sign.' })}
              </Body>
              <Key
                label={t({ id: 'home.locked.key', message: 'Unlock' })}
                onPress={() => router.navigate('unlock')}
                testID="unlock"
              />
            </Plate>
          </Ignition>
        ) : null}

        {unlocked ? (
          <>
            {/* The balance console: the scope, the total with the eye and the day underneath, the live filament. */}
            <Ignition active={ignite} reducedMotion={reducedMotion} order={1}>
              <Plate role="console" gap={6} padding={12} testID="home-console">
                <Row justifyContent="space-between" alignItems="center">
                  <ScopePill
                    scope={scope.scope}
                    label={scope.label}
                    onPress={() => setScopeOpen(true)}
                    testID="home-scope"
                  />
                  {portfolio.snapshot && !unfunded ? (
                    <Body tone="mute" size="caption" testID="home-token-count">
                      {tokenCount === 1
                        ? t({ id: 'home.tokens.one', message: '1 token' })
                        : t({
                            id: 'home.tokens.many',
                            message: '{n} tokens',
                            values: { n: tokenCount },
                          })}
                      {unpriced > 0
                        ? ` · ${t({ id: 'home.unpriced', message: '{n} without price', values: { n: unpriced } })}`
                        : ''}
                    </Body>
                  ) : null}
                </Row>
                <PortfolioBalance
                  value={totalText}
                  change={change}
                  hidden={hidden}
                  onToggle={() => setPrefs({ hideBalances: !hidden })}
                  reducedMotion={reducedMotion}
                  onPress={() => router.navigate('portfolio')}
                  trailing={<Icon name="chevronRight" size={20} color={paint.mute} />}
                  extra={
                    !change && !portfolio.snapshot ? (
                      <Body tone="mute" size="caption" numberOfLines={1}>
                        {t({ id: 'home.scope.none', message: 'No balances yet' })}
                      </Body>
                    ) : null
                  }
                  pressTestID="home-portfolio"
                />
                {/*
                  How old the number is (ES-BV-046).

                  The hero total is the figure people act on, and it was shown
                  with no age beside it whatever its provenance — a snapshot
                  remembered from a previous session, or one whose refreshes
                  have been failing for an hour, read exactly like a reading
                  taken a second ago. Nothing is said while it is current; a
                  minute past that, it says when it was true.
                */}
                {ageLabel ? (
                  <Body tone="mute" size="caption" testID="home-total-age">
                    {ageLabel}
                  </Body>
                ) : null}
                {/*
                  The line under the total (§8.2).

                  Home had a number and one "since you last looked" comparison,
                  because the portfolio kept exactly one earlier point. The
                  snapshot now carries a bounded series of the totals this
                  wallet has actually seen in this scope — which is why it
                  hangs off `portfolio.snapshot` rather than a second call: it
                  arrives with the figure it belongs to, on the same event, and
                  costs the paint path nothing.

                  It draws only once there is a shape to draw; a fresh wallet
                  gets no empty box in a 600-pixel window.
                */}
                <PortfolioHistory
                  points={portfolio.snapshot?.history ?? []}
                  currency={currency}
                  hidden={hidden}
                  body={body}
                  inset={inset}
                  reducedMotion={reducedMotion}
                  testID="home-history"
                />
                <LiveFilament
                  tick={head?.blockNumber ?? null}
                  live={head?.live ?? false}
                  reducedMotion={reducedMotion}
                  testID="filament"
                />
              </Plate>
            </Ignition>

            {gate ? (
              <Ignition active={ignite} reducedMotion={reducedMotion} order={2}>
                {gate}
              </Ignition>
            ) : rotor.length > 0 ? (
              <Ignition active={ignite} reducedMotion={reducedMotion} order={2}>
                <Rotor items={rotor} reducedMotion={reducedMotion} testID="home-rotor" />
              </Ignition>
            ) : null}

            <Ignition active={ignite} reducedMotion={reducedMotion} order={3}>
              <ActionGrid items={tiles} layout={wide ? 'row' : 'stacked'} testID="keys" />
            </Ignition>

            {/*
              The give. Everything above it keeps its natural height and this
              takes what is left, which puts the strip on the dock's shoulder
              instead of leaving a third of the screen bare under it.
            */}
            <Column flex={1} minHeight={8} />

            {/*
              The way into the in-app browser (§5.3), on the bodies that have
              one — the phone, never the extension, which is already in a
              browser.

              It is drawn as an empty address bar rather than as a key or a
              tile: the well, the radius and the mute placeholder are the
              `Input` face, so it reads as the thing it opens instead of as a
              button that happens to be named Web. Tapping anywhere on it opens
              the Browser, where the real field takes over; nothing is typed
              here, because a second URL input on Home would be a second place
              for the same text to live.

              It sits directly above the price strip, in the room the phone has
              under the grid and the popup does not — the same slack the spacer
              above was added to absorb.
            */}
            {host.browser ? (
              <Ignition active={ignite} reducedMotion={reducedMotion} order={4}>
                <Pressable
                  onPress={() => router.navigate('browser', { focus: true })}
                  accessibilityRole="button"
                  accessibilityLabel={t({
                    id: 'home.browser.a11y',
                    message: 'Open the in-app browser',
                  })}
                  testID="home-browser-bar"
                  style={{
                    // The `Input` face exactly, down to the four pixels over
                    // the hit floor — this is meant to read as that field.
                    minHeight: metrics.hit + 4,
                    borderRadius: radius.well,
                    borderWidth: 1,
                    borderColor: edge,
                    backgroundColor: paint.well,
                    paddingHorizontal: 14,
                    justifyContent: 'center',
                  }}
                >
                  <Row gap="$2" alignItems="center">
                    <Icon name="search" size={16} color={paint.mute} />
                    <Body tone="mute" numberOfLines={1} flexShrink={1}>
                      {t({ id: 'home.browser.bar', message: 'Search or enter address' })}
                    </Body>
                  </Row>
                </Pressable>
              </Ignition>
            ) : null}

            {/* The status strip: the site under the popup, and ETN's price. */}
            <Ignition active={ignite} reducedMotion={reducedMotion} order={4}>
              <Plate role="card" padding={0} overflow="hidden" testID="home-strip">
                <Row minHeight={44} alignItems="stretch">
                  {hasDappStrip ? (
                    <>
                      <DappStrip state={dapp} onPress={() => setDappOpen(true)} />
                      <Column width={1} backgroundColor="$edge" marginVertical={8} />
                    </>
                  ) : null}
                  {/*
                    Straight to ETN's own screen, and it says whose price it is.

                    It used to open the Tokens list — which does not list ETN at
                    all, so the one tap the strip offers landed you somewhere the
                    thing you tapped was not. And a bare "$0.001058" beside a
                    chain mark is a number without a noun: the symbol goes after
                    it (owner: "show $0.00XXXX ETN").
                  */}
                  <Pressable
                    onPress={() => router.navigate('token', { chainId: ETN, address: 'native' })}
                    accessibilityRole="button"
                    accessibilityLabel={t({ id: 'home.price.a11y', message: 'ETN price' })}
                    testID="home-price"
                    /*
            The right-hand side of the bar was dead (ES-BV-078).

            This box is content-width, and on a phone it is the strip's only
            child — DappStrip renders solely in the extension popup. So it
            sat at the left of a full-width plate and every pixel past the
            price text pressed nothing: the tester's "bottom ETN price
            doesn't trigger on the right side of the bar".

            It grows only when it is alone. DappStrip already claims flex 1,
            so growing unconditionally would split the popup's bar down the
            middle instead of leaving the price at the end. The inner Row's
            justifyContent was a no-op in a box sized to its content; now it
            is what keeps the price to the right.
          */
          style={{ flexShrink: 0, flexGrow: hasDappStrip ? 0 : 1, justifyContent: 'center', paddingHorizontal: 12 }}
                  >
                    <Row gap={6} alignItems="center" justifyContent="flex-end">
                      <ChainMark chainId={ETN} size={14} />
                      <Body size="caption" fontWeight="600" numberOfLines={1}>
                        {etn ? `${formatPrice(etn.price, 'USD')} ETN` : '—'}
                      </Body>
                      {etnChange ? (
                        <Body
                          size="caption"
                          tone={
                            etnChange.startsWith('+')
                              ? 'surge'
                              : etnChange.startsWith('−')
                                ? 'burn'
                                : 'mute'
                          }
                        >
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
      <DappSheet
        open={dappOpen}
        onClose={() => setDappOpen(false)}
        state={dapp}
        reducedMotion={reducedMotion}
      />
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
