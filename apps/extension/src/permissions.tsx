/**
 * Optional host permissions (master plan §4.7): since Firefox 127 users can
 * decline or revoke `<all_urls>` at install and content scripts then
 * silently never run. Every page opens with this gate: when the permission
 * is missing it explains and asks — from a click, as the browser requires —
 * instead of leaving sites unable to find the wallet.
 */
import { useEffect, useState, type ReactNode } from 'react'

const ORIGINS = { origins: ['<all_urls>'] }

/** The page background, so the moment before the answer arrives is not a white flash. */
const GROUND = '#060913'

export function HostPermissionsGate({ children }: { children: ReactNode }) {
  const [granted, setGranted] = useState<boolean | null>(null)
  /** "Not now" is the user's choice to carry on without it — not evidence the permission exists. */
  const [dismissed, setDismissed] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let alive = true
    browser.permissions
      .contains(ORIGINS)
      .then((ok) => alive && setGranted(ok))
      /*
        This used to resolve `true` on failure. A check that cannot answer was
        therefore indistinguishable from a permission we hold, which is the
        wrong way round for a gate: the recoverable outcome is showing the ask
        one time too many, not hiding it when the permission is actually gone.
        Asking again costs the user one click even where the permission is
        already granted, because `request` resolves without a prompt then.
      */
      .catch(() => alive && setGranted(false))
    return () => {
      alive = false
    }
  }, [])
  if (granted === true || dismissed) return <>{children}</>
  // Until the answer arrives, show the ground rather than the app: rendering
  // children first made the gate something the page simply painted past.
  if (granted === null) return <div style={{ minHeight: '100vh', background: GROUND }} data-testid="host-permissions-checking" />
  const ask = async (): Promise<void> => {
    setBusy(true)
    try {
      setGranted(await browser.permissions.request(ORIGINS))
    } catch {
      setGranted(false)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ minHeight: '100vh', background: GROUND, color: '#DCE5F5', fontFamily: 'Sora, system-ui, sans-serif', padding: 20, display: 'flex', flexDirection: 'column', gap: 12, justifyContent: 'center' }} data-testid="host-permissions">
      <div style={{ fontSize: 17, fontWeight: 600 }}>Let BoltVault work on sites</div>
      <div style={{ fontSize: 14, color: '#8593AD', lineHeight: 1.4 }}>Sites can only find your wallet when BoltVault may run on them. Nothing is read or sent until a site asks you to connect and you say yes.</div>
      <button type="button" onClick={() => void ask()} disabled={busy} style={{ minHeight: 48, borderRadius: 14, border: 0, background: '#5FD8FF', color: '#060913', font: '600 15px Sora, system-ui, sans-serif', cursor: 'pointer' }} data-testid="host-permissions-allow">
        Allow on all sites
      </button>
      <button type="button" onClick={() => setDismissed(true)} style={{ minHeight: 44, borderRadius: 14, border: '1px solid rgba(95,216,255,0.12)', background: '#152238', color: '#DCE5F5', font: '600 15px Sora, system-ui, sans-serif', cursor: 'pointer' }} data-testid="host-permissions-later">
        Not now
      </button>
    </div>
  )
}
