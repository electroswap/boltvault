import { describe, expect, it } from 'vitest'
import { getChain } from '@boltvault/chains'
import {
  RPC,
  RpcError,
  RpcFlow,
  SiteRegistry,
  SigningQueue,
  DEFAULT_HEX_CHAIN_ID,
  toDecChainId,
  hexChainId,
  type RpcContext,
  type ProviderEvent,
  type SitesStore,
} from '../src'
import type { ConnectedSite } from '../src'


/** Await `promise` and assert it rejects with an RpcError carrying `code`. */
async function rejectsWith(promise: Promise<unknown>, code: number): Promise<void> {
  let caught: unknown
  try {
    await promise
  } catch (e) {
    caught = e
  }
  expect(caught).toBeInstanceOf(RpcError)
  expect((caught as RpcError).code).toBe(code)
}

/** In-memory SitesStore. */
function memorySitesStore(): SitesStore {
  let data: Record<string, ConnectedSite> | undefined
  return {
    load: async () => data,
    save: async (s) => void (data = s),
  }
}

// ---- fake context ------------------------------------------------------------
interface FakeHooks {
  connected: boolean
  accounts: string[]
  ethSignEnabled: boolean
  /** Drives approve: resolves when `approveResolve` is called, or immediately. */
  hangApprove?: boolean
}

function makeFake(hooks: Partial<FakeHooks> = {}): {
  ctx: RpcContext
  sites: SiteRegistry
  events: Array<{ origin: string; event: ProviderEvent }>
  calls: { safe: string[]; action: string[]; approve: string[] }
  resolveApprove: () => void
} {
  const sites = new SiteRegistry(memorySitesStore())
  const events: Array<{ origin: string; event: ProviderEvent }> = []
  const calls = { safe: [] as string[], action: [] as string[], approve: [] as string[] }
  let resolveApproveFn: (() => void) | null = null

  const connected = hooks.connected ?? true
  const accounts = hooks.accounts ?? ['0x' + 'aa'.repeat(20)]

  const ctx: RpcContext = {
    sites,
    accountsFor: async () => (connected ? accounts : []),
    settings: { ethSignEnabled: hooks.ethSignEnabled ?? false },
    emit: (origin, event) => void events.push({ origin, event }),
    isUnlocked: async () => connected,
    approve: async (origin, method) => {
      calls.approve.push(method)
      if (hooks.hangApprove) {
        await new Promise<void>((r) => (resolveApproveFn = r))
      }
    },
    executeSafe: async (_o, method) => {
      calls.safe.push(method)
      // eth_chainId is answered by the page provider itself, but the router
      // delegates any SAFE method to the context; return a plausible value.
      if (method === 'eth_chainId') return DEFAULT_HEX_CHAIN_ID
      if (method === 'eth_accounts') return accounts
      return null
    },
    executeAction: async (_o, method) => {
      calls.action.push(method)
      if (method === 'eth_sendTransaction') return '0x' + '11'.repeat(32)
      if (method === 'personal_sign') return '0x' + '22'.repeat(65)
      return '0x' + '33'.repeat(32)
    },
  }

  return {
    ctx,
    sites,
    events,
    calls,
    resolveApprove: () => resolveApproveFn?.(),
  }
}

// ---- tests -------------------------------------------------------------------

describe('RpcFlow SAFE methods', () => {
  it('routes a read-only method to executeSafe without approval', async () => {
    const { ctx, calls } = makeFake()
    const flow = new RpcFlow(ctx)
    const result = await flow.request('https://app.electroswap.io', 'eth_chainId')
    expect(result).toBe(DEFAULT_HEX_CHAIN_ID)
    expect(calls.safe).toContain('eth_chainId')
    expect(calls.action).toEqual([])
    expect(calls.approve).toEqual([])
  })

  it('answers eth_accounts with the connected accounts', async () => {
    const { ctx } = makeFake()
    const flow = new RpcFlow(ctx)
    const accs = await flow.request('o', 'eth_accounts')
    expect(accs).toEqual(['0x' + 'aa'.repeat(20)])
  })
})

