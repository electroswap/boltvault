import { defineContentScript } from '#imports'
import { BoltVaultProvider, installProvider, providerInfo } from '../src/page-provider'

/**
 * MAIN-world page-provider (T3.4).
 *
 * This file runs in the page's JS context (world: 'MAIN'). WXT bundles it as a
 * standalone chunk; it imports only from ../src/page-provider (no chrome.* /
 * core imports), keeping it eval-safe in the page. It builds the BoltVault
 * provider with a postMessage relay to the ISOLATED bridge, then installs it
 * onto window.ethereum + announces EIP-6963.
 *
 * Coexistence (design table): we only claim window.ethereum when we're the
 * default wallet; otherwise we push onto `window.ethereum.providers` and let
 * EIP-6963 carry us. The "default wallet" + "metaMask compat" settings live in
 * the SW and are fetched on first request — here we default to non-claiming so
 * a fresh install never fights MetaMask/Rabby.
 */

// Minimal data-URI icon (EIP-6963 requires a data: URI, not https).
const ICON =
  'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAzMiAzMiI+PHJlY3Qgd2lkdGg9IjMyIiBoZWlnaHQ9IjMyIiByeD0iNyIgZmlsbD0iIzA1MDYwYyIvPjxwYXRoIGQ9Ik0xOCA0IEw4IDE4IEgxNSBMMTQgMjggTDI0IDEzIEgxNyBaIiBmaWxsPSIjNUNFMUZGIi8+PC9zdmc+'

export default defineContentScript({
  matches: ['http://*/*', 'https://*/*'],
  runAt: 'document_start',
  allFrames: true,
  world: 'MAIN',
  main() {
    // Relay: the page posts JSON-RPC to the ISOLATED bridge (target 'bolt-inpage').
    const relay = {
      request(payload: {
        jsonrpc: string
        id: number
        method: string
        params?: unknown[]
      }): Promise<unknown> {
        const msg = { ...payload, target: 'bolt-inpage' }
        window.postMessage(msg, window.location.origin)
        // Response arrives via window 'message' handled inside BoltVaultProvider;
        // the relay's returned promise is a fallback that resolves on response.
        return new Promise((resolve) => {
          const handler = (ev: MessageEvent) => {
            const d = ev.data as any
            if (ev.source !== window) return
            if (d && d.target === 'io.electroswap.boltvault' && d.id === payload.id) {
              window.removeEventListener('message', handler)
              resolve(d)
            }
          }
          window.addEventListener('message', handler)
        })
      },
    }

    // Install the provider (coexistence-aware) + announce EIP-6963.
    installProvider({
      win: window,
      relay,
      iconDataUri: ICON,
      isDefaultWallet: false,
      metaMaskCompat: false,
    })
  },
})
