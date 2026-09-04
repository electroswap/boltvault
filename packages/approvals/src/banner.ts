/**
 * Infinite-approve detection + banner copy (T6.2, design "Approvals").
 */
export interface AllowanceState {
  readonly token: string
  readonly spender: string
  readonly allowance: bigint
  readonly maxAllowance?: bigint
}

/**
 * An allowance is "infinite" when it sits in the ERC-20 uint max region —
 * threshold 2^255, far above any sane finite approval.
 */
const INFINITE_THRESHOLD = 2n ** 255n

export function isInfinite(allowance: bigint): boolean {
  return allowance >= INFINITE_THRESHOLD
}

/** The subset of states whose allowance is infinite. */
export function infiniteApprovals(states: readonly AllowanceState[]): AllowanceState[] {
  return states.filter((s) => isInfinite(s.allowance))
}

/**
 * Banner copy. Null when there is nothing to say (exact-approve users see 0).
 */
export function bannerCopy(infiniteCount: number): string | null {
  if (infiniteCount <= 0) return null
  const s = infiniteCount === 1 ? '' : 's'
  return `${infiniteCount} infinite approval${s} — anyone can move this token. Revoke to reclaim control.`
}
