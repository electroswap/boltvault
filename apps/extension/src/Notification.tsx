/**
 * NotificationView (G) — the signing notification window.
 *
 * Design §tab: "Signing: Notification window, breaker, no game enter-animation.
 * Same breaker [as the popup/mobile]." The breaker's VoiceOver order is
 * origin → diffs → fee → primary verb, and the origin domain is the LARGEST
 * type on the breaker. The chamber is quiet (no filament/coil, no motion).
 *
 * This is a `windows.create` surface (design §usability 6): it carries ONE
 * signing request at a time. The request arrives via a `bv:notify:*` message
 * from the SW (or, in v1, is injected as props for the demo/tests).
 */
import { useEffect, useState } from 'react'
import { Breaker, Chip } from '@boltvault/design'

export interface NotifyRequest {
  origin: string
  method: string
  diffs: { label: string; value: string }[]
  /** The in-wallet swap fee line, if this is an in-wallet swap (0.25%). */
  fee?: string
  /** The seated key that would sign. */
  account?: string
}

export function NotificationView({
  initial,
  onDone,
  testId = 'notification',
}: {
  initial?: NotifyRequest | null
  onDone?: (verb: 'Sign' | 'Connect' | 'Reject') => void
  testId?: string
}) {
  const [req, setReq] = useState<NotifyRequest | null>(initial ?? null)
  const [busy, setBusy] = useState(false)

  // Pull a pending request from the SW if we didn't get one as a prop.
  useEffect(() => {
    if (req) return
    const b = (globalThis as any).browser
    b?.runtime?.sendMessage?.({ type: 'bv:notify:get' })
      .then((r: any) => {
        if (r?.request) setReq(r.request)
      })
      .catch(() => {})
  }, [req])

  const isConnect =
    !!req && (req.method.toLowerCase().includes('requestaccounts') || req.method.toLowerCase().includes('eth_accounts'))
  const primary = isConnect ? 'Connect' : 'Sign'

  const act = (verb: 'Sign' | 'Connect' | 'Reject') => {
    if (busy) return
    setBusy(true)
    onDone?.(verb)
    const b = (globalThis as any).browser
    b?.runtime?.sendMessage?.({ type: 'bv:notify:done', verb }).catch(() => {})
    // Close the window after the verb is resolved (the SW answers the dApp).
    setTimeout(() => (window as any).close?.(), 250)
  }

  return (
    <div
      data-testid={testId}
      style={{
        width: 380,
        background: 'var(--bv-void)',
        color: 'var(--bv-ink)',
        fontFamily: 'var(--bv-font-sora)',
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {req ? (
        <>
          {/* Origin domain — the largest type on the breaker. */}
          <div
            data-testid={`${testId}-origin`}
            style={{ fontFamily: 'var(--bv-font-oxanium)', fontSize: 28, fontWeight: 600, letterSpacing: '-0.02em' }}
          >
            {req.origin}
          </div>
          <div style={{ color: 'var(--bv-mute)', fontSize: 12, marginTop: -8 }}>{req.method}</div>

          {/* Simulation diffs — mass in / mass out pills. */}
          {req.diffs.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {req.diffs.map((d, i) => (
                <Chip key={i} label={d.label} sub={d.value} testId={`${testId}-diff-${i}`} />
              ))}
            </div>
          )}

          {/* Fee line (in-wallet swap 0.25%), if present. */}
          {req.fee && (
            <div data-testid={`${testId}-fee`} style={{ color: 'var(--bv-ember)', fontSize: 13 }}>
              {req.fee}
            </div>
          )}

          {req.account && (
            <div style={{ color: 'var(--bv-mute)', fontSize: 12 }}>
              Sign with {req.account.slice(0, 6)}…{req.account.slice(-4)}
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <Breaker
              label={primary}
              armed
              variant="arc"
              testId={`${testId}-${primary.toLowerCase()}`}
              onClick={() => act(primary)}
            />
            <Breaker label="Reject" armed variant="ghost" testId={`${testId}-reject`} onClick={() => act('Reject')} />
          </div>
        </>
      ) : (
        <div data-testid={`${testId}-empty`} style={{ color: 'var(--bv-mute)', fontSize: 13, padding: 24, textAlign: 'center' }}>
          Waiting for a request…
        </div>
      )}
    </div>
  )
}
