/**
 * Bridge (master plan §8.7; plan C4, owner item B1): one console with two
 * wells — From and To — each led by a chain pill with the chain's mark that
 * opens a sheet of chains (a chain that is turned off says so and offers
 * Networks); the From well holds the balance, the amount and Max; the To
 * well what arrives and when. A lit flip on the seam swaps direction; the
 * cable takes its place while a transfer is in flight. Assets are pills
 * with the token's mark. Only corridors the engine verified on chain are
 * offered; arriving on Electroneum offers "Get ETN".
 */
import { Body, Cable, ChainMark, Chip, Column, Icon, Input, Key, Pill, Plate, Pressable, Rim, Row, ScrollView, Sheet, TokenAvatar, metrics, paint, shortAddress } from '@boltvault/ui'
import type { BridgeQuote, BridgeRoute, BridgeStatus, ChainView } from '@boltvault/engine'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { PageHeader } from '../components/PageHeader'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { swapFlowStore, useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014
type Origin = { chainId: number; enabled: boolean; symbols: Array<'USDC' | 'USDT'> }

export interface BridgeProps {
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly reducedMotion?: boolean
  readonly chainId?: number
  readonly token?: string
}

function shortHash(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-4)}`
}

/** "Avalanche C-Chain" → "Avalanche", "BNB Smart Chain" → "BNB": the pills are narrow. */
function shortName(name: string): string {
  return name.replace(/ C-Chain$/, '').replace(/ Smart Chain$/, '').replace(/ One$/, '')
}

function ChainSelect({ chainId, label, onPress, testID }: { chainId: number | null; label: string; onPress: () => void; testID: string }) {
  return (
    <Column marginVertical={-6}>
      <Pill label={label} icon={chainId !== null ? <ChainMark chainId={chainId} size={16} /> : undefined} chevron tone="ink" onPress={onPress} testID={testID} />
    </Column>
  )
}

export function Bridge({ body, reducedMotion = false, chainId: initialChain, token: initialToken }: BridgeProps) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['bridge'])
  const [chains, setChains] = useState<ChainView[]>([])
  const [origins, setOrigins] = useState<Origin[]>([])
  const [fromChain, setFromChain] = useState(initialChain ?? ETN)
  const [preferredTo, setPreferredTo] = useState<number | null>(null)
  const [routes, setRoutes] = useState<BridgeRoute[]>([])
  const [symbol, setSymbol] = useState<'USDC' | 'USDT' | null>(null)
  const [toChain, setToChain] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [editingRecipient, setEditingRecipient] = useState(false)
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [transfers, setTransfers] = useState<BridgeStatus[]>([])
  const [sheet, setSheet] = useState<'from' | 'to' | 'asset' | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const wide = body === 'extension-tab'

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
    engine.bridge.origins().then(setOrigins, () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'settings.changed') engine.bridge.origins().then(setOrigins, () => undefined)
    })
  }, [engine])

  // Corridors from the origin chain, verified by the engine; the asset from the token we came from.
  useEffect(() => {
    let alive = true
    setRoutes([])
    engine.bridge.routes({ fromChainId: fromChain }).then((rs) => {
      if (!alive) return
      setRoutes(rs)
      const fromToken = initialToken ? rs.find((r) => r.token.toLowerCase() === initialToken.toLowerCase())?.symbol : undefined
      setSymbol((s) => fromToken ?? (s && rs.some((r) => r.symbol === s) ? s : (rs[0]?.symbol ?? null)))
    }, () => undefined)
    return () => {
      alive = false
    }
  }, [engine, fromChain, initialToken])

  const symbols = useMemo(() => [...new Set(routes.map((r) => r.symbol))], [routes])
  const destinations = useMemo(() => routes.filter((r) => r.symbol === symbol), [routes, symbol])
  useEffect(() => {
    setToChain((c) => {
      if (preferredTo !== null && destinations.some((d) => d.toChainId === preferredTo)) return preferredTo
      return c && destinations.some((d) => d.toChainId === c) ? c : (destinations[0]?.toChainId ?? null)
    })
  }, [destinations, preferredTo])
  const route = destinations.find((d) => d.toChainId === toChain) ?? null

  const load = useCallback((): void => {
    if (!active) return
    engine.bridge.list({ accountId: active.id }).then(setTransfers, () => undefined)
  }, [engine, active])
  useEffect(load, [load])
  const onChanged = useCallback((e: { transfers: BridgeStatus[] }) => setTransfers(e.transfers.filter((x) => x.accountId === active?.id).sort((a, b) => b.startedAt - a.startedAt)), [active])
  useEngineEvent('bridge.changed', onChanged)

  useEffect(() => {
    if (!active || !route) {
      setQuote(null)
      return
    }
    let alive = true
    const timer = setTimeout(() => {
      engine.bridge.quote({ accountId: active.id, fromChainId: route.fromChainId, toChainId: route.toChainId, token: route.token, amount: amount || '0', ...(recipient.trim() ? { recipient: recipient.trim() } : {}) }).then(
        (q) => alive && setQuote(q),
        (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
      )
    }, 250)
    return () => {
      alive = false
      clearTimeout(timer)
    }
  }, [engine, active, route, amount, recipient])

  const chainName = (id: number): string => shortName(chains.find((c) => c.chainId === id)?.name ?? `Chain ${id}`)
  const flip = (): void => {
    if (toChain === null) return
    const back = toChain
    setPreferredTo(fromChain)
    setFromChain(back)
    setQuote(null)
  }

  const submit = async (): Promise<void> => {
    if (!active || !route || !quote?.ok) return
    setBusy(true)
    setError(null)
    try {
      const r = await engine.bridge.execute({ accountId: active.id, fromChainId: route.fromChainId, toChainId: route.toChainId, token: route.token, amount, ...(recipient.trim() ? { recipient: recipient.trim() } : {}) })
      const f = await engine.swap.flow({ flowId: r.flowId })
      if (f) swapFlowStore.upsert(f)
      setActive(r.flowId)
      setAmount('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (!active) return null

  if (flow) {
    return (
      <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="bridge">
        <FlowPlate flow={flow} titles={{ working: t({ id: 'bridge.flow.working', message: 'Bridging' }), done: t({ id: 'bridge.flow.done', message: 'Bridged' }) }} summary={route ? t({ id: 'bridge.flow.summary', message: '{symbol} from {from} to {to}', values: { symbol: route.symbol, from: chainName(route.fromChainId), to: chainName(route.toChainId) } }) : null} onDone={dismiss} body={body} reducedMotion={reducedMotion} testID="bridge-flow" />
      </ScrollView>
    )
  }

  const inFlight = transfers.filter((x) => x.state === 'pending' || x.state === 'dispatched')
  const landed = transfers.filter((x) => x.state === 'delivered' || x.state === 'failed' || x.state === 'timeout').slice(0, 5)
  const feeSymbol = quote?.feeSymbol ?? chains.find((c) => c.chainId === fromChain)?.symbol ?? 'ETN'
  const problem = quote && !quote.ok && amount.trim() ? (quote.problems[0] ?? null) : null
  const receiveText = quote && quote.ok && amount.trim() ? `≈ ${formatRaw(quote.amountRaw, quote.decimals)} ${quote.symbol}` : '—'
  const fromOptions = origins.filter((o) => !symbol || o.symbols.includes(symbol) || o.chainId === fromChain)
  const toOptions = origins.filter((o) => o.chainId !== fromChain && (!symbol || o.symbols.includes(symbol)))

  const chainRow = (o: Origin, selected: boolean, onPick: () => void, kind: 'from' | 'to'): React.ReactNode => {
    const reachable = kind === 'from' ? true : destinations.some((d) => d.toChainId === o.chainId)
    const off = !o.enabled || !reachable
    return (
      <Pressable key={o.chainId} onPress={off ? undefined : onPick} accessibilityRole="button" accessibilityState={{ selected, disabled: off }} accessibilityLabel={chainName(o.chainId)} style={{ minHeight: 52, justifyContent: 'center', opacity: off ? 0.6 : 1 }} testID={`bridge-${kind}-${o.chainId}`}>
        <Row gap="$3" alignItems="center">
          <ChainMark chainId={o.chainId} size={24} />
          <Column flex={1} alignItems="flex-start">
            <Body fontWeight={selected ? '600' : '400'}>{chainName(o.chainId)}</Body>
            <Body tone="mute" size="caption">
              {!o.enabled ? t({ id: 'bridge.chain.off', message: 'Turned off in Settings › Networks' }) : !reachable ? t({ id: 'bridge.chain.nocorridor', message: 'No {s} corridor from {c}', values: { s: symbol ?? 'USDC', c: chainName(fromChain) } }) : o.symbols.join(' · ')}
            </Body>
          </Column>
          {!o.enabled ? <Pill label={t({ id: 'bridge.chain.networks', message: 'Networks' })} size="sm" onPress={() => { setSheet(null); router.navigate('networks') }} testID={`bridge-networks-${o.chainId}`} /> : selected ? <Icon name="check" size={18} color={paint.arc} /> : null}
        </Row>
      </Pressable>
    )
  }

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ paddingHorizontal: inset, paddingTop: inset, paddingBottom: 12, gap: 10, ...(wide ? { maxWidth: 560, width: '100%', alignSelf: 'center' } : {}) }} testID="bridge">
        <PageHeader title={t({ id: 'bridge.title', message: 'Bridge' })} />

        {/* The console: From and To wells, the flip (or the cable, in flight) on the seam. */}
        <Plate role="console" gap="$2" padding={12} testID="bridge-console">
          <Plate role="well" gap={4} paddingVertical={8} paddingHorizontal={12} testID="bridge-from">
            <Row justifyContent="space-between" alignItems="center">
              <Body tone="mute" size="caption">
                {t({ id: 'bridge.from', message: 'From' })}
              </Body>
              <ChainSelect chainId={fromChain} label={chainName(fromChain)} onPress={() => setSheet('from')} testID="bridge-from-select" />
            </Row>
            <Row gap="$2" alignItems="center">
              <Column flex={1}>
                <Input value={amount} onChange={setAmount} placeholder="0" bare big testID="bridge-amount-input" />
              </Column>
              {route ? <Pill label={route.symbol} icon={<TokenAvatar chainId={fromChain} address={route.token} logoUri={null} size={18} />} chevron={symbols.length > 1} tone="ink" size="md" onPress={symbols.length > 1 ? () => setSheet('asset') : undefined} testID="bridge-asset-select" /> : null}
            </Row>
            <Row justifyContent="space-between" alignItems="center" minHeight={20}>
              <Body tone="mute" size="caption" testID="bridge-balance">
                {quote ? t({ id: 'bridge.balance', message: 'Balance {b} {s}', values: { b: formatRaw(quote.balanceRaw, quote.decimals), s: quote.symbol } }) : ''}
              </Body>
              {quote ? (
                <Pressable onPress={() => setAmount(formatRaw(quote.balanceRaw, quote.decimals).replace(/,/g, ''))} accessibilityRole="button" accessibilityLabel={t({ id: 'max', message: 'Max' })} style={{ minHeight: 44, minWidth: 44, marginVertical: -10, justifyContent: 'center', alignItems: 'flex-end' }} testID="bridge-max">
                  <Body tone="arc" size="caption" fontWeight="600">
                    {t({ id: 'max', message: 'Max' })}
                  </Body>
                </Pressable>
              ) : null}
            </Row>
          </Plate>

          <Row justifyContent="center" marginVertical={-18} zIndex={2}>
            <Pressable onPress={flip} accessibilityRole="button" accessibilityLabel={t({ id: 'bridge.flip', message: 'Swap direction' })} style={{ width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }} testID="bridge-flip">
              <Chip width={36} height={36} borderRadius={18} padding={0} justifyContent="center" alignItems="center" backgroundColor="$glassRaisedSolid" borderWidth={0} overflow="hidden">
                <Icon name="swap" color={paint.arc} size={18} />
                <Rim radius={18} opacity={0.85} />
              </Chip>
            </Pressable>
          </Row>

          <Plate role="well" gap={4} paddingVertical={8} paddingHorizontal={12} testID="bridge-to">
            <Row justifyContent="space-between" alignItems="center">
              <Body tone="mute" size="caption">
                {t({ id: 'bridge.to', message: 'To' })}
              </Body>
              <ChainSelect chainId={toChain} label={toChain !== null ? chainName(toChain) : t({ id: 'bridge.pick', message: 'Pick a chain' })} onPress={() => setSheet('to')} testID="bridge-to-select" />
            </Row>
            <Row justifyContent="space-between" alignItems="center" minHeight={32} gap="$2">
              <Body size="title" numberOfLines={1} flexShrink={1} testID="bridge-receive">
                {receiveText}
              </Body>
              <Body tone="mute" size="caption" numberOfLines={1}>
                {quote ? t({ id: 'bridge.eta.short', message: 'About {m} min via Hyperlane', values: { m: quote.etaMinutes } }) : ''}
              </Body>
            </Row>
          </Plate>
        </Plate>

        {routes.length === 0 ? (
          <Plate gap="$2" testID="bridge-none">
            <Body tone="mute">{t({ id: 'bridge.none', message: 'No Hyperlane corridor starts on this chain. USDC moves between Electroneum, Ethereum, Base and Avalanche; USDT between Electroneum and Ethereum.' })}</Body>
          </Plate>
        ) : null}
        {route && !route.verified ? (
          <Plate gap="$2" testID="bridge-off">
            <Row gap="$2" alignItems="center">
              <Icon name="warn" size={16} color={paint.burn} />
              <Body size="caption">{t({ id: 'bridge.off', message: 'This corridor is switched off: {reason}.', values: { reason: route.reason ?? 'verification failed' } })}</Body>
            </Row>
          </Plate>
        ) : null}

        <Plate role="recessed" gap={2} paddingVertical={6} paddingHorizontal="$3" testID="bridge-recipient">
          <Row justifyContent="space-between" alignItems="center" minHeight={22}>
            <Body tone="mute" size="caption">
              {t({ id: 'bridge.recipient', message: 'Arrives at' })}
            </Body>
            {!editingRecipient ? <Pill label={t({ id: 'bridge.recipient.other', message: 'Someone else' })} size="sm" onPress={() => setEditingRecipient(true)} testID="bridge-recipient-edit" /> : null}
          </Row>
          {editingRecipient ? <Input value={recipient} onChange={setRecipient} mono placeholder="0x…" autoFocus testID="bridge-recipient-input" /> : <Body size="caption" fontFamily="$mono">{active.label ? `${active.label} · ${shortAddress(active.address)}` : shortAddress(active.address)}</Body>}
          {quote?.recipientCode.origin ? (
            <Body tone={quote.recipientCode.destination === false ? 'burn' : 'mute'} size="caption">
              {quote.recipientCode.destination === false ? t({ id: 'bridge.recipient.nocode', message: 'A contract here, nothing on the destination — the tokens would be stuck.' }) : t({ id: 'bridge.recipient.contract', message: 'This address is a contract on both chains.' })}
            </Body>
          ) : null}
          <Column height={1} backgroundColor="rgba(95,216,255,0.10)" marginVertical={2} />
          <Row justifyContent="space-between" minHeight={22} alignItems="center">
            <Body tone="mute" size="caption">
              {t({ id: 'bridge.fee.gas', message: 'Interchain gas' })}
            </Body>
            <Body size="caption" testID="bridge-fee-gas">
              {quote ? `${formatRaw(quote.gasQuoteWei, 18)} ${feeSymbol}` : '—'}
            </Body>
          </Row>
          <Row justifyContent="space-between" minHeight={22} alignItems="center">
            <Body tone="mute" size="caption">
              {t({ id: 'bridge.fee.tx', message: 'Network fee' })}
            </Body>
            <Body size="caption">{quote ? `≈ ${formatRaw(quote.txFeeWei, 18)} ${feeSymbol}` : '—'}</Body>
          </Row>
          {quote?.steps.includes('approve') ? (
            <Body tone="mute" size="caption">
              {t({ id: 'bridge.approve', message: 'Two signatures: allow the Hyperlane router to take the tokens, then bridge.' })}
            </Body>
          ) : null}
        </Plate>

        {problem ? (
          <Body tone="burn" size="caption" testID="bridge-problem">
            {problem}
          </Body>
        ) : null}
        {error ? (
          <Body tone="burn" size="caption" testID="bridge-error">
            {error}
          </Body>
        ) : null}
        <Key label={t({ id: 'key.bridge', message: 'Bridge' })} disabled={busy || !quote?.ok || active.kind === 'watch'} onPress={() => void submit()} testID="bridge-key" />
        {active.kind === 'watch' ? (
          <Body tone="mute" size="caption">
            {t({ id: 'watch.only', message: 'Watch-only — import a key or pair a device.' })}
          </Body>
        ) : null}

        {inFlight.length > 0 ? (
          <Column gap="$2" testID="bridge-inflight">
            <Body tone="mute" size="caption">
              {t({ id: 'bridge.inflight', message: 'In flight' })}
            </Body>
            {inFlight.map((x) => (
              <TransferCard key={x.id} x={x} chainName={chainName} reducedMotion={reducedMotion} />
            ))}
          </Column>
        ) : null}
        {landed.length > 0 ? (
          <Column gap="$2" testID="bridge-landed">
            <Body tone="mute" size="caption">
              {t({ id: 'bridge.landed', message: 'Recent' })}
            </Body>
            {landed.map((x) => (
              <TransferCard key={x.id} x={x} chainName={chainName} reducedMotion={reducedMotion} onGetEtn={x.state === 'delivered' && x.toChainId === ETN ? () => router.navigate('receive') : undefined} />
            ))}
          </Column>
        ) : null}
      </ScrollView>

      <Sheet open={sheet === 'from'} onClose={() => setSheet(null)} title={t({ id: 'bridge.from.title', message: 'From' })} reducedMotion={reducedMotion} testID="bridge-from-sheet">
        <Column gap={2}>
          {fromOptions.map((o) =>
            chainRow(
              o,
              o.chainId === fromChain,
              () => {
                setFromChain(o.chainId)
                setPreferredTo(null)
                setSheet(null)
              },
              'from',
            ),
          )}
        </Column>
      </Sheet>
      <Sheet open={sheet === 'to'} onClose={() => setSheet(null)} title={t({ id: 'bridge.to.title', message: 'To' })} reducedMotion={reducedMotion} testID="bridge-to-sheet">
        <Column gap={2}>
          {toOptions.map((o) =>
            chainRow(
              o,
              o.chainId === toChain,
              () => {
                setPreferredTo(o.chainId)
                setToChain(o.chainId)
                setSheet(null)
              },
              'to',
            ),
          )}
        </Column>
      </Sheet>
      <Sheet open={sheet === 'asset'} onClose={() => setSheet(null)} title={t({ id: 'bridge.asset.title', message: 'Asset' })} reducedMotion={reducedMotion} testID="bridge-asset-sheet">
        <Column gap={2}>
          {symbols.map((sym) => {
            const r = routes.find((x) => x.symbol === sym)
            const selected = symbol === sym
            return (
              <Pressable key={sym} onPress={() => { setSymbol(sym); setSheet(null) }} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={sym} style={{ minHeight: 52, justifyContent: 'center' }} testID={`bridge-asset-${sym}`}>
                <Row gap="$3" alignItems="center">
                  {r ? <TokenAvatar chainId={fromChain} address={r.token} logoUri={null} size={24} /> : null}
                  <Column flex={1} alignItems="flex-start">
                    <Body fontWeight={selected ? '600' : '400'}>{sym}</Body>
                    <Body tone="mute" size="caption">
                      {t({ id: 'bridge.asset.hyperlane', message: 'Hyperlane {s} — the same asset on both chains', values: { s: sym } })}
                    </Body>
                  </Column>
                  {selected ? <Icon name="check" size={18} color={paint.arc} /> : null}
                </Row>
              </Pressable>
            )
          })}
        </Column>
      </Sheet>
    </Column>
  )
}

function TransferCard({ x, chainName, reducedMotion, onGetEtn }: { x: BridgeStatus; chainName: (id: number) => string; reducedMotion: boolean; onGetEtn?: () => void }) {
  const inFlight = x.state === 'pending' || x.state === 'dispatched'
  return (
    <Plate role="card" gap={4} testID={`bridge-transfer-${x.id}`}>
      <Row justifyContent="space-between" alignItems="center" gap="$2">
        <Row gap="$2" alignItems="center" flexShrink={1}>
          <ChainMark chainId={x.fromChainId} size={18} />
          <Icon name="chevronRight" size={12} color={paint.mute} />
          <ChainMark chainId={x.toChainId} size={18} />
          <Body numberOfLines={1} flexShrink={1}>
            {t({ id: 'bridge.transfer.short', message: '{a} {s}', values: { a: formatRaw(x.amountRaw, x.decimals), s: x.symbol } })}
          </Body>
        </Row>
        {inFlight ? (
          <Cable state={x.state} width={56} reducedMotion={reducedMotion} />
        ) : (
          <Body tone={x.state === 'delivered' ? 'surge' : 'burn'} size="caption">
            {x.state === 'delivered' ? t({ id: 'bridge.state.delivered', message: 'Delivered' }) : x.state === 'failed' ? t({ id: 'bridge.state.failed', message: 'Failed' }) : t({ id: 'bridge.state.timeout', message: 'Taking longer than 30 minutes' })}
          </Body>
        )}
      </Row>
      <Body tone="mute" size="caption" numberOfLines={1}>
        {inFlight ? (x.state === 'pending' ? t({ id: 'bridge.state.pending', message: 'Waiting for the origin block' }) : t({ id: 'bridge.state.dispatched', message: 'Dispatched — watching the destination for delivery' })) : `${chainName(x.fromChainId)} → ${chainName(x.toChainId)}`}
        {' · '}
        {shortHash(x.originHash)}
        {x.destinationHash ? ` → ${shortHash(x.destinationHash)}` : ''}
      </Body>
      {x.state === 'timeout' && x.messageId ? (
        <Body tone="mute" size="caption">
          {t({ id: 'bridge.explorer', message: 'Look it up on explorer.hyperlane.xyz with message {id}', values: { id: shortHash(x.messageId) } })}
        </Body>
      ) : null}
      {onGetEtn ? <Key label={t({ id: 'bridge.getEtn', message: 'Get ETN for fees' })} kind="secondary" size="compact" onPress={onGetEtn} testID="bridge-get-etn" /> : null}
    </Plate>
  )
}
