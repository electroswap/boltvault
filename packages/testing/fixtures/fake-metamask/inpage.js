// What MetaMask does to window.ethereum: a non-configurable property, isMetaMask, and a 6963 announcement.
//
// Note it does NOT check whether someone got there first — that is the point of
// the fixture. MetaMask defines its provider at document_start regardless, and
// wins whenever the other wallet left the property configurable (ours does,
// unless the user has asked for "default wallet"). The fixture used to bail on
// `if (window.ethereum) return`, which made the coexistence test depend on
// Chromium's content-script ordering between two --load-extension dirs: when
// ours injected first the fixture did nothing at all, and the test asserted our
// coexistence behaviour against a page MetaMask had never touched.
;(function () {
  const listeners = {}
  const provider = Object.freeze({
    isMetaMask: true,
    _fixture: true,
    request: async ({ method }) => {
      if (method === 'eth_chainId') return '0x1'
      if (method === 'eth_accounts') return []
      throw Object.assign(new Error('fixture metamask: unsupported'), { code: 4200 })
    },
    on: (e, fn) => ((listeners[e] = listeners[e] || []).push(fn), provider),
    removeListener: (e, fn) => ((listeners[e] = (listeners[e] || []).filter((f) => f !== fn)), provider),
    isConnected: () => true,
  })
  try {
    Object.defineProperty(window, 'ethereum', { value: provider, configurable: false, writable: false, enumerable: true })
  } catch {
    // Already pinned by a wallet that asked to be the default one; still announce over 6963.
  }
  const info = Object.freeze({ uuid: '11111111-2222-4333-8444-555555555555', name: 'Fixture MetaMask', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.metamask' })
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})()
