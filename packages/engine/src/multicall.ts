/**
 * Batched reads through Multicall3 (master plan §2.8): chunks of 50, the
 * canonical deployment verified by `eth_getCode` once per chain, and a
 * per-call fallback when a chain has no working multicall.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import type { Abi, Hex, PublicClient } from 'viem'
import type { ChainsService } from './namespaces/chains'

export const CANONICAL_MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as const

export interface ReadCall {
  readonly address: Hex
  readonly abi: Abi
  readonly functionName: string
  readonly args?: readonly unknown[]
}

export type ReadResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

const CHUNK = 50
const verified = new Map<number, Hex | null>()

function candidates(chainId: number): Hex[] {
  if (chainId === 52014) return [CANONICAL_MULTICALL3, ELECTRONEUM_ADDRESSES[52014].multicall3 as Hex]
  if (chainId === 5201420) return [ELECTRONEUM_ADDRESSES[5201420].multicall3 as Hex, CANONICAL_MULTICALL3]
  return [CANONICAL_MULTICALL3]
}

/** The multicall address for a chain, verified to hold code; null when none answers. */
export async function multicallAddress(chains: ChainsService, chainId: number): Promise<Hex | null> {
  const known = verified.get(chainId)
  if (known !== undefined) return known
  for (const address of candidates(chainId)) {
    const code = (await chains.rpc(chainId, 'eth_getCode', [address, 'latest']).catch(() => '0x')) as string
    if (typeof code === 'string' && code.length > 2) {
      verified.set(chainId, address)
      return address
    }
  }
  verified.set(chainId, null)
  return null
}

/** Tests: forget the verified addresses (a mock RPC may change between runs). */
export function resetMulticallCache(): void {
  verified.clear()
}

export async function readMany(chains: ChainsService, chainId: number, calls: readonly ReadCall[]): Promise<ReadResult[]> {
  if (calls.length === 0) return []
  const client = await chains.client(chainId)
  const mc = await multicallAddress(chains, chainId)
  const out: ReadResult[] = []
  if (mc) {
    for (let i = 0; i < calls.length; i += CHUNK) {
      const chunk = calls.slice(i, i + CHUNK)
      try {
        const results = await client.multicall({ contracts: chunk.map((c) => ({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args as never })) as never, multicallAddress: mc, allowFailure: true })
        for (const r of results as Array<{ status: 'success' | 'failure'; result?: unknown }>) out.push(r.status === 'success' ? { ok: true, value: r.result } : { ok: false })
      } catch {
        // A whole chunk failed (RPC hiccup): fall back per call for this chunk.
        for (const c of chunk) out.push(await one(client, c))
      }
    }
    return out
  }
  // No multicall on this chain: individual calls, bounded so a huge universe cannot melt the RPC.
  for (const c of calls.slice(0, 120)) out.push(await one(client, c))
  for (let i = 120; i < calls.length; i++) out.push({ ok: false })
  return out
}

async function one(client: PublicClient, c: ReadCall): Promise<ReadResult> {
  try {
    return { ok: true, value: await client.readContract({ address: c.address, abi: c.abi, functionName: c.functionName, args: c.args as never }) }
  } catch {
    return { ok: false }
  }
}
