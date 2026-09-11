import { describe, expect, it } from 'vitest'
import { startBridge, type BridgePort } from '../src/bridge'
import { installProvider, windowTransport, type WindowLike } from '../src/page-provider'
import { CONTENT_TARGET, INPAGE_TARGET, type InpageMessage, type ProviderPortMessage } from '../src/wire'

/** A window whose postMessage loops back to its own listeners, like the real one. */
function fakeWindow(origin = 'https://dapp.example') {
  const listeners = new Map<string, Array<(ev: unknown) => void>>()
  const win = {
    location: { origin },
    hidden: false,
    document: {
      get hidden() {
        return win.hidden
      },
      addEventListener: (type: string, l: () => void) => {
        const arr = listeners.get(type) ?? []
        arr.push(l as (ev: unknown) => void)
        listeners.set(type, arr)
      },
    },
    addEventListener: (type: string, l: (ev: unknown) => void) => {
      const arr = listeners.get(type) ?? []
      arr.push(l)
      listeners.set(type, arr)
    },
    dispatchEvent: (ev: unknown) => {
      const e = ev as { type: string }
      for (const l of listeners.get(e.type) ?? []) l(ev)
      return true
    },
    postMessage: (data: unknown, _target: string) => {
      queueMicrotask(() => {
        for (const l of listeners.get('message') ?? []) l({ source: win, origin, data })
      })
    },
    CustomEvent: class {
      readonly type: string
      readonly detail: unknown
      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type
        this.detail = init?.detail
      }
    },
    Event: class {
      readonly type: string
      constructor(type: string) {
        this.type = type
      }
    },
    ethereum: undefined as unknown,
  }
  return win
}

/** A Port whose far end is a scripted engine. */
function fakePort(answer: (m: ProviderPortMessage & { kind: 'request' }) => ProviderPortMessage | null) {
  const listeners: Array<(m: unknown) => void> = []
  const disconnects: Array<() => void> = []
  const port: BridgePort & { sent: ProviderPortMessage[]; emit(m: ProviderPortMessage): void; drop(): void } = {
    sent: [],
    postMessage: (m) => {
      port.sent.push(m)
      if (m.kind === 'request') {
        const res = answer(m)
        if (res) queueMicrotask(() => listeners.forEach((l) => l(res)))
      }
    },
    onMessage: (l) => {
      listeners.push(l)
    },
    onDisconnect: (l) => {
      disconnects.push(l)
    },
    disconnect: () => undefined,
    emit: (m) => listeners.forEach((l) => l(m)),
    drop: () => disconnects.forEach((d) => d()),
  }
  return port
}

function wire(answer: Parameters<typeof fakePort>[0], opts: { existingEthereum?: unknown; defaultWallet?: boolean; bridgeFirst?: boolean } = {}) {
  const win = fakeWindow()
  if (opts.existingEthereum !== undefined) win.ethereum = opts.existingEthereum
  const ports: ReturnType<typeof fakePort>[] = []
  const connect = () => {
    const p = fakePort(answer)
    ports.push(p)
    return p
  }
  let nonce: string | null = null
  const installMain = () => {
    // The MAIN script: listen for the nonce, ask for it, then install.
    return new Promise<ReturnType<typeof installProvider>>((resolve) => {
      win.addEventListener('bv:channel', (ev) => {
        if (nonce) return
        nonce = String((ev as { detail: string }).detail)
        const transport = windowTransport(win as never, nonce)
        resolve(installProvider({ transport, channel: nonce, win: win as unknown as WindowLike, uuid: 'uuid-1', icon: 'data:,', defaultWallet: opts.defaultWallet ?? false }))
      })
      win.dispatchEvent(new win.CustomEvent('bv:channel-request'))
    })
  }
  const startIsolated = () => startBridge({ win: win as never, nonce: 'abc123', connect, reconnectDelayMs: 0 })
  return { win, ports, installMain, startIsolated }
}

const ok = (id: number, result: unknown): ProviderPortMessage => ({ kind: 'response', id, result })

