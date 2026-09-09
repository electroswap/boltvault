import 'react-native-get-random-values'
import { createEngine, type Engine } from '@boltvault/engine'
import { App as WalletApp, type UiHost } from '@boltvault/wallet'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Linking, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
import { haptic, sound } from './src/feel'
import { mobileLedgerProvider } from './src/ledger'
import { links } from './src/links'
import { PAGE_PROVIDER_SCRIPT } from './src/page-provider.generated'
import { DEVICE_KEY_ID, ensureDeviceKey, readDeviceKey, removeDeviceKey } from './src/device-key'
import { createMobilePlatform } from './src/platform'
import { pushStatus, registerPush, unregisterPush } from './src/push'
import { ScanHost, scanQr } from './src/scan'
import { registerTokenLogos } from './src/token-logos'
import { createWalletKit } from './src/walletkit'
import { publishWidgetSnapshot } from './src/widget'

/** The phone's capabilities (master plan §5): everything the shared screens may ask their body for. */
const host: Partial<UiHost> = {
  body: 'mobile',
  secretsAllowed: true,
  // Passkeys on mobile (platform authenticators via react-native-passkeys) land
  // with the v1.1 native-secret module; the password unlocks.
  passkeys: null,
  /*
    Biometric unlock. Every piece below this line already existed and was
    tested — the device wrap in core, enrolDevice/unlockWithDevice in the
    engine, and src/device-key.ts itself — but nothing imported any of it, so
    the feature was fully built and completely unreachable. This is the wire.
  */
  deviceKey: {
    id: DEVICE_KEY_ID,
    available: async () => {
      const LocalAuthentication = await import('expo-local-authentication')
      return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync())
    },
    ensure: ensureDeviceKey,
    read: readDeviceKey,
    remove: removeDeviceKey,
  },
  copy: async (text) => {
    const { setStringAsync } = await import('expo-clipboard')
    await setStringAsync(text)
  },
  openUrl: async (url) => {
    await Linking.openURL(url)
  },
  scanQr,
  browser: { providerScript: PAGE_PROVIDER_SCRIPT },
  links,
  haptic,
  sound,
  share: async ({ title, text, url }) => {
    await Share.share({ title, message: [text, url].filter(Boolean).join('\n'), ...(url ? { url } : {}) })
  },
  push: {
    status: pushStatus,
    enable: async () => registerPush({ addresses: [], topics: ['incoming', 'sales', 'campaigns', 'rewards', 'dividends', 'tier', 'bridge'] }),
    disable: unregisterPush,
  },
  widget: { publish: publishWidgetSnapshot },
  version: process.env['EXPO_PUBLIC_APP_VERSION'] ?? '0.1.0',
  buildHash: process.env['EXPO_PUBLIC_BUILD_HASH'] ?? null,
}

registerTokenLogos()

/** Inside SafeAreaProvider, so the insets are real by the time the shell lays out. */
function Shell({ engine }: { engine: Engine['engine'] }) {
  const insets = useSafeAreaInsets()
  return <WalletApp engine={engine} body="mobile" host={host} insets={insets} />
}

export default function App() {
  const [engine, setEngine] = useState<Engine | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([createMobilePlatform(), createWalletKit().catch(() => null)])
      .then(([platform, walletKit]) => {
        if (alive) setEngine(createEngine({ platform, ledger: mobileLedgerProvider(), walletKit, body: 'mobile', clientVersion: `BoltVault/${process.env['EXPO_PUBLIC_APP_VERSION'] ?? '0.1.0'}`, ...(process.env['EXPO_PUBLIC_BOLTVAULT_API'] ? { apiOrigin: process.env['EXPO_PUBLIC_BOLTVAULT_API'] } : {}), features: { limitOrders: process.env['EXPO_PUBLIC_BOLTVAULT_LIMIT_ORDERS'] === '1' } }))
      })
      .catch((err: unknown) => console.error('platform failed', err))
    return () => {
      alive = false
    }
  }, [])
  return (
    /*
      SafeAreaProvider, not react-native's SafeAreaView: that component is
      iOS-only and lays out as a plain View on Android, which is why the header
      sat under the status bar and the dock under the gesture bar. The window
      is deliberately edge-to-edge (android/gradle.properties), so the shell
      pads itself from these insets instead.
    */
    <SafeAreaProvider>
      <View style={styles.root}>
        <StatusBar style="light" />
        {engine ? <Shell engine={engine.engine} /> : <Text style={styles.boot}>BoltVault</Text>}
        <ScanHost />
      </View>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060913' },
  boot: { color: '#DCE5F5', padding: 24 },
})
