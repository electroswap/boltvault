// What MetaMask does to window.ethereum: a non-configurable property, isMetaMask, and a 6963 announcement.
;(function () {
  if (window.ethereum) return
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
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: false, writable: false, enumerable: true })
  const info = Object.freeze({ uuid: '11111111-2222-4333-8444-555555555555', name: 'Fixture MetaMask', icon: 'data:image/svg+xml;base64,PHN2Zy8+', rdns: 'io.metamask' })
  const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }))
  window.addEventListener('eip6963:requestProvider', announce)
  announce()
})()
