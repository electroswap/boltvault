/**
 * The home-screen widget's snapshot (master plan §7.13): written as JSON
 * where the WidgetKit / Glance extensions read it. Today that is the app's
 * document directory; the native targets (apps/mobile/native) read the App
 * Group container the config plugin points both at. Never the seed, never
 * an address book — the Field seed, a name, a tier, and the total the user
 * opted into.
 */
import type { WidgetSnapshot } from '@boltvault/wallet'
import { Directory, File, Paths } from 'expo-file-system'

export const WIDGET_FILE = 'widget-snapshot.json'
export const APP_GROUP = 'group.io.electroswap.boltvault'

export async function publishWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  const dir = new Directory(Paths.document, 'widget')
  if (!dir.exists) dir.create()
  const file = new File(dir, WIDGET_FILE)
  file.write(JSON.stringify(snapshot))
}
