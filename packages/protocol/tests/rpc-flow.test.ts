import { describe, expect, it } from 'vitest'
import { RPC, RpcError } from '../src/errors'
import { RpcFlow, type ApprovalIntent, type ProviderEvent, type RpcContext } from '../src/rpc-flow'
import { SiteRegistry } from '../src/sessions'

const ADDR = '0x1111111111111111111111111111111111111111'
const A = 'https://a.example'
const B = 'https://b.example'

function harness(opts: { approve?: (intent: ApprovalIntent) => Promise<unknown>; ethSign?: boolean } = {}) {
  let now = 1_000_000
  const events: Array<{ origin: string; event: ProviderEvent }> = []
  const safe: Array<{ chainId: number; method: string }> = []
  const sites = new SiteRegistry({ load: async () => undefined, save: async () => undefined })
  const intents: ApprovalIntent[] = []
  const ctx: RpcContext = {
    sites,
    now: () => now,
    session: async (origin) => {
      const s = sites.get(origin)
      return s?.connected ? { accountId: s.accountId, addresses: s.lastAccounts ?? [] } : null
    },
    knownChain: (id) => id === 52014 || id === 5201420 || id === 1,
    executeSafe: async (chainId, method) => {
      safe.push({ chainId, method })
      return `ok:${method}`
    },
    approve: async (intent) => {
      intents.push(intent)
      if (opts.approve) return opts.approve(intent)
      if (intent.kind === 'connect') return { accountId: 'acct', addresses: [ADDR], chainId: intent.chainId }
      return '0xsigned'
    },
    emit: (origin, event) => events.push({ origin, event }),
    settings: { ethSignEnabled: opts.ethSign ?? false },
    clientVersion: 'BoltVault/test',
    subscribeHeads: () => () => undefined,
  }
  const flow = new RpcFlow(ctx)
  return { flow, events, safe, intents, sites, tick: (ms: number) => (now += ms) }
}

const req = (h: ReturnType<typeof harness>, origin: string, method: string, params?: unknown) => h.flow.request(origin, method, params, `${origin}:${method}`)

describe('method table', () => {
  it('answers eth_chainId and eth_accounts without UI, before connect', async () => {
    const h = harness()
    expect(await req(h, A, 'eth_chainId')).toBe('0xcb2e')
    expect(await req(h, A, 'net_version')).toBe('52014')
    expect(await req(h, A, 'eth_accounts')).toEqual([])
    expect(h.intents).toEqual([])
  })
  it('rejects unknown, unsupported and disabled methods with the right codes', async () => {
    const h = harness()
    await expect(req(h, A, 'eth_nope')).rejects.toMatchObject({ code: RPC.METHOD_NOT_FOUND })
    await expect(req(h, A, 'eth_signTransaction')).rejects.toMatchObject({ code: RPC.UNSUPPORTED_METHOD })
    await expect(req(h, A, 'wallet_sendCalls')).rejects.toMatchObject({ code: RPC.UNSUPPORTED_METHOD })
    await expect(req(h, A, 'eth_sign', [ADDR, '0x00'])).rejects.toMatchObject({ code: RPC.UNSUPPORTED_METHOD })
  })
  it('passes SAFE reads through on the origin chain and rate-limits them', async () => {
    const h = harness()
    // Chain reads need a session now (see "an unconnected origin" below).
    await req(h, A, 'eth_requestAccounts')
    await req(h, B, 'eth_requestAccounts')
    expect(await req(h, A, 'eth_blockNumber')).toBe('ok:eth_blockNumber')
    expect(h.safe[0]).toEqual({ chainId: 52014, method: 'eth_blockNumber' })
    for (let i = 0; i < 70; i++) await req(h, A, 'eth_blockNumber').catch(() => undefined)
    await expect(req(h, A, 'eth_blockNumber')).rejects.toMatchObject({ code: RPC.LIMIT_EXCEEDED })
    h.tick(1000)
    expect(await req(h, A, 'eth_blockNumber')).toBe('ok:eth_blockNumber')
    // Another origin has its own bucket.
    expect(await req(h, B, 'eth_blockNumber')).toBe('ok:eth_blockNumber')
  })
  it('bounds eth_getLogs ranges', async () => {
    const h = harness()
    await req(h, A, 'eth_requestAccounts')
    await expect(req(h, A, 'eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x10000' }])).rejects.toMatchObject({ code: RPC.LIMIT_EXCEEDED })
    await expect(req(h, A, 'eth_getLogs', [{ fromBlock: '0x1' }])).rejects.toMatchObject({ code: RPC.LIMIT_EXCEEDED })
    expect(await req(h, A, 'eth_getLogs', [{ fromBlock: '0x1', toBlock: '0x100' }])).toBe('ok:eth_getLogs')
    expect(await req(h, A, 'eth_getLogs', [{ fromBlock: 'latest', toBlock: 'latest' }])).toBe('ok:eth_getLogs')
  })
  it('refuses chain state to an unconnected origin, but still answers discovery', async () => {
    const h = harness()
    // Discovery is open: EIP-1193 expects a provider to answer before a page
    // decides whether to prompt, and none of this names the user.
    expect(await req(h, A, 'eth_chainId')).toBe('0xcb2e')
    expect(await req(h, A, 'net_version')).toBe('52014')
    expect(await req(h, A, 'eth_accounts')).toEqual([])

    // Chain state is not. Before this gate existed, any page the user merely
    // visited could read through the wallet's RPC at 60 req/s and could
    // broadcast an already-signed transaction — an open relay for the web.
    for (const method of ['eth_blockNumber', 'eth_call', 'eth_getBalance', 'eth_getLogs', 'eth_getStorageAt', 'eth_sendRawTransaction']) {
      await expect(req(h, A, method, [])).rejects.toMatchObject({ code: RPC.UNAUTHORIZED })
    }
    expect(h.safe).toEqual([])

    // ...and it works again once the origin actually connects.
    await req(h, A, 'eth_requestAccounts')
    expect(await req(h, A, 'eth_blockNumber')).toBe('ok:eth_blockNumber')
  })

  it('advertises no atomic batching', async () => {
    const h = harness()
    await req(h, A, 'eth_requestAccounts')
    expect(await req(h, A, 'wallet_getCapabilities', [ADDR])).toEqual({ '0xcb2e': { atomic: { status: 'unsupported' } } })
  })
})

