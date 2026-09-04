/**
 * Permit2 approval path (design T5.3) — decide whether the Universal Router
 * already holds enough allowance to spend the user's input token, and if not,
 * which approval action to take.
 *
 * With Permit2 the preferred action is a single gasless `permit` signature
 * instead of a separate on-chain `approve` tx: on a fresh testnet account the
 * first swap is approve-permit2 + permit + swap (3 sigs, and the approval
 * itself costs no extra gas). "Exact-approvals" is default ON: we never leave
 * a stale or excess allowance behind — every action is for EXACTLY the
 * required amount, never 'max'.
 *
 * Pure — no live RPC. The Permit2 address comes from the chains registry.
 */
import { ELECTRONEUM_ADDRESSES, isElectroneumChainId } from '@boltvault/chains'

/** The approval action the wallet must take before the swap. */
export type ApprovalAction =
  | { kind: 'none' }                       // existing allowance already covers it
  | { kind: 'permit' }                    // issue a gasless Permit2 `permit` signature (preferred)
  | { kind: 'approve'; value: bigint }    // send an on-chain approve tx for this exact value

export interface Permit2DecisionInput {
  readonly currentAllowance: bigint   // current allowance held by the spender
  readonly requiredAmount: bigint     // amount the swap needs to spend
  /** Default true (never leave an excess allowance behind). */
  readonly exactApprovals: boolean
  /** Default true (use a gasless permit when we must act). */
  readonly preferPermit: boolean
}

/**
 * Decide the approval action for a Permit2 spend.
 *
 * Exact-approval guarantee: whenever an action IS needed, the value is ALWAYS
 * exactly `requiredAmount` — never 'max' and never a rounded-up figure — so no
 * stale/excess allowance is left behind. `exactApprovals` (default true) is
 * what makes that invariant the documented intent; even when it is false the
 * value here stays `requiredAmount` (the smallest safe approval). The existing
 * allowance is only "free": once `currentAllowance >= requiredAmount` there is
 * nothing to do.
 */
export function decidePermit2Approval(input: Permit2DecisionInput): ApprovalAction {
  const { currentAllowance, requiredAmount, preferPermit } = input
  if (currentAllowance >= requiredAmount) return { kind: 'none' }
  if (preferPermit) return { kind: 'permit' }
  return { kind: 'approve', value: requiredAmount }
}

/** A NEW approval action is required iff the swap needs more than is held. */
export function needsApproval(currentAllowance: bigint, requiredAmount: bigint): boolean {
  return requiredAmount > currentAllowance
}

/**
 * The Permit2 address for an ETN chain (52014 / 5201420). Throws for any other
 * chain id. The cast mirrors `quote.ts` — `isElectroneumChainId` returns a plain
 * boolean (not a type guard), so the key must be narrowed to the registry's
 * literal-union before indexing.
 */
export function permit2AddressFor(chainId: number): string {
  if (!isElectroneumChainId(chainId)) throw new Error(`not ETN: ${chainId}`)
  return ELECTRONEUM_ADDRESSES[chainId as 52014 | 5201420].permit2
}
