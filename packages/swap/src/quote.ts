/**
 * Swap quoting (T5.1) — on-chain quoterV2 / mixedRouteQuoter / V2 getAmountsOut
 * via eth_call, with a quoter-api fallback.
 *
 * The transport is injectable (`ethCall`) so the pure logic is testable
 * without a live RPC; a SKIP_LIVE-gated test quotes testnet live. When both
 * on-chain and API quotes exist and diverge >1%, **on-chain wins** (design
 * fallback table) — `resolveQuote` makes that decision pure.
 */
import { encodeFunctionData, decodeFunctionResult, type Abi, type AbiFunction, type Hex } from 'viem'
import { ELECTRONEUM_ADDRESSES, isElectroneumChainId } from '@boltvault/chains'

/** A raw eth_call transport: (to, data) → result hex. */
export type EthCall = (to: string, data: string) => Promise<string>

// --- Quoter ABIs (the functions we call) -------------------------------------

const QUOTER_V2_SINGLE_ABI: Abi = [
  {
    type: 'function',
    name: 'quoteExactInputSingle',
    stateMutability: 'view',
    inputs: [
      {
        type: 'tuple',
        name: 'params',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'fee', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
]

const MIXED_SINGLE_V2_ABI: Abi = [
  {
    type: 'function',
    name: 'quoteExactInputSingleV2',
    stateMutability: 'view',
    inputs: [
      {
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
]

const V2_GET_AMOUNTS_OUT_ABI: Abi = [
  {
    type: 'function',
    name: 'getAmountsOut',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ name: 'amounts', type: 'uint256[]' }],
  },
]

/** Route kind we can quote on-chain (single-hop for v1; multi-hop later). */
export type QuoteRoute = 'v3-single' | 'v2-mixed-single' | 'v2-getamounts'

export interface QuoteRequest {
  readonly chainId: number
  readonly tokenIn: string
  readonly tokenOut: string
  readonly amountIn: bigint
  /** V3 pool fee tier (default 3000). */
  readonly v3Fee?: number
}

export interface OnChainQuote {
  readonly route: QuoteRoute
  readonly tokenIn: string
  readonly tokenOut: string
  readonly amountIn: bigint
  readonly amountOut: bigint
  readonly quoter: string
}

const DEFAULT_V3_FEE = 3000

/** Which quoter + route to use for a single-hop pair (design planner). */
export function pickRoute(chainId: number): { route: QuoteRoute; quoter: string } {
  const a = ELECTRONEUM_ADDRESSES[chainId as 52014 | 5201420]
  // Prefer the mixed (V2) quoter when present (testnet has none → V3).
  if (a.mixedRouteQuoter != null) return { route: 'v2-mixed-single', quoter: a.mixedRouteQuoter }
  return { route: 'v3-single', quoter: a.quoterV2 }
}

/**
 * Quote a single-hop swap on-chain via eth_call. Throws when the call reverts
 * or returns 0 (no liquidity). The transport is injected.
 */
export async function quoteOnChain(req: QuoteRequest, ethCall: EthCall): Promise<OnChainQuote> {
  if (!isElectroneumChainId(req.chainId)) throw new Error(`not ETN: ${req.chainId}`)
  const { route, quoter } = pickRoute(req.chainId)
  const fee = req.v3Fee ?? DEFAULT_V3_FEE

  let data: Hex
  if (route === 'v2-mixed-single') {
    data = encodeFunctionData({
      abi: MIXED_SINGLE_V2_ABI,
      functionName: 'quoteExactInputSingleV2',
      args: [{ tokenIn: req.tokenIn, tokenOut: req.tokenOut, amountIn: req.amountIn }],
    })
  } else {
    data = encodeFunctionData({
      abi: QUOTER_V2_SINGLE_ABI,
      functionName: 'quoteExactInputSingle',
      args: [{ tokenIn: req.tokenIn, tokenOut: req.tokenOut, amountIn: req.amountIn, fee, sqrtPriceLimitX96: 0 }],
    })
  }

  const result = await ethCall(quoter, data)
  let amountOut: bigint
  if (route === 'v2-mixed-single') {
    amountOut = decodeFunctionResult({
      abi: MIXED_SINGLE_V2_ABI,
      functionName: 'quoteExactInputSingleV2',
      data: result as Hex,
    }) as bigint
  } else {
    amountOut = decodeFunctionResult({
      abi: QUOTER_V2_SINGLE_ABI,
      functionName: 'quoteExactInputSingle',
      data: result as Hex,
    }) as bigint
  }
  if (amountOut <= 0n) throw new Error('no liquidity for this pair')
  return { route, tokenIn: req.tokenIn, tokenOut: req.tokenOut, amountIn: req.amountIn, amountOut, quoter }
}

// --- fallback + divergence decision ------------------------------------------

export interface FallbackQuote {
  readonly amountOut: bigint
  readonly source: 'on-chain' | 'api'
}

/**
 * Reconcile an on-chain quote with an API fallback. Design: on-chain wins on
 * divergence >1%; if on-chain is absent, use the API; if they agree within 1%,
 * on-chain is returned (identical intent). Returns the chosen quote + a flag
 * when the API was used (so the caller can log).
 */
export function resolveQuote(
  onChain: OnChainQuote | null,
  api: { readonly amountOut: bigint } | null,
): { readonly quote: FallbackQuote; readonly usedFallback: boolean } {
  if (onChain != null) {
    // On-chain is the source of truth. If the API diverges >1% we still use
    // on-chain but the caller may log the divergence (design fallback table).
    return { quote: { amountOut: onChain.amountOut, source: 'on-chain' }, usedFallback: false }
  }
  if (api != null) return { quote: { amountOut: api.amountOut, source: 'api' }, usedFallback: true }
  throw new Error('no quote (on-chain or api)')
}

/** Absolute percentage difference between two amounts (0..100+). */
export function divergesPct(a: bigint, b: bigint): number {
  if (a === 0n && b === 0n) return 0
  const hi = a > b ? a : b
  const lo = a > b ? b : a
  if (hi === 0n) return 0
  // (hi - lo) / hi * 100 as a float (precision is fine for a 1% gate).
  return Number((hi - lo)) / Number(hi) * 100
}
