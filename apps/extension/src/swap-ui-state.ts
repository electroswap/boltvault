/**
 * Swap UI state (T5.4) — the testable decision layer behind the stacked
 * terminals. The fee is "taught before the first quote arms" (design §Fee):
 * the breaker only arms after the first-swap coach is dismissed (once per
 * install). A quote >8s old disarms the breaker; price impact >5% warns.
 */
import {
  feeAmount,
  minOutAfterFee,
  WALLET_FEE_BPS,
  QUOTE_STALE_MS,
  PRICE_IMPACT_WARN_PCT,
  type FeeBreakdown,
} from '@boltvault/swap'

export interface SwapQuote {
  /** On-chain amount out, base units (before fee). */
  readonly amountOut: bigint
  readonly at: number // epoch ms the quote was fetched
}

export interface SwapUiInput {
  readonly quote: SwapQuote | null
  readonly now: number
  readonly priceImpactPct: number
  readonly sink: string | null
  readonly coachDismissed: boolean
  readonly tokenOutSymbol: string
}

export type BreakerReason = 'armed' | 'no-quote' | 'stale' | 'coach' | 'no-sink' | 'impact-warn'

export interface SwapUiState {
  /** Whether the Sign breaker can be pressed. */
  readonly armed: boolean
  readonly reason: BreakerReason
  /** The "Wallet fee 0.25% → 0x… (fee sink)" line (null until there's a quote). */
  readonly feeLine: string | null
  /** min-out after fee + slippage (the breaker's minimum receive). */
  readonly minOut: bigint | null
  /** The 0.25% fee amount (for the fee sheet). */
  readonly fee: bigint | null
  readonly impactWarn: boolean
  readonly stale: boolean
}

function shortAddr(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

export function computeSwapUiState(input: SwapUiInput): SwapUiState {
  const { quote, now, priceImpactPct, sink, coachDismissed, tokenOutSymbol } = input
  const stale = quote != null && now - quote.at > QUOTE_STALE_MS
  const impactWarn = priceImpactPct > PRICE_IMPACT_WARN_PCT

  if (quote == null) return { armed: false, reason: 'no-quote', feeLine: null, minOut: null, fee: null, impactWarn, stale }
  if (sink == null) return { armed: false, reason: 'no-sink', feeLine: null, minOut: null, fee: null, impactWarn, stale }
  if (!coachDismissed) return { armed: false, reason: 'coach', feeLine: null, minOut: null, fee: null, impactWarn, stale }
  if (stale) return { armed: false, reason: 'stale', feeLine: null, minOut: null, fee: null, impactWarn, stale }
  if (impactWarn) return { armed: false, reason: 'impact-warn', feeLine: null, minOut: null, fee: null, impactWarn, stale }

  const fee = feeAmount(quote.amountOut)
  const minOut = minOutAfterFee({ quotedOut: quote.amountOut })
  const feeLine = `Wallet fee 0.25% → ${shortAddr(sink)} (fee sink)`
  return { armed: true, reason: 'armed', feeLine, minOut, fee, impactWarn, stale }
}

/** The fee-coach copy (design: numeric example, sink address, dApp note, hardware note). */
export function feeCoachCopy(sink: string): { example: string; sinkLine: string; dappNote: string; hardwareNote: string } {
  return {
    example: 'Swap 100 BOLT → ~99.75 BOLT reaches you; 0.25 BOLT (0.25%) pays the fee.',
    sinkLine: `Fees go to the fee sink ${shortAddr(sink)} (not "BoltVault").`,
    dappNote: 'Swaps on websites are not charged this fee.',
    hardwareNote: 'Your hardware wallet shows a hash, not the amounts — the amounts are above.',
  }
}

/** A human summary of a fee breakdown for the breaker. */
export function feeSheet(sheet: FeeBreakdown, tokenOutSymbol: string): string {
  return `Wallet fee 0.25% → ${shortAddr(sheet.sink)} (fee sink) · min out ${sheet.minOut.toString()} ${tokenOutSymbol}`
}

export { WALLET_FEE_BPS }
