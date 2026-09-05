import { encodeFunctionData, keccak256, type Abi, type Hex } from 'viem'

/**
 * adapters/hyperlane — pure Hyperlane warp-transfer shims for BoltVault.
 *
 * Dispatch: call the Interchain Account (ICA) router with a warp
 * `transferRemote(...)`. The mailbox poll checks relayed logs for a
 * messageId so the UI can track dispatch → processed without a chain client.
 */

/**
 * Interchain Account router.
 * TODO(verify): confirm against the repo's ICA_ROUTER constant — this shim
 * must route through the same ICA router the dapp deploys to.
 */
export const ICA_ROUTER = '0x9fE454AA8156E49F130aB73c6b783008f53e99a9'

/** Minimal warp-router surface we encode against. */
const WARP_ROUTER_ABI = [
  {
    name: 'transferRemote',
    type: 'function' as const,
    stateMutability: 'payable' as const,
    inputs: [
      { name: '_destination', type: 'address' },
      { name: '_recipient', type: 'address' },
      { name: '_amount', type: 'uint256' },
    ],
    outputs: [],
  },
] satisfies Abi

/** Build a Hyperlane warp dispatch (ICA router `transferRemote`). */
export function buildDispatch(a: {
  destination: string
  recipient: string
  amount: bigint
}): { to: string; data: string; value: bigint; messageId: string } {
  const data: Hex = encodeFunctionData({
    abi: WARP_ROUTER_ABI,
    functionName: 'transferRemote',
    args: [a.destination, a.recipient, a.amount],
  })
  return {
    to: ICA_ROUTER,
    data,
    value: a.amount,
    messageId: keccak256(data),
  }
}

/**
 * Did any log carry `messageId` (in topics or data)? Case-insensitive hex
 * substring compare — log topics/data are hex strings, messageId is 32-byte hex.
 */
export function pollProcess(
  logs: { topics?: (string | null)[]; data?: string }[],
  messageId: string,
): boolean {
  const needle = messageId.toLowerCase()
  for (const log of logs) {
    const data = log.data?.toLowerCase()
    if (data !== undefined && data !== '' && data.includes(needle)) return true
    const topics = log.topics
    if (topics) {
      for (const topic of topics) {
        if (topic !== null && topic.toLowerCase().includes(needle)) return true
      }
    }
  }
  return false
}
