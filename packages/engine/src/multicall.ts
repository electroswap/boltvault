/**
 * Batched reads through Multicall3 (master plan §2.8): bursts coalesced into
 * one aggregate, chunked and sent in parallel, the canonical deployment
 * verified by `eth_getCode` once per chain, and a per-call fallback when a
 * chain has no working multicall.
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

/**
 * Calls per aggregate.
 *
 * Was 50, which is a cautious number for arbitrary calls and a wasteful one
 * for the call this actually makes most: `balanceOf`, 36 bytes in and 32 out.
 * BNB's public list is over a thousand tokens, so a portfolio read was twenty
 * aggregates — and they went out one after another. At 200 it is four, and
 * the request is still a few tens of kilobytes.
 */
const CHUNK = 200
/**
 * How many aggregates for one chain may be in flight together.
 *
 * Enough that a long universe finishes in a round or two, few enough that one
 * refresh does not look like a burst to the endpoint serving it — the governor
 * would let far more through, and being a good guest is cheaper than being
 * rate-limited.
 */
const CHUNK_CONCURRENCY = 4
const verified = new Map<number, Hex | null>()

/**
 * Canonical first on mainnet, and that ordering is load-bearing.
 *
 * It looks like a wasted probe — ETN pins its own multicall3 in the registry,
 * so why ask about the canonical address first? Because on chain 52014 *both*
 * addresses hold code (canonical 3808 bytes, the pinned one 3286), and they
 * are not the same contract. The pinned address answers eth_getCode, passes
 * the "does it hold code" test, and then returns aggregate3 results that do
 * not decode — a token's decimals come back empty and adding a custom token
 * reports "this contract does not look like a token". Reordering these broke
 * the swap e2e and nothing else, which is how it was found.
 *
 * The registry entry for 52014 is worth a second look; until then, canonical
 * wins on mainnet and the pinned address is only the fallback.
 */
function candidates(chainId: number): Hex[] {
  if (chainId === 52014)
    return [CANONICAL_MULTICALL3, ELECTRONEUM_ADDRESSES[52014].multicall3 as Hex]
  if (chainId === 5201420)
    return [ELECTRONEUM_ADDRESSES[5201420].multicall3 as Hex, CANONICAL_MULTICALL3]
  return [CANONICAL_MULTICALL3]
}

/** The multicall address for a chain, verified to hold code; null when none answers. */
export async function multicallAddress(
  chains: ChainsService,
  chainId: number,
): Promise<Hex | null> {
  const known = verified.get(chainId)
  if (known !== undefined) return known
  for (const address of candidates(chainId)) {
    const code = (await chains
      .rpc(chainId, 'eth_getCode', [address, 'latest'])
      .catch(() => '0x')) as string
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
export function readMany(
  chains: ChainsService,
  chainId: number,
  calls: readonly ReadCall[],
): Promise<ReadResult[]> {
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

async function readManyNow(
  chains: ChainsService,
  chainId: number,
  calls: readonly ReadCall[],
): Promise<ReadResult[]> {
  if (calls.length === 0) return []
  const client = await chains.client(chainId)
  const mc = await multicallAddress(chains, chainId)
  const out: ReadResult[] = []
  if (mc) {
    const chunks: ReadCall[][] = []
    for (let i = 0; i < calls.length; i += CHUNK) chunks.push(calls.slice(i, i + CHUNK))
    // Bounded workers rather than `Promise.all` over every chunk: the results
    // are written back by index, so the answer keeps the caller's order however
    // the chunks finish.
    const done: ReadResult[][] = new Array<ReadResult[]>(chunks.length)
    let next = 0
    const worker = async (): Promise<void> => {
      for (;;) {
        const i = next
        next += 1
        const chunk = chunks[i]
        if (chunk === undefined) return
        done[i] = await aggregate(client, mc, chunk)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(CHUNK_CONCURRENCY, chunks.length) }, () => worker()),
    )
    return done.flat()
  }
  // No multicall on this chain: individual calls, bounded so a huge universe cannot melt the RPC.
  for (const c of calls.slice(0, 120)) out.push(await one(client, c))
  for (let i = 120; i < calls.length; i++) out.push({ ok: false })
  return out
}

/** One aggregate, falling back to individual calls when the whole thing fails. */
async function aggregate(
  client: PublicClient,
  mc: Hex,
  chunk: readonly ReadCall[],
): Promise<ReadResult[]> {
  try {
    const results = await client.multicall({
      contracts: chunk.map((c) => ({
        address: c.address,
        abi: c.abi,
        functionName: c.functionName,
        args: c.args as never,
      })) as never,
      multicallAddress: mc,
      allowFailure: true,
    })
    return (results as Array<{ status: 'success' | 'failure'; result?: unknown }>).map((r) =>
      r.status === 'success' ? { ok: true, value: r.result } : { ok: false },
    )
  } catch {
    // A whole chunk failed (RPC hiccup): fall back per call for this chunk.
    const out: ReadResult[] = []
    for (const c of chunk) out.push(await one(client, c))
    return out
  }
}

async function one(client: PublicClient, c: ReadCall): Promise<ReadResult> {
  try {
    return {
      ok: true,
      value: await client.readContract({
        address: c.address,
        abi: c.abi,
        functionName: c.functionName,
        args: c.args as never,
      }),
    }
  } catch {
    return { ok: false }
  }
}
