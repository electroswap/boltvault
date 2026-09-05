/**
 * ReceiveView (E) — the Receive surface.
 *
 * Design law (the design spec): "QR engraved on glass, chain id ETN 52014
 * in Oxanium under it, share copy includes the chain name." One verb:
 * **Receive** (here the share/copy verb).
 *
 * v1 is presentational: the address is engraved on a glass plate, a QR
 * placeholder (a CSS grid of squares) sits above it, the chain id is stamped
 * under it in Oxanium, and a Share verb carries a copy string that includes
 * the chain name. No network.
 */
import { useMemo } from 'react'
import { Breaker, IconCopy } from '@boltvault/design'

/** Deterministic pseudo-QR: a 9x9 grid derived from the address so it looks
 *  engraved-but-real without a QR codec (v1 is display-only). */
function qrCells(address: string): boolean[] {
  let h = 2166136261
  for (let i = 0; i < address.length; i++) {
    h ^= address.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  const cells: boolean[] = []
  let x = h >>> 0
  for (let i = 0; i < 81; i++) {
    x = (Math.imul(x, 1103515245) + 12345) & 0x7fffffff
    cells.push((x & 0x40000) !== 0)
  }
  return cells
}

export function ReceiveView({
  address,
  chainId = 52014,
  chainName = 'ETN',
  testId = 'receive',
}: {
  address: string
  chainId?: number
  chainName?: string
  testId?: string
}) {
  const cells = useMemo(() => qrCells(address), [address])

  // Share copy includes the chain name (design law).
  const shareCopy = `${address} · ${chainName} (${chainId})`

  return (
    <div
      data-testid={testId}
      style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}
    >
      <div style={{ color: 'var(--bv-mute)', fontSize: '12px' }}>
        Receive on {chainName}
      </div>

      {/* The engraved glass panel: QR placeholder above the address. */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px',
          padding: '20px 16px',
          background: 'var(--bv-glass)',
          borderRadius: '12px',
          border: '1px solid var(--bv-glass)',
        }}
      >
        {/* QR placeholder — a 9x9 grid of squares. */}
        <div
          data-testid={`${testId}-qr`}
          aria-label="QR code"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(9, 1fr)',
            width: '132px',
            height: '132px',
            background: 'var(--bv-void)',
            padding: '6px',
            borderRadius: '6px',
          }}
        >
          {cells.map((on, i) => (
            <div key={i} style={{ background: on ? 'var(--bv-ink)' : 'transparent' }} />
          ))}
        </div>

        {/* The engraved address. */}
        <div
          data-testid={`${testId}-address`}
          title={address}
          style={{
            fontFamily: 'var(--bv-font-oxanium)',
            fontSize: '13px',
            color: 'var(--bv-ink)',
            textAlign: 'center',
            wordBreak: 'break-all',
            letterSpacing: '0.02em',
          }}
        >
          {address}
        </div>

        {/* Chain id under it, in Oxanium. */}
        <div
          data-testid={`${testId}-chain`}
          style={{
            fontFamily: 'var(--bv-font-oxanium)',
            fontSize: '13px',
            fontWeight: 600,
            color: 'var(--bv-arc)',
            letterSpacing: '0.06em',
          }}
        >
          {chainName} {chainId}
        </div>
      </div>

      {/* The Share verb — copy string includes the chain name. */}
      <Breaker
        label="Share"
        armed
        variant="ghost"
        icon={<IconCopy size={16} />}
        testId={`${testId}-share`}
        onClick={() => {
          const nav = (globalThis as any).navigator
          nav?.clipboard?.writeText?.(shareCopy)
        }}
      />
    </div>
  )
}
