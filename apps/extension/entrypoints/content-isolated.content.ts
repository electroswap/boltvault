/**
 * The isolated-world bridge (master plan §4.1, §4.2). Runs first at
 * document_start on every http(s) frame: mints the channel nonce, hands it to
 * the MAIN-world provider, relays page ⇄ service-worker traffic over a Port
 * that is opened only when the page first talks to the wallet.
 */
import { CONFIG_EVENT, mintNonce, PROVIDER_PORT_NAME, startBridge, type BridgePort, type BridgeWindow } from '@boltvault/protocol'
import { defineContentScript } from '#imports'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: false,
  main() {
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
    void browser.storage.local.get('settings').then((r: Record<string, unknown>) => {
      const doc = r['settings'] as { data?: { metaMaskCompat?: boolean; defaultWallet?: boolean } } | undefined
      const value = doc?.data
      if (!value) return
      window.dispatchEvent(new CustomEvent(CONFIG_EVENT, { detail: { isMetaMask: value.metaMaskCompat === true, defaultWallet: value.defaultWallet === true } }))
    })
  },
})
