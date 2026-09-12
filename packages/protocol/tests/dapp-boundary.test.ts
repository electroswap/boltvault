/**
 * What a page may do to the wallet, and how often (ES-BV-016, ES-BV-017,
 * ES-BV-018, ES-BV-020).
 *
 * The leaky bucket used to apply to `safe` alone, subscriptions had no cap and
 * outlived the port that asked for them, a page-initiated revoke went round
 * the engine's own door, and only `method.length` was bounded on the way in.
 */
import { describe, expect, it, vi } from 'vitest'
import { RpcFlow, type ApprovalIntent, type RpcContext } from '../src/rpc-flow'
import { SiteRegistry } from '../src/sessions'

const ORIGIN = 'https://app.example.com'
const ME = '0x3333333333333333333333333333333333333333'

function boot(over: Partial<RpcContext> = {}) {
  const sites = new SiteRegistry({
    load: async () => ({}),
    save: async () => undefined,
    homeChainId: 52014,
  } as never)
  const unsubscribed: string[] = []
  const revoked: string[] = []
  const approved: ApprovalIntent[] = []
  const ctx: RpcContext = {
    sites,
    now: () => Date.now(),
    session: async () => ({ accountId: 'acct-1', addresses: [ME] }),
    knownChain: () => true,
    executeSafe: async () => '0x1',
    approve: async (intent) => {
      approved.push(intent)
      return null
    },
    emit: () => undefined,
    settings: { ethSignEnabled: false },
    subscribeHeads: (_o, _c, id) => () => unsubscribed.push(id),
    revoke: async (origin) => {
      revoked.push(origin)
    },
    ...over,
  } as RpcContext
  return { flow: new RpcFlow(ctx), sites, unsubscribed, revoked, approved }
}

describe('metering', () => {
  it('bounds connect and chain calls far below the safe budget (ES-BV-016)', async () => {
    const { flow, sites } = boot()
    await sites.connect(ORIGIN, { accountId: 'acct-1' })
    let refused = 0
    for (let i = 0; i < 20; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await flow.request(ORIGIN, 'eth_requestAccounts', [], `r${i}`).catch((e: unknown) => {
        if ((e as { code?: number }).code === -32005) refused += 1
      })
    }
    // Five a second, so most of twenty in one tick are turned away.
    expect(refused).toBeGreaterThan(10)
  })
})

describe('subscriptions', () => {
  it('caps them per origin and lets them go with the origin (ES-BV-017)', async () => {
    const { flow, sites, unsubscribed } = boot()
    await sites.connect(ORIGIN, { accountId: 'acct-1' })
    const ids: string[] = []
    for (let i = 0; i < 8; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      ids.push((await flow.request(ORIGIN, 'eth_subscribe', ['newHeads'], `s${i}`)) as string)
    }
    await expect(flow.request(ORIGIN, 'eth_subscribe', ['newHeads'], 's9')).rejects.toMatchObject({ code: -32005 })
    expect(ids).toHaveLength(8)

    // The tab goes away; so does the polling it was keeping alive.
    flow.forgetOrigin(ORIGIN)
    expect(unsubscribed.sort()).toEqual(ids.sort())
    // And the cap is clear again for a page that comes back.
    await expect(flow.request(ORIGIN, 'eth_subscribe', ['newHeads'], 's10')).resolves.toBeTruthy()
  })
})

describe('a page revoking its own permissions', () => {
  it('goes through the engine, so the change is fanned out (ES-BV-018)', async () => {
    const { flow, sites, revoked } = boot()
    await sites.connect(ORIGIN, { accountId: 'acct-1' })
    await flow.request(ORIGIN, 'wallet_revokePermissions', [{ eth_accounts: {} }], 'rev')
    expect(revoked).toEqual([ORIGIN])
  })
})

describe('what a page may hand over', () => {
  it('refuses a message, a calldata and a typed message that are simply too big (ES-BV-020)', async () => {
    const { flow, sites } = boot()
    await sites.connect(ORIGIN, { accountId: 'acct-1' })
    const huge = 'a'.repeat(200_000)
    await expect(flow.request(ORIGIN, 'personal_sign', [huge, ME], 'p1')).rejects.toMatchObject({ code: -32602 })
    await expect(
      flow.request(ORIGIN, 'eth_sendTransaction', [{ from: ME, to: ME, data: `0x${'ab'.repeat(200_000)}` }], 'p2'),
    ).rejects.toMatchObject({ code: -32602 })
    await expect(
      flow.request(ORIGIN, 'eth_signTypedData_v4', [ME, JSON.stringify({ note: huge })], 'p3'),
    ).rejects.toMatchObject({ code: -32602 })
    expect(vi.isMockFunction(() => undefined)).toBe(false)
  })

  it('still takes an ordinary one', async () => {
    const { flow, sites, approved } = boot()
    await sites.connect(ORIGIN, { accountId: 'acct-1' })
    await flow.request(ORIGIN, 'personal_sign', ['hello', ME], 'ok')
    expect(approved[0]?.kind).toBe('sign_message')
  })
})
