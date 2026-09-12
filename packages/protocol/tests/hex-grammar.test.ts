/**
 * A quantity is not a byte string, and `0x` is neither (ES-BV-021).
 *
 * One regular expression stood in for both grammars and admitted empty and
 * odd-length values everywhere — so `value: '0x'` reached a sheet, where
 * `parseInt('0x', 16)` is `NaN`, and `data: '0xabc'` reached one too, where
 * half a byte of calldata is not calldata. `eth_sign` accepted a hash of any
 * length, which raised the most dangerous sheet in the wallet for something
 * that could never be signed.
 */
import { describe, expect, it } from 'vitest'
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
    settings: { ethSignEnabled: true },
    subscribeHeads: () => () => undefined,
    revoke: async () => undefined,
    ...over,
  } as RpcContext
  return { flow: new RpcFlow(ctx), sites, approved }
}

/** Whether the request was refused by the grammar rather than by anything later. */
async function badParams(run: Promise<unknown>): Promise<boolean> {
  try {
    await run
    return false
  } catch (err) {
    return (err as { code?: number }).code === -32602
  }
}

async function send(tx: Record<string, unknown>): Promise<boolean> {
  const { flow, sites } = boot()
  await sites.connect(ORIGIN, { accountId: 'acct-1' })
  return badParams(flow.request(ORIGIN, 'eth_sendTransaction', [{ from: ME, to: ME, ...tx }], `r${Math.random()}`))
}

describe('a quantity field', () => {
  it('refuses `0x`, which is not a number', async () => {
    expect(await send({ value: '0x' })).toBe(true)
    expect(await send({ gas: '0x' })).toBe(true)
    expect(await send({ nonce: '0x' })).toBe(true)
    expect(await send({ maxFeePerGas: '0x' })).toBe(true)
  })

  it('accepts an odd-length one, because `0x1` is a number', async () => {
    expect(await send({ value: '0x1' })).toBe(false)
    expect(await send({ gas: '0x5208' })).toBe(false)
  })

  it('still refuses something that is not hex at all', async () => {
    expect(await send({ value: '1' })).toBe(true)
    expect(await send({ value: '0xzz' })).toBe(true)
  })
})

describe('a byte-string field', () => {
  it('refuses half a byte', async () => {
    expect(await send({ data: '0xabc' })).toBe(true)
  })

  it('accepts `0x`, because a plain send has no calldata', async () => {
    expect(await send({ data: '0x' })).toBe(false)
    expect(await send({ data: '0xa9059cbb' })).toBe(false)
  })
})

describe('an eth_sign hash', () => {
  const sign = async (hash: string): Promise<boolean> => {
    const { flow, sites } = boot()
    await sites.connect(ORIGIN, { accountId: 'acct-1' })
    return badParams(flow.request(ORIGIN, 'eth_sign', [ME, hash], `s${Math.random()}`))
  }

  it('is thirty-two bytes or it is not a hash', async () => {
    expect(await sign('0xdeadbeef')).toBe(true)
    expect(await sign('0x')).toBe(true)
    expect(await sign(`0x${'11'.repeat(33)}`)).toBe(true)
    expect(await sign(`0x${'11'.repeat(32)}`)).toBe(false)
  })
})

describe('a personal_sign message', () => {
  const signMessage = async (message: unknown): Promise<ApprovalIntent | undefined> => {
    const { flow, sites, approved } = boot()
    await sites.connect(ORIGIN, { accountId: 'acct-1' })
    await flow.request(ORIGIN, 'personal_sign', [message, ME], `m${Math.random()}`).catch(() => undefined)
    return approved[0]
  }

  it('reads a half-byte "hex" message as the text it is', async () => {
    // Not a refusal: a page that sent `0xabc` meant those four characters, and
    // signing them as text is what every other wallet does.
    const intent = await signMessage('0xabc')
    expect(intent?.kind).toBe('sign_message')
    expect((intent as { message: string }).message).not.toBe('0xabc')
  })

  it('keeps a whole-byte hex message as bytes', async () => {
    const intent = await signMessage('0xdeadbeef')
    expect((intent as { message: string }).message).toBe('0xdeadbeef')
  })
})
