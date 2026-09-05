import { encodeFunctionData } from 'viem'

/** Yield farm contract on ETN 52014. */
export const FARM_CONTRACT = '0xe653aC16B732876F58a1722d24801230fA96bc82'

const abi = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'farmId', type: 'uint256' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
      { name: 'amountBolt', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'withdraw',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'farmId', type: 'uint256' },
      { name: 'liquidityAmt', type: 'uint256' },
      { name: 'asNative', type: 'bool' },
    ],
    outputs: [],
  },
] as const

export interface DepositArgs {
  farmId: number
  amount0: bigint
  amount1: bigint
  amountBolt: bigint
  value: bigint
}

export interface WithdrawArgs {
  farmId: number
  liquidityAmt: bigint
  asNative: boolean
}

export interface CallPayload {
  to: string
  data: string
  value: bigint
}

export function depositCall(a: DepositArgs): CallPayload {
  return {
    to: FARM_CONTRACT,
    data: encodeFunctionData({
      abi,
      functionName: 'deposit',
      args: [BigInt(a.farmId), a.amount0, a.amount1, a.amountBolt],
    }),
    value: a.value,
  }
}

export function withdrawCall(a: WithdrawArgs): CallPayload {
  return {
    to: FARM_CONTRACT,
    data: encodeFunctionData({
      abi,
      functionName: 'withdraw',
      args: [BigInt(a.farmId), a.liquidityAmt, a.asNative],
    }),
    value: 0n,
  }
}

/**
 * Collect rewards without touching the position: withdraw(farmId, 0, asNative).
 * Liquidity 0 is the valid "collect" path.
 */
export function collectCall(a: { farmId: number; asNative: boolean }): CallPayload {
  return withdrawCall({ farmId: a.farmId, liquidityAmt: 0n, asNative: a.asNative })
}
