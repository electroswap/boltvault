/**
 * Identity (D) — the pure account model shared by the UI + SW.
 *
 * Design law: "one seated account" — `currentAccountId` is the single source
 * of truth. Hardware / watch accounts are metadata (address is public), not a
 * different custody model. Switching accounts produces a NEW state (pure), so
 * the UI can re-render + the data layer can re-read the portfolio for the new
 * account.
 */

export type AccountKind = 'hd' | 'watch' | 'hardware'

export interface VaultAccount {
  readonly id: string
  readonly label: string
  /** Checksummed EOA address — every kind resolves to one. */
  readonly address: string
  readonly kind: AccountKind
}

export interface IdentityState {
  readonly accounts: readonly VaultAccount[]
  /** The seated (current) account id, or null before onboarding. */
  readonly currentAccountId: string | null
}

/** The seated account, or null. */
export function currentAccount(s: IdentityState): VaultAccount | null {
  if (s.currentAccountId == null) return null
  return s.accounts.find((a) => a.id === s.currentAccountId) ?? null
}

/** First account (used as the default seated account post-onboarding). */
export function firstAccount(s: IdentityState): VaultAccount | null {
  return s.accounts[0] ?? null
}

/** Seat the first account (idempotent) — used right after onboarding. */
export function seatFirst(s: IdentityState): IdentityState {
  const first = firstAccount(s)
  if (!first) return s
  if (first.id === s.currentAccountId) return s
  return { ...s, currentAccountId: first.id }
}

/** Switch the seated account (pure). No-op when the id is unknown. */
export function switchAccount(s: IdentityState, id: string): IdentityState {
  if (!s.accounts.some((a) => a.id === id)) return s
  return { ...s, currentAccountId: id }
}

/** Add an account + seat it (pure). */
export function addAccount(s: IdentityState, account: VaultAccount): IdentityState {
  return { accounts: [...s.accounts, account], currentAccountId: account.id }
}

export function emptyIdentity(): IdentityState {
  return { accounts: [], currentAccountId: null }
}
