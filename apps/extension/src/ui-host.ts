/**
 * UiHost for the extension bodies (master plan §3.2, §3.5): the popup never
 * renders secrets — it opens tab.html for them; the tab does. The sign window
 * closes itself after a decision and re-arms its primary after focus.
 * Passkeys are WebAuthn with PRF in every page.
 */
import { createWebAuthnPasskeys, type ScreenId, type UiHost } from '@boltvault/wallet'

function openTab(query: URLSearchParams, closeSelf: boolean): void {
  void browser.tabs.create({ url: browser.runtime.getURL(`/tab.html?${query.toString()}`) })
  if (closeSelf) window.close()
}
import { scanQr } from './qr-scan'

export function extensionUiHost(
  body: 'extension-popup' | 'extension-tab' | 'extension-sign',
): UiHost {
  return {
    body,
    secretsAllowed: body === 'extension-tab',
    passkeys: createWebAuthnPasskeys(),
    relayUrl: `${__API_ORIGIN__}/api/wallet/sync`,
    version: browser.runtime.getManifest().version,
    buildHash: __BUILD_HASH__ || null,
    // The system's reduce-motion preference is the default; Settings › Appearance can force it on (plan A4).
    prefersReducedMotion: () =>
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
        : false,
    openSecretScreen: (screen: ScreenId) =>
      openTab(new URLSearchParams({ screen }), body !== 'extension-tab'),
    openInTab: (target) => {
      const q = new URLSearchParams()
      if (target.tab) q.set('tab', target.tab)
      if (target.screen) q.set('screen', target.screen)
      if (target.params !== undefined) q.set('p', JSON.stringify(target.params))
      openTab(q, body !== 'extension-tab')
    },
    copy: async (text) => {
      await navigator.clipboard.writeText(text)
    },
    openUrl: async (url) => {
      await browser.tabs.create({ url })
    },
    closeWindow: () => window.close(),
    ...(body === 'extension-popup'
      ? {
          currentTab: async () => {
            const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
            const url = tab?.url ?? tab?.pendingUrl ?? ''
            if (!/^https?:/.test(url)) return null
            const u = new URL(url)
            return { origin: u.origin, host: u.host, favicon: tab?.favIconUrl ?? null }
          },
        }
      : {}),
    ...(body === 'extension-tab'
      ? {
          scanQr: async (onPart?: (text: string) => boolean) => {
            const overlay = document.createElement('div')
            overlay.setAttribute('data-testid', 'qr-overlay')
            overlay.style.cssText =
              'position:fixed;inset:0;background:#060913;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px'
            const cancel = document.createElement('button')
            cancel.textContent = 'Cancel'
            cancel.style.cssText =
              'min-height:44px;padding:0 20px;border-radius:12px;border:1px solid #5FD8FF33;background:#152238;color:#DCE5F5;font:600 15px Sora,sans-serif'
            document.body.appendChild(overlay)
            const session = scanQr(overlay, onPart)
            overlay.appendChild(cancel)
            cancel.onclick = () => session.cancel()
            try {
              return await session.result
            } finally {
              overlay.remove()
            }
          },
          requestHid: async () => {
            const nav = navigator as unknown as {
              hid?: {
                requestDevice(o: { filters: Array<{ vendorId: number }> }): Promise<unknown[]>
              }
            }
            if (!nav.hid)
              throw new Error(
                'This browser has no WebHID. Pair the Ledger from Chrome, Edge or Brave on a computer.',
              )
            const granted = await nav.hid.requestDevice({ filters: [{ vendorId: 0x2c97 }] })
            return granted.length > 0
          },
        }
      : {}),
    onWindowFocus: (listener) => {
      window.addEventListener('focus', listener)
      window.addEventListener('resize', listener)
      return () => {
        window.removeEventListener('focus', listener)
        window.removeEventListener('resize', listener)
      }
    },
  }
}
