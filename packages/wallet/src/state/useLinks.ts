/**
 * Links become navigation (master plan §5.3): `wc:` pairs, a launchpad link
 * remembers its referrer and opens the campaign, a payment link prefills
 * Send, a screen link navigates. Mounted once per body; the host supplies
 * the URLs. Nothing executes without the user's next tap.
 */
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { parseLink, type LinkAction } from '../links'
import { useRouter } from '../navigation/router'

const ETN = 52014

/**
 * Links the app raised for itself, after asking (ES-BV-039, ES-BV-040).
 *
 * The in-app browser will not hand a `wc:`, `ethereum:` or `boltvault:` URL to
 * the OS any more — the page that asked is not the person, and the OS route
 * came straight back into the wallet with no confirmation anywhere along it.
 * A URL the user has explicitly agreed to open arrives here instead, so it
 * goes through the same parser and the same screens as a real deep link
 * without ever leaving the app.
 */
const listeners = new Set<(url: string, from?: string) => void>()

/**
 * Hand a link to the app as if the OS had delivered it.
 *
 * `from` is where it came from, and it reaches the pairing confirmation
 * (ES-BV-040): "a page you were reading asked to connect" and "you opened this
 * from somewhere else" are different questions, and only the user can answer
 * either. The in-app browser passes the page's origin.
 */
export function deliverLink(url: string, from?: string): void {
  for (const l of [...listeners]) l(url, from)
}

/**
 * A WalletConnect pairing waiting for the user to say yes (ES-BV-040).
 *
 * `pair()` used to run the moment a `wc:` link arrived, from any source — a
 * page inside the in-app browser, another app, a QR in an email — and the
 * first thing the user saw was a Connect sheet for a peer they had not
 * knowingly invited. Pairing itself is not free: it opens a relay subscription
 * and tells the peer this wallet exists. Asking first costs one tap.
 */
export interface PendingPairing {
  readonly uri: string
  /** The topic, which is all a URI says about itself before the peer answers. */
  readonly topic: string
  /**
   * Where the link came from, when the app knows (ES-BV-040).
   *
   * A page inside the in-app browser passes its own origin. "A page you were
   * reading asked to connect" and "you opened this from somewhere else" are
   * different questions and the confirmation should not ask the same one for
   * both.
   */
  readonly from?: string
}

export function useLinks(): {
  pendingPairing: PendingPairing | null
  confirmPairing: () => void
  dismissPairing: () => void
} {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const [pendingPairing, setPendingPairing] = useState<PendingPairing | null>(null)
  useEffect(() => {
    const links = host.links
    const seen = new Set<string>()
    const act = async (url: string, from?: string): Promise<void> => {
      if (seen.has(url)) return
      seen.add(url)
      const action: LinkAction | null = parseLink(url)
      if (!action) return
      switch (action.kind) {
        case 'wc':
          // Not without a yes (ES-BV-040).
          setPendingPairing({
            uri: action.uri,
            topic: action.uri.slice(3).split('@')[0] ?? '',
            ...(from ? { from } : {}),
          })
          return
        case 'launchpad': {
          await engine.launchpad.rememberFromLink({ url: action.url }).catch(() => undefined)
          router.navigate('campaign', { chainId: ETN, pool: action.pool })
          return
        }
        case 'pay':
          router.navigate('send', { to: action.to, ...(action.token ? { token: action.token } : {}), ...(action.chainId ? { chainId: action.chainId } : {}) })
          return
        case 'screen':
          if (action.screen === 'home' || action.screen === 'swap' || action.screen === 'activity') router.setTab(action.screen)
          else if (action.screen === 'explore') router.navigate('explore')
          else if (action.screen === 'browser') router.navigate('browser', action.url ? { url: action.url } : undefined)
          else router.navigate(action.screen)
          return
      }
    }
    void links?.initial().then((url) => (url ? act(url) : undefined))
    const inApp = (url: string, from?: string): void => void act(url, from)
    listeners.add(inApp)
    const off = links?.subscribe((url) => void act(url))
    return () => {
      listeners.delete(inApp)
      off?.()
    }
  }, [engine, host, router])

  return {
    pendingPairing,
    confirmPairing: () => {
      const p = pendingPairing
      setPendingPairing(null)
      if (p) void engine.connect.pair({ uri: p.uri }).catch(() => undefined)
    },
    dismissPairing: () => setPendingPairing(null),
  }
}
