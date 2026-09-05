// @boltvault/design — shared React primitives.
//
// These replace the ad-hoc inline styling that used to live in App.tsx /
// SwapView.tsx and give every surface the same craft. Each takes a `testId`
// (rendered as data-testid) so Playwright/vitest can assert. Style is inline
// objects (RN-ready per design D2), consuming the tokens via CSS vars.
import { useEffect, type CSSProperties, type ReactNode } from 'react'
import { palette, metrics } from './tokens'
import type { IconProps } from './icons'

export type TestId = string

const s = (o: CSSProperties): CSSProperties => o

/**
 * The labeled primary button — the "breaker". One verb from the closed table
 * (Swap/Sign/Swapped, Connect, Revoke, Receive, Send). `armed` drives the
 * arc fill; otherwise it is a glass plate.
 */
export function Breaker({
  label,
  armed = false,
  onClick,
  variant = 'arc',
  icon,
  testId,
}: {
  label: string
  armed?: boolean
  onClick?: () => void
  variant?: 'arc' | 'burn' | 'ghost'
  icon?: ReactNode
  testId?: string
}) {
  const bg = variant === 'burn' ? palette.burn : variant === 'ghost' ? palette.glass : armed ? palette.arc : palette.glass
  const fg = variant === 'ghost' ? (armed ? palette.arc : palette.mute) : armed ? palette.void : palette.mute
  return (
    <button
      data-testid={testId}
      data-armed={String(armed)}
      disabled={!armed && variant !== 'ghost'}
      onClick={onClick}
      style={s({
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        width: '100%',
        height: metrics.hit,
        background: bg,
        color: fg,
        border: 'none',
        borderRadius: 8,
        fontWeight: 600,
        fontSize: 14,
        fontFamily: "var(--bv-font-sora)",
        cursor: armed || variant === 'ghost' ? 'pointer' : 'default',
      })}
    >
      {icon}
      {label}
    </button>
  )
}

/** A portfolio bus bar — 44px min height, arc-stroke + arc fill when selected. */
export function BusBar({
  symbol,
  share,
  selected = false,
  onSelect,
  avatar,
  price,
  testId,
}: {
  symbol: string
  share: number
  selected?: boolean
  onSelect?: () => void
  avatar?: ReactNode
  price?: ReactNode
  testId?: string
}) {
  return (
    <button
      data-testid={testId ?? `busbar-${symbol}`}
      onClick={onSelect}
      style={s({
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        minHeight: metrics.busBarHeight,
        background: 'transparent',
        border: `1px solid ${selected ? palette.arc : 'transparent'}`,
        borderRadius: 6,
        cursor: 'pointer',
        padding: '0 12px',
        textAlign: 'left',
        color: palette.ink,
        fontFamily: 'var(--bv-font-sora)',
        fontSize: 13,
      })}
    >
      {avatar}
      <span style={{ width: 52, color: selected ? palette.arc : palette.ink }}>{symbol}</span>
      <div
        data-testid={testId ? `${testId}-fill` : `busbar-${symbol}-fill`}
        style={{ flex: 1, height: 10, borderRadius: 5, background: palette.glass, position: 'relative', overflow: 'hidden' }}
      >
        <div
          style={{
            width: `${Math.round(share * 100)}%`,
            height: '100%',
            background: selected ? palette.arc : palette.plasma,
            borderRadius: 5,
          }}
        />
      </div>
      <span style={{ color: palette.mute, width: 72, textAlign: 'right' }}>{price ?? `${Math.round(share * 100)}%`}</span>
    </button>
  )
}

/** A swap terminal (stacked pay/receive row). */
export function Terminal({
  label,
  amount,
  token,
  avatar,
  testId,
}: {
  label: string
  amount: string
  token: { symbol: string }
  avatar?: ReactNode
  testId?: string
}): ReactNode {
  return (
    <div
      data-testid={testId ?? 'terminal'}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: 12,
        background: palette.glass,
        borderRadius: 10,
      }}
    >
      {avatar}
      <div style={{ flex: 1 }}>
        <div style={{ color: palette.mute, fontSize: 11 }}>{label}</div>
        <div style={{ color: palette.ink, fontSize: 18, fontFamily: 'var(--bv-font-oxanium)' }}>{amount}</div>
      </div>
      <div style={{ color: palette.ink, fontSize: 14, fontWeight: 600 }}>{token.symbol}</div>
    </div>
  )
}

/** An accessory chip (the one Home accessory slot: bridge > farm > campaign). */
export function Chip({
  icon,
  label,
  sub,
  onDismiss,
  testId,
}: {
  icon?: ReactNode
  label: string
  sub?: string
  onDismiss?: () => void
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        background: palette.glass,
        borderRadius: 8,
        color: palette.ink,
        fontSize: 12,
        fontFamily: 'var(--bv-font-sora)',
      }}
    >
      {icon}
      <div style={{ flex: 1 }}>
        <div>{label}</div>
        {sub ? <div style={{ color: palette.mute, fontSize: 11, marginTop: 2 }}>{sub}</div> : null}
      </div>
      {onDismiss ? (
        <button data-testid={testId ? `${testId}-dismiss` : undefined} onClick={onDismiss} style={{ background: 'none', border: 'none', color: palette.mute, cursor: 'pointer' }}>
          ×
        </button>
      ) : null}
    </div>
  )
}

