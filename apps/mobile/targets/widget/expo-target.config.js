/** @type {import('@bacons/apple-targets').Config} */
module.exports = {
  type: 'widget',
  name: 'BoltVaultWidget',
  displayName: 'BoltVault',
  deploymentTarget: '16.2',
  entitlements: { 'com.apple.security.application-groups': ['group.io.electroswap.boltvault'] },
  frameworks: ['SwiftUI', 'WidgetKit', 'ActivityKit'],
}