describe('connect', () => {
  it('opens the connect sheet once, then answers from the session and emits events to that origin only', async () => {
    const h = harness()
    expect(await req(h, A, 'eth_requestAccounts')).toEqual([ADDR])
    expect(h.intents).toHaveLength(1)
    expect(await req(h, A, 'eth_requestAccounts')).toEqual([ADDR])
    expect(h.intents).toHaveLength(1)
    expect(await req(h, A, 'eth_accounts')).toEqual([ADDR])
    expect(await req(h, B, 'eth_accounts')).toEqual([])
    expect(h.events.map((e) => `${e.origin} ${e.event.event}`)).toEqual([`${A} accountsChanged`, `${A} connect`])
  })
  it('wallet_requestPermissions returns a permissions object', async () => {
    const h = harness()
    const perms = (await req(h, A, 'wallet_requestPermissions', [{ eth_accounts: {} }])) as Array<{ parentCapability: string }>
    expect(perms[0]?.parentCapability).toBe('eth_accounts')
    expect(await req(h, A, 'wallet_getPermissions')).toHaveLength(1)
  })
  it('a rejected connect is 4001 and leaves no session', async () => {
    const h = harness({ approve: async () => Promise.reject(new RpcError(RPC.USER_REJECTED, 'no')) })
    await expect(req(h, A, 'eth_requestAccounts')).rejects.toMatchObject({ code: 4001 })
    expect(await req(h, A, 'eth_accounts')).toEqual([])
  })
  it('one approval in flight per origin', async () => {
    const gate: { release: null | (() => void) } = { release: null }
    const h = harness({ approve: () => new Promise((resolve) => (gate.release = () => resolve({ accountId: 'acct', addresses: [ADDR], chainId: 52014 }))) })
    const first = req(h, A, 'eth_requestAccounts')
    await new Promise((r) => setTimeout(r, 0))
    await expect(h.flow.request(A, 'eth_requestAccounts', undefined, 'another-request')).rejects.toMatchObject({ code: RPC.RESOURCE_UNAVAILABLE })
    // The same client id re-sent (a worker restart) joins the open request instead.
    const again = h.flow.request(A, 'eth_requestAccounts', undefined, `${A}:eth_requestAccounts`)
    gate.release?.()
    expect(await first).toEqual([ADDR])
    expect(await again).toEqual([ADDR])
    expect(h.intents).toHaveLength(1)
  })
})