describe('page provider through the bridge', () => {
  it('installs window.ethereum at parse time and answers eth_chainId whichever script ran first', async () => {
    for (const bridgeFirst of [true, false]) {
      const w = wire((m) => (m.method === 'eth_chainId' ? ok(m.id, '0xcb2e') : m.method === 'eth_accounts' ? ok(m.id, []) : null), { bridgeFirst })
      let installed: ReturnType<typeof installProvider> | undefined
      if (bridgeFirst) {
        w.startIsolated()
        installed = await w.installMain()
      } else {
        const p = w.installMain()
        w.startIsolated()
        installed = await p
      }
      expect(installed.windowEthereum).toBe('ours')
      const eth = w.win.ethereum as { isBoltVault: boolean; request: (a: { method: string }) => Promise<unknown>; isConnected(): boolean }
      expect(eth.isBoltVault).toBe(true)
      expect(await eth.request({ method: 'eth_chainId' })).toBe('0xcb2e')
      await new Promise((r) => setTimeout(r, 0))
      expect(eth.isConnected()).toBe(true)
    }
  })

  it('announces EIP-6963 with the same object as window.ethereum and re-announces on request', async () => {
    const w = wire((m) => ok(m.id, []))
    w.startIsolated()
    const announced: unknown[] = []
    w.win.addEventListener('eip6963:announceProvider', (ev) => announced.push((ev as { detail: { info: { rdns: string }; provider: unknown } }).detail))
    const { provider } = await w.installMain()
    expect(announced).toHaveLength(1)
    expect((announced[0] as { provider: unknown }).provider).toBe(provider)
    expect((announced[0] as { info: { rdns: string } }).info.rdns).toBe('io.electroswap.boltvault')
    w.win.dispatchEvent(new w.win.Event('eip6963:requestProvider'))
    expect(announced).toHaveLength(2)
    expect(Object.isFrozen(provider)).toBe(true)
  })

  it('delivers events with exact EIP-1193 payloads and mirrors them synchronously', async () => {
    const w = wire((m) => ok(m.id, []))
    w.startIsolated()
    const { provider } = await w.installMain()
    // The Port opens on first use, so ask something before reaching for it.
    await provider.request({ method: 'eth_accounts' })
    const seen: Array<[string, unknown]> = []
    provider.on('accountsChanged', (a) => seen.push(['accountsChanged', a]))
    provider.on('chainChanged', (c) => seen.push(['chainChanged', c]))
    await new Promise((r) => setTimeout(r, 0))
    w.ports[0]?.emit({ kind: 'event', event: 'accountsChanged', payload: ['0xabc'] })
    w.ports[0]?.emit({ kind: 'event', event: 'chainChanged', payload: '0x1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(seen).toEqual([
      ['accountsChanged', ['0xabc']],
      ['chainChanged', '0x1'],
    ])
    expect(provider.selectedAddress).toBe('0xabc')
    expect(provider.chainId).toBe('0x1')
    expect(provider.networkVersion).toBe('1')
  })

  it('surfaces errors as ProviderRpcError with the engine code', async () => {
    const w = wire((m) => (m.method === 'eth_requestAccounts' ? { kind: 'response', id: m.id, error: { code: 4001, message: 'User rejected the request.' } } : ok(m.id, [])))
    w.startIsolated()
    const { provider } = await w.installMain()
    await expect(provider.request({ method: 'eth_requestAccounts' })).rejects.toMatchObject({ code: 4001 })
    await expect(provider.enable()).rejects.toMatchObject({ code: 4001 })
  })

  it('supports legacy send/sendAsync shapes', async () => {
    const w = wire((m) => (m.method === 'eth_chainId' ? ok(m.id, '0xcb2e') : ok(m.id, ['0xabc'])))
    w.startIsolated()
    const { provider } = await w.installMain()
    expect(await provider.send('eth_chainId', [])).toBe('0xcb2e')
    const res = await new Promise<unknown>((resolve) => provider.sendAsync({ jsonrpc: '2.0', id: 7, method: 'eth_chainId', params: [] }, (_e, r) => resolve(r)))
    expect(res).toEqual({ id: 7, jsonrpc: '2.0', result: '0xcb2e' })
    // The synchronous form answers from the mirrors, which follow real traffic.
    await provider.request({ method: 'eth_accounts' })
    await new Promise((r) => setTimeout(r, 0))
    expect(provider.send({ id: 1, method: 'eth_accounts' })).toEqual({ id: 1, jsonrpc: '2.0', result: ['0xabc'] })
  })

  it('ignores a spoofed postMessage with the wrong channel and any message not from this window', async () => {
    const w = wire((m) => ok(m.id, 'answered'))
    w.startIsolated()
    const { provider } = await w.installMain()
    // The Port opens on first use, so ask something before reaching for it.
    await provider.request({ method: 'eth_accounts' })
    await new Promise((r) => setTimeout(r, 0))
    const before = w.ports[0]?.sent.length ?? 0
    w.win.postMessage({ target: INPAGE_TARGET, channel: 'guess', id: 999, method: 'eth_requestAccounts', params: [] }, '*')
    await new Promise((r) => setTimeout(r, 0))
    expect(w.ports[0]?.sent.length).toBe(before)
  })

  it('holds approval-class requests while the tab is hidden', async () => {
    const w = wire((m) => ok(m.id, ['0xabc']))
    w.startIsolated()
    const { provider } = await w.installMain()
    // The Port opens on first use, so ask something before reaching for it.
    await provider.request({ method: 'eth_accounts' })
    await new Promise((r) => setTimeout(r, 0))
    w.win.hidden = true
    const sentBefore = w.ports[0]?.sent.length ?? 0
    const p = provider.request({ method: 'eth_requestAccounts' })
    await new Promise((r) => setTimeout(r, 0))
    expect(w.ports[0]?.sent.length).toBe(sentBefore)
    w.win.hidden = false
    w.win.dispatchEvent(new w.win.Event('visibilitychange'))
    expect(await p).toEqual(['0xabc'])
  })

  it('re-sends pending requests after the worker drops the Port', async () => {
    const w = wire((m) => (m.method === 'personal_sign' ? null : ok(m.id, [])))
    w.startIsolated()
    const { provider } = await w.installMain()
    await new Promise((r) => setTimeout(r, 0))
    const p = provider.request({ method: 'personal_sign', params: ['0x00', '0xabc'] })
    await new Promise((r) => setTimeout(r, 0))
    w.ports[0]?.drop()
    await new Promise((r) => setTimeout(r, 5))
    expect(w.ports).toHaveLength(2)
    const resent = w.ports[1]?.sent.find((m) => m.kind === 'request' && m.method === 'personal_sign')
    expect(resent).toBeDefined()
    w.ports[1]?.emit({ kind: 'response', id: (resent as { id: number }).id, result: '0xsig' })
    expect(await p).toBe('0xsig')
  })

  it('leaves an existing non-configurable window.ethereum alone and joins its providers array', async () => {
    const theirs = { isMetaMask: true, providers: [] as unknown[] }
    const w = wire((m) => ok(m.id, []), { existingEthereum: theirs })
    w.startIsolated()
    const { windowEthereum, provider } = await w.installMain()
    expect(windowEthereum).toBe('providers')
    expect(w.win.ethereum).toBe(theirs)
    expect(theirs.providers).toContain(provider)
  })

  it('bridge → page messages carry the channel and target', async () => {
    const w = wire((m) => ok(m.id, 1))
    w.startIsolated()
    const seen: InpageMessage[] = []
    w.win.addEventListener('message', (ev) => {
      const d = (ev as { data: InpageMessage }).data
      if (d && d.target === CONTENT_TARGET) seen.push(d)
    })
    const { provider } = await w.installMain()
    await provider.request({ method: 'eth_blockNumber' })
    expect(seen.every((m) => m.channel === 'abc123')).toBe(true)
  })
})

