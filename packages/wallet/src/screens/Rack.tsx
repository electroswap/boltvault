/**
 * The Rack (master plan §8.10, §7.12): the account's pieces on glass
 * shelves with real depth — listed pieces carry a glowing price tag, pieces
 * with an open offer an ember mark. A collection header shows floor value
 * and counts; filters by listed / unlisted / collection; the offers inbox
 * is one key away. Opening a piece is a move into its lit view.
 */
import { Artwork, Body, Chip, Column, Icon, Key, Plate, Row, ScrollView, metrics, paint } from '@boltvault/ui'
import type { Inventory } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

type BodyKind = 'extension-popup' | 'extension-tab' | 'mobile'
type Filter = 'all' | 'listed' | 'unlisted'

export function Rack({ body, embedded = false, limit }: { body: BodyKind; embedded?: boolean; limit?: number }) {
  const engine = useEngine()
  const router = useRouter()
  const { active } = useWalletState()
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [collection, setCollection] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const cols = body === 'extension-popup' ? 3 : 4
  const size = Math.floor(((body === 'extension-popup' ? 360 : 640) - inset * 2 - 8 * (cols - 1)) / cols)

  useEffect(() => {
    if (!active) return
    let alive = true
    engine.nft.inventory({ accountId: active.id, chainId: 52014 }).then(
      (inv) => alive && setInventory(inv),
      (err: unknown) => alive && setError(err instanceof Error ? err.message : String(err)),
    )
    return () => {
      alive = false
    }
  }, [engine, active])

  const pieces = (inventory?.assets ?? []).filter((a) => (filter === 'listed' ? a.listing !== null : filter === 'unlisted' ? a.listing === null : true)).filter((a) => (collection ? a.address.toLowerCase() === collection.toLowerCase() : true))
  const shown = limit ? pieces.slice(0, limit) : pieces
  const shelves: typeof shown[] = []
  for (let i = 0; i < shown.length; i += cols) shelves.push(shown.slice(i, i + cols))

  const content = (
    <>
      {!embedded ? (
        <Row justifyContent="space-between" alignItems="center">
          <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
          <Body size="title">{t({ id: 'rack.title', message: 'Your collection' })}</Body>
        </Row>
      ) : null}
      {inventory ? (
        <Row gap="$3" flexWrap="wrap" alignItems="center" testID="rack-header">
          <Body tone="mute" size="caption">
            {t({ id: 'rack.count', message: '{n} piece{s}', values: { n: inventory.assets.length, s: inventory.assets.length === 1 ? '' : 's' } })}
          </Body>
          {inventory.floorValueEtn !== null ? (
            <Body tone="mute" size="caption">
              {t({ id: 'rack.floor', message: '{v} ETN at floor', values: { v: Math.round(inventory.floorValueEtn) } })}
            </Body>
          ) : null}
          {inventory.listedCount ? (
            <Body tone="arc" size="caption">
              {t({ id: 'rack.listed', message: '{n} listed', values: { n: inventory.listedCount } })}
            </Body>
          ) : null}
          {inventory.withOffersCount ? (
            <Chip onPress={() => router.navigate('offers')} cursor="pointer" minHeight={44} justifyContent="center" testID="rack-offers">
              <Body tone="ember" size="caption">
                {t({ id: 'rack.offers', message: '{n} with offers', values: { n: inventory.withOffersCount } })}
              </Body>
            </Chip>
          ) : !embedded ? (
            <Chip onPress={() => router.navigate('offers')} cursor="pointer" minHeight={44} justifyContent="center" testID="rack-offers">
              <Body tone="mute" size="caption">
                {t({ id: 'rack.inbox', message: 'Offers inbox' })}
              </Body>
            </Chip>
          ) : null}
        </Row>
      ) : null}
      {!embedded && inventory && inventory.collections.length > 1 ? (
        <Row gap="$2" flexWrap="wrap">
          <Chip onPress={() => setCollection(null)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={collection === null ? paint.arc : undefined}>
            <Body tone={collection === null ? 'arc' : 'mute'} size="caption">
              {t({ id: 'rack.all', message: 'All' })}
            </Body>
          </Chip>
          {inventory.collections.map((c) => (
            <Chip key={c.address} onPress={() => setCollection(c.address)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={collection === c.address ? paint.arc : undefined} testID={`rack-collection-${c.address}`}>
              <Body tone={collection === c.address ? 'arc' : 'mute'} size="caption">
                {`${c.name} · ${c.balance}`}
              </Body>
            </Chip>
          ))}
        </Row>
      ) : null}
      {!embedded ? (
        <Row gap="$2">
          {(['all', 'listed', 'unlisted'] as const).map((f) => (
            <Chip key={f} onPress={() => setFilter(f)} cursor="pointer" minHeight={44} justifyContent="center" borderColor={filter === f ? paint.arc : undefined} testID={`rack-filter-${f}`}>
              <Body tone={filter === f ? 'arc' : 'mute'} size="caption">
                {f === 'all' ? t({ id: 'rack.f.all', message: 'All' }) : f === 'listed' ? t({ id: 'rack.f.listed', message: 'Listed' }) : t({ id: 'rack.f.unlisted', message: 'Unlisted' })}
              </Body>
            </Chip>
          ))}
        </Row>
      ) : null}
      {error ? <Body tone="burn">{error}</Body> : null}
      {inventory && inventory.assets.length === 0 ? (
        <Plate gap="$2" testID="rack-empty">
          <Body tone="mute">{t({ id: 'rack.empty', message: 'Nothing on the shelves yet. Explore collections on Electroneum — buying a piece lands it here.' })}</Body>
          <Key label={t({ id: 'rack.explore', message: 'Explore collectibles' })} kind="secondary" onPress={() => router.navigate('explore', { segment: 'collectibles' })} testID="rack-explore" />
        </Plate>
      ) : null}
      <Column gap={14} testID="rack-shelves">
        {shelves.map((row, i) => (
          <Column key={i} gap={0}>
            <Row gap={8} alignItems="flex-end">
              {row.map((a) => (
                <Column key={`${a.address}:${a.tokenId}`} onPress={() => router.navigate('nft', { chainId: 52014, address: a.address, tokenId: a.tokenId })} cursor="pointer" testID={`rack-piece-${a.tokenId}`}>
                  <Artwork uri={a.smallImageUrl} label={a.name} size={size} badge={a.listing?.priceEtn !== null && a.listing?.priceEtn !== undefined ? { text: `${a.listing.priceEtn} ETN`, tone: 'arc' } : a.bids.length ? { text: t({ id: 'rack.offer', message: 'Offer' }), tone: 'ember' } : null} />
                </Column>
              ))}
            </Row>
            {/* The shelf: a lit glass edge with a soft contact shadow beneath. */}
            <Column height={2} backgroundColor="rgba(238,248,255,0.28)" marginTop={2} borderRadius={1} />
            <Column height={8} backgroundColor="rgba(2,3,8,0.35)" borderBottomLeftRadius={8} borderBottomRightRadius={8} />
          </Column>
        ))}
      </Column>
      {embedded && pieces.length > (limit ?? 0) ? <Key label={t({ id: 'rack.open', message: 'Open the Rack' })} kind="secondary" onPress={() => router.navigate('rack')} testID="rack-open" /> : null}
    </>
  )
  if (embedded) return <Column gap="$3">{content}</Column>
  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="rack">
      {content}
    </ScrollView>
  )
}