describe('chains', () => {
  /*
    `wallet_addEthereumChain` prompted and `wallet_switchEthereumChain` did
    not, so a connected site could move the session to a chain the user does
    not use and then ask for a transaction on it — never asked, and the site
    choosing what the signature binds to. The `switch_chain` payload and its
    sheet already existed and were unreachable from here.

    Once per network, though, not once per call: a site flipping between two
    chains it has already been allowed would otherwise produce a prompt the
    user learns to dismiss, which is worse than not asking at all.
  */
  it('asks before moving a connected site to another chain, once per chain; only that origin hears it', async () => {
    const h = harness()
    await req(h, A, 'eth_requestAccounts')
    await req(h, B, 'eth_requestAccounts')
    expect(await req(h, A, 'wallet_switchEthereumChain', [{ chainId: '0x4f5e0c' }])).toBeNull()
    expect(h.intents.filter((i) => i.kind === 'switch_chain')).toHaveLength(1)
    expect(await req(h, A, 'eth_chainId')).toBe('0x4f5e0c')
    expect(await req(h, B, 'eth_chainId')).toBe('0xcb2e')
    expect(h.events.filter((e) => e.event.event === 'chainChanged').map((e) => e.origin)).toEqual([A])
    // Back and forth over chains already agreed: no further sheets.
    expect(await req(h, A, 'wallet_switchEthereumChain', [{ chainId: '0xcb2e' }])).toBeNull()
    expect(await req(h, A, 'wallet_switchEthereumChain', [{ chainId: '0x4f5e0c' }])).toBeNull()
    expect(h.intents.filter((i) => i.kind === 'switch_chain')).toHaveLength(2)
  })
  it('unknown chains are 4902 and a dApp cannot add one', async () => {
    const h = harness()
    await expect(req(h, A, 'wallet_switchEthereumChain', [{ chainId: '0x539' }])).rejects.toMatchObject({ code: RPC.UNRECOGNIZED_CHAIN })
    await expect(req(h, A, 'wallet_addEthereumChain', [{ chainId: '0x539', rpcUrls: ['https://evil'] }])).rejects.toMatchObject({ code: RPC.UNRECOGNIZED_CHAIN })
  })
  it('a switch before connect records the preference so the connect sheet shows it', async () => {
    const h = harness()
    await req(h, A, 'wallet_switchEthereumChain', [{ chainId: '0x1' }])
    expect(await req(h, A, 'eth_chainId')).toBe('0x1')
    await req(h, A, 'eth_requestAccounts')
    expect(h.intents[0]).toMatchObject({ kind: 'connect', chainId: 1 })
  })
  it('revoking permissions disconnects and emits an empty accountsChanged', async () => {
    const h = harness()
    await req(h, A, 'eth_requestAccounts')
    await req(h, A, 'wallet_revokePermissions', [{ eth_accounts: {} }])
    expect(await req(h, A, 'eth_accounts')).toEqual([])
    expect(h.events.at(-1)).toMatchObject({ origin: A, event: { event: 'accountsChanged', payload: [] } })
  })
})

describe('approvals', () => {
  it('signing needs a connected account that owns the address', async () => {
    const h = harness()
    await expect(req(h, A, 'personal_sign', ['0x68656c6c6f', ADDR])).rejects.toMatchObject({ code: RPC.UNAUTHORIZED })
    await req(h, A, 'eth_requestAccounts')
    await expect(req(h, A, 'personal_sign', ['0x68656c6c6f', '0x2222222222222222222222222222222222222222'])).rejects.toMatchObject({ code: RPC.UNAUTHORIZED })
    expect(await req(h, A, 'personal_sign', ['0x68656c6c6f', ADDR])).toBe('0xsigned')
    expect(h.intents.at(-1)).toMatchObject({ kind: 'sign_message', from: ADDR, message: '0x68656c6c6f' })
  })
  it('accepts the legacy [address, message] order and utf-8 text', async () => {
    const h = harness()
    await req(h, A, 'eth_requestAccounts')
    await req(h, A, 'personal_sign', [ADDR, 'hi'])
    expect(h.intents.at(-1)).toMatchObject({ kind: 'sign_message', message: '0x6869' })
  })
  it('a transaction for another chain is invalid params', async () => {
    const h = harness()
    await req(h, A, 'eth_requestAccounts')
    await expect(req(h, A, 'eth_sendTransaction', [{ from: ADDR, to: ADDR, chainId: '0x1' }])).rejects.toMatchObject({ code: RPC.INVALID_PARAMS })
    expect(await req(h, A, 'eth_sendTransaction', [{ from: ADDR, to: ADDR, value: '0x1', data: '0x' }])).toBe('0xsigned')
    expect(h.intents.at(-1)).toMatchObject({ kind: 'send_transaction', tx: { from: ADDR, to: ADDR, value: '0x1', data: '0x' } })
  })
  it('typed data v4 carries the payload and version', async () => {
    const h = harness()
    await req(h, A, 'eth_requestAccounts')
    await req(h, A, 'eth_signTypedData_v4', [ADDR, '{"a":1}'])
    expect(h.intents.at(-1)).toMatchObject({ kind: 'sign_typed_data', version: 'v4', typedData: '{"a":1}' })
  })
  it('eth_sign reaches the sheet only when enabled', async () => {
    const h = harness({ ethSign: true })
    await req(h, A, 'eth_requestAccounts')
    await req(h, A, 'eth_sign', [ADDR, `0x${'aa'.repeat(32)}`])
    expect(h.intents.at(-1)?.kind).toBe('eth_sign')
  })
  it('a rejection surfaces as 4001', async () => {
    const h = harness({ approve: async (i) => (i.kind === 'connect' ? { accountId: 'acct', addresses: [ADDR], chainId: 52014 } : Promise.reject(new RpcError(4001, 'User rejected the request.'))) })
    await req(h, A, 'eth_requestAccounts')
    await expect(req(h, A, 'personal_sign', ['0x00', ADDR])).rejects.toMatchObject({ code: 4001 })
  })
})
