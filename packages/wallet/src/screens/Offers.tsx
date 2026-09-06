/**
 * The offers inbox (master plan §8.10): every open offer on the account's
 * pieces with Accept, every offer the account made with Cancel, and the
 * WETN the open offers commit against the balance.
 */
import { Artwork, Body, Column, Key, Plate, Row, ScrollView, metrics, shortAddress } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { OffersInbox } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { useEngine } from '../engine/EngineProvider'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Offers({ body, reducedMotion = false }: { body: BodyKind; reducedMotion?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['nft'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [inbox, setInbox] = useState<OffersInbox | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!active) return
    let alive = true
    engine.nft.offers({ accountId: active.id, chainId: 52014 }).then(
      (i) => alive && setInbox(i),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
    }
  }, [engine, active, flow?.status])

  const run = async (fn: () => Promise<{ flowId: string }>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      setActive(r.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (flow) return <FlowPlate flow={flow} body={body} reducedMotion={reducedMotion} titles={{ working: t({ id: 'offers.working', message: 'Working…' }), done: flow.steps.some((s) => s.step === 'accept') ? t({ id: 'piece.sold', message: 'Sold' }) : t({ id: 'piece.cancelled', message: 'Cancelled' }) }} onDone={dismiss} testID="offers-flow" />

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="offers">
      <PageHeader title={t({ id: 'offers.title', message: 'Offers' })} />
      {inbox ? (
        <Plate gap={2} testID="offers-obligation">
          <Body tone="mute" size="caption">
            {t({ id: 'offers.obligation', message: 'Your open offers commit {o} WETN; you hold {b} WETN.', values: { o: formatRaw(inbox.obligationWei, 18), b: formatRaw(inbox.wetnBalanceWei, 18) } })}
          </Body>
        </Plate>
      ) : null}
      {error ? <Body tone="burn">{error}</Body> : null}
      <Body size="caption">{t({ id: 'offers.received', message: 'On your pieces' })}</Body>
      {inbox && inbox.received.length === 0 ? (
        <Body tone="mute" size="caption">
          {t({ id: 'offers.received.none', message: 'No offers yet.' })}
        </Body>
      ) : null}
      {inbox?.received.map(({ asset, offer }) => (
        <Plate key={`${asset.tokenId}:${offer.orderHash ?? offer.maker}`} gap="$2" testID={`offer-received-${asset.tokenId}`}>
          <Row gap="$3" alignItems="center">
            <Column onPress={() => router.navigate('nft', { chainId: 52014, address: asset.address, tokenId: asset.tokenId })} cursor="pointer">
              <Artwork uri={asset.smallImageUrl} label={asset.name} size={44} />
            </Column>
            <Column flex={1}>
              <Body numberOfLines={1}>{asset.name}</Body>
              <Body tone="mute" size="caption">
                {t({ id: 'offers.from', message: '{p} WETN from {a}', values: { p: offer.priceEtn ?? '—', a: shortAddress(offer.maker) } })}
                {offer.endAt ? ` · ${t({ id: 'offers.expires', message: 'until {d}', values: { d: new Date(offer.endAt * 1000).toLocaleDateString('en-GB') } })}` : ''}
              </Body>
            </Column>
            {offer.actionable && offer.orderHash && active ? <Key label={t({ id: 'offers.accept', message: 'Accept' })} disabled={busy} onPress={() => void run(() => engine.nft.accept({ accountId: active.id, chainId: 52014, address: asset.address, tokenId: asset.tokenId, orderHash: offer.orderHash ?? '' }))} testID={`offer-accept-${asset.tokenId}`} /> : null}
          </Row>
        </Plate>
      ))}
      <Body size="caption">{t({ id: 'offers.made', message: 'Made by you' })}</Body>
      {inbox && inbox.made.length === 0 ? (
        <Body tone="mute" size="caption">
          {t({ id: 'offers.made.none', message: 'You have no open offers.' })}
        </Body>
      ) : null}
      {inbox?.made.map((m) => (
        <Plate key={`${m.tokenId}:${m.offer.orderHash ?? ''}`} gap="$2" testID={`offer-made-${m.tokenId}`}>
          <Row gap="$3" alignItems="center">
            <Column onPress={() => router.navigate('nft', { chainId: 52014, address: m.address, tokenId: m.tokenId })} cursor="pointer">
              <Artwork uri={m.imageUrl} label={m.name} size={44} />
            </Column>
            <Column flex={1}>
              <Body numberOfLines={1}>{m.name}</Body>
              <Body tone="mute" size="caption">
                {t({ id: 'offers.yours', message: '{p} WETN · until {d}', values: { p: m.offer.priceEtn ?? '—', d: new Date(m.expiresAt * 1000).toLocaleDateString('en-GB') } })}
              </Body>
            </Column>
            {m.offer.actionable && m.offer.orderHash && active ? <Key label={t({ id: 'approval.cancel', message: 'Cancel' })} kind="secondary" disabled={busy} onPress={() => void run(() => engine.nft.cancel({ accountId: active.id, chainId: 52014, address: m.address, tokenId: m.tokenId, orderHash: m.offer.orderHash ?? '' }))} testID={`offer-cancel-${m.tokenId}`} /> : null}
          </Row>
        </Plate>
      ))}
    </ScrollView>
  )
}
