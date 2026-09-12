/* eslint-disable @typescript-eslint/no-require-imports -- an Expo config plugin is CommonJS */
/**
 * Expo config plugin: USB host, so a Ledger on an OTG cable is visible.
 *
 * Owner: "I connected via OTG cable and had Ethereum app open (Ledger Live
 * detected) but BoltVault did not detect it." Beyond the missing transport
 * (src/ledger-hid.ts), Android will not surface a USB device to an app that
 * never says it wants one. This adds the three pieces that requires:
 *
 *   - <uses-feature android.hardware.usb.host>, marked not-required so the
 *     build still installs on a phone without OTG
 *   - a USB_DEVICE_ATTACHED intent filter on MainActivity, so plugging in
 *     while the app is closed offers BoltVault
 *   - res/xml/usb_device_filter.xml naming Ledger's vendor id, which is what
 *     that filter matches against
 *
 * It lives here rather than in android/ because android/ is gitignored and
 * rewritten by every `expo prebuild` — an edit there would silently vanish.
 */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

/** Ledger's USB vendor id, 0x2c97. The resource filter wants it in decimal. */
const LEDGER_VENDOR_ID = 11415

function withUsbManifest(config) {
  return withAndroidManifest(config, (c) => {
    const manifest = c.modResults.manifest
    manifest['uses-feature'] = manifest['uses-feature'] ?? []
    if (
      !manifest['uses-feature'].some((f) => f.$['android:name'] === 'android.hardware.usb.host')
    ) {
      manifest['uses-feature'].push({
        $: { 'android:name': 'android.hardware.usb.host', 'android:required': 'false' },
      })
    }
    const app = manifest.application?.[0]
    const main = app?.activity?.find((a) => a.$['android:name'] === '.MainActivity')
    if (!main) return c
    main['intent-filter'] = main['intent-filter'] ?? []
    const attached = 'android.hardware.usb.action.USB_DEVICE_ATTACHED'
    if (
      !main['intent-filter'].some((f) =>
        (f.action ?? []).some((a) => a.$['android:name'] === attached),
      )
    ) {
      main['intent-filter'].push({ action: [{ $: { 'android:name': attached } }] })
    }
    main['meta-data'] = main['meta-data'] ?? []
    if (!main['meta-data'].some((m) => m.$['android:name'] === attached)) {
      main['meta-data'].push({
        $: { 'android:name': attached, 'android:resource': '@xml/usb_device_filter' },
      })
    }
    return c
  })
}

function withUsbFilterResource(config) {
  return withDangerousMod(config, [
    'android',
    (c) => {
      const dir = path.join(c.modRequest.platformProjectRoot, 'app', 'src', 'main', 'res', 'xml')
      fs.mkdirSync(dir, { recursive: true })
      const xml = [
        '<?xml version="1.0" encoding="utf-8"?>',
        '<resources>',
        '  <!-- Ledger (0x2c97): every model, since the product id encodes the model. -->',
        `  <usb-device vendor-id="${LEDGER_VENDOR_ID}" />`,
        '</resources>',
        '',
      ].join('\n')
      fs.writeFileSync(path.join(dir, 'usb_device_filter.xml'), xml)
      return c
    },
  ])
}

module.exports = function withUsbHost(config) {
  return withUsbFilterResource(withUsbManifest(config))
}
