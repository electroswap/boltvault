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
  /** BOLT-equivalent per DYNO, 18-decimal fixed point (`DYNO_WEIGHT_ONE` = one BOLT per DYNO); 0 = DYNO does not count. */
  readonly dynoWeight: bigint
  readonly countFarmBolt: boolean
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

/** One BOLT per DYNO in the schedule's fixed-point weight. */
export const DYNO_WEIGHT_ONE = 10n ** 18n

/**
 * The deployed defaults (§8.18, owner decision 2026-09-05 on USD prices: 1 BOLT = $0.00185, 1 DYNO = $1.62;
 * $25 / $250 / $1,250 / $2,500 of BOLT + DYNO), used only when the schedule contract cannot answer — and
 * then only for the next-tier hint, because the fee itself falls back to the base and never lower.
 */
export const FALLBACK_SCHEDULE: FeeSchedule = {
  baseBips: BASE_FEE_BIPS,
  tiers: [
    { minScore: 13_600n * 10n ** 18n, bips: 40 },
    { minScore: 136_000n * 10n ** 18n, bips: 30 },
    { minScore: 680_000n * 10n ** 18n, bips: 20 },
    { minScore: 1_360_000n * 10n ** 18n, bips: 10 },
  ],
  /** 875.68 BOLT-eq per DYNO. */
  dynoWeight: 875_680n * 10n ** 15n,
  countFarmBolt: true,
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

/**
 * The floor the router will actually enforce — the number `encodeSwap` writes
 * into the delivering `SWEEP`/`UNWRAP_WETH` command.
 *
 * It is not `minimumOut`. The router applies slippage first and takes the fee
 * from what survives, so the two differ by their rounding, and the screen was
 * quoting a floor a few wei above the one in the calldata — promising slightly
 * more than the transaction guaranteed. Both sides use this now, so the number
 * on the Swap screen, the number on the signing sheet and the `amountMin` in
 * the bytes are one value.
 */
export function deliveredMinimumOut(quotedOut: bigint, feeBips: number, slippageBips: number): bigint {
  const afterSlippage = routerMinimumOut(quotedOut, slippageBips)
  return afterSlippage - feeAmount(afterSlippage, feeBips)
}

/** The router's own minimum-out check happens before the fee is taken: the pre-fee floor. */
export function routerMinimumOut(quotedOut: bigint, slippageBips: number): bigint {
  return quotedOut - (quotedOut * BigInt(slippageBips)) / BIPS
}

/*
  ─── Exact output ────────────────────────────────────────────────────────────

  Everything above answers "I am spending this much; what do I get, at worst?"
  Exact output asks the opposite question, and two things invert with it.

  1. Slippage protects the other side. Exact-in guarantees a MINIMUM received
     and lets the input stand; exact-out fixes the output and guarantees a
     MAXIMUM spent. `deliveredMinimumOut` is meaningless in this direction —
     the delivered amount is the number the user typed — and `maximumIn` takes
     its place as the figure the router enforces and the sheet must show.

  2. The wallet fee is charged on top, not out of the middle. `PAY_PORTION`
     takes its bips of whatever the router is holding, so if the router bought
     exactly the amount asked for, the fee would come out of it and the user
     would receive less than the exact amount they typed — which is the one
     promise this whole mode makes. (The universal-router SDK does exactly that:
     for an exact-output trade with a fee it subtracts the fee from
     `minimumAmountOut` and sweeps the remainder.) So the router is asked for a
     grossed-up amount instead, the fee is taken from the gross, and what is
     left is the exact amount. The fee bips and the sink are untouched — the
     firewall's FEE_SINK/FEE_TIER assertion sees the same single PAY_PORTION at
     the same pinned sink — but the fee is now paid in extra input, which is why
     the screen says so out loud.
*/

/**
 * What the router must produce so that, after the wallet fee is taken from it,
 * the user is still left with `exactOut`.
 *
 * Rounded UP: rounding down would leave the user a wei short of the exact
 * amount, which is precisely the thing the mode exists to prevent.
 */
export function grossOutForExactOut(exactOut: bigint, feeBips: number): bigint {
  if (feeBips <= 0) return exactOut
  if (feeBips >= Number(BIPS)) throw new Error('fee bips out of range')
  const denominator = BIPS - BigInt(feeBips)
  return (exactOut * BIPS + denominator - 1n) / denominator
}

/** The most an exact-output swap may spend: the quoted input plus the slippage the user accepted. */
export function maximumIn(quotedIn: bigint, slippageBips: number): bigint {
  return quotedIn + (quotedIn * BigInt(slippageBips)) / BIPS
}

/** Price impact in percent from spot (mid) and executed prices; null when spot is unknown. */
export function priceImpactPct(amountIn: bigint, amountOut: bigint, spotOutPerIn: number | null, decimalsIn: number, decimalsOut: number): number | null {
  if (spotOutPerIn === null || amountIn === 0n) return null
  const executed = Number(amountOut) / 10 ** decimalsOut / (Number(amountIn) / 10 ** decimalsIn)
  if (!Number.isFinite(executed) || spotOutPerIn <= 0) return null
  return Math.max(0, (1 - executed / spotOutPerIn) * 100)
}