describe('RpcFlow connect (eth_requestAccounts)', () => {
  it('connects the origin and returns the accounts, emitting accountsChanged', async () => {
    const { ctx, sites, events } = makeFake()
    const flow = new RpcFlow(ctx)
    const accs = await flow.request('https://app.electroswap.io', 'eth_requestAccounts')
    expect(accs).toEqual(['0x' + 'aa'.repeat(20)])
    expect(sites.isConnected('https://app.electroswap.io')).toBe(true)
    // Connected on the home chain (52014).
    expect(sites.chainIdFor('https://app.electroswap.io')).toBe(52014)
    expect(events.some((e) => e.event.event === 'accountsChanged')).toBe(true)
  })

  it('throws 4100 NOT_CONNECTED when there are no accounts', async () => {
    const { ctx } = makeFake({ connected: false })
    const flow = new RpcFlow(ctx)
    await expect(flow.request('o', 'eth_requestAccounts')).rejects.toSatisfy(
      (e: unknown) => e instanceof RpcError && e.code === RPC.NOT_CONNECTED,
    )
  })
})

describe('RpcFlow per-origin chain', () => {
  it('wallet_switchEthereumChain sets this origin chain + emits chainChanged', async () => {
    const { ctx, sites, events } = makeFake()
    await ctx.sites.connect('o', { accountId: '0x1', accounts: ['0x1'] })
    const flow = new RpcFlow(ctx)
    // Switch to Ethereum mainnet (1) — a known chain.
    const result = await flow.request('o', 'wallet_switchEthereumChain', [{ chainId: '0x1' }])
    expect(result).toBeNull()
    expect(sites.chainIdFor('o')).toBe(1)
    expect(events.some((e) => e.event.event === 'chainChanged')).toBe(true)
  })

  it('rejects an unrecognized chain with 4902', async () => {
    const { ctx } = makeFake()
    const flow = new RpcFlow(ctx)
    // 999999 is not in the 10-chain registry.
    await expect(flow.request('o', 'wallet_switchEthereumChain', [{ chainId: '0x' + (999999).toString(16) }])).rejects.toSatisfy(
      (e: unknown) => e instanceof RpcError && e.code === RPC.UNRECOGNIZED_CHAIN,
    )
  })

  it('chain changes are isolated per origin', async () => {
    const { ctx, sites } = makeFake()
    const flow = new RpcFlow(ctx)
    await sites.connect('a', { accountId: '0x1', accounts: ['0x1'] })
    await sites.connect('b', { accountId: '0x1', accounts: ['0x1'] })
    await flow.request('a', 'wallet_switchEthereumChain', [{ chainId: '0x1' }])
    // B is untouched.
    expect(sites.chainIdFor('a')).toBe(1)
    expect(sites.chainIdFor('b')).toBe(52014)
  })

  it('wallet_addEthereumChain only for registry chains (4902 otherwise)', async () => {
    const { ctx, sites } = makeFake()
    const flow = new RpcFlow(ctx)
    await sites.connect('o', { accountId: '0x1', accounts: ['0x1'] })
    expect(await flow.request('o', 'wallet_addEthereumChain', [{ chainId: '0x2105' }])).toBeNull() // Base 8453
    expect(getChain(8453)?.shortName).toBe('BASE')
    await expect(flow.request('o', 'wallet_addEthereumChain', [{ chainId: '0x12345' }])).rejects.toSatisfy(
      (e: unknown) => e instanceof RpcError && e.code === RPC.UNRECOGNIZED_CHAIN,
    )
  })
})

