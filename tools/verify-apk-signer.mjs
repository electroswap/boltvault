#!/usr/bin/env node
/**
 * Refuse an APK signed with the Android debug key (ATT-BV-008).
 *
 * The debug keystore ships with the SDK, so an APK signed with it can be
 * "updated" by anybody: Android matches the signature, keeps the UID, the
 * files and the Keystore entries, and the replacement can ask for biometrics
 * and unwrap the vault. `plugins/withReleaseSigning.js` stops a release build
 * from being made that way; this is the gate that stops one being *shipped*
 * that way, wherever the artefact came from.
 *
 *     node tools/verify-apk-signer.mjs path/to/app-arm64-v8a-release.apk …
 *
 * Exits non-zero when any certificate names the debug identity, and also when
 * `apksigner` is missing — a gate that passes because it could not run is not
 * a gate. Set BOLTVAULT_APKSIGNER to point at the binary if it is not on PATH
 * (it lives in $ANDROID_HOME/build-tools/<version>/apksigner).
 */
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'

/** What `apksigner --print-certs` prints for the SDK's own key. */
const DEBUG_IDENTITY = /CN=Android Debug/i

const files = process.argv.slice(2)
if (files.length === 0) {
  console.error('usage: node tools/verify-apk-signer.mjs <apk> [<apk> …]')
  process.exit(2)
}

const apksigner = process.env.BOLTVAULT_APKSIGNER ?? 'apksigner'
let bad = 0

for (const file of files) {
  if (!existsSync(file)) {
    console.error(`✗ ${file}: no such file`)
    bad += 1
    continue
  }
  const run = spawnSync(apksigner, ['verify', '--print-certs', file], { encoding: 'utf8' })
  if (run.error) {
    console.error(`✗ cannot run ${apksigner}: ${run.error.message}`)
    console.error('  Set BOLTVAULT_APKSIGNER to $ANDROID_HOME/build-tools/<version>/apksigner.')
    process.exit(2)
  }
  const out = `${run.stdout ?? ''}${run.stderr ?? ''}`
  if (run.status !== 0) {
    console.error(`✗ ${file}: apksigner could not verify it\n${out.trim()}`)
    bad += 1
    continue
  }
  const subject = out.split('\n').find((l) => l.includes('certificate DN:'))?.trim() ?? '(no DN printed)'
  if (DEBUG_IDENTITY.test(out)) {
    console.error(`✗ ${file}: signed with the Android debug key — ${subject}`)
    console.error('  Anyone can sign an "update" for this install. Build with BOLTVAULT_RELEASE_KEYSTORE set.')
    bad += 1
    continue
  }
  console.log(`✓ ${file}: ${subject}`)
}

process.exit(bad === 0 ? 0 : 1)
