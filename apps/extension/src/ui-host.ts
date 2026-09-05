/**
 * UiHost for the extension bodies (master plan §3.2, §3.5): the popup never
 * renders secrets — it opens tab.html for them; the tab does. The sign window
 * closes itself after a decision and re-arms its primary after focus.
 * Passkeys are WebAuthn with PRF in every page.
 */
import { createWebAuthnPasskeys, type ScreenId, type UiHost } from '@boltvault/wallet'

export function extensionUiHost(body: 'extension-popup' | 'extension-tab' | 'extension-sign'): UiHost {
  return {
    body,
    secretsAllowed: body === 'extension-tab',
    passkeys: createWebAuthnPasskeys(),
    relayUrl: 'https://electroswap.io/api/wallet/sync',
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
