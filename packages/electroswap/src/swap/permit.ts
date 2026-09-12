/**
 * Permit2 for swaps (master plan §8.6): one ERC-20 `approve(Permit2, max)`
 * per token (or exact, per Settings › Spending), then a per-swap exact
 * `PermitSingle` signature (`spender = UR`, `amount = exact`, 30-minute
 * expiry and deadline) carried into the router as `PERMIT2_PERMIT`.
 * Types mirror `sdks/permit2-sdk/src/allowanceTransfer.ts`.
 */
import type { Hex } from 'viem'

export const PERMIT_EXPIRY_S = 30 * 60
export const MAX_UINT160 = (1n << 160n) - 1n
export const MAX_UINT48 = (1n << 48n) - 1n

export const PERMIT_TYPES = {
  PermitSingle: [
    { name: 'details', type: 'PermitDetails' },
    { name: 'spender', type: 'address' },
    { name: 'sigDeadline', type: 'uint256' },
  ],
  PermitDetails: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint160' },
    { name: 'expiration', type: 'uint48' },
    { name: 'nonce', type: 'uint48' },
  ],
} as const

export interface PermitSingleTypedData {
  readonly domain: { readonly name: 'Permit2'; readonly chainId: number; readonly verifyingContract: Hex }
  readonly types: typeof PERMIT_TYPES
  readonly primaryType: 'PermitSingle'
  readonly message: {
    readonly details: { readonly token: Hex; readonly amount: string; readonly expiration: string; readonly nonce: string }
    readonly spender: Hex
    readonly sigDeadline: string
  }
}

/** The typed data the user signs (JSON-safe: uints as decimal strings, the way dApps send them). */
export function permitSingleTypedData(input: { chainId: number; permit2: Hex; token: Hex; amount: bigint; nonce: number; spender: Hex; nowSeconds: number }): PermitSingleTypedData {
  const expiration = input.nowSeconds + PERMIT_EXPIRY_S
  return {
    domain: { name: 'Permit2', chainId: input.chainId, verifyingContract: input.permit2 },
    types: PERMIT_TYPES,
    primaryType: 'PermitSingle',
    message: {
      details: { token: input.token, amount: input.amount.toString(), expiration: String(expiration), nonce: String(input.nonce) },
      spender: input.spender,
      sigDeadline: String(expiration),
    },
  }
}

export interface Permit2Allowance {
  readonly amount: bigint
  readonly expiration: number
  readonly nonce: number
}

/** True when the existing Permit2 allowance already covers this swap. */
export function permitCovers(a: Permit2Allowance, amount: bigint, nowSeconds: number): boolean {
  return a.amount >= amount && (a.expiration === 0 || a.expiration > nowSeconds + 60)
}
