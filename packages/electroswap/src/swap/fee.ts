/**
 * The wallet fee (master plan §8.6, §8.18): 0.5 % of output by default,
 * reduced by the account's BOLT/DYNO tier as the on-chain schedule says.
 * Fee math is pure; reading the schedule is injected so the engine, tests
 * and the fork test share one implementation.
 */
export const BASE_FEE_BIPS = 50
export const BIPS = 10_000n
export const DEFAULT_SLIPPAGE_BIPS = 50
/** A quote older than this may not arm the Swap key (§8.6). */
export const QUOTE_STALE_MS = 8_000
export const PRICE_IMPACT_WARN_PCT = 5
export const PRICE_IMPACT_DANGER_PCT = 15

export interface FeeTier {
  readonly minScore: bigint
  readonly bips: number
}

export interface FeeSchedule {
  readonly baseBips: number
  readonly tiers: readonly FeeTier[]
  /** How many DYNO count as one BOLT-equivalent; 0 = DYNO does not count. */
  readonly dynoWeight: bigint
  readonly countFarmBolt: boolean
  readonly boltPayDiscountBips: number
}

export interface HolderTier {
  readonly bips: number
  readonly tier: number
  readonly score: bigint
  /** BOLT-eq needed to reach the next tier, or null at the top. */
  readonly nextTierAt: bigint | null
  readonly nextTierBips: number | null
  /** Where the number came from — the chain, or the base fallback when the schedule could not be read. */
  readonly source: 'chain' | 'fallback'
}

/** Illustrative defaults (§8.18) until the schedule contract answers; ops sets the real numbers. */
export const FALLBACK_SCHEDULE: FeeSchedule = {
  baseBips: BASE_FEE_BIPS,
  tiers: [
    { minScore: 1_000n * 10n ** 18n, bips: 40 },
    { minScore: 10_000n * 10n ** 18n, bips: 30 },
    { minScore: 50_000n * 10n ** 18n, bips: 20 },
    { minScore: 100_000n * 10n ** 18n, bips: 10 },
  ],
  dynoWeight: 0n,
  countFarmBolt: true,
  boltPayDiscountBips: 2_500,
}

export function tierFor(schedule: FeeSchedule, score: bigint): { bips: number; tier: number } {
  let bips = schedule.baseBips
  let tier = 0
  schedule.tiers.forEach((t, i) => {
    if (score >= t.minScore) {
      bips = t.bips
      tier = i + 1
    }
  })
  return { bips, tier }
}

export function nextTier(schedule: FeeSchedule, tier: number): FeeTier | null {
  return schedule.tiers[tier] ?? null
}

/** Fee taken from the output. */
export function feeAmount(output: bigint, bips: number): bigint {
  return (output * BigInt(bips)) / BIPS
}

/** What the user keeps after the fee, before slippage. */
export function netAfterFee(output: bigint, bips: number): bigint {
  return output - feeAmount(output, bips)
}

/** `minOut = quoted × (1 − bips/10 000) × (1 − slippage)` (§8.6). */
export function minimumOut(quotedOut: bigint, feeBips: number, slippageBips: number): bigint {
  const afterFee = netAfterFee(quotedOut, feeBips)
  return afterFee - (afterFee * BigInt(slippageBips)) / BIPS
}

/** The router's own minimum-out check happens before the fee is taken: the pre-fee floor. */
export function routerMinimumOut(quotedOut: bigint, slippageBips: number): bigint {
  return quotedOut - (quotedOut * BigInt(slippageBips)) / BIPS
}

/** Price impact in percent from spot (mid) and executed prices; null when spot is unknown. */
export function priceImpactPct(amountIn: bigint, amountOut: bigint, spotOutPerIn: number | null, decimalsIn: number, decimalsOut: number): number | null {
  if (spotOutPerIn === null || amountIn === 0n) return null
  const executed = Number(amountOut) / 10 ** decimalsOut / (Number(amountIn) / 10 ** decimalsIn)
  if (!Number.isFinite(executed) || spotOutPerIn <= 0) return null
  return Math.max(0, (1 - executed / spotOutPerIn) * 100)
}
