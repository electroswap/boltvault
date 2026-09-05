import { encodeFunctionData } from 'viem'
import type { Address } from 'viem'

/** Zero address — used as the "no referrer" sentinel for contribute(). */
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as const

/** Minimal Launchpool pool ABI (per-pool contracts). */
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

export interface CallPayload {
  to: string
  data: string
  value: bigint
}

/**
 * Encode `contribute(address referrer)` for a pool.
 * The user's contribution is `value` (native ETN, must be within the pool's
 * min/max); `referrer` defaults to 0x0 (no referrer).
 */
export function contributeCall(a: {
  pool: string
  value: bigint
  referrer?: string
}): CallPayload {
  return {
    to: a.pool,
    data: encodeFunctionData({
      abi: poolAbi,
      functionName: 'contribute',
      args: [(a.referrer ?? ZERO_ADDRESS) as Address],
    }),
    value: a.value,
  }
}

/** Encode `claim()` — claim the launched token for your contribution. */
export function claimCall(a: { pool: string }): CallPayload {
  return {
    to: a.pool,
    data: encodeFunctionData({ abi: poolAbi, functionName: 'claim' }),
    value: 0n,
  }
}

/** Encode `refund()` — refund native contribution on a failed pool. */
export function refundCall(a: { pool: string }): CallPayload {
  return {
    to: a.pool,
    data: encodeFunctionData({ abi: poolAbi, functionName: 'refund' }),
    value: 0n,
  }
}
