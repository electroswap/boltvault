/**
 * The in-wallet swap fee, as configuration rather than as contracts.
 *
 * It used to be two deployed contracts: `BoltVaultFeeSink`, whose address was
 * the fee recipient, and `BoltVaultFeeSchedule`, which the wallet read at sign
 * time for the holder tier. Both are gone from the wallet's path.
 *
 * The sink was a contract that received transfers and let its owner sweep them.
 * `PAY_PORTION` sends to an address, and it cannot tell a contract from an
 * account — so a sink whose whole job was to hold funds until the owner moved
 * them somewhere else is an extra hop and an extra thing to deploy, audit and
 * remember. Fees go to the owner directly.
 *
 * The schedule was worse value. Its tiers are BOLT amounts chosen to represent
 * USD figures, so the price moving silently changes what the ladder means, and
 * correcting it was an owner transaction against a contract whose ownership had
 * to be accepted first. Owner: "those prices will tend to fluctuate over time
 * and be pretty painful to update." Here it is a text edit.
 *
 * What the contracts bought — a recipient that could change without a wallet
 * release — is a property the design does not actually want. The master plan is
 * explicit that a sink other than the pinned one must disable in-wallet swap:
 * a fee destination that can change underneath the user is a fee destination an
 * attacker can change. Baked into the build, it moves when a signed release
 * moves it, and not otherwise.
 *
 * `wallet/fees.json` (§9.4) is the same shape, signed with the statics key. If
 * it is ever published, it can override this file for the tiers — never for the
 * recipient, which must stay a build constant for the reason above.
 */
import config from '../fees.json'

export interface FeeTierConfig {
  /** What this rung is called, shown on the seat mark and the fee sheet. */
  readonly name: string
  /** BOLT-equivalent score at which this tier starts; 18 decimals, decimal string. */
  readonly minScore: string
  readonly bips: number
}

export interface WalletFeeConfig {
  /** Where PAY_PORTION sends the fee. Null disables in-wallet swap on this chain. */
  readonly recipient: string | null
  /** Tier 0 — what everyone pays before holding anything. */
  readonly baseName: string
  readonly baseBips: number
  /** The four rungs above tier 0, ascending. Index i is tier i + 1. */
  readonly tiers: readonly FeeTierConfig[]
  /**
   * BOLT-equivalent per DYNO, 18 decimals, decimal string. '0' means DYNO does
   * not count. The wallet measures the live ratio and prefers it; this is the
   * anchor it falls back to and is clamped against (`dynoWeightBand`).
   */
  readonly dynoWeight: string
  /**
   * How far a measured weight may stray from `dynoWeight`, as a multiplier: at
   * most `dynoWeight * band`, at least `dynoWeight / band`. 1 or less pins the
   * weight to the configured number and measures nothing.
   */
  readonly dynoWeightBand: number
  readonly countFarmBolt: boolean
}

const CHAINS = config.chains as Readonly<Record<string, WalletFeeConfig>>

/**
 * A ladder the service published, keyed by chain.
 *
 * `services/api` (`src/config/walletFeeTiers.ts`) is the authority for the
 * rungs now, so ops can re-tune them without a wallet release. `fees.json`
 * stays in the build as two things: the offline fallback, and the CEILING —
 * see `neverRaises` below.
 */
const served = new Map<number, WalletFeeConfig>()

/** `PAY_PORTION` reverts on zero bips, so a rung may never reach it. */
const MIN_TIER_BIPS = 1

/** What a ladder charges at a given score, without needing a FeeSchedule. */
function bipsAt(config: WalletFeeConfig, score: bigint): number {
  let bips = config.baseBips
  for (const tier of config.tiers) if (score >= BigInt(tier.minScore)) bips = tier.bips
  return bips
}

/**
 * Whether a served ladder charges no more than the bundled one, anywhere.
 *
 * This is the whole security argument for reading the ladder over the network.
 * A response we took at face value could withhold somebody's discount and put
 * them back on the base rate — the wallet would be charging a holder more
 * because a server said so. Refusing any ladder that is dearer at any score
 * means the worst a compromised or mistaken response can do is cost US
 * revenue, which is our problem rather than a holder's.
 *
 * Both ladders are step functions, so they only change at their own
 * thresholds: checking the union of those points checks every score.
 */
