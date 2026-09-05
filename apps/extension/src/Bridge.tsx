/**
 * BridgeView (E) — the warp bridge (design "Bridge").
 *
 * "A cable between two chamber plates. Message-id is a pulse traveling; it
 * lands when dest Process logs. Empty-code dest: breaker locked until the
 * user types the dest chain name."
 *
 * v1 is display-level: source (ETN 52014) + destination picker from
 * WARP_ROUTES corridors, a warp-asset selector (USDC/USDT), a cable visual
 * between two chamber plates, and a Breaker that stays LOCKED (empty-code
 * rule) until a destination is chosen. After dispatch a message-id pulse is
 * shown. No network.
 */
import { useState, type CSSProperties } from 'react'
import { Breaker, Chip, IconCable } from '@boltvault/design'
import { WARP_ROUTES } from '@boltvault/electroswap'

/** Display names for the warp corridors (design: empty-code until named). */
const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  56: 'BNB Chain',
  8453: 'Base',
  43114: 'Avalanche',
  42161: 'Arbitrum',
  10: 'OP Mainnet',
  137: 'Polygon',
}

function shortMsg(): string {
  // A Hyperlane-style message id (hex) for the pulse.
  let hex = '0x'
  for (let i = 0; i < 8; i++) hex += Math.floor(Math.random() * 16).toString(16)
  return hex
}

export function BridgeView({ testId = 'bridge' }: { testId?: string }) {
  const [dest, setDest] = useState<number | null>(null)
  const [asset, setAsset] = useState<'USDC' | 'USDT'>('USDC')
  const [dispatched, setDispatched] = useState<string | null>(null)

  const corridors = WARP_ROUTES[0]?.destinations ?? []
  const destName = dest != null ? CHAIN_NAMES[dest] ?? `Chain ${dest}` : null
  const armed = dest != null && destName != null

  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      <div style={{ color: 'var(--bv-mute)', fontSize: '12px' }}>
        Warp · ETN 52014 → {destName ?? 'pick a chain'}
      </div>

      {/* Warp-asset selector (USDC / USDT). */}
      <div data-testid={`${testId}-assets`} style={{ display: 'flex', gap: 8 }}>
        {WARP_ROUTES.map((r) => (
          <button
            key={r.symbol}
            data-testid={`${testId}-asset-${r.symbol}`}
            onClick={() => setAsset(r.symbol)}
            style={assetStyle(asset === r.symbol)}
          >
            {r.symbol}
          </button>
        ))}
      </div>

      {/* The cable between two chamber plates. */}
      <div
        data-testid={`${testId}-cable`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '14px 12px',
          background: 'var(--bv-glass)',
          borderRadius: '10px',
        }}
      >
        <div style={plateStyle}>
          <div style={plateLabel}>ETN</div>
          <div style={plateSub}>52014</div>
        </div>
        <div style={cableStyle(armed)}>
          <IconCable size={18} />
        </div>
        <div style={plateStyle}>
          <div style={plateLabel}>{dest != null ? String(dest) : '—'}</div>
          <div style={plateSub}>{destName ?? 'dest'}</div>
        </div>
      </div>

      {/* Destination picker (the empty-code rule: pick + name to arm). */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <span style={mutedSmall}>Destination (type the chain name to confirm)</span>
        <select
          data-testid={`${testId}-dest`}
          value={dest ?? ''}
          onChange={(e) => setDest(e.target.value === '' ? null : Number(e.target.value))}
          style={selectStyle}
        >
          <option value="">— choose a corridor —</option>
          {corridors.map((c) => (
            <option key={c} value={c}>
              {CHAIN_NAMES[c] ?? `Chain ${c}`} · {c}
            </option>
          ))}
        </select>
      </div>

      {/* Dispatch — locked until a dest is named (empty-code rule). */}
      <Breaker
        label={dispatched ? 'Warp in flight' : `Warp ${asset}`}
        armed={armed}
        testId={`${testId}-dispatch`}
        onClick={() => setDispatched(shortMsg())}
      />

      {/* Message-id pulse — shown once dispatched. */}
      {dispatched && (
        <Chip
          testId={`${testId}-pulse`}
          label="Message id traveling — lands when dest Process logs"
          sub={dispatched}
          icon={<IconCable size={16} />}
        />
      )}
    </div>
  )
}

const mutedSmall: CSSProperties = {
  color: 'var(--bv-mute)',
  fontSize: '12px',
  marginBottom: '2px',
}

function assetStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    height: 'var(--bv-hit)',
    background: active ? 'var(--bv-arc)' : 'var(--bv-glass)',
    color: active ? 'var(--bv-void)' : 'var(--bv-ink)',
    border: '1px solid var(--bv-glass)',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 13,
    cursor: 'pointer',
    fontFamily: "var(--bv-font-sora)",
  }
}

const plateStyle: CSSProperties = {
  width: '64px',
  height: '64px',
  borderRadius: '10px',
  background: 'var(--bv-void)',
  border: '1px solid var(--bv-glass)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '2px',
}
const plateLabel: CSSProperties = {
  fontFamily: "var(--bv-font-oxanium)",
  fontSize: '15px',
  fontWeight: 600,
  color: 'var(--bv-ink)',
}
const plateSub: CSSProperties = { fontSize: '10px', color: 'var(--bv-mute)' }

function cableStyle(active: boolean): CSSProperties {
  return {
    flex: 1,
    height: '2px',
    background: active ? 'var(--bv-arc)' : 'var(--bv-mute)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: active ? 'var(--bv-arc)' : 'var(--bv-mute)',
  }
}

const selectStyle: CSSProperties = {
  height: 'var(--bv-hit)',
  padding: '0 10px',
  background: 'var(--bv-glass)',
  color: 'var(--bv-ink)',
  border: '1px solid var(--bv-glass)',
  borderRadius: 8,
  fontFamily: "var(--bv-font-sora)",
  fontSize: 13,
}