/**
 * A bottom sheet / modal layer — "the breaker is a layer, not a 5th tab."
 * Overlay + a glass panel anchored to the bottom. Escape closes.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
  testId,
}: {
  open: boolean
  onClose: () => void
  title?: string
  children: ReactNode
  testId?: string
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div
      data-testid={testId}
      role="dialog"
      aria-modal="true"
      style={{ position: 'absolute', inset: 0, background: 'rgba(5,6,12,0.7)', display: 'flex', alignItems: 'flex-end', zIndex: 50 }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%',
          maxHeight: '85%',
          overflowY: 'auto',
          background: palette.glass,
          borderTopLeftRadius: 14,
          borderTopRightRadius: 14,
          padding: metrics.inset,
          color: palette.ink,
          fontFamily: 'var(--bv-font-sora)',
        }}
      >
        {title ? (
          <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>{title}</div>
        ) : null}
        {children}
      </div>
    </div>
  )
}

/** Empty state — an invitation with a verb, never a sad mascot. */
export function EmptyState({
  icon,
  title,
  verb,
  onVerb,
  testId,
}: {
  icon?: ReactNode
  title: string
  verb?: string
  onVerb?: () => void
  testId?: string
}) {
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        padding: 32,
        textAlign: 'center',
        color: palette.ink,
        fontFamily: 'var(--bv-font-sora)',
      }}
    >
      {icon}
      <div style={{ color: palette.mute, fontSize: 13 }}>{title}</div>
      {verb ? (
        <button
          onClick={onVerb}
          type={onVerb ? 'button' : undefined}
          style={{
            height: metrics.hit,
            padding: '0 20px',
            background: palette.arc,
            color: palette.void,
            border: 'none',
            borderRadius: 8,
            fontWeight: 600,
            cursor: onVerb ? 'pointer' : 'default',
          }}
        >
          {verb}
        </button>
      ) : null}
    </div>
  )
}

/**
 * The 2px filament. `active` = current is flowing (arc); stalled = held at the
 * last head (mute) before it snaps. NO blur in the popup (glow is the a11y bug).
 * The stall-then-snap behavior is driven by the caller flipping `active`.
 */
export function Filament({ active = false, stalled = false, testId }: { active?: boolean; stalled?: boolean; testId?: string }) {
  const color = active ? palette.arc : stalled ? palette.mute : palette.mute
  return (
    <div
      data-testid={testId}
      style={{
        height: metrics.filament,
        background: color,
        borderRadius: 1,
        marginTop: 16,
        marginBottom: 24,
        transition: 'background 120ms linear',
      }}
    />
  )
}

/**
 * A static gauge (farm duration 1.0x→2.5x, NOT a twitchy coil). Renders a
 * conic-gradient arc at `value`/`max`. Purely display — no per-block motion.
 */
export function Gauge({
  value,
  max = 2.5,
  label,
  testId,
}: {
  value: number
  max?: number
  label?: ReactNode
  testId?: string
}) {
  const pct = Math.max(0, Math.min(1, (value - 1) / (max - 1))) * 100
  return (
    <div
      data-testid={testId}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        padding: 12,
        background: palette.glass,
        borderRadius: 10,
        color: palette.ink,
        fontFamily: 'var(--bv-font-sora)',
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: '50%',
          background: `conic-gradient(${palette.plasma} ${pct}%, ${palette.void} 0)`,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div style={{ width: 44, height: 44, borderRadius: '50%', background: palette.glass, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span style={{ fontFamily: 'var(--bv-font-oxanium)', fontWeight: 600, fontSize: 14, color: palette.plasma }}>{value.toFixed(2)}x</span>
        </div>
      </div>
      {label}
    </div>
  )
}

export interface RackItem {
  key: string
  thumb?: ReactNode
  title: string
  sub?: string
  selected?: boolean
  onSelect?: () => void
}

/** The NFT "labeled rack" — a grid of thumb + name + floor. */
export function Rack({ items, testId }: { items: RackItem[]; testId?: string }) {
  const rackId = testId ?? 'rack'
  return (
    <div data-testid={rackId} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: 'var(--bv-font-sora)' }}>
      {items.map((it) => (
        <div
          key={it.key}
          data-testid={`${rackId}-${it.key}`}
          onClick={it.onSelect}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
            padding: 10,
            background: palette.glass,
            borderRadius: 8,
            border: `1px solid ${it.selected ? palette.arc : 'transparent'}`,
            cursor: it.onSelect ? 'pointer' : 'default',
          }}
        >
          <div style={{ width: 48, height: 48, borderRadius: 8, background: palette.void, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
            {it.thumb}
          </div>
          <div style={{ color: palette.ink, fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{it.title}</div>
          {it.sub ? <div style={{ color: palette.mute, fontSize: 11 }}>{it.sub}</div> : null}
        </div>
      ))}
    </div>
  )
}

export type { IconProps }
