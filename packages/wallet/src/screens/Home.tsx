/**
 * Home — the switchgear panel (master plan §7.5, §8.2). Seat · readout ·
 * filament · Tokens/Collectibles/Positions · one accessory · four keys.
 * The Field renders behind everything. Locked = redacted; no vault = the
 * funding/creation plate; no portfolio service yet = honest empty state.
 */
import {
  Body,
  BusBar,
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
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useActivity } from '../hooks/useActivity'
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
  const portfolio = usePortfolio(active?.id ?? null)
  const { entries } = useActivity(active?.id ?? null)
  const engine = useEngine()
  const [segment, setSegment] = useState<'tokens' | 'collectibles' | 'positions'>('tokens')
  const [sinceLook, setSinceLook] = useState<{ at: number; total: number | null } | null>(null)
  const [unlimited, setUnlimited] = useState(0)
  const pendingTx = entries.filter((e) => e.status === 'pending').length

  // "Since you last looked" (§7.13) and the approvals fuse count, once per open.
  useEffect(() => {
    if (!active || !vault?.unlocked) return
    let alive = true
    engine.portfolio.lastLook({ accountId: active.id }).then((r) => {
      if (alive && r.previous && Date.now() - r.previous.at > 60 * 60_000) setSinceLook(r.previous)
    }, () => undefined)
    engine.allowances.cached({ accountId: active.id, chainId: ETN }).then((c) => alive && setUnlimited(c.rows.filter((r) => r.amount === 'unlimited' || r.amount === 'all').length), () => undefined)
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
      <Field address={address} pulse={head?.live ? 1 : 0} intensity={body === 'extension-popup' ? 0.75 : 1} quiet={quiet} reducedMotion={reducedMotion} fps={body === 'extension-popup' ? 30 : 60} width={width} height={height} testID="field" />
      <ScrollView style={{ zIndex: 1 }} contentContainerStyle={{ padding: inset, gap: 20 }}>
        <Ignition reducedMotion={reducedMotion} order={0}>
          <Row justifyContent="space-between">
            {active ? (
              <Seat address={active.address} label={active.label} onPress={() => router.navigate('accounts')} testID="seat" />
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
            <Ignition reducedMotion={reducedMotion} order={2}>
              <Column gap="$2">
                <RollingReadout value={totalText} hero reducedMotion={reducedMotion} testID="total" />
                <Row gap="$3">
                  <Body tone="mute" size="caption">
                    {portfolio.snapshot ? t({ id: 'home.scope.etn', message: 'Electroneum' }) : t({ id: 'home.scope.none', message: 'No balances yet' })}
                  </Body>
                  {change ? (
                    <Body tone={change.startsWith('+') ? 'ember' : change.startsWith('−') ? 'burn' : 'mute'} size="caption">
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
                  <Plate gap="$2">
                    <Body tone="mute">{t({ id: 'home.collectibles.empty', message: 'No collectibles yet. Explore collections on Electroneum.' })}</Body>
                  </Plate>
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

            {/* One accessory (§8.2): pending tx > unlimited approvals. */}
            {pendingTx > 0 ? (
              <Plate gap={2} onPress={() => router.setTab('activity')} cursor="pointer" testID="accessory-pending">
                <Row gap="$2" alignItems="center">
                  <Icon name="clock" size={16} color={paint.arc} />
                  <Body size="caption">{t({ id: 'home.acc.pending', message: '{n} transaction pending', values: { n: pendingTx } })}</Body>
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
              <ActionKey icon="bridge" label={t({ id: 'key.bridge', message: 'Bridge' })} onPress={() => router.navigate('explore')} />
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
