import 'react-native-get-random-values'
import { createEngine, type Engine } from '@boltvault/engine'
import { App as WalletApp, type UiHost } from '@boltvault/wallet'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Linking, SafeAreaView, Share, StyleSheet, Text } from 'react-native'
import { haptic, sound } from './src/feel'
import { bleLedgerProvider } from './src/ledger-ble'
import { links } from './src/links'
import { PAGE_PROVIDER_SCRIPT } from './src/page-provider.generated'
import { createMobilePlatform } from './src/platform'
import { pushStatus, registerPush, unregisterPush } from './src/push'
import { ScanHost, scanQr } from './src/scan'
import { createWalletKit } from './src/walletkit'
import { publishWidgetSnapshot } from './src/widget'

/** The phone's capabilities (master plan §5): everything the shared screens may ask their body for. */
const host: Partial<UiHost> = {
  body: 'mobile',
  secretsAllowed: true,
  // Passkeys on mobile (platform authenticators via react-native-passkeys) and the
  // biometric device-wrap flow land with the v1.1 native-secret module; the password unlocks.
  passkeys: null,
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

export default function App() {
  const [engine, setEngine] = useState<Engine | null>(null)
  useEffect(() => {
    let alive = true
    Promise.all([createMobilePlatform(), createWalletKit().catch(() => null)])
      .then(([platform, walletKit]) => {
        if (alive) setEngine(createEngine({ platform, ledger: bleLedgerProvider(), walletKit, body: 'mobile', clientVersion: `BoltVault/${process.env['EXPO_PUBLIC_APP_VERSION'] ?? '0.1.0'}` }))
      })
      .catch((err: unknown) => console.error('platform failed', err))
    return () => {
      alive = false
    }
  }, [])
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      {engine ? <WalletApp engine={engine.engine} body="mobile" host={host} /> : <Text style={styles.boot}>BoltVault</Text>}
      <ScanHost />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060913' },
  boot: { color: '#DCE5F5', padding: 24 },
})