describe('RpcFlow approval + signing queue', () => {
  it('personal_sign shows the approval UI then executes', async () => {
    const { ctx, calls } = makeFake()
    const flow = new RpcFlow(ctx)
    const sig = await flow.request('o', 'personal_sign', ['0xmsg', '0x' + 'aa'.repeat(20)])
    expect(sig).toBe('0x' + '22'.repeat(65))
    expect(calls.approve).toContain('personal_sign')
    expect(calls.action).toContain('personal_sign')
  })

  it('eth_sign is disabled by default -> 4200 (replayable)', async () => {
    const { ctx, calls } = makeFake({ ethSignEnabled: false })
    const flow = new RpcFlow(ctx)
    await expect(flow.request('o', 'eth_sign', ['0x' + 'aa'.repeat(20), '0xdata'])).rejects.toSatisfy(
      (e: unknown) => e instanceof RpcError && e.code === RPC.METHOD_UNSUPPORTED,
    )
    expect(calls.approve).toEqual([])
  })

  it('eth_sign works when enabled in Settings', async () => {
    const { ctx, calls } = makeFake({ ethSignEnabled: true })
    const flow = new RpcFlow(ctx)
    await flow.request('o', 'eth_sign', ['0x' + 'aa'.repeat(20), '0xdata'])
    expect(calls.approve).toContain('eth_sign')
  })

  it('one in-flight signing request per origin -> second is ALREADY_PENDING (-32002)', async () => {
    const { ctx, resolveApprove } = makeFake({ hangApprove: true })
    const flow = new RpcFlow(ctx)
    const first = flow.request('o', 'personal_sign', ['0x1', '0x' + 'aa'.repeat(20)])
    // First is now in-flight (approve hung).
    await new Promise((r) => setTimeout(r, 0))
    const second = flow.request('o', 'eth_sendTransaction', [{ to: '0x1', value: '0x0' }])
    await expect(second).rejects.toSatisfy(
      (e: unknown) => e instanceof RpcError && e.code === RPC.ALREADY_PENDING,
    )
    // Unblock the first so it completes, then let it settle.
    resolveApprove()
    await first
  })

  it('queue frees up after a request finishes', async () => {
    const { ctx } = makeFake()
    const flow = new RpcFlow(ctx)
    await flow.request('o', 'personal_sign', ['0x1', '0x' + 'aa'.repeat(20)])
    // After completion, a new signing request should not be ALREADY_PENDING.
    await expect(flow.request('o', 'personal_sign', ['0x2', '0x' + 'aa'.repeat(20)])).resolves.toBe('0x' + '22'.repeat(65))
  })
})

describe('RpcFlow unsupported + unknown', () => {
  it('eth_signTransaction is unsupported (phishing magnet) -> 4200', async () => {
    const { ctx } = makeFake()
    const flow = new RpcFlow(ctx)
    await expect(flow.request('o', 'eth_signTransaction', [{ to: '0x1' }])).rejects.toSatisfy(
      (e: unknown) => e instanceof RpcError && e.code === RPC.METHOD_UNSUPPORTED,
    )
  })

  it('an unknown method -> -32601 METHOD_NOT_FOUND', async () => {
    const { ctx } = makeFake()
    const flow = new RpcFlow(ctx)
    await expect(flow.request('o', 'eth_fancyNewMethod', [])).rejects.toSatisfy(
      (e: unknown) => e instanceof RpcError && e.code === RPC.METHOD_NOT_FOUND,
    )
  })
})

describe('EIP-2255 permissions', () => {
  it('wallet_getPermissions reports eth_accounts granted', async () => {
    const { ctx } = makeFake()
    const flow = new RpcFlow(ctx)
    const perms = (await flow.request('o', 'wallet_getPermissions')) as Array<{ parentCapability: string; granted: boolean }>
    expect(perms[0]?.parentCapability).toBe('eth_accounts')
  })

  it('wallet_revokePermissions disconnects the origin', async () => {
    const { ctx, sites } = makeFake()
    await sites.connect('o', { accountId: '0x1', accounts: ['0x1'] })
    const flow = new RpcFlow(ctx)
    await flow.request('o', 'wallet_revokePermissions', [])
    expect(sites.isConnected('o')).toBe(false)
  })
})

describe('chainId helpers', () => {
  it('toDecChainId parses 0x and decimal', () => {
    expect(toDecChainId('0xcb2e')).toBe(52014)
    expect(toDecChainId('1')).toBe(1)
    expect(toDecChainId(8453)).toBe(8453)
  })
  it('hexChainId formats decimal -> 0x', () => {
    expect(hexChainId(52014)).toBe('0xcb2e')
    expect(hexChainId(8453)).toBe('0x2105')
  })
})

describe('RpcError.toPayload', () => {
  it('serializes to a JSON-RPC error payload', () => {
    const err = new RpcError(RPC.USER_REJECTED, 'User rejected', { diff: 1 })
    expect(err.toPayload()).toEqual({ code: 4001, message: 'User rejected', data: { diff: 1 } })
  })
})
