/**
 * Approvals — the fuse box (design "Approvals").
 *
 * "A fuse box. Unlimited = fat burn fuse. Tap to pull (revoke)."
 * One fuse row per approval: token + spender, and when the allowance is
 * unlimited the fuse is FAT (extra padding) and BURN (burn background) with
 * an "Unlimited" label. Tapping a fuse pulls it — the Revoke verb — via the
 * optional `onRevoke` callback (the caller builds the revoke tx from
 * @boltvault/approvals' pure builders).
 */

export interface ApprovalFuse {
  id: string
  token: string
  spender: string
  unlimited: boolean
}

export function ApprovalsView({
  approvals = [],
  onRevoke,
}: {
  approvals?: ApprovalFuse[]
  onRevoke?: (id: string) => void
}) {
  const burnCount = approvals.filter((a) => a.unlimited).length
  return (
    <div
      data-testid="approvals"
      style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}
    >
      <div style={{ color: 'var(--bv-mute)', fontSize: '12px', marginBottom: '4px' }}>
        Fuse box · {approvals.length} approval{approvals.length === 1 ? '' : 's'}
      </div>

      {burnCount > 0 && (
        <div
          data-testid="approvals-burn-banner"
          style={{
            padding: '10px 12px',
            background: 'var(--bv-glass)',
            border: '1px solid var(--bv-burn)',
            borderRadius: '8px',
            color: 'var(--bv-ink)',
            fontSize: '12px',
            fontFamily: 'var(--bv-font-sora)',
          }}
        >
          {burnCount} infinite approval{burnCount === 1 ? '' : 's'} — anyone can
          move this token. Tap a fuse to pull it.
        </div>
      )}

      {approvals.length === 0 ? (
        <div style={{ color: 'var(--bv-mute)', fontSize: '13px', padding: '16px 4px' }}>
          No approvals in the box. Nothing can move your tokens.
        </div>
      ) : (
        approvals.map((a) => (
          <button
            key={a.id}
            data-testid={`approvals-fuse-${a.id}`}
            onClick={() => onRevoke?.(a.id)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              width: '100%',
              // The unlimited fuse is FAT: bigger padding, burn face.
              padding: a.unlimited ? '16px 14px' : '12px',
              background: a.unlimited ? 'var(--bv-burn)' : 'var(--bv-glass)',
              color: a.unlimited ? 'var(--bv-void)' : 'var(--bv-ink)',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
              fontFamily: 'var(--bv-font-sora)',
              fontSize: '13px',
              textAlign: 'left',
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontWeight: 600 }}>{a.token}</div>
              <div
                style={{
                  color: a.unlimited ? 'var(--bv-void)' : 'var(--bv-mute)',
                  fontSize: '11px',
                  marginTop: '2px',
                  opacity: a.unlimited ? 0.85 : 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {a.spender}
              </div>
              {a.unlimited && (
                <div
                  data-testid={`approvals-unlimited-${a.id}`}
                  style={{
                    marginTop: '6px',
                    display: 'inline-block',
                    padding: '2px 8px',
                    background: 'var(--bv-void)',
                    color: 'var(--bv-burn)',
                    borderRadius: '999px',
                    fontWeight: 700,
                    fontSize: '11px',
                    letterSpacing: '0.04em',
                  }}
                >
                  Unlimited
                </div>
              )}
            </div>
            <span
              data-testid={`approvals-revoke-${a.id}`}
              style={{
                fontWeight: 600,
                fontSize: '12px',
                color: a.unlimited ? 'var(--bv-void)' : 'var(--bv-arc)',
                whiteSpace: 'nowrap',
              }}
            >
              Revoke
            </span>
          </button>
        ))
      )}
    </div>
  )
}
