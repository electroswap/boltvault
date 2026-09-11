/**
 * Speed up and cancel (§8.12). Both replace a transaction already sitting in a
 * node's pool by signing a new one at the SAME nonce for a higher fee, so the
 * two properties that matter are: the nonce is reused exactly, and the fee
 * actually goes up by enough that a node will evict the old one.
 *
 * Neither is offered on Electroneum — a five-second block means the thing is
 * already mined or never got out — and refusing out loud beats a button that
 * cannot work.
 */
import { describe, expect, it } from 'vitest'
import { EngineError } from '../src/errors'
import { TxService, type TxDeps } from '../src/namespaces/tx'
import type { ActivityEntry } from '../src/schema'

const ME = '0x1111111111111111111111111111111111111111'
const CONTRACT = '0x2222222222222222222222222222222222222222'
const ETHEREUM = 1
const ETN = 52014

const row = (over: Partial<ActivityEntry> = {}): ActivityEntry => ({
  id: 'row-1',
  hash: '0xdead',
  chainId: ETHEREUM,
  accountId: 'acct-1',
  to: CONTRACT,
  value: '1000',
  nonce: 7,
  submittedAt: 1,
  origin: null,
  category: 'SEND',
  statements: [],
  riskCodes: [],
  status: 'pending',
  blockNumber: null,
  data: '0xa9059cbb',
  ...over,
})

interface Submitted {
  chainId: number
  accountId: string
  origin: string
  tx: Record<string, string | undefined>
}

function serviceWith(entries: ActivityEntry[], opts: { baseFee?: string | null } = {}) {
  const sent: Submitted[] = []
  const deps = {
    platform: { now: () => 1_700_000_000_000 },
    chains: {
      rpc: async (_chainId: number, method: string) => {
        if (method === 'eth_getBlockByNumber') return opts.baseFee === null ? null : { baseFeePerGas: opts.baseFee ?? '0x3b9aca00' }
        if (method === 'eth_maxPriorityFeePerGas') return '0x5f5e100'
        if (method === 'eth_gasPrice') return '0x77359400'
        return '0x0'
      },
    },
    vault: { accounts: async () => [{ id: 'acct-1', address: ME }] },
    provider: {
      submitInternal: async (intent: { chainId: number; accountId: string; origin: string; tx: Record<string, string | undefined> }) => {
        sent.push({ chainId: intent.chainId, accountId: intent.accountId, origin: intent.origin, tx: intent.tx })
        return { requestId: `req-${sent.length}` }
      },
    },
    activity: { list: async () => entries },
  } as unknown as TxDeps
  return { tx: new TxService(deps), sent }
}

async function codeOf(p: Promise<unknown>): Promise<string> {
  try {
    await p
  } catch (err) {
    return err instanceof EngineError ? err.message : 'not-an-engine-error'
  }
  return 'no-error'
}

describe('speeding up a stuck transaction', () => {
  it('repeats the same call at the same nonce', async () => {
    const { tx, sent } = serviceWith([row()])
    expect(await tx.speedUp({ id: 'row-1' })).toEqual({ requestId: 'req-1' })
    expect(sent[0]?.tx['nonce']).toBe('0x7')
    expect(sent[0]?.tx['to']).toBe(CONTRACT)
    expect(sent[0]?.tx['data']).toBe('0xa9059cbb')
    expect(sent[0]?.tx['value']).toBe('0x3e8')
    expect(sent[0]?.origin).toBe('internal:activity')
  })

  it('pays more than the transaction it is replacing, or a node will not take it', async () => {
    const { tx, sent } = serviceWith([row()])
    await tx.speedUp({ id: 'row-1' })
    // The tip is bumped past the node's suggestion; 0x5f5e100 is 100_000_000.
    expect(BigInt(sent[0]?.tx['maxPriorityFeePerGas'] ?? '0x0')).toBeGreaterThan(100_000_000n)
    expect(BigInt(sent[0]?.tx['maxFeePerGas'] ?? '0x0')).toBeGreaterThan(BigInt(sent[0]?.tx['maxPriorityFeePerGas'] ?? '0x0'))
  })

  it('falls back to a bumped gas price on a chain with no base fee', async () => {
    const { tx, sent } = serviceWith([row()], { baseFee: null })
    await tx.speedUp({ id: 'row-1' })
    expect(sent[0]?.tx['maxFeePerGas']).toBeUndefined()
    expect(BigInt(sent[0]?.tx['gasPrice'] ?? '0x0')).toBeGreaterThan(BigInt('0x77359400'))
  })

  it('can be found by transaction hash as well as by row id', async () => {
    const { tx, sent } = serviceWith([row()])
    await tx.speedUp({ id: '0xdead' })
    expect(sent).toHaveLength(1)
  })
})

describe('cancelling a stuck transaction', () => {
  it('occupies the nonce with nothing, to yourself', async () => {
    const { tx, sent } = serviceWith([row()])
    await tx.cancel({ id: 'row-1' })
    expect(sent[0]?.tx['nonce']).toBe('0x7')
    expect(sent[0]?.tx['to']).toBe(ME)
    expect(sent[0]?.tx['value']).toBe('0x0')
    expect(sent[0]?.tx['data']).toBe('0x')
  })
})

describe('what cannot be replaced', () => {
  it('refuses on Electroneum, and says why', async () => {
    const { tx, sent } = serviceWith([row({ chainId: ETN })])
    expect(await codeOf(tx.speedUp({ id: 'row-1' }))).toContain('five seconds')
    expect(await codeOf(tx.cancel({ id: 'row-1' }))).toContain('five seconds')
    expect(sent).toHaveLength(0)
  })

  it('refuses a transaction that has already settled', async () => {
    for (const status of ['confirmed', 'failed', 'replaced'] as const) {
      const { tx } = serviceWith([row({ status })])
      expect(await codeOf(tx.speedUp({ id: 'row-1' })), status).toContain('already settled')
    }
  })

  it('refuses a row with no nonce, because there is nothing to replace', async () => {
    const { tx } = serviceWith([row({ nonce: null })])
    expect(await codeOf(tx.speedUp({ id: 'row-1' }))).toContain('no nonce')
  })

  it('refuses an id it does not know', async () => {
    const { tx } = serviceWith([row()])
    expect(await codeOf(tx.speedUp({ id: 'nope' }))).toContain('no such transaction')
  })

  it('tells the screen whether to offer the actions at all', async () => {
    expect(await serviceWith([row()]).tx.replaceable({ id: 'row-1' })).toEqual({ can: true, why: null })
    const etn = await serviceWith([row({ chainId: ETN })]).tx.replaceable({ id: 'row-1' })
    expect(etn.can).toBe(false)
    expect(etn.why).toContain('five seconds')
  })
})
