/**
 * The mini-router (master plan §8.6): candidate paths = direct V2, direct V3
 * at the four fee tiers, one-hop through the common bases on V2 and V3, and
 * mixed; ≤ 16 candidates quoted in one multicall against QuoterV2, the
 * MixedRouteQuoter and Router02's getAmountsOut. Pure over an injected
 * reader so the engine, tests and the fork test share it. No API dependency.
 */
import { encodeFunctionData, encodePacked, type Abi, type Hex } from 'viem'
import { MIXED_ROUTE_QUOTER_ABI, QUOTER_V2_ABI, V2_ROUTER_ABI } from './abis'
import { V2_FEE_FLAG, type Hop, type SwapRoute } from './encode'

export const V3_FEES = [100, 500, 3000, 10000] as const
/** Fee tiers tried for intermediate hops (all four would be 16 combos on their own). */
const HOP_FEES = [500, 3000] as const
export const MAX_CANDIDATES = 16

export interface QuoteAddresses {
  readonly quoterV2: Hex
  readonly mixedRouteQuoter: Hex | null
  readonly v2Router02: Hex
  /** Common intermediates: WETN, USDC, USDT, BOLT. */
  readonly bases: readonly Hex[]
}

export interface Candidate {
  readonly route: SwapRoute
  readonly kind: 'v2' | 'v3' | 'mixed'
  readonly label: string
}

export interface ReadCall {
  readonly address: Hex
  readonly abi: Abi
  readonly functionName: string
  readonly args: readonly unknown[]
}

export type ReadResult = { readonly ok: true; readonly value: unknown } | { readonly ok: false }

/** Batched reads — the engine's multicall reader has this exact shape. */
export type Reader = (calls: readonly ReadCall[]) => Promise<ReadResult[]>

export interface RouteQuote {
  readonly candidate: Candidate
  readonly amountOut: bigint
  readonly gasEstimate: bigint
}

function v3PackedPath(hops: readonly Hop[]): Hex {
  const types: string[] = ['address']
  const values: unknown[] = [hops[0]?.tokenIn]
  for (const h of hops) {
    types.push('uint24', 'address')
    values.push(h.kind === 'v3' ? h.fee : V2_FEE_FLAG, h.tokenOut)
  }
  return encodePacked(types, values)
}

const eq = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Every path worth asking about, in a fixed order, capped at MAX_CANDIDATES. */
export function candidates(tokenIn: Hex, tokenOut: Hex, addresses: QuoteAddresses): Candidate[] {
  const out: Candidate[] = []
  out.push({ kind: 'v2', label: 'V2', route: { hops: [{ kind: 'v2', tokenIn, tokenOut }] } })
  for (const fee of V3_FEES) out.push({ kind: 'v3', label: `V3 ${fee / 10_000}%`, route: { hops: [{ kind: 'v3', tokenIn, tokenOut, fee }] } })
  const bases = addresses.bases.filter((b) => !eq(b, tokenIn) && !eq(b, tokenOut))
  for (const base of bases) {
    out.push({ kind: 'v2', label: 'V2 via', route: { hops: [{ kind: 'v2', tokenIn, tokenOut: base }, { kind: 'v2', tokenIn: base, tokenOut }] } })
    for (const f1 of HOP_FEES) {
      for (const f2 of HOP_FEES) {
        out.push({ kind: 'v3', label: `V3 ${f1 / 10_000}% → ${f2 / 10_000}%`, route: { hops: [{ kind: 'v3', tokenIn, tokenOut: base, fee: f1 }, { kind: 'v3', tokenIn: base, tokenOut, fee: f2 }] } })
      }
    }
    if (addresses.mixedRouteQuoter) {
      out.push({ kind: 'mixed', label: 'V3 0.3% → V2', route: { hops: [{ kind: 'v3', tokenIn, tokenOut: base, fee: 3000 }, { kind: 'v2', tokenIn: base, tokenOut }] } })
      out.push({ kind: 'mixed', label: 'V2 → V3 0.3%', route: { hops: [{ kind: 'v2', tokenIn, tokenOut: base }, { kind: 'v3', tokenIn: base, tokenOut, fee: 3000 }] } })
    }
  }
  return out.slice(0, MAX_CANDIDATES)
}

function callFor(c: Candidate, amountIn: bigint, a: QuoteAddresses): ReadCall {
  if (c.kind === 'v2') {
    const path = [c.route.hops[0]?.tokenIn as Hex, ...c.route.hops.map((h) => h.tokenOut)]
    return { address: a.v2Router02, abi: V2_ROUTER_ABI, functionName: 'getAmountsOut', args: [amountIn, path] }
  }
  if (c.kind === 'mixed') {
    return { address: a.mixedRouteQuoter as Hex, abi: MIXED_ROUTE_QUOTER_ABI, functionName: 'quoteExactInput', args: [v3PackedPath(c.route.hops), amountIn] }
  }
  const hop = c.route.hops[0]
  if (c.route.hops.length === 1 && hop && hop.kind === 'v3') {
    return { address: a.quoterV2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInputSingle', args: [{ tokenIn: hop.tokenIn, tokenOut: hop.tokenOut, amountIn, fee: hop.fee, sqrtPriceLimitX96: 0n }] }
  }
  return { address: a.quoterV2, abi: QUOTER_V2_ABI, functionName: 'quoteExactInput', args: [v3PackedPath(c.route.hops), amountIn] }
}

function parse(c: Candidate, r: ReadResult): RouteQuote | null {
  if (!r.ok) return null
  const v = r.value
  if (c.kind === 'v2') {
    const amounts = v as readonly bigint[]
    const last = amounts[amounts.length - 1]
    return last !== undefined && last > 0n ? { candidate: c, amountOut: last, gasEstimate: 120_000n * BigInt(c.route.hops.length) } : null
  }
  const tuple = v as readonly [bigint, unknown, unknown, bigint]
  const amountOut = tuple[0]
  const gas = tuple[3]
  return typeof amountOut === 'bigint' && amountOut > 0n ? { candidate: c, amountOut, gasEstimate: typeof gas === 'bigint' ? gas : 150_000n } : null
}

export interface BestQuote {
  readonly best: RouteQuote
  readonly all: readonly RouteQuote[]
}

/**
 * Quote every candidate in one batch and pick the best output; a single-hop
 * route within 0.1 % of the best wins for simplicity and gas.
 */
export async function bestRoute(tokenIn: Hex, tokenOut: Hex, amountIn: bigint, addresses: QuoteAddresses, read: Reader): Promise<BestQuote | null> {
  const cands = candidates(tokenIn, tokenOut, addresses)
  const results = await read(cands.map((c) => callFor(c, amountIn, addresses)))
  const quotes = cands.map((c, i) => parse(c, results[i] ?? { ok: false })).filter((q): q is RouteQuote => q !== null)
  if (quotes.length === 0) return null
  quotes.sort((a, b) => (a.amountOut === b.amountOut ? a.candidate.route.hops.length - b.candidate.route.hops.length : b.amountOut > a.amountOut ? 1 : -1))
  const top = quotes[0] as RouteQuote
  const single = quotes.find((q) => q.candidate.route.hops.length === 1 && q.amountOut * 1000n >= top.amountOut * 999n)
  return { best: single ?? top, all: quotes }
}

/** The calldata a fork test replays to reproduce a quote. */
export function quoteCalldata(c: Candidate, amountIn: bigint, a: QuoteAddresses): { to: Hex; data: Hex } {
  const call = callFor(c, amountIn, a)
  return { to: call.address, data: encodeFunctionData({ abi: call.abi, functionName: call.functionName, args: call.args as never }) }
}
