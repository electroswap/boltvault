import { defineContentScript } from '#imports'

/**
 * ISOLATED-world bridge (T3.4).
 *
 * Runs in the page's ISOLATED world. Owns the Port to the SW and relays:
 *   page (MAIN) --postMessage--> [this bridge] --Port--> [SW rpcFlow]
 * It is the only place `browser` is touched, so a broken dApp can't reach the
 * SW's runtime object. Origin is taken by the SW from the Port `sender`, never
 * from the payload (design: "The SW never trusts origin from the payload").
 */
export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  main() {
    const port = browser.runtime.connect({ name: 'bolt-provider' } as any)

    // SW → page (RPC responses + event pushes).
    port.onMessage.addListener((msg: any) => {
      window.postMessage({ target: 'io.electroswap.boltvault', ...msg }, window.location.origin)
    })

    // Page (MAIN) → SW. MUST check event.source === window (a dApp can postMessage).
    window.addEventListener('message', (ev: MessageEvent) => {
      const data = ev.data as any
      if (ev.source !== window) return
      if (!data || data.target !== 'bolt-inpage') return
      port.postMessage({
        jsonrpc: data.jsonrpc,
        id: data.id,
        method: data.method,
        params: data.params,
      })
    })
  },
})
