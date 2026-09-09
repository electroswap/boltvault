/**
 * Runtime permissions Android will not grant from the manifest alone.
 *
 * BLUETOOTH_SCAN and BLUETOOTH_CONNECT became runtime grants in Android 12
 * (API 31). Nothing in the app ever requested them, so `TransportBLE.list()`
 * came back empty on any modern phone no matter what the manifest declared —
 * a Ledger Nano X could be awake and advertising and still never appear.
 */
import { PermissionsAndroid, Platform } from 'react-native'

export async function ensureBluetoothPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  // Below API 31 the manifest grant is the whole story (location gated it,
  // and that is declared).
  if (typeof Platform.Version === 'number' && Platform.Version < 31) return true
  try {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
      PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
    ])
    return Object.values(result).every((r) => r === PermissionsAndroid.RESULTS.GRANTED)
  } catch {
    return false
  }
}
