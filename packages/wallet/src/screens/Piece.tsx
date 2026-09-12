/**
 * The Piece (master plan §8.10): the artwork lit by one slow sweep on open,
 * rarity and traits as engraved plates, the listing, the best offer and the
 * last sale, the owner; keys by role — owner: List · Cancel listing ·
 * Accept offer · Transfer; visitor: Buy · Offer. A Legend says what it
 * earns. Every verb runs through the sheet and lands here as a Discharge.
 */
import { Artwork, Body, Chip, Column, Icon, Input, Key, Pill, Plate, Row, ScrollView, SharedElement, Sheet, metrics, paint, shortAddress, useWindowDimensions } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AssetView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { FlowPlate, useActiveFlow } from '../components/FlowPlate'
import { useEngine } from '../engine/EngineProvider'
import { useLastGood } from '../hooks/useLastGood'
import { useSafeOpen } from '../hooks/useSafeOpen'
import { formatRaw } from '../format'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { pieceSharedId } from '../navigation/transitions'
import { useSwapFlow } from '../state/useSwapFlow'
import { useWalletState } from '../state/useWalletState'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'
type SheetKind = 'list' | 'offer' | 'transfer' | null

export function Piece({ body, chainId, address, tokenId, reducedMotion = false }: { body: BodyKind; chainId: number; address: string; tokenId: string; reducedMotion?: boolean }) {
  // Every outward link passes the same gate (ES-BV-035).
  const openSafely = useSafeOpen()
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const { setActive } = useSwapFlow()
  const { flow, dismiss } = useActiveFlow(['nft'])
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const { width: windowWidth } = useWindowDimensions()
  const width = Math.min(windowWidth, body === 'extension-tab' ? 640 : windowWidth) - inset * 2
  const [loadedAsset, setAsset] = useState<AssetView | null>(null)
  const asset = useLastGood(`piece:${chainId}:${address}:${tokenId}`, loadedAsset)
  const [sheet, setSheet] = useState<SheetKind>(null)
  const [price, setPrice] = useState('')
  const [days, setDays] = useState('7')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    engine.nft.asset({ chainId, address, tokenId, ...(active ? { accountId: active.id } : {}) }).then(
      (a) => alive && setAsset(a),
      (err: unknown) => alive && setLoadError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
    }
  }, [engine, chainId, address, tokenId, active, flow?.status])

  const run = async (fn: () => Promise<{ flowId: string }>): Promise<void> => {
    if (!active) return
    setBusy(true)
    setError(null)
    try {
      const r = await fn()
      setSheet(null)
      setActive(r.flowId)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (flow) {
    const kind = flow.steps.map((s) => s.step)
    const done = kind.includes('buy') ? t({ id: 'piece.bought', message: 'It is yours' }) : kind.includes('sign_order') && kind.includes('accept') ? t({ id: 'piece.sold', message: 'Sold' }) : kind.includes('accept') ? t({ id: 'piece.sold', message: 'Sold' }) : kind.includes('post_order') ? (asset?.mine ? t({ id: 'piece.listed', message: 'Listed' }) : t({ id: 'piece.offered', message: 'Offer made' })) : kind.includes('cancel_order') ? t({ id: 'piece.cancelled', message: 'Cancelled' }) : kind.includes('transfer') ? t({ id: 'piece.sent', message: 'Sent' }) : t({ id: 'piece.done', message: 'Done' })
    return <FlowPlate flow={flow} body={body} reducedMotion={reducedMotion} titles={{ working: t({ id: 'piece.working', message: 'Working…' }), done }} summary={asset?.name ?? null} onDone={dismiss} testID="nft-flow" />
  }

  const mine = asset?.mine === true
  const listing = asset?.listing ?? null
  const best = asset?.bestBid ?? null

  return (
    <Column flex={1}>
    <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="piece">
      <PageHeader title={asset?.name ?? ''} right={<>{asset ? <Pill label={asset.collectionName} icon={asset.collectionVerified ? <Icon name="check" size={14} color={paint.arc} /> : undefined} size="sm" onPress={() => router.navigate('collection', { chainId, address })} testID="piece-collection" /> : null}</>} />
      {loadError ? <Body tone="burn">{loadError}</Body> : null}
      {!asset && !loadError ? (
        <Body tone="mute" size="caption">
          {t({ id: 'piece.loading', message: 'Lighting it up…' })}
        </Body>
      ) : null}
      {asset ? (
        <>
          {/* Where the thumb from the Rack lands, before the slow light sweep runs over it (§7.7). */}
          <SharedElement id={pieceSharedId(chainId, address, tokenId)}>
            <Artwork uri={asset.imageUrl ?? asset.smallImageUrl} label={asset.name} size={{ width, height: Math.round(width * 0.9) }} sweep reducedMotion={reducedMotion} testID="piece-art" />
          </SharedElement>
          <Column gap={2}>
            <Row gap="$2" alignItems="center">
              <Body size="title" numberOfLines={1} testID="piece-name">
                {asset.name}
              </Body>
              {asset.suspicious ? <Icon name="warn" size={16} color={paint.burn} /> : null}
            </Row>
            <Body tone="mute" size="caption">
              {asset.owner ? (mine ? t({ id: 'piece.yours', message: 'Yours' }) : t({ id: 'piece.owner', message: 'Owned by {a}', values: { a: shortAddress(asset.owner) } })) : ''}
              {asset.rarityRank !== null ? ` · ${t({ id: 'piece.rank', message: 'Rank #{r}', values: { r: asset.rarityRank } })}` : ''}
            </Body>
          </Column>
          {asset.paysDividends ? (
            <Plate gap={2} testID="piece-dividends">
              <Body tone="ember" size="caption">
                {asset.dividendsWei !== null && BigInt(asset.dividendsWei) > 0n
                  ? t({ id: 'piece.earns', message: 'This piece earns marketplace dividends — {a} ETN unclaimed', values: { a: formatRaw(asset.dividendsWei, 18) } })
                  : t({ id: 'piece.earns.none', message: 'This piece earns marketplace dividends (activate them after you hold it).' })}
              </Body>
            </Plate>
          ) : null}
          <Row gap="$3" flexWrap="wrap" testID="piece-prices">
            <Column minWidth={90}>
              <Body tone="mute" size="caption">
                {t({ id: 'piece.listing', message: 'Listed at' })}
              </Body>
              <Body tone={listing ? 'arc' : 'ink'}>{listing?.priceEtn !== null && listing?.priceEtn !== undefined ? `${listing.priceEtn} ETN` : '—'}</Body>
            </Column>
            <Column minWidth={90}>
              <Body tone="mute" size="caption">
                {t({ id: 'piece.best', message: 'Best offer' })}
              </Body>
              <Body tone={best ? 'ember' : 'ink'}>{best?.priceEtn !== null && best?.priceEtn !== undefined ? `${best.priceEtn} WETN` : '—'}</Body>
            </Column>
            <Column minWidth={90}>
              <Body tone="mute" size="caption">
                {t({ id: 'piece.last', message: 'Last sale' })}
              </Body>
              <Body>{asset.lastPriceEtn !== null ? `${asset.lastPriceEtn} ETN` : '—'}</Body>
            </Column>
          </Row>
          {asset.traits.length ? (
            <Row gap="$2" flexWrap="wrap" testID="piece-traits">
              {asset.traits.slice(0, 12).map((tr) => (
                <Chip key={`${tr.name}:${tr.value}`} paddingVertical={4}>
                  <Body tone="mute" size="caption">
                    {tr.name}
                  </Body>
                  <Body size="caption">{tr.value}</Body>
                </Chip>
              ))}
            </Row>
          ) : null}
          {asset.custom ? (
            <Body tone="mute" size="caption" testID="piece-custom-note">
              {t({ id: 'piece.custom', message: 'From a collection you added: read from the contract, not on the marketplace.' })}
            </Body>
          ) : null}
          {active ? (
            <Row gap="$2" flexWrap="wrap" testID="piece-keys">
              {mine ? (
                <>
                  {!listing && !asset.custom ? <Key label={t({ id: 'piece.list', message: 'List' })} size="compact" onPress={() => setSheet('list')} testID="piece-list" /> : null}
                  {listing && listing.actionable && listing.orderHash ? <Key label={t({ id: 'piece.cancelListing', message: 'Cancel listing' })} kind="secondary" disabled={busy} onPress={() => void run(() => engine.nft.cancel({ accountId: active.id, chainId, address, tokenId, orderHash: listing.orderHash ?? '' }))} testID="piece-cancel" /> : null}
                  {best && best.actionable && best.orderHash ? <Key label={t({ id: 'piece.accept', message: 'Accept offer' })} disabled={busy} onPress={() => void run(() => engine.nft.accept({ accountId: active.id, chainId, address, tokenId, orderHash: best.orderHash ?? '' }))} testID="piece-accept" /> : null}
                  <Key label={t({ id: 'piece.transfer', message: 'Send' })} kind="secondary" size="compact" onPress={() => setSheet('transfer')} testID="piece-transfer" />
                </>
              ) : (
                <>
                  {listing && listing.actionable ? <Key label={t({ id: 'piece.buy', message: 'Buy' })} disabled={busy} onPress={() => void run(() => engine.nft.buy({ accountId: active.id, chainId, address, tokenId }))} testID="piece-buy" /> : null}
                  {!asset.custom ? <Key label={t({ id: 'piece.offer', message: 'Offer' })} kind="secondary" size="compact" onPress={() => setSheet('offer')} testID="piece-offer" /> : null}
                </>
              )}
            </Row>
          ) : null}
          {error ? <Body tone="burn">{error}</Body> : null}
          {asset.bids.length ? (
            <Column gap="$1" testID="piece-bids">
              <Body size="caption">{t({ id: 'piece.offers', message: 'Offers' })}</Body>
              {asset.bids.map((b) => (
                <Row key={b.orderHash ?? b.maker} justifyContent="space-between" minHeight={36} alignItems="center">
                  <Body tone="mute" size="caption">
                    {shortAddress(b.maker)}
                  </Body>
                  <Body size="caption">{b.priceEtn !== null ? `${b.priceEtn} WETN` : '—'}</Body>
                </Row>
              ))}
            </Column>
          ) : null}
          {asset.description ? (
            <Body tone="mute" size="caption" numberOfLines={6}>
              {asset.description}
            </Body>
          ) : null}
          {!asset.custom ? <Pill label={t({ id: 'piece.web', message: 'On ElectroSwap' })} icon={<Icon name="external" size={14} color={paint.mute} />} size="sm" onPress={() => openSafely(`https://app.electroswap.io/nfts/asset/${address}/${tokenId}`)} /> : null}
        </>
      ) : null}

    </ScrollView>
      <Sheet open={sheet !== null} onClose={() => setSheet(null)} title={sheet === 'list' ? t({ id: 'piece.list.title', message: 'List for sale' }) : sheet === 'offer' ? t({ id: 'piece.offer.title', message: 'Make an offer' }) : t({ id: 'piece.transfer.title', message: 'Send this piece' })} reducedMotion={reducedMotion} testID="piece-sheet">
        <Column gap="$3">
          {sheet === 'transfer' ? (
            <>
              <Input value={to} onChange={setTo} placeholder="0x…" label={t({ id: 'piece.transfer.to', message: 'To' })} testID="piece-transfer-to" />
              <Body tone="mute" size="caption">
                {t({ id: 'piece.transfer.body', message: 'The recipient goes through the same address checks as a send. A collectible cannot be recalled.' })}
              </Body>
              <Key label={t({ id: 'piece.transfer', message: 'Send' })} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(to.trim())} onPress={() => void run(() => engine.nft.transfer({ accountId: active?.id ?? '', chainId, address, tokenId, to: to.trim() }))} testID="piece-transfer-go" />
            </>
          ) : (
            <>
              <Input value={price} onChange={setPrice} placeholder="0" label={sheet === 'list' ? t({ id: 'piece.price', message: 'Price in ETN' }) : t({ id: 'piece.offer.price', message: 'Offer in WETN' })} testID="piece-price" />
              <Row gap="$2" flexWrap="wrap">
                {['1', '7', '30'].map((d) => (
                  <Pill key={d} label={t({ id: 'piece.days', message: '{d} days', values: { d } })} selected={days === d} onPress={() => setDays(d)} testID={`piece-days-${d}`} />
                ))}
              </Row>
              {sheet === 'list' && price && Number(price) > 0 ? (
                <Body tone="mute" size="caption" testID="piece-proceeds">
                  {t({ id: 'piece.proceeds', message: 'You receive {a} ETN after the 3% marketplace fee{c}', values: { a: (Number(price) * (1 - 0.03 - (asset?.creatorFee?.basisPoints ?? 0) / 10_000)).toFixed(4).replace(/\.?0+$/, ''), c: asset?.creatorFee ? ` and the ${(asset.creatorFee.basisPoints / 100).toFixed(1)}% creator royalty` : '' } })}
                </Body>
              ) : null}
              {sheet === 'offer' ? (
                <Body tone="mute" size="caption">
                  {t({ id: 'piece.offer.body', message: 'Offers are made in WETN. If you are short, the wallet wraps ETN for you first. The owner can accept any time before it expires.' })}
                </Body>
              ) : null}
              {error ? <Body tone="burn">{error}</Body> : null}
              <Key label={sheet === 'list' ? t({ id: 'piece.list', message: 'List' }) : t({ id: 'piece.offer', message: 'Offer' })} disabled={busy || !(Number(price) > 0)} onPress={() => void run(() => (sheet === 'list' ? engine.nft.list({ accountId: active?.id ?? '', chainId, address, tokenId, priceEtn: price, days: Number(days) }) : engine.nft.offer({ accountId: active?.id ?? '', chainId, address, tokenId, priceEtn: price, days: Number(days) })))} testID="piece-sheet-go" />
            </>
          )}
        </Column>
      </Sheet>
    </Column>
  )
}
