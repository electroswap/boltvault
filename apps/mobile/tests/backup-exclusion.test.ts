/**
 * The wallet's files are still in the iPhone's backups, and this is the test
 * that says when they stop being (ES-BV-042).
 *
 * The encrypted vault, the settings and the widget snapshot live under the
 * app's Documents directory, which iOS includes in iCloud and local backups.
 * The code that "handled" this called an `excludeFromBackup()` method through
 * an optional call — a method the pinned `expo-file-system@57.0.6` does not
 * have — so it did nothing and looked like it had, in two places.
 *
 * There is no honest way to set `NSURLIsExcludedFromBackupKey` from the pinned
 * module, so the gap is recorded here instead of hidden. The last test fails
 * the day the module gains the API or a native module is added for it, which
 * is the point: it stops being a comment and becomes a one-line change.
 */
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { backupExclusionAvailable, excludeFromBackup } from '../src/backup-exclusion'

const require_ = createRequire(import.meta.url)

describe('the helper', () => {
  it('reports failure rather than pretending, when there is no API to call', () => {
    expect(excludeFromBackup({ uri: 'file:///x' })).toBe(false)
    expect(excludeFromBackup(null)).toBe(false)
  })

  it('does not throw when an API exists and refuses', () => {
    const angry = {
      uri: 'file:///x',
      excludeFromBackup() {
        throw new Error('no')
      },
    }
    expect(excludeFromBackup(angry)).toBe(false)
  })

  it('reads a prototype rather than touching the disk', () => {
    expect(backupExclusionAvailable(null)).toBe(false)
    expect(backupExclusionAvailable({})).toBe(false)
    expect(backupExclusionAvailable({ excludeFromBackup: () => undefined })).toBe(true)
    expect(backupExclusionAvailable({ setExcludedFromBackup: () => undefined })).toBe(true)
  })
})

describe('the pinned file-system module', () => {
  it('still has no way to exclude a file from backup', () => {
    /*
      Read from the published type declarations rather than by loading the
      module: this runner parses TypeScript itself and will not strip types
      under `node_modules`, and the declarations are the contract anyway.

      When this starts failing, that is the good news. The helper already tries
      both spellings, so enabling it is a one-line change — and then this
      expectation becomes `true`.
    */
    const root = dirname(require_.resolve('expo-file-system/package.json'))
    const declared = ['Directory.d.ts', 'File.d.ts', 'FileSystem.types.d.ts', 'ExpoFileSystem.types.d.ts']
      .map((f) => join(root, 'build', f))
      .filter((f) => existsSync(f))
      .map((f) => readFileSync(f, 'utf8'))
      .join('\n')
    expect(declared.length).toBeGreaterThan(0)
    expect(/excludeFromBackup|setExcludedFromBackup|ExcludedFromBackup/.test(declared)).toBe(false)
  })
})
