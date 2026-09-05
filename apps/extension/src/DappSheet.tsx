/**
 * DappSheet (D) — the dApp request sheet.
 *
 * Design: "Origin domain is the LARGEST type on the breaker. Simulation diffs
 * are mass in / mass out, same pills as Home. Dim the chamber. No bolt
 * animation until they sign." One verb from the closed table (Connect / Sign /
 * Reject). The seated key is the signer.
 */
import { useState } from 'react'
import { Breaker, Sheet, Chip } from '@boltvault/design'

export interface DappDiff {
  label: string
  value: string
}

export function DappSheet({
  open,
  origin,
  method,
  diffs = [],
  account,
  onVerb,
  onClose,
  testId = 'dapp-sheet',
}: {
  open: boolean
  origin: string
  method: string
  diffs?: DappDiff[]
  account?: string
  onVerb: (verb: 'Connect' | 'Sign' | 'Reject') => void
  onClose: () => void
  testId?: string
}) {
  // `method` drives the primary verb (closed table): eth_requestAccounts ->
  // Connect, sign/swap/send -> Sign. Reject is always available.
  const isConnect = method.toLowerCase().includes('requestaccounts') || method.toLowerCase().includes('eth_accounts')
  const primary = isConnect ? 'Connect' : 'Sign'

  return (
    <Sheet open={open} onClose={onClose} title={origin} testId={testId}>
      {/* Origin domain — the largest type on the breaker. */}
      <div
        data-testid={`${testId}-origin`}
        style={{ fontFamily: 'var(--bv-font-oxanium)', fontSize: 26, fontWeight: 600, letterSpacing: '-0.02em', color: 'var(--bv-ink)', marginBottom: 4 }}
      >
        {origin}
      </div>
      <div style={{ color: 'var(--bv-mute)', fontSize: 12, marginBottom: 16 }}>{method}</div>

      {/* Simulation diffs — mass in / mass out pills (same as Home). */}
      {diffs.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>
          {diffs.map((d, i) => (
            <Chip key={i} label={d.label} sub={d.value} testId={`${testId}-diff-${i}`} />
          ))}
        </div>
      )}

      {account && (
        <div style={{ color: 'var(--bv-mute)', fontSize: 12, marginBottom: 16, fontFamily: 'var(--bv-font-sora)' }}>
          Sign with {account.slice(0, 6)}…{account.slice(-4)}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Breaker label={primary} armed variant="arc" testId={`${testId}-${primary.toLowerCase()}`} onClick={() => onVerb(primary)} />
        <Breaker label="Reject" armed variant="ghost" testId={`${testId}-reject`} onClick={() => onVerb('Reject')} />
      </div>
    </Sheet>
  )
}
