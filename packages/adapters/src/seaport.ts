import { encodeFunctionData, toHex, type Abi, type Hex } from 'viem'

/**
 * adapters/seaport — pure Seaport 1.5 calldata shims for BoltVault.
 *
 * We call Seaport 1.5 directly (not through ElectroSwap SDKs) so the
 * viem-native side can build/verify orders without importing the SDKs.
 * Calldata is plain encoded function data; nothing here touches a chain.
 */

/** Seaport 1.5 contract (the "Seaport" upgrade that ElectroSwap deploys on). */
export const SEAPORT_15 = '0x678748317e7fD5B7699D07e666087608B401cbFd'

/**
 * ElectroSwap's own Seaport conduit key.
 * NOTE: this is NOT OpenSea's conduit (0x7c90...) — orders must be matched
 * against this conduit or ElectroSwap's collection won't accept them.
 */
export const CONDUIT_KEY =
  '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0000000000000000000000000'

/** Minimal Seaport 1.5 surface we encode against (no structural deps). */
const SEAPORT_15_ABI = [
  {
    name: 'fulfillBasicOrder',
    type: 'function' as const,
    stateMutability: 'payable' as const,
    inputs: [{ name: 'order', type: 'bytes' }],
    outputs: [{ name: 'orderHash', type: 'bytes32' }],
  },
  {
    name: 'createBasicOrder',
    type: 'function' as const,
    stateMutability: 'nonpayable' as const,
    inputs: [{ name: 'order', type: 'bytes' }],
    outputs: [{ name: 'orderHash', type: 'bytes32' }],
  },
] satisfies Abi

/**
 * Build the calldata to fulfill a Seaport 1.5 basic order.
 * `offerer` is carried for caller convenience/verification; it is not part of
 * the calldata (the order bytes already encode it).
 */
export function buildFulfillOrder(order: {
  order: Uint8Array
  offerer: string
}): { to: string; data: string; value: bigint } {
  const data: Hex = encodeFunctionData({
    abi: SEAPORT_15_ABI,
    functionName: 'fulfillBasicOrder',
    args: [toHex(order.order)],
  })
  return { to: SEAPORT_15, data, value: 0n }
}

/** Build the calldata to create (pre-sign) a Seaport 1.5 basic order. */
export function buildCreateOrder(order: {
  order: Uint8Array
}): { to: string; data: string } {
  const data: Hex = encodeFunctionData({
    abi: SEAPORT_15_ABI,
    functionName: 'createBasicOrder',
    args: [toHex(order.order)],
  })
  return { to: SEAPORT_15, data }
}
