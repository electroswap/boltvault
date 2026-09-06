/**
 * The Legends vault, full size (master plan §8.10): the vessel, every
 * piece as a medallion, Activate and Claim, and the mint plate when the
 * collection is minting. Reached from Home › Positions and the accessory.
 */
import { Body, Key, Plate, Row, ScrollView, metrics } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { LegendsStatus } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { LegendsVault } from '../components/LegendsVault'
import { useEngine } from '../engine/EngineProvider'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014
type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'

export function Legends({ body, reducedMotion = false }: { body: BodyKind; reducedMotion?: boolean }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['legends'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [status, setStatus] = useState<LegendsStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [count, setCount] = useState(1)

  useEffect(() => {
    if (!active) return
    let alive = true
    engine.legends.status({ accountId: active.id, chainId: ETN }).then((s) => alive && setStatus(s), (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)))
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

  if (flow) return <FlowPlate flow={flow} body={body} reducedMotion={reducedMotion} titles={{ working: t({ id: 'legends.working', message: 'Working…' }), done: flow.steps.some((s) => s.step === 'mint') ? t({ id: 'legends.minted', message: 'Minted' }) : flow.steps.some((s) => s.step === 'register') ? t({ id: 'legends.activated', message: 'Dividends activated' }) : t({ id: 'legends.claimed', message: 'Claimed' }) }} onDone={dismiss} testID="legends-flow" />

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="legends">
      <PageHeader title={t({ id: 'legends.screen', message: 'Electric Legends' })} />
      {error ? <Body tone="burn">{error}</Body> : null}
      {status && active ? (
        <>
          <LegendsVault status={status} busy={busy} reducedMotion={reducedMotion} onActivate={() => void run(() => engine.legends.activate({ accountId: active.id, chainId: ETN }))} onClaim={() => void run(() => engine.legends.claim({ accountId: active.id, chainId: ETN }))} onPiece={(tokenId) => router.navigate('nft', { chainId: ETN, address: status.collection, tokenId })} />
          {status.ownedTokenIds.length === 0 ? (
            <Plate gap="$2" testID="legends-none">
              <Body tone="mute" size="caption">
                {t({ id: 'legends.none', message: 'You hold no Electric Legends yet. Every Legend shares a third of the marketplace fees, forever.' })}
              </Body>
              <Key label={t({ id: 'legends.browse', message: 'See the collection' })} kind="secondary" onPress={() => router.navigate('collection', { chainId: ETN, address: status.collection })} testID="legends-browse" />
            </Plate>
          ) : null}
          {status.mint?.mintable ? (
            <Plate gap="$2" testID="legends-mint">
              <Body size="title">{t({ id: 'collection.mint', message: 'Mint a Legend' })}</Body>
              <Body tone="mute" size="caption">
                {t({ id: 'collection.mint.body', message: '{p} ETN each · {n} left for you · {s} minted', values: { p: formatRaw(status.mint.priceWei, 18), n: status.mint.mintableCount, s: status.mint.totalSupply } })}
              </Body>
              <Row gap="$2" alignItems="center">
                <Key label="−" kind="secondary" disabled={count <= 1} onPress={() => setCount((n) => Math.max(1, n - 1))} testID="legends-mint-minus" />
                <Body size="title" testID="legends-mint-count">
                  {String(count)}
                </Body>
                <Key label="+" kind="secondary" disabled={count >= status.mint.mintableCount} onPress={() => setCount((n) => Math.min(status.mint?.mintableCount ?? 1, n + 1))} testID="legends-mint-plus" />
                <Key label={t({ id: 'collection.mint.key', message: 'Mint' })} disabled={busy || status.mint.mintableCount === 0} onPress={() => void run(() => engine.legends.mint({ accountId: active.id, chainId: ETN, count }))} testID="legends-mint-go" />
              </Row>
            </Plate>
          ) : null}
          <Body tone="mute" size="caption">
            {t({ id: 'legends.how', message: 'How it works: the marketplace fee receiver is the dividend distributor. It keeps two thirds for ElectroSwap and credits one third to every registered Legend. Claiming pays the ETN straight to you; there is no allowance involved.' })}
          </Body>
        </>
      ) : null}
    </ScrollView>
  )
}
