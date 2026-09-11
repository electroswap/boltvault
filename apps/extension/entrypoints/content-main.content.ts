/**
 * The MAIN-world provider (master plan §4.2, §4.3). Zero imports of
 * chrome/browser: it receives the channel nonce from the isolated script by
 * CustomEvent (either ordering) and installs `window.ethereum` + EIP-6963
 * before any page script runs.
 */
import { CHANNEL_EVENT, CHANNEL_REQUEST_EVENT, hasOpaqueOrigin, installProvider, windowTransport, type WindowLike } from '@boltvault/protocol'
import { defineContentScript } from '#imports'
import { BOLTVAULT_ICON, BOLTVAULT_NAME, BOLTVAULT_PROVIDER_UUID, BOLTVAULT_RDNS } from '../src/identity'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  matchAboutBlank: false,
  world: 'MAIN',
  main() {
    // No provider in an opaque origin (§3.6) — the isolated script refuses too,
    // but the MAIN world must not depend on that to stay safe.
    if (hasOpaqueOrigin(window)) return
    let installed = false
    const install = (nonce: string): void => {
      if (installed || !nonce) return
      installed = true
      installProvider({
        transport: windowTransport(window, nonce),
        channel: nonce,
        win: window as unknown as WindowLike,
        uuid: BOLTVAULT_PROVIDER_UUID,
        name: BOLTVAULT_NAME,
        icon: BOLTVAULT_ICON,
        rdns: BOLTVAULT_RDNS,
      })
    }
    window.addEventListener(CHANNEL_EVENT, (ev) => install(String((ev as CustomEvent<string>).detail ?? '')))
    window.dispatchEvent(new CustomEvent(CHANNEL_REQUEST_EVENT))
  },
})
