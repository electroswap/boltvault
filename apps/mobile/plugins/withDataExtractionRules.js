/* eslint-disable @typescript-eslint/no-require-imports -- an Expo config plugin is CommonJS */
/**
 * Expo config plugin: say no to device transfer as well as to cloud backup.
 *
 * `android.allowBackup: false` (app.json) turns off Auto Backup, and that is
 * the half everybody remembers. Android 12 added a second path — the
 * device-to-device transfer a new phone runs during setup — which is governed
 * by `dataExtractionRules` and is NOT covered by `allowBackup`. Without the
 * file, the wallet's whole data directory can be copied onto another handset:
 * the encrypted MMKV store, the vault file, and the widget snapshot beside
 * them. The ciphertext is still ciphertext, but a copy an attacker can take
 * their time over is a different problem from one they cannot take at all, and
 * §3.7 says the wallet does not travel.
 *
 * `<cloud-backup>` is stated as well as `<device-transfer>` so the two paths
 * are visible together rather than one being implied by app.json.
 */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

const RULES = `<?xml version="1.0" encoding="utf-8"?>
<!-- Added by plugins/withDataExtractionRules.js. A wallet does not travel. -->
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </cloud-backup>
    <device-transfer>
        <exclude domain="root" />
        <exclude domain="file" />
        <exclude domain="database" />
        <exclude domain="sharedpref" />
        <exclude domain="external" />
    </device-transfer>
</data-extraction-rules>
`

function withRulesFile(config) {
  return withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'data_extraction_rules.xml'), RULES)
      return c
    },
  ])
}

module.exports = function withDataExtractionRules(config) {
  config = withRulesFile(config)
  return withAndroidManifest(config, (c) => {
    const application = c.modResults.manifest.application?.[0]
    if (!application) return c
    application.$ = application.$ ?? {}
    application.$['android:dataExtractionRules'] = '@xml/data_extraction_rules'
    // Pre-12 handsets read this one; it names the same "nothing leaves" rule.
    application.$['android:fullBackupContent'] = '@xml/data_extraction_rules'
    return c
  })
}
