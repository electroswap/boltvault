import { describe, expect, it } from 'vitest'
import { decodeFunctionData, type Address } from 'viem'
import { claimCall, contributeCall, refundCall } from './calldata'
import { parseFeatured } from './featured'
import { classifyStatus, parseCampaigns } from './parse'
import type { LaunchpadStatus } from './types'

const REFERRER = '0x1111111111111111111111111111111111111111'
const ZERO = '0x0000000000000000000000000000000000000000'
const POOL = '0x2222222222222222222222222222222222222222'

const poolAbi = [
  {
    type: 'function',
    name: 'contribute',
    stateMutability: 'payable',
    inputs: [{ name: 'referrer', type: 'address' }],
    outputs: [],
  },
  {
    type: 'function',
    name: 'claim',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [],
    outputs: [],
  },
] as const

describe('classifyStatus — the binding 6-state table', () => {
  it('returns "cancelled" for a cancelled row', () => {
    expect(classifyStatus({ cancelled: true })).toBe('cancelled')
    expect(classifyStatus({ status: 'Cancelled' })).toBe('cancelled')
  })

  it('returns "launched-claim" for launched / token-claimable rows', () => {
    expect(classifyStatus({ launched: true })).toBe('launched-claim')
    expect(classifyStatus({ tokenClaimable: true })).toBe('launched-claim')
    expect(classifyStatus({ status: 'launched' })).toBe('launched-claim')
  })

  it('returns "failed-refund" for failed / refunded rows', () => {
    expect(classifyStatus({ failed: true })).toBe('failed-refund')
    expect(classifyStatus({ refunded: true })).toBe('failed-refund')
    expect(classifyStatus({ status: 'failed' })).toBe('failed-refund')
  })

  it('returns "ended-not-finalized" for ended-but-not-finalized rows', () => {
    expect(classifyStatus({ ended: true, finalized: false })).toBe('ended-not-finalized')
    expect(classifyStatus({ status: 'ended-not-finalized' })).toBe('ended-not-finalized')
  })

  it('returns "launched-claim" for ended+finalized rows', () => {
    expect(classifyStatus({ ended: true, finalized: true })).toBe('launched-claim')
  })

  it('returns "not-started" when startBlock > nowBlock', () => {
    expect(classifyStatus({ startBlock: 100, nowBlock: 50 })).toBe('not-started')
  })

  it('returns "live" for an in-window row (and for unknown rows)', () => {
    expect(classifyStatus({ startBlock: 50, nowBlock: 100 })).toBe('live')
    expect(classifyStatus({})).toBe('live')
  })

  it('exhaustively covers all 6 states', () => {
    const fixtures: Record<LaunchpadStatus, any> = {
      'not-started': { startBlock: 200, nowBlock: 100 },
      live: { startBlock: 100, nowBlock: 200 },
      'ended-not-finalized': { ended: true, finalized: false },
      'launched-claim': { launched: true },
      'failed-refund': { failed: true },
      cancelled: { cancelled: true },
    }
    for (const [expected, row] of Object.entries(fixtures)) {
      expect(classifyStatus(row)).toBe(expected)
    }
  })
})

describe('contributeCall', () => {
  it('encodes contribute(referrer) with the given value and referrer', () => {
    const value = 1_234_567n
    const call = contributeCall({ pool: POOL, value, referrer: REFERRER })
    expect(call.to).toBe(POOL)
    expect(call.value).toBe(value)
    const decoded = decodeFunctionData({ abi: poolAbi, data: call.data as `0x${string}` })
    expect(decoded.functionName).toBe('contribute')
    expect(decoded.args[0]).toBe(REFERRER.toLowerCase())
  })

  it('defaults referrer to the zero address', () => {
    const call = contributeCall({ pool: POOL, value: 1n })
    const decoded = decodeFunctionData({ abi: poolAbi, data: call.data as `0x${string}` })
    expect(decoded.functionName).toBe('contribute')
    expect(decoded.args[0]).toBe(ZERO)
  })
})

describe('claimCall / refundCall', () => {
  it('encodes claim() with zero value', () => {
    const call = claimCall({ pool: POOL })
    expect(call.to).toBe(POOL)
    expect(call.value).toBe(0n)
    const decoded = decodeFunctionData({ abi: poolAbi, data: call.data as `0x${string}` })
    expect(decoded.functionName).toBe('claim')
    expect(decoded.args ?? []).toEqual([])
  })

  it('encodes refund() with zero value', () => {
    const call = refundCall({ pool: POOL })
    expect(call.to).toBe(POOL)
    expect(call.value).toBe(0n)
    const decoded = decodeFunctionData({ abi: poolAbi, data: call.data as `0x${string}` })
    expect(decoded.functionName).toBe('refund')
    expect(decoded.args ?? []).toEqual([])
  })
})

describe('parseFeatured', () => {
  it('returns null on empty / invalid JSON', () => {
    expect(parseFeatured(null)).toBeNull()
    expect(parseFeatured(undefined)).toBeNull()
    expect(parseFeatured('')).toBeNull()
    expect(parseFeatured('{}')).toBeNull()
    expect(parseFeatured('not json')).toBeNull()
    expect(parseFeatured('"just a string"')).toBeNull()
    expect(parseFeatured('[1,2]')).toBeNull()
  })

  it('returns the pool on valid JSON', () => {
    expect(parseFeatured(JSON.stringify({ pool: POOL, name: 'Acme' }))).toEqual({
      pool: POOL,
      name: 'Acme',
    })
    expect(parseFeatured(JSON.stringify({ pool: POOL }))).toEqual({ pool: POOL })
  })
})

describe('parseCampaigns', () => {
  const row = {
    pool: POOL,
    min: '1000000000000000000',
    max: '10000000000000000000',
    raised: 2500000000000000000,
    yourFill: '500000000000000000',
    referrer: REFERRER,
    token: '0x3333333333333333333333333333333333333333',
    name: 'TestCoin',
  }

  it('maps rows from an array', () => {
    const campaigns = parseCampaigns([row])
    expect(campaigns).toHaveLength(1)
    const c = campaigns[0]!
    expect(c.pool).toBe(POOL)
    expect(c.status).toBe('live')
    expect(c.min).toBe(1000000000000000000n)
    expect(c.max).toBe(10000000000000000000n)
    expect(c.raised).toBe(2500000000000000000n)
    expect(c.yourFill).toBe(500000000000000000n)
    expect(c.referrer).toBe(REFERRER)
    expect(c.token).toBe('0x3333333333333333333333333333333333333333')
    expect(c.name).toBe('TestCoin')
    expect(c.raw).toBe(row)
  })

  it('maps rows from a { presales: [...] } envelope', () => {
    const campaigns = parseCampaigns({ presales: [row, { pool: POOL, started: false, startBlock: 9, nowBlock: 5 }] })
    expect(campaigns).toHaveLength(2)
    expect(campaigns[0]!.status).toBe('live')
    expect(campaigns[1]!.status).toBe('not-started')
    expect(campaigns[1]!.min).toBe(0n)
  })

  it('returns [] for unknown shapes', () => {
    expect(parseCampaigns(null)).toEqual([])
    expect(parseCampaigns({})).toEqual([])
  })
})
