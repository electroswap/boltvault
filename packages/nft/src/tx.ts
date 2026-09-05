import { encodeFunctionData } from 'viem'

/**
 * @boltvault/nft — Seaport 1.5 constants + calldata helpers for ETN NFTs.
 *
 * NFTs trade on Seaport 1.5 with the **ElectroSwap** conduit key (NOT
 * OpenSea's). SELL_MODE is the default execution path for purchases.
 */

/** Seaport 1.5 core contract on ETN. */
export const SEAPORT_15 = '0x678748317e7fD5B7699D07e666087608B401cbFd'

/** ElectroSwap's Seaport conduit key (NOT OpenSea's). */
export const CONDUIT_KEY = '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0000000000000000000000000'

/** Default buy path: off-chain order + on-chain fulfill (`link-out`). */
export const SELL_MODE: 'link-out' | 'onchain' = 'link-out'

/** Minimal ERC-721 ownerOf ABI (just what ownerCheck needs). */
const ERC721_OWNER_OF_ABI = [
  {
    type: 'function',
    name: 'ownerOf',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const

/**
 * Call `ownerOf(tokenId)` on the asset contract via an injected viem-style
 * client and return the owner. If `expectedOwner` is given and differs from
 * the on-chain owner (case-insensitive), throws.
 */
export async function ownerCheck(
  clientLike: {
    readContract: (args: {
      address: string
      abi: unknown
      functionName: string
      args: unknown[]
    }) => Promise<string>
  },
  a: { address: string; tokenId: string; expectedOwner?: string },
): Promise<string> {
  const owner = await clientLike.readContract({
    address: a.address,
    abi: ERC721_OWNER_OF_ABI as any,
    functionName: 'ownerOf',
    args: [BigInt(a.tokenId)],
  })
  if (a.expectedOwner !== undefined && owner.toLowerCase() !== a.expectedOwner.toLowerCase()) {
    throw new Error(`owner mismatch: expected ${a.expectedOwner}, on-chain ${owner}`)
  }
  return owner
}

/** Minimal Seaport 1.5 fulfillBasicOrder ABI (bytes) — the whole call shape. */
const SEAPORT_FULFILL_ABI = [
  {
    type: 'function',
    name: 'fulfillBasicOrder',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'order', type: 'bytes' }],
    outputs: [],
  },
] as const

/**
 * Build the fulfill calldata for a Seaport order.
 *
 * Default builder encodes `fulfillBasicOrder(order.order)` via viem. A custom
 * `builder` may be injected to override the encoding (e.g. an off-chain
 * `link-out` path). Throws if `order.conduitKey` is set and is not the
 * ElectroSwap conduit key.
 */
export function fulfillOrderCall(
  order: any,
  builder?: (o: any) => { data: string; value: bigint },
): { to: string; data: string; value: bigint } {
  const conduitKey = order?.conduitKey
  if (conduitKey !== undefined && conduitKey !== null && String(conduitKey).toLowerCase() !== CONDUIT_KEY.toLowerCase()) {
    throw new Error(`unexpected conduit key: ${conduitKey}`)
  }
  const defaultBuilder = (o: any) => ({
    data: encodeFunctionData({
      abi: SEAPORT_FULFILL_ABI as any,
      functionName: 'fulfillBasicOrder',
      args: [o.order as `0x${string}`],
    }),
    value: 0n,
  })
  const { data, value } = (builder ?? defaultBuilder)(order)
  return { to: SEAPORT_15, data, value }
}
