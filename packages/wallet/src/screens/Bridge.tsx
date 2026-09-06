/**
 * Bridge (master plan §8.7): two chain plates joined by a cable, the asset,
 * the amount, a destination that defaults to you, the interchain gas beside
 * the network fee, an honest ETA, and the verb Bridge. Only corridors the
 * engine verified on chain are offered; in flight, the pulse travels the
 * cable and lands on delivery; arriving on Electroneum offers "Get ETN".
 */
import { Body, Cable, Chip, Column, Icon, Input, Key, Plate, Row, ScrollView, metrics, paint, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { BridgeQuote, BridgeRoute, BridgeStatus, ChainView, Settings } from '@boltvault/engine'
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { swapFlowStore, useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'

const ETN = 52014

export interface BridgeProps {
  readonly body: 'extension-popup' | 'extension-tab' | 'mobile'
  readonly reducedMotion?: boolean
  readonly chainId?: number
  readonly token?: string
}

function shortHash(h: string): string {
  return `${h.slice(0, 8)}…${h.slice(-4)}`
}

function Plates({ stacked, children }: { stacked: boolean; children: ReactNode }) {
  return stacked ? (
    <Column gap="$2" testID="bridge-plates">
      {children}
    </Column>
  ) : (
    <Row gap="$2" alignItems="stretch" testID="bridge-plates">
      {children}
    </Row>
  )
}

/** "Avalanche C-Chain" → "Avalanche", "BNB Smart Chain" → "BNB": the plates are narrow. */
function shortName(name: string): string {
  return name.replace(/ C-Chain$/, '').replace(/ Smart Chain$/, '').replace(/ One$/, '')
}

export function Bridge({ body, reducedMotion = false, chainId: initialChain, token: initialToken }: BridgeProps) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['bridge'])
  const [chains, setChains] = useState<ChainView[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [fromChain, setFromChain] = useState(initialChain ?? ETN)
  const [routes, setRoutes] = useState<BridgeRoute[]>([])
  const [symbol, setSymbol] = useState<'USDC' | 'USDT' | null>(null)
  const [toChain, setToChain] = useState<number | null>(null)
  const [amount, setAmount] = useState('')
  const [recipient, setRecipient] = useState('')
  const [editingRecipient, setEditingRecipient] = useState(false)
  const [quote, setQuote] = useState<BridgeQuote | null>(null)
  const [transfers, setTransfers] = useState<BridgeStatus[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
    engine.settings.get().then(setSettings, () => undefined)
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
    setToChain((c) => (c && destinations.some((d) => d.toChainId === c) ? c : (destinations[0]?.toChainId ?? null)))
  }, [destinations])
  const route = destinations.find((d) => d.toChainId === toChain) ?? null

  // Transfers in flight and landed, kept fresh by the engine's watcher.
  const load = useCallback((): void => {
    if (!active) return
    engine.bridge.list({ accountId: active.id }).then(setTransfers, () => undefined)
  }, [engine, active])
  useEffect(load, [load])
  const onChanged = useCallback((e: { transfers: BridgeStatus[] }) => setTransfers(e.transfers.filter((x) => x.accountId === active?.id).sort((a, b) => b.startedAt - a.startedAt)), [active])
  useEngineEvent('bridge.changed', onChanged)

  // The quote: re-asked on every input change, so the fee line is never stale.
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
  const stacked = body !== 'extension-tab'
  const titleSize = 'title'
  const origins = useMemo(() => {
    const enabled = new Set([ETN, ...(settings?.enabledChains ?? [])])
    return [ETN, 1, 8453, 43114].filter((id) => enabled.has(id))
  }, [settings])

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

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="bridge">
      <PageHeader title={t({ id: 'bridge.title', message: 'Bridge' })} />

      {/* Two chain plates joined by the cable: side by side with room (tab), stacked with the cable between them elsewhere. */}
      <Plates stacked={stacked}>
        <Plate role="raised" gap={2} flex={stacked ? undefined : 1} testID="bridge-from">
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.from', message: 'From' })}
          </Body>
          <Body size={titleSize}>{chainName(fromChain)}</Body>
          <Row gap="$1" flexWrap="wrap">
            {origins
              .filter((id) => id !== fromChain)
              .map((id) => (
                <Chip key={id} onPress={() => setFromChain(id)} cursor="pointer" minHeight={32} justifyContent="center" testID={`bridge-from-${id}`}>
                  <Body tone="mute" size="caption">
                    {chainName(id)}
                  </Body>
                </Chip>
              ))}
          </Row>
        </Plate>
        <Column justifyContent="center" alignItems="center">
          <Cable state={inFlight.length ? (inFlight[0]?.state ?? 'idle') : 'idle'} width={stacked ? 140 : 96} reducedMotion={reducedMotion} testID="bridge-cable" />
        </Column>
        <Plate role="raised" gap={2} flex={stacked ? undefined : 1} testID="bridge-to">
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.to', message: 'To' })}
          </Body>
          <Body size={titleSize}>{toChain ? chainName(toChain) : '—'}</Body>
          <Row gap="$1" flexWrap="wrap">
            {destinations
              .filter((d) => d.toChainId !== toChain)
              .map((d) => (
                <Chip key={d.toChainId} onPress={() => setToChain(d.toChainId)} cursor="pointer" minHeight={32} justifyContent="center" testID={`bridge-to-${d.toChainId}`}>
                  <Body tone="mute" size="caption">
                    {chainName(d.toChainId)}
                  </Body>
                </Chip>
              ))}
          </Row>
        </Plate>
      </Plates>

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

      <Plate gap="$2" testID="bridge-asset">
        <Row gap="$2" justifyContent="space-between" alignItems="center">
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.asset', message: 'Asset' })}
          </Body>
          <Row gap="$1">
            {symbols.map((s) => (
              <Chip key={s} onPress={() => setSymbol(s)} cursor="pointer" minHeight={32} justifyContent="center" borderColor={symbol === s ? paint.arc : undefined} testID={`bridge-asset-${s}`}>
                <Body tone={symbol === s ? 'arc' : 'mute'} size="caption">
                  {t({ id: 'bridge.asset.name', message: 'Hyperlane {s}', values: { s } })}
                </Body>
              </Chip>
            ))}
          </Row>
        </Row>
        <Input value={amount} onChange={setAmount} placeholder="0" error={problem} testID="bridge-amount-input" />
        {quote ? (
          <Row justifyContent="space-between">
            <Body tone="mute" size="caption">
              {t({ id: 'bridge.balance', message: 'Balance {b} {s}', values: { b: formatRaw(quote.balanceRaw, quote.decimals), s: quote.symbol } })}
            </Body>
            <Chip onPress={() => setAmount(formatRaw(quote.balanceRaw, quote.decimals).replace(/,/g, ''))} cursor="pointer" minHeight={28} justifyContent="center" testID="bridge-max">
              <Body tone="arc" size="caption">
                {t({ id: 'max', message: 'Max' })}
              </Body>
            </Chip>
          </Row>
        ) : null}
      </Plate>

      <Plate gap="$2" testID="bridge-recipient">
        <Row justifyContent="space-between" alignItems="center">
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.recipient', message: 'Arrives at' })}
          </Body>
          {!editingRecipient ? (
            <Chip onPress={() => setEditingRecipient(true)} cursor="pointer" minHeight={28} justifyContent="center" testID="bridge-recipient-edit">
              <Body tone="mute" size="caption">
                {t({ id: 'bridge.recipient.other', message: 'Someone else' })}
              </Body>
            </Chip>
          ) : null}
        </Row>
        {editingRecipient ? <Input value={recipient} onChange={setRecipient} mono placeholder="0x…" autoFocus testID="bridge-recipient-input" /> : <Body fontFamily="$mono">{active.label ? `${active.label} · ${shortAddress(active.address)}` : shortAddress(active.address)}</Body>}
        {quote?.recipientCode.origin ? (
          <Body tone={quote.recipientCode.destination === false ? 'burn' : 'mute'} size="caption">
            {quote.recipientCode.destination === false ? t({ id: 'bridge.recipient.nocode', message: 'A contract here, nothing on the destination — the tokens would be stuck.' }) : t({ id: 'bridge.recipient.contract', message: 'This address is a contract on both chains.' })}
          </Body>
        ) : null}
      </Plate>

      <Plate gap={2} testID="bridge-fees">
        <Row justifyContent="space-between">
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.fee.gas', message: 'Interchain gas' })}
          </Body>
          <Body size="caption" testID="bridge-fee-gas">
            {quote ? `${formatRaw(quote.gasQuoteWei, 18)} ${feeSymbol}` : '—'}
          </Body>
        </Row>
        <Row justifyContent="space-between">
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.fee.tx', message: 'Network fee' })}
          </Body>
          <Body size="caption">{quote ? `≈ ${formatRaw(quote.txFeeWei, 18)} ${feeSymbol}` : '—'}</Body>
        </Row>
        <Row justifyContent="space-between">
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.eta', message: 'Usually lands in' })}
          </Body>
          <Body size="caption">{quote ? t({ id: 'bridge.eta.min', message: 'about {m} minutes', values: { m: quote.etaMinutes } }) : '—'}</Body>
        </Row>
        {quote?.steps.includes('approve') ? (
          <Body tone="mute" size="caption">
            {t({ id: 'bridge.approve', message: 'Two signatures: allow the Hyperlane router to take the tokens, then bridge.' })}
          </Body>
        ) : null}
      </Plate>

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
          <Body size="title">{t({ id: 'bridge.inflight', message: 'In flight' })}</Body>
          {inFlight.map((x) => (
            <Plate key={x.id} gap={2} testID={`bridge-transfer-${x.id}`}>
              <Row justifyContent="space-between" alignItems="center">
                <Body>{t({ id: 'bridge.transfer', message: '{a} {s} · {from} → {to}', values: { a: formatRaw(x.amountRaw, x.decimals), s: x.symbol, from: chainName(x.fromChainId), to: chainName(x.toChainId) } })}</Body>
                <Cable state={x.state} width={56} reducedMotion={reducedMotion} />
              </Row>
              <Body tone="mute" size="caption">
                {x.state === 'pending' ? t({ id: 'bridge.state.pending', message: 'Waiting for the origin block' }) : t({ id: 'bridge.state.dispatched', message: 'Dispatched — watching the destination for delivery' })}
                {' · '}
                {shortHash(x.originHash)}
              </Body>
            </Plate>
          ))}
        </Column>
      ) : null}

      {landed.length > 0 ? (
        <Column gap="$2" testID="bridge-landed">
          <Body size="title">{t({ id: 'bridge.landed', message: 'Recent' })}</Body>
          {landed.map((x) => (
            <Plate key={x.id} gap={2} testID={`bridge-transfer-${x.id}`}>
              <Row justifyContent="space-between" alignItems="center">
                <Body>{t({ id: 'bridge.transfer', message: '{a} {s} · {from} → {to}', values: { a: formatRaw(x.amountRaw, x.decimals), s: x.symbol, from: chainName(x.fromChainId), to: chainName(x.toChainId) } })}</Body>
                <Body tone={x.state === 'delivered' ? 'surge' : 'burn'} size="caption">
                  {x.state === 'delivered' ? t({ id: 'bridge.state.delivered', message: 'Delivered' }) : x.state === 'failed' ? t({ id: 'bridge.state.failed', message: 'Failed' }) : t({ id: 'bridge.state.timeout', message: 'Taking longer than 30 minutes' })}
                </Body>
              </Row>
              <Body tone="mute" size="caption" fontFamily="$mono">
                {shortHash(x.originHash)}
                {x.destinationHash ? ` → ${shortHash(x.destinationHash)}` : ''}
              </Body>
              {x.state === 'timeout' && x.messageId ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'bridge.explorer', message: 'Look it up on explorer.hyperlane.xyz with message {id}', values: { id: shortHash(x.messageId) } })}
                </Body>
              ) : null}
              {x.state === 'delivered' && x.toChainId === ETN ? <Key label={t({ id: 'bridge.getEtn', message: 'Get ETN for fees' })} kind="secondary" onPress={() => router.navigate('receive')} testID="bridge-get-etn" /> : null}
            </Plate>
          ))}
        </Column>
      ) : null}
    </ScrollView>
  )
}
