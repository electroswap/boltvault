/**
 * Push on the phone (master plan §9.3, §5.5): local notifications for what
 * the engine raises (watchlist alerts, campaigns, rewards), and — only after
 * the user opts in — registration of the device token with ElectroSwap's
 * watcher so events arrive while the app is closed. The payload carries a
 * type and an id, never content; the app fetches the details. Nothing here
 * runs in the background.
 */
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export const API_BASE = process.env['EXPO_PUBLIC_BOLTVAULT_API'] ?? 'https://electroswap.io'
export const CLIENT_KEY = process.env['EXPO_PUBLIC_BOLTVAULT_KEY'] ?? ''

let configured = false

export function configureNotifications(): void {
  if (configured) return
  configured = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }),
  })
  if (Platform.OS === 'android') void Notifications.setNotificationChannelAsync('boltvault', { name: 'BoltVault', importance: Notifications.AndroidImportance.DEFAULT })
}

/** The engine's `platform.notify`: an immediate local notification. */
export async function notifyLocal(n: { title: string; body: string; data?: Record<string, unknown> }): Promise<void> {
  configureNotifications()
  await Notifications.scheduleNotificationAsync({ content: { title: n.title, body: n.body, data: n.data ?? {} }, trigger: null })
}

export async function pushStatus(): Promise<'unavailable' | 'off' | 'granted' | 'denied'> {
  const p = await Notifications.getPermissionsAsync().catch(() => null)
  if (!p) return 'unavailable'
  if (p.status === 'granted') return 'granted'
  if (p.status === 'denied' && !p.canAskAgain) return 'denied'
  return 'off'
}

/** Ask for permission, then register the Expo push token with the watcher for these addresses and topics. */
export async function registerPush(input: { addresses: readonly string[]; topics: readonly string[] }): Promise<boolean> {
  configureNotifications()
  const p = await Notifications.requestPermissionsAsync()
  if (p.status !== 'granted') return false
  if (!CLIENT_KEY) return true // local notifications work; the watcher needs the wallet key (backend B6)
  const token = (await Notifications.getExpoPushTokenAsync()).data
  const res = await fetch(`${API_BASE}/api/wallet/devices`, { method: 'POST', headers: { 'content-type': 'application/json', 'X-BoltVault-Key': CLIENT_KEY }, body: JSON.stringify({ token, platform: Platform.OS, addresses: input.addresses, topics: input.topics }) })
  return res.ok
}

export async function unregisterPush(): Promise<void> {
  if (!CLIENT_KEY) return
  const token = await Notifications.getExpoPushTokenAsync().then((t) => t.data).catch(() => null)
  if (!token) return
  await fetch(`${API_BASE}/api/wallet/devices`, { method: 'DELETE', headers: { 'content-type': 'application/json', 'X-BoltVault-Key': CLIENT_KEY }, body: JSON.stringify({ token }) }).catch(() => undefined)
}
