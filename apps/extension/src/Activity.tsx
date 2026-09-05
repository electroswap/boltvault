/**
 * Activity — the discharge list (design "Activity").
 *
 * A list of discharges: label, sub-line, signed USD with color
 * (ember positive / burn negative). Design laws honored here:
 * - "Other chains show incoming only when bounded getLogs returns" — the
 *   other-chain gap is explained ONCE, as a footnote, not per row.
 * - "Pending Activity items may breathe" — a pending row runs a subtle
 *   opacity breathe (the only motion allowed on this surface).
 */

export interface ActivityItem {
  id: string
  label: string
  sub: string
  usd: number | null
  pending?: boolean
}

/** Injected once per mount — keyframes can't live in inline styles. */
const BREATHE_CSS = `@keyframes bv-breathe {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
}`

function usdColor(usd: number): string {
  return usd >= 0 ? 'var(--bv-ember)' : 'var(--bv-burn)'
}

export function ActivityView({ items = [] }: { items?: ActivityItem[] }) {
  return (
    <div
      data-testid="activity"
      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <style>{BREATHE_CSS}</style>
      <div style={{ color: 'var(--bv-mute)', fontSize: '12px', marginBottom: '4px' }}>
        Discharges · ETN 52014
      </div>

      {items.length === 0 ? (
        <div style={{ color: 'var(--bv-mute)', fontSize: '13px', padding: '16px 4px' }}>
          No discharges yet — swap or receive to begin.
        </div>
      ) : (
        items.map((a) => (
          <div
            key={a.id}
            data-testid={`activity-item-${a.id}`}
            data-pending={a.pending ? 'true' : undefined}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: '12px',
              padding: '12px',
              background: 'var(--bv-glass)',
              borderRadius: '8px',
              color: 'var(--bv-ink)',
              fontSize: '13px',
              fontFamily: 'var(--bv-font-sora)',
              // Design: pending items may breathe (subtle, not twitchy).
              animation: a.pending ? 'bv-breathe 2.4s ease-in-out infinite' : undefined,
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div>{a.label}</div>
              <div style={{ color: 'var(--bv-mute)', fontSize: '11px', marginTop: '2px' }}>
                {a.sub}
              </div>
            </div>
            {a.usd != null && (
              <div
                style={{
                  color: usdColor(a.usd),
                  fontSize: '12px',
                  fontFamily: 'var(--bv-font-oxanium)',
                }}
              >
                {a.usd >= 0 ? '+' : ''}
                {a.usd.toFixed(2)}
              </div>
            )}
          </div>
        ))
      )}

      {/* Design: the other-chain incoming gap is explained once, not per row. */}
      <div style={{ color: 'var(--bv-mute)', fontSize: '11px', marginTop: '8px' }}>
        Other chains show incoming only when bounded getLogs returns — no indexer here.
      </div>
    </div>
  )
}
