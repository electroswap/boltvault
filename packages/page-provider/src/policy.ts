/**
 * MAIN-world provider coexistence policy — pure decision logic (no DOM).
 *
 * Design "Coexistence": BoltVault ships a MAIN-world provider so dApps can
 * `import` from the page context (extension-injected script). It must not
 * clobber an existing `window.ethereum` unless it is the default wallet,
 * while always announcing via EIP-6963 so multi-provider dApps (EIP-5792)
 * see it alongside others.
 *
 * Rules:
 *   - `isBoltVault` is always true; `rdns` is always the BoltVault rdns.
 *   - If `isDefaultWallet`: sets `window.ethereum` (`setsEthereum=true`),
 *     providers = [existing?, bolt].
 *   - Else: does NOT set `window.ethereum` (`setsEthereum=false`), but
 *     providers = [existing, bolt] so EIP-5792 dApps still see both.
 *   - `metaMaskCompat` (MetaMask-style namespace compat flag) toggles
 *     `isMetaMask`; it never affects rdns.
 */
export interface CoexistState {
  /** Current `window.ethereum` value (if any). */
  existingEthereum: unknown
  /** The BoltVault provider instance to announce. */
  boltProvider: unknown
  /** Whether the user has made BoltVault the default wallet. */
  isDefaultWallet: boolean
  /** Whether MetaMask-compatible namespace behavior is enabled. */
  metaMaskCompat: boolean
  /** Stable UUID for EIP-6963 announcements. */
  stableUuid: string
}

export interface CoexistPolicy {
  /** Whether to (re)assign `window.ethereum`. */
  setsEthereum: boolean
  /** Announcements in order: existing provider first, then BoltVault. */
  providers: unknown[]
  isMetaMask: boolean
  isBoltVault: boolean
  rdns: string
}

export const BOLTVAULT_RDNS = 'io.electroswap.boltvault'

export function coexistPolicy(state: CoexistState): CoexistPolicy {
  const providers: unknown[] = []
  if (state.existingEthereum) providers.push(state.existingEthereum)
  providers.push(state.boltProvider)

  return {
    setsEthereum: state.isDefaultWallet,
    providers,
    isMetaMask: state.metaMaskCompat,
    isBoltVault: true,
    rdns: BOLTVAULT_RDNS,
  }
}
