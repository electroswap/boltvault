/**
 * Push on the phone (master plan §9.3, §5.5): local notifications for what
 * the engine raises (watchlist alerts, campaigns, rewards), and — only after
 * the user opts in — registration of the device token with ElectroSwap's
 * watcher so events arrive while the app is closed. The payload carries a
 * type and an id, never content; the app fetches the details. Nothing here
 * runs in the background.
 */
import { authHeaders } from '@boltvault/engine'
import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'

export const API_BASE = process.env['EXPO_PUBLIC_BOLTVAULT_API'] ?? 'https://electroswap.io'
export const CLIENT_KEY = process.env['EXPO_PUBLIC_BOLTVAULT_KEY'] ?? ''

let configured = false

/**
 * The API said push is switched off, so this install has no watcher to register
 * with.
 *
 * `/api/wallet/devices` answers **503**, not 404, when the service runs with
 * `pushEnabled` false — deliberately, so a client can tell "off today" from
 * "no such route". We used to throw that away (`return res.ok`) and report the
 * refusal as an ordinary failure, which left Settings › Notifications offering
 * a Push switch that could never do anything. Remembering it turns `status()`
 * into 'unavailable', and the screen hides the control entirely.
 *
 * In memory only, and only after a first attempt: there is no endpoint that
 * states the setting, so this is the one moment the wallet ever hears it. A
 * relaunch asks again, which is also the only way a wallet would notice the API
 * being switched back on.
 */
let apiPushOff = false

export function configureNotifications(): void {
  if (configured) return
  configured = true
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: false,
      shouldSetBadge: false,
    }),
  })
  if (Platform.OS === 'android')
    void Notifications.setNotificationChannelAsync('boltvault', {
      name: 'BoltVault',
      importance: Notifications.AndroidImportance.DEFAULT,
    })
}

/** The engine's `platform.notify`: an immediate local notification. */
export async function notifyLocal(n: {
  title: string
  body: string
  data?: Record<string, unknown>
}): Promise<void> {
  configureNotifications()
  await Notifications.scheduleNotificationAsync({
    content: { title: n.title, body: n.body, data: n.data ?? {} },
    trigger: null,
  })
}

export async function pushStatus(): Promise<'unavailable' | 'off' | 'granted' | 'denied'> {
  // Before the OS permission, because an allowed permission with nowhere to
  // register is still no push: nothing arrives while the app is closed.
  if (apiPushOff) return 'unavailable'
  const p = await Notifications.getPermissionsAsync().catch(() => null)
  if (!p) return 'unavailable'
  if (p.status === 'granted') return 'granted'
  if (p.status === 'denied' && !p.canAskAgain) return 'denied'
  return 'off'
}

/** Ask for permission, then register the Expo push token with the watcher for these addresses and topics. */
export async function registerPush(input: {
  addresses: readonly string[]
  topics: readonly string[]
}): Promise<boolean> {
  configureNotifications()
  const p = await Notifications.requestPermissionsAsync()
  if (p.status !== 'granted') return false
  if (!CLIENT_KEY) return true // local notifications work; the watcher needs the wallet key (backend B6)
  const token = (await Notifications.getExpoPushTokenAsync()).data
  const url = `${API_BASE}/api/wallet/devices`
  const body = JSON.stringify({
    token,
    platform: Platform.OS,
    addresses: input.addresses,
    topics: input.topics,
  })
  // Signed, not bearing the key (§9.1) — this route verifies the MAC over the body.
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...authHeaders({ key: CLIENT_KEY, method: 'POST', url, body, now: Date.now() }),
    },
    body,
  })
  // 503 is the API saying push is not enabled at all — remembered, not retried.
  if (res.status === 503) apiPushOff = true
  return res.ok
}

export async function unregisterPush(): Promise<void> {
  if (!CLIENT_KEY) return
  const token = await Notifications.getExpoPushTokenAsync()
    .then((t) => t.data)
    .catch(() => null)
  if (!token) return
  const url = `${API_BASE}/api/wallet/devices`
  const body = JSON.stringify({ token })
  const res = await fetch(url, {
    method: 'DELETE',
    headers: {
      'content-type': 'application/json',
      ...authHeaders({ key: CLIENT_KEY, method: 'DELETE', url, body, now: Date.now() }),
    },
    body,
  }).catch(() => null)
  // The unregister route is gated on the same flag, so it carries the same news.
  if (res?.status === 503) apiPushOff = true
}
