import { describe, expect, it, vi } from 'vitest'
import {
  BoltVaultProvider,
  installProvider,
  providerInfo,
  PROVIDER_RDNS,
  type Relay,
} from '../src/page-provider'

// A minimal fake window: addEventListener + dispatchEvent + CustomEvent (no real DOM).
function fakeWindow(): any {
  const listeners: Record<string, ((ev: any) => void)[]> = {}
  // Minimal CustomEvent: announceProvider dispatches `new win.CustomEvent(...)`.
  class FakeEvent {
    readonly type: string
    readonly detail: unknown
    constructor(type: string, init?: { detail?: unknown }) {
      this.type = type
      this.detail = init?.detail
    }
  }
  return {
    CustomEvent: FakeEvent,
    listeners,
    addEventListener: (type: string, fn: (ev: any) => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
    removeEventListener: (type: string, fn: (ev: any) => void) => {
      const arr = listeners[type] ?? []
      const i = arr.indexOf(fn)
      if (i >= 0) arr.splice(i, 1)
    },
    dispatchEvent: (ev: any) => {
      for (const fn of listeners[ev.type] ?? []) fn(ev)
      return true
    },
    addEventListenerOnce: (type: string, fn: (ev: any) => void) => {
      ;(listeners[type] ??= []).push(fn)
    },
  }
}

// A relay that records requests and lets the test reply to a specific id.
function fakeRelay(): { relay: Relay; requests: any[]; reply: (id: number, result: unknown) => void } {
  const requests: any[] = []
  const waiters = new Map<number, (r: unknown) => void>()
  const relay: Relay = {
    request: (payload) => {
      requests.push(payload)
      return new Promise((resolve) => waiters.set(payload.id, resolve))
    },
  }
  const reply = (id: number, result: unknown) => {
    const w = waiters.get(id)
    if (w) w({ jsonrpc: '2.0', id, result })
  }
  return { relay, requests, reply }
}

describe('BoltVaultProvider (T3.4 page-provider)', () => {
  it('exposes the required EIP-1193 flags + default ETN chain', () => {
    const { relay } = fakeRelay()
    const p = new BoltVaultProvider({ relay, win: fakeWindow() as any })
    expect(p.isBoltVault).toBe(true)
    expect(p.isBoltWallet).toBe(true)
    expect(p.isRabby).toBe(false)
    expect(p.isMetaMask).toBe(false)
    // ETN mainnet = 52014 = 0xcb2e
    expect(p.chainId).toBe('0xcb2e')
    expect(p.networkVersion).toBe('52014')
    expect(p.selectedAddress).toBeNull()
  })

  it('request() forwards to the relay and resolves with the result', async () => {
    const win = fakeWindow()
    const { relay, requests, reply } = fakeRelay()
    const p = new BoltVaultProvider({ relay, win })
    const promise = p.request({ method: 'eth_chainId' })
    // give the relay a tick to record the request
    await new Promise((r) => setTimeout(r, 0))
    expect(requests[0]?.method).toBe('eth_chainId')
    reply(1, '0xcb2e')
    const result = await promise
    expect(result).toBe('0xcb2e')
  })

  it('eth_accounts updates selectedAddress (EIP-1193 state auto-apply)', async () => {
    const win = fakeWindow()
    const { relay, reply } = fakeRelay()
    const p = new BoltVaultProvider({ relay, win })
    const promise = p.request({ method: 'eth_accounts' })
    await new Promise((r) => setTimeout(r, 0))
    reply(1, ['0x' + 'ab'.repeat(20)])
    await promise
    expect(p.selectedAddress).toBe('0x' + 'ab'.repeat(20))
  })

  it('enable() returns connected accounts via eth_requestAccounts', async () => {
    const { relay, reply } = fakeRelay()
    const p = new BoltVaultProvider({ relay, win: fakeWindow() as any })
    const promise = p.enable()
    await new Promise((r) => setTimeout(r, 0))
    reply(1, ['0x' + 'ab'.repeat(20)])
    expect(await promise).toEqual(['0x' + 'ab'.repeat(20)])
  })

  it('legacy sendAsync resolves via callback (web3 v1)', async () => {
    const { relay, reply } = fakeRelay()
    const p = new BoltVaultProvider({ relay, win: fakeWindow() as any })
    const result: { err: any; res: any } = await new Promise((resolve) => {
      p.sendAsync(
        { method: 'net_version', params: [] },
        (err, res) => resolve({ err, res }),
      )
      reply(1, '52014')
    })
    expect(result.err).toBeNull()
    expect(result.res?.result).toBe('52014')
  })

  it('providerInfo is frozen and has the stable rdns + uuid', () => {
    const info = providerInfo('data:image/svg+xml;base64,xxx')
    expect(info.rdns).toBe(PROVIDER_RDNS)
    expect(info.name).toBe('BoltVault')
    expect(info.uuid).toMatch(/^[0-9a-f-]{36}$/)
    expect(Object.isFrozen(info)).toBe(true)
  })
})

describe('installProvider (window.ethereum coexistence, T3.4)', () => {
  it('claims window.ethereum when default wallet and none exists', () => {
    const win = fakeWindow()
    win.ethereum = undefined
    const { relay } = fakeRelay()
    const provider = installProvider({ win, relay, iconDataUri: 'data:x' })
    expect(win.ethereum).toBe(provider)
    expect(win.ethereum.providers).toEqual([provider])
  })

  it('coexists (does NOT replace) when another wallet is present', () => {
    const win = fakeWindow()
    const other = { isMetaMask: true, providers: [] as any[] }
    win.ethereum = other
    const { relay } = fakeRelay()
    installProvider({ win, relay, iconDataUri: 'data:x' })
    // our provider was pushed onto providers, not installed as window.ethereum
    expect(win.ethereum).toBe(other)
    expect(win.ethereum.providers).toContainEqual(expect.objectContaining({ isBoltVault: true }))
  })
})
