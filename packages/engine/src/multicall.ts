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

/** The address the registry pins for this chain, if it pins one. */
function pinned(chainId: number): Hex | null {
  if (chainId === 52014) return ELECTRONEUM_ADDRESSES[52014].multicall3 as Hex
  if (chainId === 5201420) return ELECTRONEUM_ADDRESSES[5201420].multicall3 as Hex
  return null
}

function candidates(chainId: number): Hex[] {
  const own = pinned(chainId)
  // The pinned address goes first. Neither ETN chain runs the canonical
  // deployment, so probing canonical first spent an eth_getCode on a certain
  // miss before falling through to the right one — every cold service worker.
  return own === null ? [CANONICAL_MULTICALL3] : [own, CANONICAL_MULTICALL3]
}

/** The multicall address for a chain, verified to hold code; null when none answers. */
export async function multicallAddress(chains: ChainsService, chainId: number): Promise<Hex | null> {
  const known = verified.get(chainId)
  if (known !== undefined) return known
  // The probe stays. It is what lets one build work against a chain whose
  // Multicall3 is at the canonical address and one whose is not — including
  // every mock chain in the test suite, which registers the canonical one.
  // Only the order changes, and that is where the saving is.
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
  queues.clear()
}

interface Waiter {
  readonly start: number
  readonly count: number
  readonly resolve: (results: ReadResult[]) => void
  readonly reject: (err: unknown) => void
}

interface Queue {
  calls: ReadCall[]
  waiters: Waiter[]
  timer: ReturnType<typeof setTimeout> | null
}

const queues = new Map<number, Queue>()

/**
 * How long a read waits for company before going out.
 *
 * Opening the popup used to fire nineteen separate eth_calls: holder,
 * portfolio, farm, legends and launchpad each reach the chain through their
 * own readMany, and each was its own Multicall3 aggregate. They are not in the
 * same tick — every one arrives after its own Port round trip — so neither
 * viem's HTTP batching nor its automatic multicall could merge them.
 *
 * Coalescing here does. Reads are idempotent and order-independent, so a short
 * window costs nothing but latency, and merges the burst into one aggregate.
 * Deliberately not applied to writes, where ordering is load-bearing.
 */
const COALESCE_MS = 12

/** Collect the burst, then send it as one aggregate. */
export function readMany(chains: ChainsService, chainId: number, calls: readonly ReadCall[]): Promise<ReadResult[]> {
  if (calls.length === 0) return Promise.resolve([])
  return new Promise<ReadResult[]>((resolve, reject) => {
    let q = queues.get(chainId)
    if (q === undefined) {
      q = { calls: [], waiters: [], timer: null }
      queues.set(chainId, q)
    }
    q.waiters.push({ start: q.calls.length, count: calls.length, resolve, reject })
    q.calls.push(...calls)
    if (q.timer === null) {
      q.timer = setTimeout(() => {
        const batch = queues.get(chainId)
        queues.delete(chainId)
        if (batch === undefined) return
        readManyNow(chains, chainId, batch.calls).then(
          (all) => {
            for (const w of batch.waiters) w.resolve(all.slice(w.start, w.start + w.count))
          },
          (err: unknown) => {
            for (const w of batch.waiters) w.reject(err)
          },
        )
      }, COALESCE_MS)
    }
  })
}

async function readManyNow(chains: ChainsService, chainId: number, calls: readonly ReadCall[]): Promise<ReadResult[]> {
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
