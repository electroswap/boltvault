/**
 * Home — the switchgear panel (master plan §7.5, §8.2). Seat · readout ·
 * filament · Tokens/Collectibles/Positions · one accessory · four keys.
 * The Field renders behind everything. Locked = redacted; no vault = the
 * funding/creation plate; no portfolio service yet = honest empty state.
 */
import {
  Body,
  BusBar,
  Chip,
  Column,
  Field,
  Icon,
  Ignition,
  Key,
  LiveFilament,
  Plate,
  Pressable,
  Row,
  RollingReadout,
  Seat,
  Segmented,
  ScrollView,
  metrics,
  paint,
  useWindowDimensions,
} from '@boltvault/ui'
// Column is also the Field's host; content sits above it via zIndex.
import { useEffect, useState, useMemo } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useActivity } from '../hooks/useActivity'
import { usePositions } from '../hooks/usePositions'
import { LegendsVault } from '../components/LegendsVault'
import { Rack } from './Rack'
import type { BridgeStatus, CampaignView, ChainView, HolderTier, Settings } from '@boltvault/engine'
import { formatRaw } from '../format'
import { useChainHead } from '../hooks/useChainHead'
import { usePortfolio } from '../hooks/usePortfolio'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'
import { formatChange, formatFiat, formatQuantity } from '../format'

const ETN = 52014
const NO_ACCOUNT_SEED = '0x0000000000000000000000000000000000000e7n'

export interface HomeProps {
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly reducedMotionOverride?: boolean
}

