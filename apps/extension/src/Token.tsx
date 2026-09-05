/**
 * TokenView (E) — the token "schematic" (design "Token info").
 *
 * "Pull a pill into focus; it becomes a schematic (sparkline as a waveform,
 * lock % as a physical bar, tags as stamped marks). BLOCKED tokens get a
 * burn plate, Swap disabled."
 *
 * v1 is display-level: the sparkline is a waveform placeholder, the lock %
 * is a physical bar, tags render as stamped Chip marks, and the price is an
 * injected prop (display-only, no live feed here). A BLOCKED token shows a
 * burn plate and disables the Swap verb. No network.
 */
import { useState } from 'react'
import { Breaker, TokenAvatar, IconAlert } from '@boltvault/design'

export interface TokenSchematic {
  symbol: string
  name: string
  address: string
  chainId?: number
  /** % of the supply / LP locked (0..100) — rendered as a physical bar. */
  lockPct?: number
  /** Stamped marks. */
  tags?: string[]
  /** A deterministic sparkline waveform (0..1 per point). */
  sparkline?: number[]
}

/** A default waveform so an un-injected token still renders a schematic. */
function defaultSparkline(): number[] {
  const pts: number[] = []
  let v = 0.5
  for (let i = 0; i < 24; i++) {
    v = Math.min(1, Math.max(0, v + (Math.sin(i * 0.9) + (Math.random() - 0.5)) * 0.18))
    pts.push(v)
  }
  return pts
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 8)}…${a.slice(-6)}` : a
}

export function TokenView({
  token,
  blocked = false,
  priceUsd,
  testId = 'token',
}: {
  token: TokenSchematic
  blocked?: boolean
  /** Display-only price readout (injected). */
  priceUsd?: number | null
  testId?: string
}) {
  const spark = token.sparkline ?? defaultSparkline()
  const [swapArmed, setSwapArmed] = useState(false)
  const lock = token.lockPct ?? 0

  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}
    >
      {/* The pill in focus: avatar + name + symbol + price. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <TokenAvatar chainId={token.chainId ?? 52014} address={token.address} size={44} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: 'var(--bv-ink)', fontSize: '15px', fontWeight: 600 }}>
            {token.name}
          </div>
          <div style={{ color: 'var(--bv-mute)', fontSize: '12px', fontFamily: 'var(--bv-font-oxanium)' }}>
            {token.symbol} · {shortAddr(token.address)}
          </div>
        </div>
        <div
          data-testid={`${testId}-price`}
          style={{
            fontFamily: 'var(--bv-font-oxanium)',
            fontSize: '16px',
            color: priceUsd == null ? 'var(--bv-mute)' : 'var(--bv-ink)',
          }}
        >
          {priceUsd == null ? '—' : `$${priceUsd.toFixed(4)}`}
        </div>
      </div>

      {/* The sparkline as a waveform. */}
      <div
        data-testid={`${testId}-sparkline`}
        aria-label="price waveform"
        style={{
          display: 'flex',
          alignItems: 'flex-end',
          gap: '2px',
          height: '48px',
          padding: '10px',
          background: 'var(--bv-glass)',
          borderRadius: '10px',
        }}
      >
        {spark.map((p, i) => (
          <div
            key={i}
            style={{
              flex: 1,
              height: `${Math.max(6, p * 100)}%`,
              background: blocked ? 'var(--bv-burn)' : 'var(--bv-plasma)',
              borderRadius: 2,
            }}
          />
        ))}
      </div>

      {/* Lock % as a physical bar. */}
      <div
        data-testid={`${testId}-lock`}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 12px',
          background: 'var(--bv-glass)',
          borderRadius: '8px',
        }}
      >
        <span style={{ color: 'var(--bv-mute)', fontSize: '12px', width: '92px' }}>Locked</span>
        <div
          style={{
            flex: 1,
            height: '8px',
            background: 'var(--bv-void)',
            borderRadius: 4,
            overflow: 'hidden',
          }}
        >
          <div
            style={{
              width: `${Math.min(100, Math.max(0, lock))}%`,
              height: '100%',
              background: blocked ? 'var(--bv-burn)' : 'var(--bv-arc)',
              borderRadius: 4,
            }}
          />
        </div>
        <span style={{ color: 'var(--bv-ink)', fontSize: '12px', fontFamily: 'var(--bv-font-oxanium)' }}>
          {lock.toFixed(0)}%
        </span>
      </div>

      {/* Tags as stamped marks. */}
      {token.tags && token.tags.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
          {token.tags.map((t) => (
            <span
              key={t}
              data-testid={`${testId}-tag-${t.toLowerCase()}`}
              style={{
                padding: '3px 8px',
                background: 'var(--bv-glass)',
                border: '1px solid var(--bv-glass)',
                borderRadius: '999px',
                color: 'var(--bv-mute)',
                fontSize: '11px',
                letterSpacing: '0.03em',
              }}
            >
              {t}
            </span>
          ))}
        </div>
      )}

      {/* BLOCKED → burn plate + Swap disabled. */}
      {blocked && (
        <div
          data-testid={`${testId}-burn`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '10px 12px',
            background: 'var(--bv-burn)',
            color: 'var(--bv-void)',
            borderRadius: '8px',
            fontSize: '12px',
            fontFamily: "var(--bv-font-sora)",
          }}
        >
          <IconAlert size={16} />
          <span>BLOCKED — trading suspended for {token.symbol}. Verify before swapping.</span>
        </div>
      )}

      <Breaker
        label="Swap"
        armed={swapArmed && !blocked}
        testId={`${testId}-swap`}
        onClick={() => setSwapArmed(true)}
      />
    </div>
  )
}
