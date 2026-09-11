/**
 * The isolated-world bridge (master plan §4.1, §4.2). Runs first at
 * document_start on every http(s) frame: mints the channel nonce, hands it to
 * the MAIN-world provider, relays page ⇄ service-worker traffic over a Port
 * that is opened only when the page first talks to the wallet.
 */
import { CONFIG_EVENT, hasOpaqueOrigin, mintNonce, PROVIDER_PORT_NAME, startBridge, type BridgePort, type BridgeWindow } from '@boltvault/protocol'
import { defineContentScript } from '#imports'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: false,
  main() {
    // Sandboxed iframes, about:blank and PDFs have an opaque origin. §3.6 denies
    // them: the Port sender URL would key the session to the embedding page.
    if (hasOpaqueOrigin(window)) return
    const connect = (): BridgePort => {
      const port = browser.runtime.connect({ name: PROVIDER_PORT_NAME })
      return {
        postMessage: (m) => port.postMessage(m),
        onMessage: (l) => port.onMessage.addListener((m: unknown) => l(m)),
        onDisconnect: (l) => port.onDisconnect.addListener(() => l()),
        disconnect: () => port.disconnect(),
      }
    }
    startBridge({ win: window as unknown as BridgeWindow, nonce: mintNonce((b) => crypto.getRandomValues(b)), connect })

    // Settings that shape the provider (MetaMask compatibility, default wallet)
    // arrive a few milliseconds later than the provider itself; storage is
    // asynchronous at document_start (§4.5).
    // The physical key is prefixed (`platform/src/extension.ts` maps the engine's
    // `local` store onto `chrome.storage.local` under `bv:local:`). Reading the
    // bare name always missed, so this event never fired and `metaMaskCompat` /
    // `defaultWallet` silently never took effect.
    void browser.storage.local.get('bv:local:settings').then((r: Record<string, unknown>) => {
      const doc = r['bv:local:settings'] as { data?: { metaMaskCompat?: boolean; defaultWallet?: boolean } } | undefined
      const value = doc?.data
      if (!value) return
      window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: { isMetaMask: value.metaMaskCompat === true, defaultWallet: value.defaultWallet === true } }))
    })
  },
})
