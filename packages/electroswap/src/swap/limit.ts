/**
 * Limit orders (master plan §8.6) on EsLimitOrderManagerV1: submit (with or
 * without a Permit2 signature), close, and read the user's open orders. The
 * contract takes `toSendPreFee / 1000` on every fill for the platform — the
 * sheet says so; there is no wallet fee on limit orders.
 */
import { encodeFunctionData, type Hex } from 'viem'
import { LIMIT_ORDERS_ABI } from './abis'
import type { ReadCall, Reader } from './quote'

export const LIMIT_PLATFORM_FEE_BIPS = 10

export type OrderStatus = 'open' | 'filled' | 'closed' | 'expired' | 'unknown'

export interface LimitOrderView {
  readonly orderId: bigint
  readonly owner: Hex
  readonly recipient: Hex
  readonly tokenIn: Hex
  readonly tokenOut: Hex
  readonly unwrapOutput: boolean
  readonly amountInExact: bigint
  readonly amountOutMin: bigint
  readonly amountInRemaining: bigint
  readonly amountOutFilled: bigint
  readonly amountOutPlatformFees: bigint
  readonly createdAt: number
  readonly updatedAt: number
  readonly expiresAt: number
  readonly status: OrderStatus
  readonly statusCode: number
}

const ORDER_OUTPUTS = [
  { name: 'orderId', type: 'uint256' },
  { name: 'owner', type: 'address' },
  { name: 'recipient', type: 'address' },
  { name: 'tokenIn', type: 'address' },
  { name: 'tokenOut', type: 'address' },
  { name: 'unwrapOutput', type: 'bool' },
  { name: 'amountInExact', type: 'uint256' },
  { name: 'amountOutMin', type: 'uint256' },
  { name: 'amountInRemaining', type: 'uint256' },
  { name: 'amountOutFilled', type: 'uint256' },
  { name: 'amountOutPlatformFees', type: 'uint256' },
  { name: 'createdAt', type: 'uint256' },
  { name: 'updatedAt', type: 'uint256' },
  { name: 'expiresAt', type: 'uint256' },
  { name: 'status', type: 'uint8' },
] as const

/** `orders(uint256)` with the artifact's field names (apps/interface/src/abis/limit-orders.json). */
export const ORDERS_ABI = [
  {
    type: 'function',
    name: 'orders',
    stateMutability: 'view',
    inputs: [{ name: '', type: 'uint256' }],
    outputs: ORDER_OUTPUTS,
  },
] as const

/** Status codes per the artifact: 0 open, 1 filled, 2 closed, 3 expired (verified against the test suite in contracts/electroswap/LimitOrders). */
function statusOf(code: number, expiresAt: number, nowSeconds: number): OrderStatus {
  if (code === 0) return expiresAt !== 0 && expiresAt < nowSeconds ? 'expired' : 'open'
  if (code === 1) return 'filled'
  if (code === 2) return 'closed'
  if (code === 3) return 'expired'
  return 'unknown'
}

export function encodeSubmitOrder(input: {
  tokenIn: Hex
  tokenOut: Hex
  unwrapOutput: boolean
  amountInExact: bigint
  amountOutMin: bigint
  recipient: Hex
  durationSeconds: bigint
}): Hex {
  return encodeFunctionData({
    abi: LIMIT_ORDERS_ABI,
    functionName: 'submitOrder',
    args: [
      input.tokenIn,
      input.tokenOut,
      input.unwrapOutput,
      input.amountInExact,
      input.amountOutMin,
      input.recipient,
      input.durationSeconds,
    ],
  })
}

export function encodeSubmitOrderWithPermit(input: {
  tokenIn: Hex
  tokenOut: Hex
  unwrapOutput: boolean
  amountInExact: bigint
  amountOutMin: bigint
  recipient: Hex
  durationSeconds: bigint
  permit: {
    token: Hex
    amount: bigint
    expiration: number
    nonce: number
    spender: Hex
    sigDeadline: bigint
    signature: Hex
  }
}): Hex {
  const p = input.permit
  return encodeFunctionData({
    abi: LIMIT_ORDERS_ABI,
    functionName: 'submitOrderWithPermit',
    args: [
      input.tokenIn,
      input.tokenOut,
      input.unwrapOutput,
      input.amountInExact,
      input.amountOutMin,
      input.recipient,
      input.durationSeconds,
      {
        details: { token: p.token, amount: p.amount, expiration: p.expiration, nonce: p.nonce },
        spender: p.spender,
        sigDeadline: p.sigDeadline,
      },
      p.signature,
    ],
  })
}

export function encodeCloseOrder(orderId: bigint): Hex {
  return encodeFunctionData({ abi: LIMIT_ORDERS_ABI, functionName: 'closeOrder', args: [orderId] })
}

export function encodeCloseOrders(orderIds: readonly bigint[]): Hex {
  return encodeFunctionData({
    abi: LIMIT_ORDERS_ABI,
    functionName: 'closeOrders',
    args: [[...orderIds]],
  })
}

/** The user's open orders, read in one batch. */
export async function openOrders(
  manager: Hex,
  user: Hex,
  read: Reader,
  nowSeconds: number,
): Promise<LimitOrderView[]> {
  const [ids] = await read([
    { address: manager, abi: LIMIT_ORDERS_ABI, functionName: 'openOrdersByUser', args: [user] },
  ])
  if (!ids?.ok || !Array.isArray(ids.value)) return []
  const orderIds = ids.value as readonly bigint[]
  if (orderIds.length === 0) return []
  const calls: ReadCall[] = orderIds.map((id) => ({
    address: manager,
    abi: ORDERS_ABI,
    functionName: 'orders',
    args: [id],
  }))
  const rows = await read(calls)
  const out: LimitOrderView[] = []
  rows.forEach((r) => {
    if (!r.ok || !Array.isArray(r.value)) return
    const v = r.value as unknown as readonly [
      bigint,
      Hex,
      Hex,
      Hex,
      Hex,
      boolean,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      number,
    ]
    const expiresAt = Number(v[13])
    out.push({
      orderId: v[0],
      owner: v[1],
      recipient: v[2],
      tokenIn: v[3],
      tokenOut: v[4],
      unwrapOutput: v[5],
      amountInExact: v[6],
      amountOutMin: v[7],
      amountInRemaining: v[8],
      amountOutFilled: v[9],
      amountOutPlatformFees: v[10],
      createdAt: Number(v[11]),
      updatedAt: Number(v[12]),
      expiresAt,
      status: statusOf(Number(v[14]), expiresAt, nowSeconds),
      statusCode: Number(v[14]),
    })
  })
  return out
}
