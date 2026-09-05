/**
 * Launchpad — the live campaign rack (design §Launchpad).
 *
 * A live campaign list over the @boltvault/launchpad 6-state table:
 * not-started / live / ended-not-finalized / launched-claim / failed-refund /
 * cancelled. v1 is display-level: contribute on `live`, claim on
 * `launched-claim`, refund on `failed-refund` — one verb per state, no tx
 * wiring yet.
 */
import { Breaker, IconRocket } from '@boltvault/design'
import { classifyStatus, type Campaign } from '@boltvault/launchpad'

function weiDisplay(wei: bigint | number): string {
  const n = typeof wei === 'bigint' ? Number(wei) / 1e18 : wei / 1e18
  return `${n.toFixed(2)}`
}

function verbFor(status: Campaign['status']): { verb: string; armed: boolean } {
  switch (status) {
    case 'live':
      return { verb: 'Contribute', armed: true }
    case 'launched-claim':
      return { verb: 'Claim', armed: true }
    case 'failed-refund':
      return { verb: 'Refund', armed: true }
    case 'not-started':
      return { verb: 'Not started', armed: false }
    case 'ended-not-finalized':
      return { verb: 'Awaiting finalize', armed: false }
    case 'cancelled':
      return { verb: 'Cancelled', armed: false }
    default:
      return { verb: '—', armed: false }
  }
}

export function LaunchpadView({ campaigns = [] }: { campaigns?: any[] }) {
  const rows: Campaign[] = campaigns.map((c: any, i: number): Campaign => {
    // Accept already-parsed Campaign rows or raw rows — classifyStatus is
    // defensive and handles both (raw rows go through the same 6-state table).
    const status = c?.status ?? classifyStatus(c)
    return {
      pool: String(c?.pool ?? c?.poolAddress ?? c?.address ?? `pool-${i}`),
      status,
      min: c?.min ?? 0n,
      max: c?.max ?? 0n,
      raised: c?.raised ?? 0n,
      yourFill: c?.yourFill ?? 0n,
      ...(c?.name !== undefined && c?.name !== null ? { name: String(c.name) } : {}),
      raw: c,
    }
  })

  return (
    <div data-testid="launchpad" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
      <div style={{ color: 'var(--bv-mute)', fontSize: '12px', display: 'flex', alignItems: 'center', gap: 6 }}>
        <IconRocket size={16} />
        <span>Live campaigns · ETN</span>
      </div>

      {rows.length === 0 && (
        <div data-testid="launchpad-empty" style={{ color: 'var(--bv-mute)', fontSize: '13px', padding: '16px 4px' }}>
          No campaigns in flight — check back when the pad lights up.
        </div>
      )}

      {rows.map((c) => {
        const { verb, armed } = verbFor(c.status)
        return (
          <div
            key={c.pool}
            data-testid={`campaign-${c.pool}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              padding: '12px',
              background: 'var(--bv-glass)',
              borderRadius: '8px',
              color: 'var(--bv-ink)',
              fontFamily: 'var(--bv-font-sora)',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <span style={{ fontSize: '13px', fontWeight: 600 }}>{c.name ?? c.pool.slice(0, 10) + '…'}</span>
              <span style={{ color: 'var(--bv-mute)', fontSize: '11px' }}>{c.status}</span>
            </div>
            <div style={{ color: 'var(--bv-mute)', fontSize: '11px' }}>
              Raised {weiDisplay(c.raised)} ETN
              {typeof c.max === 'bigint' && c.max > 0n ? ` / ${weiDisplay(c.max)} cap` : ''}
            </div>
            <Breaker label={verb} armed={armed} variant={armed ? 'arc' : 'ghost'} testId={`campaign-${c.pool}-verb`} />
          </div>
        )
      })}
    </div>
  )
}
