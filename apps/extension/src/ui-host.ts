/**
 * UiHost for the extension bodies (master plan §3.2, §3.5): the popup never
 * renders secrets — it opens tab.html for them; the tab does. The sign window
 * closes itself after a decision and re-arms its primary after focus.
 * Passkeys are WebAuthn with PRF in every page.
 */
import { createWebAuthnPasskeys, type ScreenId, type UiHost } from '@boltvault/wallet'
import { scanQr } from './qr-scan'

export function extensionUiHost(body: 'extension-popup' | 'extension-tab' | 'extension-sign'): UiHost {
  return {
    body,
    secretsAllowed: body === 'extension-tab',
    passkeys: createWebAuthnPasskeys(),
    relayUrl: 'https://electroswap.io/api/wallet/sync',
    version: browser.runtime.getManifest().version,
    buildHash: __BUILD_HASH__ || null,
    openSecretScreen: (screen: ScreenId) => {
      void browser.tabs.create({ url: browser.runtime.getURL(`/tab.html?screen=${screen}`) })
      if (body !== 'extension-tab') window.close()
    },
    copy: async (text) => {
      await navigator.clipboard.writeText(text)
    },
    openUrl: async (url) => {
      await browser.tabs.create({ url })
    },
    closeWindow: () => window.close(),
    ...(body === 'extension-tab'
      ? {
          scanQr: async (onPart?: (text: string) => boolean) => {
            const overlay = document.createElement('div')
            overlay.setAttribute('data-testid', 'qr-overlay')
            overlay.style.cssText = 'position:fixed;inset:0;background:#060913;z-index:1000;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px'
            const cancel = document.createElement('button')
            cancel.textContent = 'Cancel'
            cancel.style.cssText = 'min-height:44px;padding:0 20px;border-radius:12px;border:1px solid #5FD8FF33;background:#152238;color:#DCE5F5;font:600 15px Sora,sans-serif'
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
            const nav = navigator as unknown as { hid?: { requestDevice(o: { filters: Array<{ vendorId: number }> }): Promise<unknown[]> } }
            if (!nav.hid) return false
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
