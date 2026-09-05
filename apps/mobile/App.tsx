import { createEngine } from '@boltvault/engine'
import { App as WalletApp } from '@boltvault/wallet'
import { StatusBar } from 'expo-status-bar'
import { useMemo } from 'react'
import { SafeAreaView, StyleSheet } from 'react-native'
import { createMobilePlatform } from './src/platform'

export default function App() {
  // The engine runs in-process on mobile (master plan §2.4). One instance per app.
  const engine = useMemo(() => createEngine({ platform: createMobilePlatform() }).engine, [])
  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="light" />
      <WalletApp engine={engine} body="mobile" />
    </SafeAreaView>
  )
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#060913' },
})
