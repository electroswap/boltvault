/**
 * The isolated-world bridge (master plan §4.1, §4.2). Runs first at
 * document_start on every http(s) frame: mints the channel nonce, hands it to
 * the MAIN-world provider, relays page ⇄ service-worker traffic over a Port
 * that is opened only when the page first talks to the wallet.
 *
 * It is also where the AMO fallback lives (§4.7): on a browser that does not
 * honour a manifest-declared `world: 'MAIN'` entry, nothing else would ever
 * install `window.ethereum`.
 */
import { CONFIG_EVENT, hasOpaqueOrigin, injectPageProvider, mainWorldDeclared, mintNonce, PAGE_PROVIDER_FILE, pageProviderWebAccessible, PROVIDER_PORT_NAME, startBridge, type BridgePort, type BridgeWindow, type InjectableDocument, type ManifestLike } from '@boltvault/protocol'
import { defineContentScript } from '#imports'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: false,
  main() {
    // Sandboxed iframes, about:blank and PDFs have an opaque origin. §3.6 denies
    // them: the Port sender URL would key the session to the embedding page.
    // Nothing below runs, so the fallback never injects a provider there either.
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

    /*
      The AMO fallback (§4.7). `mainWorldDeclared` reads the *normalised*
      manifest, so this is a synchronous yes/no at document_start rather than a
      wait to see whether the MAIN-world script shows up — the fallback and the
      manifest path can never both run, and if a browser ever managed both, the
      realm claim in `installFromChannel` still leaves exactly one provider.

      It runs after `startBridge` so the nonce is already being announced by the
      time the injected script asks for it, and only where the build actually
      published the script — a browser that honours `world` never asks a page to
      load something that build did not ship.

      `getURL` is typed to the public paths WXT knew at `wxt prepare` time;
      page-provider.js is emitted by a build hook in `wxt.config.ts` and is only
      web-accessible in the Firefox build, so it is not in that union.
    */
    const manifest = browser.runtime.getManifest() as unknown as ManifestLike
    if (!mainWorldDeclared(manifest) && pageProviderWebAccessible(manifest, PAGE_PROVIDER_FILE)) {
      const url = (browser.runtime as unknown as { getURL(path: string): string }).getURL(`/${PAGE_PROVIDER_FILE}`)
      injectPageProvider(document as unknown as InjectableDocument, url)
    }

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
