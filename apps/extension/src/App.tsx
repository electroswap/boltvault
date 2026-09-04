import type { CSSProperties } from 'react'
import { useState } from 'react'
import { SwapView } from './SwapView'

/**
 * The popup — the v1 product is the popup (design §Layout).
 *
 * T3.2 delivers the *quiet-custody chrome*: account plate, the big Oxanium
 * total, the 2px ETN filament (no blur in the popup), bus-bar portfolio stub,
 * the one accessory chip slot, Home primary, and the 4-tab dock. Data is
 * placeholder until T4.x wires real portfolio reads; the breaker is a labeled
 * stub (security is a labeled breaker, not a modal).
 */

const TABS = [
  { id: 'home', label: 'Home' },
  { id: 'swap', label: 'Swap' },
  { id: 'activity', label: 'Act' },
  { id: 'settings', label: 'Set' },
] as const

/** Placeholder portfolio (ETN share of portfolio) — replaced by T4.2. */
const PORTFOLIO = [
  { symbol: 'ETN', share: 0.62 },
  { symbol: 'BOLT', share: 0.28 },
  { symbol: 'USDC', share: 0.1 },
] as const

function Filament({ active }: { active: boolean }) {
  return (
    <div
      data-testid="filament"
      style={{
        height: 'var(--bv-filament)',
        background: active ? 'var(--bv-arc)' : 'var(--bv-mute)',
        // Design: 2px arc, NO blur/glow in the popup (glow is the a11y bug).
        borderRadius: '1px',
        marginTop: '16px',
        marginBottom: '24px',
        transition: 'background 120ms linear',
      }}
    />
  )
}

function BusBar({ symbol, share, selected }: { symbol: string; share: number; selected: boolean }) {
  return (
    <button
      data-testid={`busbar-${symbol}`}
      onClick={(e) => (e.currentTarget.style.outline = selected ? '' : '1px solid var(--bv-arc)')}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        height: 'var(--bv-bus-bar-height)',
        background: 'transparent',
        border: selected ? '1px solid var(--bv-arc)' : '1px solid transparent',
        borderRadius: '6px',
        cursor: 'pointer',
        padding: '0 12px',
        textAlign: 'left',
        color: 'var(--bv-ink)',
        fontFamily: 'var(--bv-font-sora)',
        fontSize: '13px',
      }}
    >
      <span style={{ width: '52px', color: selected ? 'var(--bv-arc)' : 'var(--bv-ink)' }}>{symbol}</span>
      <div
        data-testid={`busbar-${symbol}-fill`}
        style={{
          flex: 1,
          height: '10px',
          borderRadius: '5px',
          background: 'var(--bv-glass)',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${Math.round(share * 100)}%`,
            height: '100%',
            background: selected ? 'var(--bv-arc)' : 'var(--bv-plasma)',
            borderRadius: '5px',
          }}
        />
      </div>
      <span style={{ color: 'var(--bv-mute)', width: '36px', textAlign: 'right' }}>
        {Math.round(share * 100)}%
      </span>
    </button>
  )
}

export default function App() {
  const [tab, setTab] = useState<'home' | 'swap' | 'activity' | 'settings'>('home')
  return (
    <div
      data-testid="chamber"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        background: 'var(--bv-void)',
      }}
    >
      {/* Account plate + scan */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px var(--bv-inset)',
        }}
      >
        <span data-testid="account" style={{ color: 'var(--bv-ink)', fontSize: '14px' }}>
          main ▾
        </span>
        <span style={{ color: 'var(--bv-mute)', fontSize: '13px' }}>scan</span>
      </header>

      <main style={{ flex: 1, padding: '0 var(--bv-inset)', overflowY: 'auto' }}>
        {tab === 'swap' ? (
          <SwapView
            chainId={52014}
            tokenIn={{ address: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77', symbol: 'ETN' }}
            tokenOut={{ address: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', symbol: 'USDC' }}
            quote={null}
            now={Date.now()}
            priceImpactPct={0.4}
            sink={null}
            amountInDisplay="0"
          />
        ) : (
        <>
        {/* Big total — Oxanium, left-aligned */}
        <div
          data-testid="total"
          style={{
            fontFamily: 'var(--bv-font-oxanium)',
            fontSize: '32px',
            letterSpacing: '-0.04em',
            fontWeight: 600,
          }}
        >
          12,480.22
        </div>
        <div style={{ color: 'var(--bv-ember)', fontSize: '13px', marginTop: '2px' }}>
          ETN&ensp;+2.1%
        </div>

        <Filament active />

        {/* Bus bars */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
          {PORTFOLIO.map((t) => (
            <BusBar key={t.symbol} symbol={t.symbol} share={t.share} selected={t.symbol === 'ETN'} />
          ))}
        </div>

        {/* One accessory chip slot (bridge > farm > campaign) */}
        <div
          data-testid="accessory-chip"
          style={{
            marginTop: '20px',
            padding: '10px 12px',
            background: 'var(--bv-glass)',
            borderRadius: '8px',
            color: 'var(--bv-mute)',
            fontSize: '12px',
          }}
        >
          WETN/BOLT 1.41x · Collect 12 DYNO
        </div>
        </>
        )}
      </main>

      {/* Home primary */}
      <div style={{ padding: '12px var(--bv-inset)' }}>
        <button
          data-testid="home-primary"
          style={{
            width: '100%',
            height: 'var(--bv-hit)',
            background: 'var(--bv-arc)',
            color: 'var(--bv-void)',
            border: 'none',
            borderRadius: '8px',
            fontFamily: 'var(--bv-font-sora)',
            fontWeight: 600,
            fontSize: '14px',
            cursor: 'pointer',
          }}
        >
          Receive ETN
        </button>
      </div>

      {/* 4-tab dock — Home / Swap / Act / Set. Breaker is a layer, not a 5th tab. */}
      <nav
        data-testid="tab-dock"
        style={{
          display: 'flex',
          borderTop: '1px solid var(--bv-glass)',
          background: 'var(--bv-void)',
        }}
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            data-testid={`tab-${t.id}`}
            onClick={() => setTab(t.id as typeof tab)}
            style={{
              flex: 1,
              padding: '10px 0',
              background: 'transparent',
              border: 'none',
              color: tab === t.id ? 'var(--bv-arc)' : 'var(--bv-mute)',
              fontFamily: 'var(--bv-font-sora)',
              fontSize: '12px',
              cursor: 'pointer',
            }}
          >
            {t.label}
          </button>
        ))}
      </nav>
    </div>
  )
}

export type { CSSProperties }
