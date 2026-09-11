/**
 * Portfolio (plan B3, owner item H3): what Home used to be, minus the verbs —
 * the hero readout on the Grid, Tokens as cards, Collectibles as the Rack,
 * Positions, and "since you last looked". Reached from the Home console; the
 * dock stays underneath.
 */
import { Body, BusBar, Column, Icon, LiveFilament, Pill, Plate, Row, RollingReadout, ScrollView, Segmented, SharedElement, metrics, paint } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { AddTokenSheet } from '../components/AddTokenSheet'
import { ChainScopeSheet, ScopePill, useHomeScope } from '../components/ChainScope'
import { DividendsCard } from '../components/DividendsCard'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { formatChange, formatFiat, formatQuantity, formatRaw } from '../format'
import { useChainHead } from '../hooks/useChainHead'
import { usePortfolio } from '../hooks/usePortfolio'
import { usePositions } from '../hooks/usePositions'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { tokenSharedId } from '../navigation/transitions'
import { useReducedMotion } from '../state/useReducedMotion'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'
import { FarmCard } from '../components/cards/FarmCard'
import { Rack } from './Rack'

const ETN = 52014
type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'
type Segment = 'tokens' | 'collectibles' | 'positions'

export function Portfolio({ body }: { body: BodyKind }) {
  const router = useRouter()
  const engine = useEngine()
  const reducedMotion = useReducedMotion()
  const { vault, active } = useWalletState()
  const head = useChainHead(ETN)
  const scope = useHomeScope()
  const [scopeOpen, setScopeOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const accountId = active?.id ?? null
  const portfolio = usePortfolio(accountId, 5_000, scope.loaded ? scope.chainIds : null)
  const { positions } = usePositions(accountId, !!vault?.unlocked)
  const [segment, setSegment] = useState<Segment>('tokens')
  // Collecting is offered wherever a position is shown, so the card reads the
  // same on Portfolio as it does on Home > Farms (owner: "rendered
  // consistently across the portfolio farm positions and the home -> farm list").
  const { setActive: setFlow } = useSwapFlow()
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
  const [sinceLook, setSinceLook] = useState<{ at: number; total: number | null } | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  // "Since you last looked" (§7.13), once per open.
  useEffect(() => {
    if (!accountId || !vault?.unlocked) return
    let alive = true
    engine.portfolio.lastLook({ accountId }).then((r) => {
      if (alive && r.previous && Date.now() - r.previous.at > 60 * 60_000) setSinceLook(r.previous)
    }, () => undefined)
    return () => {
      alive = false
    }
  }, [engine, accountId, vault?.unlocked])

  const snapshot = portfolio.snapshot
  const currency = snapshot?.currency ?? 'USD'
  const total = snapshot?.total ?? null
  const totalText = total === null ? '—' : formatFiat(total, currency)
  const change = formatChange(snapshot?.change24h ?? null)
  const rows = (snapshot?.rows ?? []).filter((r) => !r.hidden)
  const hidden = (snapshot?.rows ?? []).length - rows.length
  const hasPositions = !!positions && (positions.farms.length > 0 || (positions.legends !== null && positions.legends.ownedTokenIds.length > 0) || positions.orders.length > 0 || positions.campaigns.length > 0)

  return (
    <Column flex={1} testID="portfolio">
      <ScrollView contentContainerStyle={{ padding: inset, gap: 16 }}>
        <PageHeader title={t({ id: 'portfolio.title', message: 'Portfolio' })} />
        <Column gap="$2">
          <Row>
            <ScopePill scope={scope.scope} label={scope.label} onPress={() => setScopeOpen(true)} testID="home-scope" />
          </Row>
          <RollingReadout value={totalText} hero reducedMotion={reducedMotion} testID="total" />
          <Row gap="$3" flexWrap="wrap">
            {change ? (
              <Body tone={change.startsWith('+') ? 'surge' : change.startsWith('−') ? 'burn' : 'mute'} size="caption">
                {change} {t({ id: 'home.today', message: 'today' })}
              </Body>
            ) : null}
            {snapshot ? (
              <Body tone="mute" size="caption">
                {rows.length === 1 ? t({ id: 'home.tokens.one', message: '1 token' }) : t({ id: 'home.tokens.many', message: '{n} tokens', values: { n: rows.length } })}
              </Body>
            ) : (
              <Body tone="mute" size="caption">
                {t({ id: 'home.scope.none', message: 'No balances yet' })}
              </Body>
            )}
            {snapshot && snapshot.unpricedCount > 0 ? (
              <Body tone="mute" size="caption">
                {t({ id: 'home.unpriced', message: '{n} without price', values: { n: snapshot.unpricedCount } })}
              </Body>
            ) : null}
          </Row>
          <LiveFilament tick={head?.blockNumber ?? null} live={head?.live ?? false} reducedMotion={reducedMotion} testID="filament" />
        </Column>

        <Segmented
          options={[
            { id: 'tokens', label: t({ id: 'home.seg.tokens', message: 'Tokens' }) },
            { id: 'collectibles', label: t({ id: 'home.seg.collectibles', message: 'Collectibles' }) },
            { id: 'positions', label: t({ id: 'home.seg.positions', message: 'Positions' }) },
          ]}
          value={segment}
          onChange={(id) => setSegment(id as Segment)}
          testID="home-segments"
        />

        {segment === 'tokens' ? (
          rows.length > 0 ? (
            <Column gap="$2" testID="bus-bars">
              {/* The bus bar is the token dossier's header, seen from further away (§7.7). */}
              {rows.map((r) => (
                <SharedElement key={`${r.chainId}:${r.address}`} id={tokenSharedId(r.chainId, r.address)}>
                  <BusBar
                    variant="card"
                    chainId={r.chainId}
                    address={r.address === 'native' ? '0x0000000000000000000000000000000000000000' : r.address}
                    symbol={r.symbol}
                    amount={formatQuantity(r.quantity)}
                    value={r.fiat === null ? null : formatFiat(r.fiat, currency)}
                    change={formatChange(r.change24h)}
                    share={r.share}
                    logoUri={r.logoUri}
                    chainBadge={scope.chainIds.length > 1}
                    mark={r.custom ? t({ id: 'home.mark.custom', message: 'Custom' }) : null}
                    onPress={() => router.navigate('token', { chainId: r.chainId, address: r.address })}
                  />
                </SharedElement>
              ))}
              <Row justifyContent="space-between" alignItems="center" gap="$2">
                <Body tone="mute" size="caption" testID="portfolio-hidden">
                  {hidden === 0 ? '' : hidden === 1 ? t({ id: 'portfolio.hidden.one', message: '1 hidden token' }) : t({ id: 'portfolio.hidden.many', message: '{n} hidden tokens', values: { n: hidden } })}
                </Body>
                <Pill label={t({ id: 'token.add.pill', message: 'Add token' })} icon={<Icon name="plus" size={14} color={paint.arc} />} tone="arc" size="sm" onPress={() => setAddOpen(true)} testID="portfolio-add-token" />
              </Row>
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
              <Pill label={t({ id: 'token.add.pill', message: 'Add token' })} icon={<Icon name="plus" size={14} color={paint.arc} />} tone="arc" size="sm" onPress={() => setAddOpen(true)} testID="portfolio-add-token" />
            </Plate>
          )
        ) : segment === 'collectibles' ? (
          <Rack body={body} embedded limit={6} />
        ) : hasPositions && positions ? (
          <Column gap="$2" testID="positions">
            {positions.legends && positions.legends.ownedTokenIds.length > 0 ? <DividendsCard status={positions.legends} compact reducedMotion={reducedMotion} onOpen={() => router.navigate('legends')} testID="home-legends" /> : null}
            {positions.farms.map((f) => (
              <FarmCard key={f.id} farm={f} onPress={() => router.navigate('farm', { chainId: ETN, farmId: f.id })} onCollect={active && f.position ? () => void collect(f.id) : undefined} busy={collecting === f.id} />
            ))}
            {positions.orders.map((o) => (
              <Plate key={o.orderId} role="card" gap={2} onPress={() => router.setTab('swap')} cursor="pointer" testID={`position-order-${o.orderId}`}>
                <Body size="caption">{t({ id: 'home.pos.order', message: 'Open order: {a} {s} → at least {b} {u}', values: { a: formatRaw(o.amountInExact, o.decimalsIn), s: o.symbolIn, b: formatRaw(o.amountOutMin, o.decimalsOut), u: o.symbolOut } })}</Body>
              </Plate>
            ))}
            {positions.campaigns.map((c) => (
              <Plate key={c.pool} role="card" gap={2} onPress={() => router.navigate('campaign', { chainId: ETN, pool: c.pool })} cursor="pointer" testID={`position-campaign-${c.pool}`}>
                <Body size="caption">{t({ id: 'home.pos.campaign', message: '{s}: {a} ETN contributed{k}', values: { s: c.token.symbol, a: formatRaw(c.contributedWei, 18), k: c.keys.includes('claim_tokens') ? ' · tokens ready' : c.keys.includes('claim_refund') ? ' · refund waiting' : '' } })}</Body>
              </Plate>
            ))}
          </Column>
        ) : (
          <Plate gap="$2">
            <Body tone="mute">{t({ id: 'home.positions.empty', message: 'No farm positions, open orders or bridges in flight.' })}</Body>
          </Plate>
        )}

        {sinceLook ? (
          <Plate gap={2} testID="since-look">
            <Body tone="mute" size="caption">
              {t({ id: 'home.since', message: 'Since {d}', values: { d: new Date(sinceLook.at).toLocaleDateString() } })}
            </Body>
            <Body size="caption">
              {sinceLook.total !== null && total !== null
                ? t({ id: 'home.since.change', message: '{from} → {to}', values: { from: formatFiat(sinceLook.total, currency), to: totalText } })
                : t({ id: 'home.since.none', message: 'No priced change to report.' })}
            </Body>
          </Plate>
        ) : null}
      </ScrollView>
      <ChainScopeSheet
        open={scopeOpen}
        onClose={() => setScopeOpen(false)}
        scope={scope.scope}
        enabled={scope.enabled}
        chains={scope.chains}
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
      <AddTokenSheet open={addOpen} onClose={() => setAddOpen(false)} initialChainId={scope.scope === 'all' ? ETN : scope.scope} reducedMotion={reducedMotion} />
    </Column>
  )
}
