/**
 * NftView (E) — the NFT labeled rack + detail sheet (design "NFT").
 *
 * "Labeled rack (thumb, name, floor). Detail sheet for the selected piece."
 * The rack uses the design `Rack` primitive; the detail sheet opens in a
 * design `Sheet`. Media is resolved through `resolveMedia` (ipfs:// →
 * gateway). v1 is display-level: assets are injected as props, no network.
 */
import { useState } from 'react'
import { Rack, Sheet, Breaker, TokenAvatar } from '@boltvault/design'
import { resolveMedia } from '@boltvault/nft'

export interface NftAssetRow {
  collection: string
  tokenId: string
  name?: string
  mediaUri?: string
  floor?: number
  owner?: string
  listed?: boolean
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a
}

/** A thumb: the resolved media image, falling back to a TokenAvatar. */
function Thumb({ asset }: { asset: NftAssetRow }) {
  const [broken, setBroken] = useState(false)
  const src = asset.mediaUri ? resolveMedia(asset.mediaUri) : null
  if (!src || broken) {
    return <TokenAvatar chainId={52014} address={asset.collection} size={48} />
  }
  return (
    <img
      src={src}
      alt={asset.name ?? asset.tokenId}
      onError={() => setBroken(true)}
      style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8 }}
    />
  )
}

export function NftView({ assets = [], testId = 'nft' }: { assets?: NftAssetRow[]; testId?: string }) {
  const [selected, setSelected] = useState<number | null>(null)
  const sel = selected != null ? assets[selected] ?? null : null

  return (
    <div data-testid={testId} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ color: 'var(--bv-mute)', fontSize: '12px' }}>
        Rack · {assets.length} asset{assets.length === 1 ? '' : 's'}
      </div>

      {assets.length === 0 ? (
        <div style={{ color: 'var(--bv-mute)', fontSize: '13px', padding: '16px 4px' }}>
          Nothing on the rack yet — list a piece to begin.
        </div>
      ) : (
        <Rack
          testId={`${testId}-rack`}
          items={assets.map((a, i) => ({
            key: `item-${i}`,
            thumb: <Thumb asset={a} />,
            title: a.name ?? `#${a.tokenId}`,
            sub: a.floor != null ? `floor ${a.floor.toFixed(2)} ETN` : a.listed ? 'listed' : undefined,
            selected: selected === i,
            onSelect: () => setSelected(i),
          }))}
        />
      )}

      {/* Detail sheet for the selected piece. */}
      <Sheet open={sel != null} onClose={() => setSelected(null)} testId={`${testId}-detail`} title={sel?.name ?? `#${sel?.tokenId ?? ''}`}>
        {sel && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ width: '100%', height: '160px', borderRadius: '10px', overflow: 'hidden', background: 'var(--bv-void)' }}>
              <Thumb asset={sel} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', fontSize: '13px' }}>
              <div style={{ color: 'var(--bv-mute)' }}>Token id</div>
              <div style={{ fontFamily: 'var(--bv-font-oxanium)' }}>{sel.tokenId}</div>
              <div style={{ color: 'var(--bv-mute)', marginTop: '6px' }}>Collection</div>
              <div style={{ fontFamily: 'var(--bv-font-oxanium)' }}>{shortAddr(sel.collection)}</div>
              {sel.floor != null && (
                <>
                  <div style={{ color: 'var(--bv-mute)', marginTop: '6px' }}>Floor</div>
                  <div style={{ fontFamily: 'var(--bv-font-oxanium)' }}>{sel.floor.toFixed(2)} ETN</div>
                </>
              )}
            </div>
            <Breaker
              label={sel.listed ? 'Relist' : 'List for sale'}
              armed
              testId={`${testId}-detail-list`}
            />
          </div>
        )}
      </Sheet>
    </div>
  )
}
