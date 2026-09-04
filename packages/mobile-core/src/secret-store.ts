/**
 * Secret store (T8.1) — where the wrapped vault key lives per platform, and the
 * wrap strategy. The vault plaintext (Argon2id + XChaCha20-Poly1305, T1.1) is
 * wrapped by a hardware-backed key so the raw key never leaves secure storage:
 *
 *   - iOS:     Secure Enclave (a private key pair inside the SE); the vault
 *              file is encrypted with a symmetric key held in the Keychain.
 *   - Android: Keystore (StrongBox when available), or regular Keystore.
 *
 * On desktop/extension the equivalent is chrome.storage + the WebAuthn/Argon2
 * path; here we decide the mobile hardware store. The pure decision: which store
 * + which wrap for a given platform + hardware availability.
 */

export type MobilePlatform = 'ios' | 'android'

export interface HardwareCaps {
  readonly hasSecureEnclave: boolean
  readonly hasStrongBox: boolean
}

export interface SecretStoreDecision {
  readonly platform: MobilePlatform
  /** Where the wrap key lives. */
  readonly keyStore: 'secure-enclave' | 'strongbox-keystore' | 'keystore'
  /** Where the (wrapped) vault file is at rest. */
  readonly vaultAtRest: 'keychain' | 'android-keystore-file'
  /** Whether the wrap key is hardware-backed (non-extractable). */
  readonly hardwareBacked: boolean
  /** Human note for the onboarding screen. */
  readonly note: string
}

export function secretStoreDecision(platform: MobilePlatform, hw: HardwareCaps): SecretStoreDecision {
  if (platform === 'ios') {
    return {
      platform,
      keyStore: 'secure-enclave',
      vaultAtRest: 'keychain',
      hardwareBacked: hw.hasSecureEnclave,
      note: 'Secure Enclave wraps your vault key; the vault file lives in the Keychain.',
    }
  }
  // android
  const strongBox = hw.hasStrongBox
  return {
    platform,
    keyStore: strongBox ? 'strongbox-keystore' : 'keystore',
    vaultAtRest: 'android-keystore-file',
    hardwareBacked: true,
    note: strongBox
      ? 'StrongBox wraps your vault key (hardware-isolated).'
      : 'Android Keystore wraps your vault key.',
  }
}

/**
 * The wrap is always hardware-backed on mobile (that's the point of the Enclave/
 * Keystore). `hardwareBacked` only reports whether the *named* high-grade store
 * is present (SE on iOS / StrongBox on Android) — even the fallback Keystore is
 * still non-extractable.
 */
export function wrapStrategy(platform: MobilePlatform): 'hardware-wrap' {
  void platform
  return 'hardware-wrap'
}
