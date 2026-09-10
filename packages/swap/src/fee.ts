/**
 * In-wallet swap fee — 0.25% on-chain (T5.2 core, design C2/C8 + fee section).
 *
 * The fee is a Universal Router `PAY_PORTION` command, NOT a new AMM and NOT a
 * rewrite of dApp txs. Bips base = 10_000 → 25 bips = 0.25%. `minOut` in the
 * breaker is *after* fee: `quotedOut * (1 - 0.0025) * (1 - slippage)`.
 *
 * Integer math throughout (the "±1 wei" tolerance in the decode test comes
 * from `floor`). The recipient is a build-time constant (`fees.json`); an
 * address other than the configured one must disable in-wallet swap ("do not
 * swap") — a fee destination that can move at runtime is one an attacker can
 * move.
 */
import { ELECTRONEUM_ADDRESSES, feeRecipient, isElectroneumChainId } from '@boltvault/chains'

/** 0.25% — the in-wallet wallet fee. */
export const WALLET_FEE_BPS = 25
/** Universal Router bips base (InvalidBips if 0 or > 10_000). */
export const FEE_BIPS_BASE = 10_000
/** Default slippage (design T5.4: 50 bps). */
export const DEFAULT_SLIPPAGE_BPS = 50
/** Price-impact warning threshold (design: >5%). */
export const PRICE_IMPACT_WARN_PCT = 5
/** A quote older than this disarms the breaker (design: 8s). */
export const QUOTE_STALE_MS = 8_000

/**
 * The wallet fee on a post-swap output. `floor` so the sink gets ≤ bips and the
 * user sweep is the exact remainder (total preserved, user minOut met).
 */
export function feeAmount(output: bigint, bips: number = WALLET_FEE_BPS): bigint {
  return (output * BigInt(bips)) / BigInt(FEE_BIPS_BASE)
}

/** User's sweep after the fee. */
export function netAfterFee(output: bigint, bips: number = WALLET_FEE_BPS): bigint {
  return output - feeAmount(output, bips)
}

export interface MinOutParams {
  readonly quotedOut: bigint
  readonly feeBips?: number
  /** Slippage in bips (default 50). */
  readonly slippageBips?: number
}

/**
 * The breaker `minOut` = `quotedOut * (1 - fee) * (1 - slippage)`, integer math.
 * This is the minimum the user must receive for the swap to be acceptable.
 */
export function minOutAfterFee({ quotedOut, feeBips = WALLET_FEE_BPS, slippageBips = DEFAULT_SLIPPAGE_BPS }: MinOutParams): bigint {
  const afterFee = netAfterFee(quotedOut, feeBips)
  const minOut = (afterFee * BigInt(FEE_BIPS_BASE - slippageBips)) / BigInt(FEE_BIPS_BASE)
  return minOut
}

/**
 * Where the fee goes on a chain, from `fees.json`; null turns in-wallet swap off.
 *
 * Still called a sink for the shape it has in a swap — the address
 * `PAY_PORTION` pays — but there is no sink contract any more: it is whatever
 * address the config names, and today that is the account that used to own the
 * contract.
 */
export function feeSinkFor(chainId: number): string | null {
  if (!isElectroneumChainId(chainId)) return null
  return feeRecipient(chainId)
}

/**
 * `true` when in-wallet swap is allowed on this chain: ETN chain AND a pinned
 * sink exists. A missing sink means "do not swap" (design fee section).
 */
export function inWalletSwapEnabled(chainId: number): boolean {
  return feeSinkFor(chainId) != null
}

/** The ETN universal router for the chain (the ONLY in-wallet execute target). */
export function universalRouterFor(chainId: number): string {
  if (!isElectroneumChainId(chainId)) throw new Error(`not ETN: ${chainId}`)
  return ELECTRONEUM_ADDRESSES[chainId as 52014 | 5201420].universalRouter
}

export interface FeeBreakdown {
  readonly output: bigint
  readonly fee: bigint
  readonly userOut: bigint
  readonly minOut: bigint
  readonly sink: string
}

/** Full fee sheet for the breaker (output / fee / user / minOut / sink). */
export function feeBreakdown(quotedOut: bigint, chainId: number, opts: { feeBips?: number; slippageBips?: number } = {}): FeeBreakdown {
  const sink = feeSinkFor(chainId)
  if (sink == null) throw new Error('no fee recipient pinned for this chain')
  const fee = feeAmount(quotedOut, opts.feeBips)
  return {
    output: quotedOut,
    fee,
    userOut: quotedOut - fee,
    minOut: minOutAfterFee({ quotedOut, feeBips: opts.feeBips, slippageBips: opts.slippageBips }),
    sink,
  }
}
