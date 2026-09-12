/**
 * The device wrap key (master plan §3.2 KEK_dev, §5.2 v1): a random 32-byte
 * key in the OS keychain behind the current biometric set. It wraps the vault
 * DEK as a `device` wrap; Face ID / fingerprint at unlock reads it back and
 * the engine unwraps the DEK. The password remains the recovery path.
 */
import * as Keychain from 'react-native-keychain'

const SERVICE = 'io.electroswap.boltvault.device-key'
export const DEVICE_KEY_ID = 'device'

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
}

/** Mint (or return) the key. Requires biometry to be enrolled. */
export async function ensureDeviceKey(): Promise<string> {
  const level = await Keychain.getSecurityLevel()
  const existing = await Keychain.getGenericPassword({
    service: SERVICE,
    authenticationPrompt: { title: 'Unlock BoltVault' },
  })
  if (existing && existing.password) return existing.password
  const key = new Uint8Array(32)
  globalThis.crypto.getRandomValues(key)
  const keyHex = hex(key)
  await Keychain.setGenericPassword(DEVICE_KEY_ID, keyHex, {
    service: SERVICE,
    accessControl: Keychain.ACCESS_CONTROL.BIOMETRY_CURRENT_SET,
    accessible: Keychain.ACCESSIBLE.WHEN_PASSCODE_SET_THIS_DEVICE_ONLY,
    ...(level === Keychain.SECURITY_LEVEL.SECURE_HARDWARE
      ? { securityLevel: Keychain.SECURITY_LEVEL.SECURE_HARDWARE }
      : {}),
  })
  return keyHex
}

/** Read the key behind a biometric prompt; null if the user cancels or none exists. */
export async function readDeviceKey(reason: string): Promise<string | null> {
  try {
    const r = await Keychain.getGenericPassword({
      service: SERVICE,
      authenticationPrompt: { title: reason },
    })
    return r && r.password ? r.password : null
  } catch {
    return null
  }
}

export async function removeDeviceKey(): Promise<void> {
  await Keychain.resetGenericPassword({ service: SERVICE })
}