function neverRaises(candidate: WalletFeeConfig, bundled: WalletFeeConfig): boolean {
  const points = [
    0n,
    ...candidate.tiers.map((t) => BigInt(t.minScore)),
    ...bundled.tiers.map((t) => BigInt(t.minScore)),
  ]
  return points.every((score) => bipsAt(candidate, score) <= bipsAt(bundled, score))
}

/** Ascending thresholds, descending fees, and nothing at or below zero bips. */
function wellFormed(config: WalletFeeConfig): boolean {
  if (!Number.isInteger(config.baseBips) || config.baseBips < MIN_TIER_BIPS) return false
  let score = 0n
  let bips = config.baseBips
  for (const tier of config.tiers) {
    const min = BigInt(tier.minScore)
    if (min <= score || tier.bips >= bips || tier.bips < MIN_TIER_BIPS) return false
    score = min
    bips = tier.bips
  }
  return true
}

/**
 * Take the ladder the service published for a chain, or refuse it.
 *
 * The recipient is never read from it — `walletFeeConfig` always returns the
 * built-in one — because a fee destination that can change underneath the user
 * is a fee destination an attacker can change (master plan §8.18). That is why
 * this takes a ladder and not a config.
 *
 * Returns false when the ladder was refused, so a caller can log it rather
 * than assume it landed. A refusal is not an error: the bundled ladder is a
 * perfectly good answer, and the wallet keeps using it.
 */
export function applyServedLadder(chainId: number, ladder: ServedLadder): boolean {
  const bundled = CHAINS[String(chainId)]
  if (!bundled) return false
  const candidate: WalletFeeConfig = {
    ...bundled,
    baseName: ladder.baseName,
    baseBips: ladder.baseBips,
    tiers: ladder.tiers.map((tier) => ({
      name: tier.name,
      minScore: tier.minScore,
      bips: tier.bips,
    })),
    dynoWeight: ladder.dynoWeight,
    dynoWeightBand: ladder.dynoWeightBand,
    countFarmBolt: ladder.countFarmBolt,
  }
  if (!wellFormed(candidate) || !neverRaises(candidate, bundled)) return false
  served.set(chainId, candidate)
  return true
}

/** Forget a served ladder and go back to the build's. */
export function clearServedLadder(chainId: number): void {
  served.delete(chainId)
}

/** The ladder in the build, ignoring anything served. The ceiling, and the fallback. */
export function bundledFeeConfig(chainId: number): WalletFeeConfig | null {
  return CHAINS[String(chainId)] ?? null
}

/** The tiers a service may publish. Everything else about a chain stays local. */
export interface ServedLadder {
  readonly baseName: string
  readonly baseBips: number
  readonly tiers: readonly FeeTierConfig[]
  readonly dynoWeight: string
  readonly dynoWeightBand: number
  readonly countFarmBolt: boolean
}

/**
 * The fee configuration for a chain, or null for one the wallet does not price.
 *
 * A served ladder wins on the rungs, and never on the recipient — that field is
 * taken from the build every time, whatever was published.
 */
export function walletFeeConfig(chainId: number): WalletFeeConfig | null {
  const bundled = CHAINS[String(chainId)] ?? null
  if (!bundled) return null
  const override = served.get(chainId)
  return override ? { ...override, recipient: bundled.recipient } : bundled
}

/**
 * Where the fee goes on this chain, or null when in-wallet swap is off.
 *
 * This is the gate: `inWalletSwapEnabled` is exactly `feeRecipient() != null`.
 */
export function feeRecipient(chainId: number): string | null {
  return walletFeeConfig(chainId)?.recipient ?? null
}

/**
 * The name of a tier index: 0 is the base rung, 1..n the ones above it.
 *
 * A number is a fact about a ladder; a name is something to hold. "Reactor"
 * tells a holder what they are in a way "tier 4" never does, and it gives the
 * seat mark and the fee sheet the same word to use.
 */
export function tierName(chainId: number, tier: number): string | null {
  const c = walletFeeConfig(chainId)
  if (!c) return null
  if (tier <= 0) return c.baseName
  // Null above the top rung, not the base name: callers ask "what is the next
  // one called", and at the top the honest answer is that there isn't one.
  return c.tiers[tier - 1]?.name ?? null
}

/** Every rung, base first, for the fee sheet's ladder. */
export function tierLadder(
  chainId: number,
): ReadonlyArray<{ name: string; minScore: string; bips: number }> {
  const c = walletFeeConfig(chainId)
  if (!c) return []
  return [{ name: c.baseName, minScore: '0', bips: c.baseBips }, ...c.tiers]
}
