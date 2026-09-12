/**
 * The home-screen widget's snapshot (master plan §7.13): written as JSON
 * where the WidgetKit / Glance extensions read it. Never the seed, never an
 * address book — the Field seed, a name, a tier, and the total the user opted
 * into.
 *
 * The two platforms read from different places, and this is the only file that
 * knows it (packages/** may not import expo-* or react-native-*, §2.3):
 *
 * - **iOS.** A WidgetKit extension is a separate process with its own
 *   container, so the app's document directory is invisible to it. The one
 *   path both processes can open is the App Group container they both declare
 *   — `app.json` (`ios.entitlements`) for the app,
 *   `targets/widget/expo-target.config.js` for the widget — which is what
 *   `BoltVaultWidget.swift` opens with
 *   `containerURL(forSecurityApplicationGroupIdentifier:)`. Writing to the
 *   document directory, as this did, put the file somewhere the widget can
 *   never look.
 * - **Android.** A Glance widget runs inside the app's own process and reads
 *   `context.filesDir`, which is exactly where `Paths.document` lands. Nothing
 *   is shared and nothing needs to be.
 */
import type { WidgetSnapshot } from '@boltvault/wallet'
import { Directory, File, Paths } from 'expo-file-system'
import { excludeFromBackup as excludeTargetFromBackup } from './backup-exclusion'
import { Platform } from 'react-native'

export const WIDGET_DIR = 'widget'
export const WIDGET_FILE = 'widget-snapshot.json'
export const APP_GROUP = 'group.io.electroswap.boltvault'

/**
 * The directory the native widget reads, for this platform.
 *
 * `Paths.appleSharedContainers` is keyed by App Group id and is populated from
 * the entitlements the binary was actually signed with, so a missing entry
 * means the entitlement did not make it into the build — the widget then has
 * no container to read either, and there is nothing this can write that would
 * reach it. Say so once and fall back to the document directory rather than
 * throwing: `Home.tsx` publishes with a bare `void`, so a rejection here would
 * surface as an unhandled promise rejection over an unrelated screen.
 */
function snapshotRoot(): Directory {
  if (Platform.OS !== 'ios') return Paths.document
  const shared = Paths.appleSharedContainers[APP_GROUP]
  if (shared) return shared
  console.warn(`widget: no App Group container for ${APP_GROUP} — the widget will not see this snapshot. Check ios.entitlements in app.json and that the widget target was prebuilt.`)
  return Paths.document
}

export async function publishWidgetSnapshot(snapshot: WidgetSnapshot): Promise<void> {
  const dir = new Directory(snapshotRoot(), WIDGET_DIR)
  if (!dir.exists) dir.create({ intermediates: true })
  const file = new File(dir, WIDGET_FILE)
  file.write(JSON.stringify(snapshot))
  excludeFromBackup(file)
}

/**
 * Take the snapshot back: on lock, and when the account it described is gone.
 *
 * A widget that keeps showing a wallet nobody has unlocked for a week is a
 * balance sitting on a lock screen, and the file behind it is one a backup
 * picks up (§7.13, ATT-BV-033).
 */
export async function clearWidgetSnapshot(): Promise<void> {
  const file = new File(new Directory(snapshotRoot(), WIDGET_DIR), WIDGET_FILE)
  if (file.exists) file.delete()
}

/**
 * Keep the snapshot out of iCloud.
 *
 * Without `NSURLIsExcludedFromBackupKey` the App Group container is backed up
 * with everything else, so a file the wallet wrote for a widget on one phone
 * is readable from a backup of it — which is a different threat model from
 * "somebody has the phone". Best-effort: the API is iOS-only, and a failure
 * here must not stop the widget being written.
 */
// One helper for both stores, which also says whether it worked (ES-BV-042).
const excludeFromBackup = (file: File): boolean => excludeTargetFromBackup(file, Platform.OS === 'ios')