export function Home({ body, reducedMotionOverride }: HomeProps) {
  const { width, height } = useWindowDimensions()
  const router = useRouter()
  const reducedMotion = useReducedMotion(reducedMotionOverride)
  const { vault, active, loading } = useWalletState()
  const head = useChainHead(ETN)
  const [scope, setScope] = useState<'all' | number>(ETN)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [chains, setChains] = useState<ChainView[]>([])
  const [bridges, setBridges] = useState<BridgeStatus[]>([])
  const [notice, setNotice] = useState<string | null>(null)
  const scopeIds = useMemo(() => (scope === 'all' ? [ETN, ...(settings?.enabledChains ?? [])] : [scope]), [scope, settings])
  const portfolio = usePortfolio(active?.id ?? null, 5_000, scopeIds)
  const { entries } = useActivity(active?.id ?? null)
  const engine = useEngine()
  const [segment, setSegment] = useState<'tokens' | 'collectibles' | 'positions'>('tokens')
  const [sinceLook, setSinceLook] = useState<{ at: number; total: number | null } | null>(null)
  const [unlimited, setUnlimited] = useState(0)
  const [tier, setTier] = useState<HolderTier | null>(null)
  const [live, setLive] = useState<CampaignView | null>(null)
  const { positions } = usePositions(active?.id ?? null, !!vault?.unlocked)
  const pendingTx = entries.filter((e) => e.status === 'pending').length
  const host = useHost()
  // The home-screen widget reads what Home shows (§7.13); never more.
  useEffect(() => {
    if (!host.widget || !active || !portfolio.snapshot) return
    void host.widget.publish({ address: active.address, label: active.label, tier: tier?.tier ?? 0, total: portfolio.snapshot.total, change24h: portfolio.snapshot.change24h, currency: portfolio.snapshot.currency, at: Date.now() })
  }, [host, active, portfolio.snapshot, tier])

  // Chain scope (§8.2): Electroneum by default; All chains or one enabled chain. Never a site's session.
  useEffect(() => {
    engine.settings.get().then(setSettings, () => undefined)
    engine.chains.list().then(setChains, () => undefined)
    engine.flags.get().then((f) => setNotice(f.flags.notice), () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'flags.changed') setNotice(e.flags.flags.notice)
    })
  }, [engine])
  useEffect(() => {
    if (!active || !vault?.unlocked) return
    let alive = true
    const load = (): void => {
      engine.bridge.list({ accountId: active.id }).then((xs) => alive && setBridges(xs), () => undefined)
    }
    load()
    const off = engine.events.subscribe((e) => {
      if (e.type === 'bridge.changed') load()
    })
    return () => {
      alive = false
      off()
    }
  }, [engine, active, vault?.unlocked])
  const cycleScope = (): void => {
    const order: Array<'all' | number> = ['all', ETN, ...(settings?.enabledChains ?? [])]
    const i = order.indexOf(scope)
    setScope(order[(i + 1) % order.length] ?? ETN)
  }
  const scopeLabel = scope === 'all' ? t({ id: 'home.scope.all', message: 'All chains' }) : scope === ETN ? t({ id: 'home.scope.etn', message: 'Electroneum' }) : (chains.find((c) => c.chainId === scope)?.name ?? `Chain ${scope}`)
  const bridgeInFlight = bridges.find((b) => b.state === 'pending' || b.state === 'dispatched') ?? null

  // "Since you last looked" (§7.13) and the approvals fuse count, once per open.
  useEffect(() => {
    if (!active || !vault?.unlocked) return
    let alive = true
    engine.portfolio.lastLook({ accountId: active.id }).then((r) => {
      if (alive && r.previous && Date.now() - r.previous.at > 60 * 60_000) setSinceLook(r.previous)
    }, () => undefined)
    engine.allowances.cached({ accountId: active.id, chainId: ETN }).then((c) => alive && setUnlimited(c.rows.filter((r) => r.amount === 'unlimited' || r.amount === 'all').length), () => undefined)
    // The holder tier warms the Field's spectrum and marks the seat (§8.18); a live campaign puts a Launch key on Home (§7.13).
    engine.holder.tier({ accountId: active.id, chainId: ETN }).then((x) => alive && setTier(x), () => undefined)
    engine.launchpad.list({ chainId: ETN, statuses: ['ACTIVE'] }).then((cs) => alive && setLive(cs.find((c) => c.phase === 'live') ?? null), () => undefined)
    return () => {
      alive = false
    }
  }, [engine, active, vault?.unlocked])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const address = active?.address ?? NO_ACCOUNT_SEED
  const quiet = !vault?.unlocked

  const total = portfolio.snapshot?.total ?? null
  const totalText = total === null ? '—' : formatFiat(total, portfolio.snapshot?.currency ?? 'USD')
  const change = formatChange(portfolio.snapshot?.change24h ?? null)

  return (
    <Column flex={1} backgroundColor="$void" testID="home">
      <Field address={address} pulse={head?.live ? 1 : 0} warmth={tier ? Math.min(1, tier.tier / 4) : 0} intensity={body === 'extension-popup' ? 0.75 : 1} quiet={quiet} reducedMotion={reducedMotion} fps={body === 'extension-popup' ? 30 : 60} width={width} height={height} testID="field" />
      <ScrollView style={{ zIndex: 1 }} contentContainerStyle={{ padding: inset, gap: 20 }}>
        <Ignition reducedMotion={reducedMotion} order={0}>
          <Row justifyContent="space-between">
            {active ? (
              <Seat address={active.address} label={active.label} tierMark={tier && tier.tier > 0 ? t({ id: 'home.tier', message: 'Tier {t}', values: { t: tier.tier } }) : null} onPress={() => router.navigate('accounts')} testID="seat" />
            ) : (
              <Body size="title">BoltVault</Body>
            )}
            <Row gap="$4">
              <Icon name="scan" color={paint.mute} />
              <Pressable onPress={() => router.navigate('settings')} accessibilityRole="button" accessibilityLabel="Settings" testID="settings-key" hitSlop={12} style={{ minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="settings" color={paint.mute} />
              </Pressable>
            </Row>
          </Row>
        </Ignition>

        {!loading && !vault?.exists ? (
          <Ignition reducedMotion={reducedMotion} order={1}>
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
          <Ignition reducedMotion={reducedMotion} order={1}>
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

        {vault?.unlocked ? (
          <>
            {!vault.backupComplete && vault.seeds.length > 0 ? (
              <Ignition reducedMotion={reducedMotion} order={1}>
                <Plate role="raised" gap="$2" testID="backup-gate">
                  <Body size="title">{t({ id: 'home.backup.title', message: 'Back up your recovery phrase' })}</Body>
                  <Body tone="mute" size="caption">
                    {t({ id: 'home.backup.body', message: 'Swapping and signing stay locked until you confirm three words. Watching and receiving work now.' })}
                  </Body>
                  <Key label={t({ id: 'home.backup.key', message: 'Back up' })} onPress={() => router.navigate('backup')} testID="backup-key" />
                </Plate>
              </Ignition>
            ) : null}
            {notice ? (
              <Plate gap={2} testID="home-notice">
                <Row gap="$2" alignItems="center">
                  <Icon name="warn" size={16} color={paint.ember} />
                  <Body size="caption" flexShrink={1}>
                    {notice}
                  </Body>
                </Row>
              </Plate>
            ) : null}
            <Ignition reducedMotion={reducedMotion} order={2}>
              <Column gap="$2">
                <RollingReadout value={totalText} hero reducedMotion={reducedMotion} testID="total" />
                <Row gap="$3">
                  {portfolio.snapshot ? (
                    <Chip onPress={cycleScope} cursor="pointer" minHeight={28} justifyContent="center" testID="home-scope">
                      <Body tone={scope === ETN ? 'mute' : 'arc'} size="caption">
                        {scopeLabel} ▾
                      </Body>
                    </Chip>
                  ) : (
                    <Body tone="mute" size="caption">
                      {t({ id: 'home.scope.none', message: 'No balances yet' })}
                    </Body>
                  )}
                  {change ? (
                    <Body tone={change.startsWith('+') ? 'surge' : change.startsWith('−') ? 'burn' : 'mute'} size="caption">
                      {change} {t({ id: 'home.today', message: 'today' })}
                    </Body>
                  ) : null}
                  {portfolio.snapshot && portfolio.snapshot.unpricedCount > 0 ? (
                    <Body tone="mute" size="caption">
                      {t({ id: 'home.unpriced', message: '{n} without price', values: { n: portfolio.snapshot.unpricedCount } })}
                    </Body>
                  ) : null}
                </Row>
                <LiveFilament tick={head?.blockNumber ?? null} live={head?.live ?? false} reducedMotion={reducedMotion} testID="filament" />
              </Column>
            </Ignition>

            <Ignition reducedMotion={reducedMotion} order={3}>
              <Column gap="$3">
                <Segmented
                  options={[
                    { id: 'tokens', label: t({ id: 'home.seg.tokens', message: 'Tokens' }) },
                    { id: 'collectibles', label: t({ id: 'home.seg.collectibles', message: 'Collectibles' }) },
                    { id: 'positions', label: t({ id: 'home.seg.positions', message: 'Positions' }) },
                  ]}
                  value={segment}
                  onChange={(id) => setSegment(id as typeof segment)}
                  testID="home-segments"
                />
                {segment === 'tokens' ? (
                  portfolio.snapshot && portfolio.snapshot.rows.length > 0 ? (
                    <Column gap="$1" testID="bus-bars">
                      {portfolio.snapshot.rows
                        .filter((r) => !r.hidden)
                        .map((r) => (
                          <BusBar
                            key={`${r.chainId}:${r.address}`}
                            chainId={r.chainId}
                            address={r.address === 'native' ? '0x0000000000000000000000000000000000000000' : r.address}
                            symbol={r.symbol}
                            amount={formatQuantity(r.quantity)}
                            value={r.fiat === null ? null : formatFiat(r.fiat, portfolio.snapshot?.currency ?? 'USD')}
                            change={formatChange(r.change24h)}
                            share={r.share}
                            logoUri={r.logoUri}
                            mark={r.custom ? t({ id: 'home.mark.custom', message: 'Custom' }) : null}
                            onPress={() => router.navigate('token', { chainId: r.chainId, address: r.address })}
                          />
                        ))}
                    </Column>
                  ) : (
                    <Plate gap="$2" testID="funding-plate">
                      <Body size="title">{t({ id: 'home.fund.title', message: 'Receive ETN to get started' })}</Body>
                      <Body tone="mute">
                        {t({
                          id: 'home.fund.body',
                          message: 'This is Electroneum Smart Chain (52014). Send ETN here from an exchange that supports the smart chain, or bridge USDC from Ethereum — you will need a little ETN for fees.',
                        })}
                      </Body>
                    </Plate>
                  )
                ) : segment === 'collectibles' ? (
                  <Rack body={body} embedded limit={6} />
                ) : positions && (positions.farms.length > 0 || (positions.legends && positions.legends.ownedTokenIds.length > 0) || positions.orders.length > 0 || positions.campaigns.length > 0) ? (
                  <Column gap="$2" testID="positions">
                    {positions.legends && positions.legends.ownedTokenIds.length > 0 ? <LegendsVault status={positions.legends} compact reducedMotion={reducedMotion} onOpen={() => router.navigate('legends')} testID="home-legends" /> : null}
                    {positions.farms.map((f) => (
                      <Plate key={f.id} gap={2} onPress={() => router.navigate('farm', { chainId: ETN, farmId: f.id })} cursor="pointer" testID={`position-farm-${f.id}`}>
                        <Row justifyContent="space-between" alignItems="center">
                          <Row gap="$2" alignItems="center">
                            <Icon name="farm" size={16} color={paint.arc} />
                            <Body>{f.name || `${f.symbol0}/${f.symbol1}`}</Body>
                          </Row>
                          <Body tone="arc" size="caption">
                            {f.position ? `${(f.position.durationMultiplier / 10_000).toFixed(2)}× · ${(f.position.boltMultiplier / 10_000).toFixed(2)}×` : ''}
                          </Body>
                        </Row>
                        {f.position ? (
                          <Body tone="mute" size="caption">
                            {t({ id: 'home.pos.pending', message: '{d} DYNO to collect', values: { d: formatRaw(f.position.pendingRewards, 18) } })}
                          </Body>
                        ) : null}
                      </Plate>
                    ))}
                    {positions.orders.map((o) => (
                      <Plate key={o.orderId} gap={2} onPress={() => router.setTab('swap')} cursor="pointer" testID={`position-order-${o.orderId}`}>
                        <Body size="caption">{t({ id: 'home.pos.order', message: 'Open order: {a} {s} → at least {b} {u}', values: { a: formatRaw(o.amountInExact, o.decimalsIn), s: o.symbolIn, b: formatRaw(o.amountOutMin, o.decimalsOut), u: o.symbolOut } })}</Body>
                      </Plate>
                    ))}
                    {positions.campaigns.map((c) => (
                      <Plate key={c.pool} gap={2} onPress={() => router.navigate('campaign', { chainId: ETN, pool: c.pool })} cursor="pointer" testID={`position-campaign-${c.pool}`}>
                        <Body size="caption">{t({ id: 'home.pos.campaign', message: '{s}: {a} ETN contributed{k}', values: { s: c.token.symbol, a: formatRaw(c.contributedWei, 18), k: c.keys.includes('claim_tokens') ? ' · tokens ready' : c.keys.includes('claim_refund') ? ' · refund waiting' : '' } })}</Body>
                      </Plate>
                    ))}
                  </Column>
                ) : (
                  <Plate gap="$2">
                    <Body tone="mute">{t({ id: 'home.positions.empty', message: 'No farm positions, open orders or bridges in flight.' })}</Body>
                  </Plate>
                )}
              </Column>
            </Ignition>

            {sinceLook ? (
              <Plate gap={2} testID="since-look">
                <Body tone="mute" size="caption">
                  {t({ id: 'home.since', message: 'Since {d}', values: { d: new Date(sinceLook.at).toLocaleDateString() } })}
                </Body>
                <Body size="caption">
                  {sinceLook.total !== null && total !== null
                    ? t({ id: 'home.since.change', message: '{from} → {to}', values: { from: formatFiat(sinceLook.total, portfolio.snapshot?.currency ?? 'USD'), to: totalText } })
                    : t({ id: 'home.since.none', message: 'No priced change to report.' })}
                </Body>
              </Plate>
            ) : null}

            {/* A persistent Launch key while a campaign is live (§7.13). */}
            {live ? (
              <Plate role="raised" gap={2} onPress={() => router.navigate('campaign', { chainId: ETN, pool: live.pool })} cursor="pointer" testID="launch-key">
                <Row gap="$2" alignItems="center">
                  <Icon name="bolt" size={16} color={paint.arc} />
                  <Body size="caption">{t({ id: 'home.launch', message: '{s} is live on the launchpad', values: { s: live.token.symbol } })}</Body>
                </Row>
              </Plate>
            ) : null}

            {/* One accessory (§8.2): bridge in flight > pending tx > rewards/dividends to collect > unlimited approvals. */}
            {bridgeInFlight ? (
              <Plate gap={2} onPress={() => router.navigate('bridge')} cursor="pointer" testID="accessory-bridge">
                <Row gap="$2" alignItems="center">
                  <Icon name="bridge" size={16} color={paint.arc} />
                  <Body size="caption">{t({ id: 'home.acc.bridge', message: 'Hyperlane {s} arriving on {c} · about {m} min', values: { s: bridgeInFlight.symbol, c: chains.find((c) => c.chainId === bridgeInFlight.toChainId)?.name ?? `chain ${bridgeInFlight.toChainId}`, m: bridgeInFlight.toChainId === 1 || bridgeInFlight.fromChainId === 1 ? 20 : 5 } })}</Body>
                </Row>
              </Plate>
            ) : pendingTx > 0 ? (
              <Plate gap={2} onPress={() => router.setTab('activity')} cursor="pointer" testID="accessory-pending">
                <Row gap="$2" alignItems="center">
                  <Icon name="clock" size={16} color={paint.arc} />
                  <Body size="caption">{t({ id: 'home.acc.pending', message: '{n} transaction pending', values: { n: pendingTx } })}</Body>
                </Row>
              </Plate>
            ) : positions?.accessory ? (
              <Plate gap={2} onPress={() => (positions.accessory?.target === 'legends' ? router.navigate('legends') : positions.accessory?.target.startsWith('farm:') ? router.navigate('farm', { chainId: ETN, farmId: Number(positions.accessory.target.slice(5)) }) : router.navigate('campaign', { chainId: ETN, pool: positions.accessory?.target.slice(9) ?? '' }))} cursor="pointer" testID="accessory-positions">
                <Row gap="$2" alignItems="center">
                  <Icon name={positions.accessory.kind === 'dividends' ? 'star' : positions.accessory.kind === 'collect' ? 'farm' : 'bolt'} size={16} color={paint.ember} />
                  <Body size="caption">{positions.accessory.text}</Body>
                </Row>
              </Plate>
            ) : unlimited > 0 ? (
              <Plate gap={2} onPress={() => router.navigate('allowances')} cursor="pointer" testID="accessory-approvals">
                <Row gap="$2" alignItems="center">
                  <Icon name="approvals" size={16} color={paint.burn} />
                  <Body size="caption">{t({ id: 'home.acc.unlimited', message: '{n} unlimited approvals', values: { n: unlimited } })}</Body>
                </Row>
              </Plate>
            ) : null}

            <Row gap="$3" justifyContent="space-between" testID="keys">
              <ActionKey icon="send" label={t({ id: 'key.send', message: 'Send' })} onPress={() => router.navigate('send')} />
              <ActionKey icon="receive" label={t({ id: 'key.receive', message: 'Receive' })} onPress={() => router.navigate('receive')} />
              <ActionKey icon="swap" label={t({ id: 'key.swap', message: 'Swap' })} onPress={() => router.setTab('swap')} />
              <ActionKey icon="bridge" label={t({ id: 'key.bridge', message: 'Bridge' })} onPress={() => router.navigate('bridge', scope !== 'all' && scope !== ETN ? { chainId: scope } : undefined)} />
            </Row>
          </>
        ) : null}
      </ScrollView>
    </Column>
  )
}

function ActionKey({ icon, label, onPress }: { icon: 'send' | 'receive' | 'swap' | 'bridge'; label: string; onPress: () => void }) {
  return <Key label={label} kind="secondary" stacked onPress={onPress} icon={<Icon name={icon} size={20} color={paint.ink} />} testID={`key-${icon}`} />
}
