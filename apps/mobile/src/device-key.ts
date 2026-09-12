/**
 * The device wrap key (master plan §3.2 KEK_dev, §5.2 v1): a random 32-byte
 * key in the OS keychain behind the current biometric set. It wraps the vault
 * DEK as a `device` wrap; Face ID / fingerprint at unlock reads it back and
 * the engine unwraps the DEK. The password remains the recovery path.
 */
import { Platform } from 'react-native'
import * as Keychain from 'react-native-keychain'

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
async function confirmBiometric(reason: string): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  const LocalAuthentication = await import('expo-local-authentication')
  const result = await LocalAuthentication.authenticateAsync({
    promptMessage: reason,
    disableDeviceFallback: true,
    biometricsSecurityLevel: 'strong',
  })
  return result.success
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

/** Read the key behind a biometric prompt; null if the user cancels or none exists. */
export async function readDeviceKey(reason: string): Promise<string | null> {
  if (!(await confirmBiometric(reason))) return null
  try {
    const r = await Keychain.getGenericPassword({ service: SERVICE, authenticationPrompt: { title: reason } })
    return r && r.password ? r.password : null
  } catch {
    return null
  }
}

export async function removeDeviceKey(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE })
}
