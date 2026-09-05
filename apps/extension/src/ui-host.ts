/**
 * UiHost for the extension bodies (master plan §3.2): the popup never renders
 * secrets — it opens tab.html for them; the tab does. Passkeys are WebAuthn
 * with PRF in either page.
 */
import { createWebAuthnPasskeys, type ScreenId, type UiHost } from '@boltvault/wallet'

export function extensionUiHost(body: 'extension-popup' | 'extension-tab'): UiHost {
  return {
    body,
    secretsAllowed: body === 'extension-tab',
    passkeys: createWebAuthnPasskeys(),
    relayUrl: 'https://electroswap.io/api/wallet/sync',
    openSecretScreen: (screen: ScreenId) => {
      void browser.tabs.create({ url: browser.runtime.getURL(`/tab.html?screen=${screen}`) })
      if (body === 'extension-popup') window.close()
    },
  }
}
