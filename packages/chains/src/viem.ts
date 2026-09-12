import { createPublicClient, http, fallback } from 'viem'
import type { PublicClient } from 'viem'
import type { ChainDef } from './registry.js'
import { requireChain } from './registry.js'

/**
 * Per-chain viem PublicClient with built-in RPC failover (T2.1).
 *
 * viem's `fallback` transport walks the chain's `rpcUrls` in order and promotes
 * a working endpoint, so a flaky primary transparently yields to the fallback
 * of record (PublicNode keyless tier). No hand-rolled fetch.
 */
export function createChainClient(
  chainId: number,
  opts?: { timeout?: number; batch?: boolean },
): PublicClient {
  const chain = requireChain(chainId)
  const timeout = opts?.timeout ?? 10_000
  return createPublicClient({
    transport: fallback(
      chain.rpcUrls.map((url) => http(url, { timeout, batch: opts?.batch ?? true })),
      { retryCount: 0 },
    ),
  })
}

/**
 * Chunk calls for Multicall3. Most EVMs tolerate a generous batch, but a few
 * (BSC) cap `eth_call` batch size and revert large multicalls — so we cap by
 * call count AND by estimated calldata bytes. Design: "multicall3 with a
 * batch cap that's chain-aware."
 */
export interface MulticallChunk<T> {
  calls: T[]
}

export function chunkMulticall<T>(
  calls: readonly T[],
  opts?: { maxCalls?: number; maxCalldataBytes?: number; estimateBytes?: (call: T) => number },
): T[][] {
  const maxCalls = opts?.maxCalls ?? 50
  const maxBytes = opts?.maxCalldataBytes ?? 200_000 // ~200KB; safe under BSC 2M gas / eth_call limits
  const est = opts?.estimateBytes ?? (() => 100) // default: count only
  const out: T[][] = []
  let cur: T[] = []
  let bytes = 0
  for (const call of calls) {
    const b = Math.max(1, est(call))
    if (cur.length > 0 && (cur.length + 1 > maxCalls || bytes + b > maxBytes)) {
      out.push(cur)
      cur = []
      bytes = 0
    }
    cur.push(call)
    bytes += b
  }
  if (cur.length > 0) out.push(cur)
  return out
}

export type { ChainDef, PublicClient }