/*
  `Object.freeze` stops a property being replaced; it does not stop one being
  read. TypeScript's `private` is erased at compile time, so the transport, the
  channel nonce and the pending map were ordinary own properties on
  `window.ethereum` — and the file's own header said the transport was
  unreachable. Reaching the pending map means resolving another script's
  in-flight request with a value of your choosing.
*/
describe('the provider keeps its internals to itself', () => {
  it('exposes no internals to page script', () => {
    const win = fakeWindow()
    const { provider } = installProvider({ transport: windowTransport(win as never, 'nonce'), channel: 'nonce', win: win as unknown as WindowLike, uuid: 'u', icon: 'i' })
    const keys = Object.keys(provider)
    for (const name of ['transport', 'channel', 'win', 'state', 'listeners']) expect(keys).not.toContain(name)
    for (const name of ['transport', 'channel', 'win', 'state']) expect((provider as unknown as Record<string, unknown>)[name]).toBeUndefined()
  })

  it('does not let page script replace a prototype method', () => {
    const win = fakeWindow()
    const { provider } = installProvider({ transport: windowTransport(win as never, 'n2'), channel: 'n2', win: win as unknown as WindowLike, uuid: 'u', icon: 'i' })
    expect(Object.isFrozen(Object.getPrototypeOf(provider))).toBe(true)
  })
})

/*
  `prime()` ran from `installProvider`, so every http(s) frame of every page
  opened a service-worker Port at document_start — whether or not anything ever
  touched the wallet. That defeats the lazy-Port design, tells the worker about
  every page the user visits, and leaves a rate-limiter bucket per origin.
*/
describe('a page that never touches the wallet costs nothing', () => {
  it('opens no Port until the page asks for something', async () => {
    const w = wire((m) => ok(m.id, '0xcb2e'))
    w.startIsolated()
    const { provider } = await w.installMain()
    await new Promise((r) => setTimeout(r, 0))
    expect(w.ports).toHaveLength(0)
    await provider.request({ method: 'eth_chainId' })
    expect(w.ports).toHaveLength(1)
  })
})
