/**
 * Optional host permissions (master plan §4.7): since Firefox 127 users can
 * decline or revoke `<all_urls>` at install and content scripts then
 * silently never run. Every page opens with this gate: when the permission
 * is missing it explains and asks — from a click, as the browser requires —
 * instead of leaving sites unable to find the wallet.
 */
import { useEffect, useState, type ReactNode } from 'react'

const ORIGINS = { origins: ['<all_urls>'] }

export function HostPermissionsGate({ children }: { children: ReactNode }) {
  const [granted, setGranted] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    browser.permissions
      .contains(ORIGINS)
      .then((ok) => alive && setGranted(ok))
      .catch(() => alive && setGranted(true))
    return () => {
      alive = false
    }
  }, [])
  if (granted !== false) return <>{children}</>
  const ask = async (): Promise<void> => {
    setBusy(true)
    try {
      setGranted(await browser.permissions.request(ORIGINS))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ minHeight: '100vh', background: '#060913', color: '#DCE5F5', fontFamily: 'Sora, system-ui, sans-serif', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }} data-testid="host-permissions">
      <div style={{ fontSize: 17, fontWeight: 600 }}>Let BoltVault work on sites</div>
      <div style={{ fontSize: 14, color: '#8593AD', lineHeight: 1.4 }}>Sites can only find your wallet when BoltVault may run on them. Nothing is read or sent until a site asks you to connect and you say yes.</div>
      <button type="button" onClick={() => void ask()} disabled={busy} style={{ minHeight: 48, borderRadius: 14, border: 0, background: '#5FD8FF', color: '#060913', font: '600 15px Sora, system-ui, sans-serif', cursor: 'pointer' }} data-testid="host-permissions-allow">
        Allow on all sites
      </button>
      <button type="button" onClick={() => setGranted(true)} style={{ minHeight: 44, borderRadius: 14, border: '1px solid rgba(95,216,255,0.12)', background: '#152238', color: '#DCE5F5', font: '600 15px Sora, system-ui, sans-serif', cursor: 'pointer' }} data-testid="host-permissions-later">
        Not now
      </button>
    </div>
  )
}
