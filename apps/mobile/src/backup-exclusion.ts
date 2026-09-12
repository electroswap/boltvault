/**
 * Keeping the wallet's files out of the iPhone's backups (ES-BV-042).
 *
 * The encrypted vault, the settings and the widget snapshot live under the
 * app's Documents directory, which iOS includes in iCloud and in local
 * backups. That is a different threat model from "somebody has the phone": a
 * file the wallet wrote on one device is readable from a backup of it, and the
 * backup may be somewhere the user does not think of as holding a wallet.
 *
 * The flag that fixes it is `NSURLIsExcludedFromBackupKey`, set on the URL.
 * The pinned `expo-file-system@57.0.6` does not expose it — no `Directory` or
 * `File` method, no option on `create`. The code that "handled" this called an
 * `excludeFromBackup()` method that does not exist, through an optional call,
 * so it did nothing at all and looked like it had.
 *
 * This module is the honest version. It tries, it says whether it worked, and
 * `backupExclusionAvailable()` is asserted by a test — so the day the pinned
 * module gains the API, or a native module is added for it, the test fails and
 * points here rather than the gap staying invisible for another release.
 */
/*
  Deliberately free of `react-native` imports: the mobile test runner parses
  these files directly and React Native ships Flow-typed sources it cannot
  read, so the platform check is the caller's to make.
*/

/** Anything with a `uri`, which is what both `File` and `Directory` are. */
export interface BackupTarget {
  readonly uri: string
}

/** What a target that supports the flag would look like. */
type MaybeExcludable = {
  excludeFromBackup?: () => void
  setExcludedFromBackup?: (value: boolean) => void
  isExcludedFromBackup?: boolean
}

/**
 * Whether the pinned file-system module can exclude anything at all.
 *
 * Probed from the prototype rather than from an instance, so it answers
 * without touching the disk.
 */
export function backupExclusionAvailable(proto: object | null | undefined): boolean {
  if (!proto) return false
  const p = proto as MaybeExcludable
  return typeof p.excludeFromBackup === 'function' || typeof p.setExcludedFromBackup === 'function'
}

/**
 * Ask iOS to keep this out of backups. Returns whether it actually happened.
 *
 * Never throws: a widget snapshot that cannot be flagged is still a widget
 * snapshot, and a vault that cannot be flagged still has to be written — the
 * bytes are encrypted under the user's password either way. What must not
 * happen is the wallet believing it did something it did not.
 */
export function excludeFromBackup(target: BackupTarget | null | undefined, isIos = true): boolean {
  if (!isIos || !target) return false
  const t = target as unknown as MaybeExcludable
  try {
    if (typeof t.setExcludedFromBackup === 'function') {
      t.setExcludedFromBackup(true)
      return true
    }
    if (typeof t.excludeFromBackup === 'function') {
      t.excludeFromBackup()
      return true
    }
  } catch {
    // An API that exists and refuses is the same as one that is not there.
  }
  return false
}
