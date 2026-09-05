/**
 * AccountSwitcher (D) — the top-of-every-tab account rail.
 *
 * Design: "one seated account + chevron; the ring is a sheet." The seated
 * key is the signer; switching re-reads the portfolio for the new account.
 * Reuses the design Sheet primitive.
 */
import { useState } from 'react'
import { Sheet, IconBolt, type IconProps } from '@boltvault/design'
import type { VaultAccount } from './identity'

const short = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

export function AccountSwitcher({
  accounts,
  currentId,
  onSwitch,
  testId = 'account-switcher',
}: {
  accounts: readonly VaultAccount[]
  currentId: string | null
  onSwitch: (id: string) => void
  testId?: string
}) {
  const [open, setOpen] = useState(false)
  const current = accounts.find((a) => a.id === currentId) ?? accounts[0] ?? null

  return (
    <>
      <button
        data-testid={testId}
        onClick={() => setOpen(true)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
          background: 'transparent',
          border: 'none',
          color: 'var(--bv-ink)',
          fontSize: '14px',
          fontFamily: 'var(--bv-font-sora)',
          cursor: 'pointer',
          padding: 0,
        }}
      >
        <IconBolt size={16} />
        {current ? current.label : 'main'} ▾
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title="Account" testId={`${testId}-sheet`}>
        {accounts.map((a) => (
          <button
            key={a.id}
            data-testid={`${testId}-item-${a.id}`}
            onClick={() => {
              onSwitch(a.id)
              setOpen(false)
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              width: '100%',
              minHeight: 'var(--bv-hit)',
              background: 'transparent',
              border: a.id === currentId ? '1px solid var(--bv-arc)' : '1px solid transparent',
              borderRadius: 8,
              padding: '0 12px',
              color: 'var(--bv-ink)',
              fontFamily: 'var(--bv-font-sora)',
              fontSize: 13,
              cursor: 'pointer',
              textAlign: 'left',
              marginBottom: 4,
            }}
          >
            <span>{a.label}</span>
            <span style={{ color: 'var(--bv-mute)', fontSize: 11 }}>{short(a.address)}</span>
          </button>
        ))}
      </Sheet>
    </>
  )
}

export type { IconProps }
