import { type CSSProperties } from 'react'
import { useState } from 'react'
import { SwapView } from './SwapView'

/**
 * The popup — the v1 product is the popup (design §Layout).
 *
 * Quiet-custody chrome: account plate, big Oxanium total, 2px ETN filament
 * (no blur in the popup), bus-bar portfolio (44px rows, single selection,
 * arc-stroke + arc fill on the seated bar), ONE accessory chip max, a
 * per-tab primary (Receive ETN on Home, the labeled Sign breaker on Swap),
 * and the 4-tab dock. The breaker is a layer, not a 5th tab.
 *
 * Activity + Settings are the quiet stubs this pass (real merge/normalize
 * logic lives in @boltvault/activity + @boltvault/settings; this pass gives
 * them their own surfaces + empty states so the tabs are not Home clones).
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

/** Placeholder history — @boltvault/activity merge fills this (T6.1). */
const ACTIVITY_STUB = [
  { id: 'a1', label: 'Swap · ETN → USDC', sub: '2m ago · 0x1F9…C277', usd: -42.1 },
  { id: 'a2', label: 'Received 12.4 ETN', sub: '1h ago · Hyperlane', usd: null },
  { id: 'a3', label: 'Approval · WETN', sub: '2d ago', usd: null },
] as const

/** Placeholder settings groups — @boltvault/settings normalize (T6.6). */
const SETTINGS_STUB = [
  { group: 'Keys', rows: ['Vault · Argon2id + XChaCha20', 'Passkey · not enrolled'] },
  { group: 'Permissions', rows: ['Connected sites · 2'] },
  { group: 'Networks', rows: ['ETN · 52014 (default)', 'Ethereum · 1', 'Base · 8453'] },
  { group: 'Feel', rows: ['Motion · full', 'Sound · off (extension)'] },
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

function BusBar({
  symbol,
  share,
  selected,
  onSelect,
}: {
  symbol: string
  share: number
  selected: boolean
  onSelect: () => void
}) {
  return (
    <button
      data-testid={`busbar-${symbol}`}
      onClick={onSelect}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        width: '100%',
        minHeight: 'var(--bv-bus-bar-height)',
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
  const [selectedBar, setSelectedBar] = useState<string>('ETN')
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
        {tab === 'home' && (
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

            {/* Bus bars — single selection, arc-stroke + arc fill on the seated bar */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {PORTFOLIO.map((t) => (
                <BusBar
                  key={t.symbol}
                  symbol={t.symbol}
                  share={t.share}
                  selected={selectedBar === t.symbol}
                  onSelect={() => setSelectedBar(t.symbol)}
                />
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

        {tab === 'swap' && (
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
        )}

        {tab === 'activity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{ color: 'var(--bv-mute)', fontSize: '12px', marginBottom: '4px' }}>
              Discharges · ETN 52014
            </div>
            {ACTIVITY_STUB.map((a) => (
              <div
                key={a.id}
                data-testid={`activity-${a.id}`}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px',
                  background: 'var(--bv-glass)',
                  borderRadius: '8px',
                  color: 'var(--bv-ink)',
                  fontSize: '13px',
                  fontFamily: 'var(--bv-font-sora)',
                }}
              >
                <div>
                  <div>{a.label}</div>
                  <div style={{ color: 'var(--bv-mute)', fontSize: '11px', marginTop: '2px' }}>{a.sub}</div>
                </div>
                {a.usd != null && (
                  <div style={{ color: a.usd >= 0 ? 'var(--bv-ember)' : 'var(--bv-burn)', fontSize: '12px' }}>
                    {a.usd >= 0 ? '+' : ''}
                    {a.usd.toFixed(2)}
                  </div>
                )}
              </div>
            ))}
            {/* Design: "Other-chain incoming gaps explained once, not per row." */}
            <div style={{ color: 'var(--bv-mute)', fontSize: '11px', marginTop: '8px' }}>
              Other chains show incoming only when bounded getLogs returns — no indexer here.
            </div>
          </div>
        )}

        {tab === 'settings' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {SETTINGS_STUB.map((g) => (
              <div key={g.group}>
                <div style={{ color: 'var(--bv-mute)', fontSize: '11px', textTransform: 'none', marginBottom: '4px' }}>
                  {g.group}
                </div>
                {g.rows.map((r) => (
                  <div
                    key={r}
                    style={{
                      padding: '12px',
                      background: 'var(--bv-glass)',
                      borderRadius: '8px',
                      color: 'var(--bv-ink)',
                      fontSize: '13px',
                      fontFamily: 'var(--bv-font-sora)',
                      marginBottom: '4px',
                    }}
                  >
                    {r}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Per-tab primary. Design: one verb per button from a closed table —
          Swap/Sign/Swapped, Connect, Revoke, Receive, Send. Home → Receive ETN;
          Swap → the labeled Sign breaker (in SwapView); Act/Set → Receive ETN
          as the default "empty invitation with a verb". */}
      {tab !== 'swap' && (
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
      )}

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
              height: 'var(--bv-hit)',
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
