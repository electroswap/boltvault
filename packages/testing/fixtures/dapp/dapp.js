// Fixture dApp — plain JS on purpose (no bundler, no framework): this is what
// the extension's MAIN-world provider meets in the wild.
/* eslint-disable no-console */
;(function () {
  const $ = (id) => document.getElementById(id)
  const log = (kind, value) => {
    const el = $(kind)
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2)
    el.textContent = kind === 'events' ? el.textContent + text + '\n' : text
  }

  // 1. Parse-time detection — the race the injection must win.
  const parse = window.ethereum
  $('parse-time').textContent = parse
    ? `present isBoltVault=${!!parse.isBoltVault} isMetaMask=${!!parse.isMetaMask} isRabby=${!!parse.isRabby}`
    : 'absent'
  $('parse-time').dataset.present = String(!!parse)
  $('parse-time').dataset.boltvault = String(!!(parse && parse.isBoltVault))

  // 2. EIP-6963 discovery.
  const providers = new Map()
  window.addEventListener('eip6963:announceProvider', (ev) => {
    const { info, provider } = ev.detail
    providers.set(info.uuid, { info, provider })
    const li = document.createElement('li')
    li.dataset.rdns = info.rdns
    li.dataset.sameAsWindow = String(provider === window.ethereum)
    li.textContent = `${info.name} (${info.rdns}) uuid=${info.uuid} sameAsWindowEthereum=${provider === window.ethereum}`
    $('providers').appendChild(li)
  })
  window.dispatchEvent(new Event('eip6963:requestProvider'))

  const pick = () => {
    for (const { info, provider } of providers.values()) if (info.rdns === 'io.electroswap.boltvault') return provider
    return window.ethereum
  }

  // 3. Events, as EIP-1193 specifies them.
  const wire = (p) => {
    if (!p || p.__fixtureWired) return
    p.__fixtureWired = true
    for (const name of ['accountsChanged', 'chainChanged', 'connect', 'disconnect', 'message']) {
      p.on(name, (payload) => log('events', { event: name, payload }))
    }
  }
  wire(window.ethereum)
  setTimeout(() => wire(pick()), 0)

  const call = async (method, params) => {
    try {
      const p = pick()
      if (!p) throw new Error('no provider')
      const result = await p.request({ method, params })
      log('result', { method, result })
      return result
    } catch (err) {
      log('result', { method, error: { code: err && err.code, message: err && err.message } })
      throw err
    }
  }

  const account = async () => {
    const accounts = await pick().request({ method: 'eth_accounts' })
    return accounts[0]
  }

  $('btn-request-accounts') && document.querySelector('[data-testid=btn-request-accounts]').addEventListener('click', () => call('eth_requestAccounts', []))
  document.querySelector('[data-testid=btn-accounts]').addEventListener('click', () => call('eth_accounts', []))
  document.querySelector('[data-testid=btn-chain]').addEventListener('click', () => call('eth_chainId', []))
  document.querySelector('[data-testid=btn-block]').addEventListener('click', () => call('eth_blockNumber', []))
  document.querySelector('[data-testid=btn-personal-sign]').addEventListener('click', async () => {
    const from = await account()
    const msg = '0x' + Array.from(new TextEncoder().encode('BoltVault fixture: hello')).map((b) => b.toString(16).padStart(2, '0')).join('')
    return call('personal_sign', [msg, from])
  })
  document.querySelector('[data-testid=btn-typed]').addEventListener('click', async () => {
    const from = await account()
    const typed = {
      types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }], Ping: [{ name: 'note', type: 'string' }] },
      primaryType: 'Ping',
      domain: { name: 'Fixture', chainId: 52014 },
      message: { note: 'hello' },
    }
    return call('eth_signTypedData_v4', [from, JSON.stringify(typed)])
  })
  document.querySelector('[data-testid=btn-send]').addEventListener('click', async () => {
    const from = await account()
    return call('eth_sendTransaction', [{ from, to: from, value: '0x1', data: '0x' }])
  })
  document.querySelector('[data-testid=btn-switch]').addEventListener('click', () => call('wallet_switchEthereumChain', [{ chainId: '0xcb2e' }]))
  document.querySelector('[data-testid=btn-legacy-send]').addEventListener('click', async () => {
    try {
      const r = await pick().send('eth_chainId', [])
      log('result', { method: 'legacy send', result: r })
    } catch (err) {
      log('result', { method: 'legacy send', error: String(err) })
    }
  })
  document.querySelector('[data-testid=btn-legacy-sendasync]').addEventListener('click', () => {
    pick().sendAsync({ jsonrpc: '2.0', id: 7, method: 'eth_chainId', params: [] }, (err, res) => log('result', { method: 'legacy sendAsync', err: err && String(err), res }))
  })
  document.querySelector('[data-testid=btn-enable]').addEventListener('click', async () => {
    try {
      log('result', { method: 'enable', result: await pick().enable() })
    } catch (err) {
      log('result', { method: 'enable', error: { code: err && err.code, message: err && err.message } })
    }
  })
  // A malicious page trying to talk to the isolated bridge directly. The
  // bridge must ignore this (wrong channel nonce / not from itself).
  document.querySelector('[data-testid=btn-spoof]').addEventListener('click', () => {
    window.postMessage({ target: 'bolt-inpage', channel: 'guess', jsonrpc: '2.0', id: 999, method: 'eth_requestAccounts', params: [] }, '*')
    log('result', { method: 'spoof', note: 'posted; expect no response and no approval window' })
  })
})()
