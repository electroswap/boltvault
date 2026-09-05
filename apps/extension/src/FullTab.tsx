/**
 * FullTab (G) — the full-tab theater: "full sky + coil + shelf" (design §tab).
 *
 * Unlike the cropped 360×600 popup, the full tab shows:
 *   - the FULL portfolio (overflow list, not just top-3),
 *   - the Canvas-2D **coil** (farm duration multiplier, one travel per block),
 *   - the **NFT shelf** (labeled rack).
 * The block heartbeat drives the coil pulse + filament. Same face contract as
 * the popup (tokens + primitives from @boltvault/design).
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  CoilCanvas,
} from './CoilCanvas'
import { NftView } from './Nft'
import { useBlockHeartbeat, usePortfolio, type SafeRow } from './data-layer'
import {
  IconScan,
  IconFlask,
  IconLayers,
  IconRocket,
  IconCable,
  IconReceive,
  IconSend,
  IconSwap,
} from '@boltvault/design'

const INSET = 24

function Bar({ symbol, share, selected, onSelect }: { symbol: string; share: number; selected: boolean; onSelect: () => void }) {
  return (
    <button
      data-testid={`ft-busbar-${symbol}`}
      onClick={onSelect}
      style={{
        display: 'flex', alignItems: 'center', gap: 12, width: '100%', minHeight: 44,
        background: 'transparent', border: selected ? '1px solid var(--bv-arc)' : '1px solid transparent',
        borderRadius: 6, cursor: 'pointer', padding: '0 12px', textAlign: 'left',
        color: 'var(--bv-ink)', fontFamily: 'var(--bv-font-sora)', fontSize: 13,
      }}
    >
      <span style={{ width: 56, color: selected ? 'var(--bv-arc)' : 'var(--bv-ink)' }}>{symbol}</span>
      <div data-testid={`ft-busbar-${symbol}-fill`} style={{ flex: 1, height: 10, borderRadius: 5, background: 'var(--bv-glass)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.round(share * 100)}%`, height: '100%', background: selected ? 'var(--bv-arc)' : 'var(--bv-plasma)', borderRadius: 5 }} />
      </div>
      <span style={{ color: 'var(--bv-mute)', width: 40, textAlign: 'right' }}>{Math.round(share * 100)}%</span>
    </button>
  )
}

const plate: CSSProperties = {
  background: 'var(--bv-glass)',
  border: '1px solid var(--bv-glass)',
  borderRadius: 10,
  padding: 14,
  display: 'flex',
  flexDirection: 'column',
  gap: 10,
}
const plateTitle: CSSProperties = {
  color: 'var(--bv-mute)',
  fontSize: 12,
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
}
const iconBtn: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 44,
  height: 44,
  borderRadius: 8,
  background: 'var(--bv-glass)',
  border: '1px solid var(--bv-glass)',
  color: 'var(--bv-ink)',
  cursor: 'pointer',
}

export function FullTab() {
  const { state: hb } = useBlockHeartbeat(52014)
  const [account] = useState<string>('0x1F909f1C46a3bA06d344c51d28fE8E19D5037B63')
  const pf = usePortfolio(52014, account, { client: undefined })
  const [selected, setSelected] = useState('ETN')

  const total = pf.data?.pricedTotalUsd ?? null
  const bars = useMemo(() => {
    const rows: SafeRow[] = pf.data ? [...(pf.data.native ? [pf.data.native] : []), ...pf.data.rows] : []
    return rows.map((r) => ({ symbol: r.symbol, share: r.share }))
  }, [pf.data])

  // Coil progress: a representative farm multiplier ramp (1.0 → 2.5). The
  // block heartbeat advances one travel per block tick (pulse = block number).
  const coilProgress = 0.42
  const pulse = hb.block ?? 0

  return (
    <div
      data-testid="full-tab"
      style={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100%',
        background: 'var(--bv-void)',
        color: 'var(--bv-ink)',
        fontFamily: 'var(--bv-font-sora)',
      }}
    >
      {/* Header */}
      <header
        style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: `${INSET}px ${INSET}px 8px`,
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--bv-ink)' }}>BoltVault · full chamber</span>
        <span style={{ color: 'var(--bv-mute)', display: 'inline-flex', gap: 4 }}>
          <IconScan size={18} />
        </span>
      </header>

      {/* Sky — the coil (Canvas 2D) + the total it sits under. */}
      <section style={{ padding: `0 ${INSET}px`, display: 'flex', gap: 20, alignItems: 'center' }}>
        <div style={{ textAlign: 'left' }}>
          <div
            data-testid="ft-total"
            style={{ fontFamily: 'var(--bv-font-oxanium)', fontSize: 40, fontWeight: 600, letterSpacing: '-0.04em', color: total == null ? 'var(--bv-mute)' : 'var(--bv-ink)' }}
          >
            {total == null ? '—' : `$${total.toFixed(2)}`}
          </div>
          <div data-testid="ft-head" style={{ color: 'var(--bv-ember)', fontSize: 13, marginTop: 2 }}>
            {hb.block != null ? `ETN · ${hb.block.toLocaleString()}` : 'ETN'}
          </div>
          {/* 2px filament, no blur in the tab either. */}
          <div
            data-testid="ft-filament"
            style={{ height: 2, width: 220, marginTop: 12, borderRadius: 1, background: hb.stale ? 'var(--bv-mute)' : 'var(--bv-arc)' }}
          />
        </div>
        <div data-testid="ft-coil" style={{ marginLeft: 'auto' }}>
          <CoilCanvas progress={coilProgress} pulse={pulse} active={!hb.stale} reducedMotion={false} size={220} testId="ft-coil-canvas" />
          <div style={{ textAlign: 'center', color: 'var(--bv-mute)', fontSize: 12, marginTop: 8 }}>
            WETN/BOLT · 1.42x
          </div>
        </div>
      </section>

      {/* Action verbs (the full tab is still a remote). */}
      <section style={{ padding: `12px ${INSET}px`, display: 'flex', gap: 8 }}>
        <button data-testid="ft-send" style={iconBtn} aria-label="Send"><IconSend size={20} /></button>
        <button data-testid="ft-receive" style={iconBtn} aria-label="Receive"><IconReceive size={20} /></button>
        <button data-testid="ft-swap" style={iconBtn} aria-label="Swap"><IconSwap size={20} /></button>
        <button data-testid="ft-bridge" style={iconBtn} aria-label="Bridge"><IconCable size={20} /></button>
        <button data-testid="ft-launchpad" style={iconBtn} aria-label="Launchpad"><IconRocket size={20} /></button>
      </section>

      {/* The rest of the chamber, side by side when wide: overflow list + shelf. */}
      <section
        style={{
          padding: `0 ${INSET}px ${INSET}px`,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: 16,
          flex: 1,
        }}
      >
        {/* Full portfolio (overflow list). */}
        <div data-testid="ft-portfolio" style={plate}>
          <div style={plateTitle}>Portfolio · full</div>
          {bars.length === 0 ? (
            <div style={{ color: 'var(--bv-mute)', fontSize: 13 }}>
              {pf.loading ? 'Reading your chamber…' : 'Nothing here yet — Receive ETN to begin.'}
            </div>
          ) : (
            bars.map((t) => (
              <Bar key={t.symbol} symbol={t.symbol} share={t.share} selected={selected === t.symbol} onSelect={() => setSelected(t.symbol)} />
            ))
          )}
        </div>

        {/* NFT shelf (labeled rack). */}
        <div data-testid="ft-shelf" style={plate}>
          <div style={{ ...plateTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconLayers size={14} /> Collectibles shelf
          </div>
          <NftView
            assets={[
              { collection: '0x8a3f0000000000000000000000000000000077c1', tokenId: '#12', name: 'Volt #12', floor: 4.2, listed: true },
              { collection: '0x8a3f0000000000000000000000000000000077c1', tokenId: '#40', name: 'Volt #40', floor: 3.1 },
            ]}
          />
        </div>

        {/* Farm plate — the coil's numbers + calendar (design: gauge + date, not a hypnotic ring). */}
        <div data-testid="ft-farm" style={plate}>
          <div style={{ ...plateTitle, display: 'flex', alignItems: 'center', gap: 6 }}>
            <IconFlask size={14} /> Yield farm
          </div>
          <div style={{ fontFamily: 'var(--bv-font-oxanium)', fontSize: 22, color: 'var(--bv-ink)' }}>1.42x</div>
          <div style={{ color: 'var(--bv-mute)', fontSize: 13 }}>
            → 2.0x in ~97 days · → 2.5x in ~184 days
          </div>
          <div style={{ color: 'var(--bv-mute)', fontSize: 13 }}>BOLT 1.05x (50k locked · unlocks on 100% exit)</div>
          <div data-testid="ft-farm-collect" style={{ color: 'var(--bv-arc)', fontSize: 13 }}>Collect 12 DYNO</div>
        </div>
      </section>
    </div>
  )
}
