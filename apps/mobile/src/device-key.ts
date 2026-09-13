/**
 * The device wrap key (master plan §3.2 KEK_dev, §5.2 v1): a random 32-byte
 * key in the OS keychain behind the current biometric set. It wraps the vault
 * DEK as a `device` wrap; Face ID / fingerprint at unlock reads it back and
 * the engine unwraps the DEK. The password remains the recovery path.
 */
import { Platform } from 'react-native'
import * as Keychain from 'react-native-keychain'
import type { DeviceKeyRead } from '@boltvault/wallet'

const SERVICE = 'io.electroswap.boltvault.device-key'
export const DEVICE_KEY_ID = 'device'

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Android Keystore keys created by react-native-keychain stay usable for 5
 * seconds after *any* device authentication — unlocking the phone with
 * fingerprint or PIN counts. The unlock screen auto-prompts on mount, so
 * opening the app within that window returned the wrap key with no prompt
 * and walked straight into Home. iOS `BIOMETRY_CURRENT_SET` still prompts
 * every read; Android needs an in-app BiometricPrompt first, after which
 * the keychain read falls inside the same 5-second window and stays silent.
 */
async function confirmBiometric(reason: string): Promise<'ok' | 'cancelled' | 'failed'> {
  if (Platform.OS !== 'android') return 'ok'
  const LocalAuthentication = await import('expo-local-authentication')
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: true,
    biometricsSecurityLevel: 'strong',
  })
  if (result.success) return 'ok'
  /*
    Dismissing the sheet is a choice; everything else is a fault.

    This used to answer a bare boolean, so the caller could not tell "I changed
    my mind" from "the OS refused" — and reported neither. `user_cancel`,
    `app_cancel` and `system_cancel` are the dismissals; the rest (lockout,
    not_enrolled, a refusal because the enrolled sensor is not Class 3) are
    things the user needs told, because no amount of re-tapping will fix them.
  */
  const error = 'error' in result ? result.error : ''
  return error === 'user_cancel' || error === 'app_cancel' || error === 'system_cancel'
    ? 'cancelled'
    : 'failed'
}

/**
 * Is there a biometric enrolled that `confirmBiometric` would actually accept?
 *
 * `hasHardwareAsync() && isEnrolledAsync()` is not that question. It answers
 * true for a Class 2 (weak) sensor, which is common on mid-range Android — and
 * the read above demands `biometricsSecurityLevel: 'strong'`, i.e. Class 3. So
 * enrolment succeeded and unlocking could never succeed, and the button that
 * offered it did nothing at all when pressed (ES-BV-072). The level is the
 * question, and `expo-local-authentication` answers it directly.
 */
export async function strongBiometricAvailable(): Promise<boolean> {
  const LocalAuthentication = await import('expo-local-authentication')
  if (!(await LocalAuthentication.hasHardwareAsync())) return false
  if (!(await LocalAuthentication.isEnrolledAsync())) return false
  if (Platform.OS !== 'android') return true
  return (await LocalAuthentication.getEnrolledLevelAsync()) === LocalAuthentication.SecurityLevel.BIOMETRIC_STRONG
}

/** Mint (or return) the key. Requires biometry to be enrolled. */
export async function ensureDeviceKey(): Promise<string> {
  const level = await Keychain.getSecurityLevel()
  const existing = await Keychain.getGenericPassword({ service: SERVICE, authenticationPrompt: { title: 'Unlock BoltVault' } })
  if (existing && existing.password) return existing.password
  const key = new Uint8Array(32)
  globalThis.crypto.getRandomValues(key)
  const keyHex = hex(key)
  await Keychain.setGenericPassword(DEVICE_KEY_ID, keyHex, {
    service: SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    ...(level === Keychain.SECURITY_LEVEL.SECURE_HARDWARE ? { securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE } : {}),
  })
  return keyHex
}

/**
 * Read the key behind a biometric prompt, saying which way it went.
 *
 * The three outcomes were one `null` before this, and every caller read that
 * `null` as "cancelled" and stayed silent — which is how a phone with a weak
 * sensor ended up with an unlock button that did nothing, reported twice by
 * the same beta tester, the second time as being locked out of the wallet.
 */
export async function readDeviceKey(reason: string): Promise<DeviceKeyRead> {
  const confirmed = await confirmBiometric(reason)
  if (confirmed !== 'ok') return { ok: false, reason: confirmed }
  try {
    const r = await Keychain.getGenericPassword({ service: SERVICE, authenticationPrompt: { title: reason } })
    // No entry is not a failed read: the wrap outlived its key (a new
    // fingerprint enrolled invalidates `BIOMETRY_CURRENT_SET`).
    return r && r.password ? { ok: true, keyHex: r.password } : { ok: false, reason: 'unavailable' }
  } catch {
    return { ok: false, reason: 'failed' }
  }
}

export async function removeDeviceKey(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE })
}
