/* eslint-disable @typescript-eslint/no-require-imports -- an Expo config plugin is CommonJS */
/**
 * Expo config plugin (master plan §7.13): registers the Android Glance widget
 * receiver and copies the native sources in apps/mobile/native into the
 * prebuilt projects. The iOS WidgetKit + Live Activity target is added with
 * @bacons/apple-targets from apps/mobile/targets/widget (see native/README).
 * Runs at `expo prebuild` (EAS); nothing here touches the JS bundle.
 */
const { withAndroidManifest, withDangerousMod } = require('expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')

function withAndroidWidget(config) {
  config = withAndroidManifest(config, (c) => {
    const app = c.modResults.manifest.application?.[0]
    if (!app) return c
    app.receiver = app.receiver ?? []
    if (!app.receiver.some((r) => r.$['android:name'] === 'io.electroswap.boltvault.widget.BoltVaultWidgetReceiver')) {
      app.receiver.push({
        $: { 'android:name': 'io.electroswap.boltvault.widget.BoltVaultWidgetReceiver', 'android:exported': 'true', 'android:label': 'BoltVault' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.appwidget.action.APPWIDGET_UPDATE' } }] }],
        'meta-data': [{ $: { 'android:name': 'android.appwidget.provider', 'android:resource': '@xml/boltvault_widget_info' } }],
      })
    }
    return c
  })
  config = withDangerousMod(config, [
    'android',
    (c) => {
      const root = c.modRequest.platformProjectRoot
      const src = path.join(c.modRequest.projectRoot, 'native', 'android', 'widget')
      const dstKt = path.join(root, 'app', 'src', 'main', 'java', 'io', 'electroswap', 'boltvault', 'widget')
      fs.mkdirSync(dstKt, { recursive: true })
      fs.copyFileSync(path.join(src, 'BoltVaultWidget.kt'), path.join(dstKt, 'BoltVaultWidget.kt'))
      const xml = path.join(root, 'app', 'src', 'main', 'res', 'xml')
      fs.mkdirSync(xml, { recursive: true })
      fs.copyFileSync(path.join(src, 'boltvault_widget_info.xml'), path.join(xml, 'boltvault_widget_info.xml'))
      // Glance dependency for the app module.
      const gradle = path.join(root, 'app', 'build.gradle')
      const text = fs.readFileSync(gradle, 'utf8')
      if (!text.includes('androidx.glance:glance-appwidget')) fs.writeFileSync(gradle, text.replace(/dependencies\s*\{/, 'dependencies {\n    implementation("androidx.glance:glance-appwidget:1.1.1")\n    implementation("androidx.glance:glance-material3:1.1.1")'))
      return c
    },
  ])
  return config
}

module.exports = function withWidgets(config) {
  return withAndroidWidget(config)
}
