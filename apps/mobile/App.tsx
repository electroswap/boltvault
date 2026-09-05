import 'react-native-get-random-values'
import { createEngine, type Engine } from '@boltvault/engine'
import { App as WalletApp, type UiHost } from '@boltvault/wallet'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { Linking, SafeAreaView, StyleSheet, Text } from 'react-native'
import { bleLedgerProvider } from './src/ledger-ble'
import { createMobilePlatform } from './src/platform'
import { ScanHost, scanQr } from './src/scan'

const host: Partial<UiHost> = {
  body: 'mobile',
  secretsAllowed: true,
  // Passkeys on mobile (platform authenticators via react-native-passkeys) and the
  // biometric device-wrap flow land with M9; until then the password unlocks.
  passkeys: null,
  copy: async (text) => {
    const { setStringAsync } = await import('expo-clipboard')
    await setStringAsync(text)
  },
  openUrl: async (url) => {
    await Linking.openURL(url)
  },
  scanQr,
}

export default function App() {
  const [engine, setEngine] = useState<Engine | null>(null)
  useEffect(() => {
    let alive = true
    createMobilePlatform()
      .then((platform) => {
        if (alive) setEngine(createEngine({ platform, ledger: bleLedgerProvider() }))
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
