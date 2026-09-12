/**
 * The camera scanner on the phone (master plan §2.7 S7): `scanQr()` opens a
 * full-screen `CameraView` and resolves with the first QR read (a
 * multi-part UR keeps reading through `onPart` until the collector is
 * satisfied). One host mounts `<ScanHost />` once; the promise API is what
 * the wallet's `UiHost.scanQr` expects.
 */
import { CameraView, useCameraPermissions } from 'expo-camera'
import { useEffect, useState } from 'react'
import { Pressable, StyleSheet, Text, View } from 'react-native'

interface Job {
  readonly onPart?: (text: string) => boolean
  resolve(text: string): void
  reject(err: Error): void
}

let current: Job | null = null
let notify: (() => void) | null = null

export function scanQr(onPart?: (text: string) => boolean): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (current) current.reject(new Error('Another scan is in progress.'))
    current = { ...(onPart ? { onPart } : {}), resolve, reject }
    notify?.()
  })
}

export function ScanHost() {
  const [job, setJob] = useState<Job | null>(null)
  const [permission, requestPermission] = useCameraPermissions()
  useEffect(() => {
    notify = () => setJob(current)
    return () => {
      notify = null
    }
  }, [])
  useEffect(() => {
    if (job && permission && !permission.granted && permission.canAskAgain) void requestPermission()
  }, [job, permission, requestPermission])
  if (!job) return null
  const finish = (text: string | null, err?: Error): void => {
    const j = current
    current = null
    setJob(null)
    if (!j) return
    if (text !== null) j.resolve(text)
    else j.reject(err ?? new Error('Cancelled.'))
  }
  const seen = new Set<string>()
  return (
    <View style={styles.overlay} testID="scan-host">
      {permission?.granted ? (
        <CameraView
          style={styles.camera}
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
          onBarcodeScanned={({ data }) => {
            if (!data || seen.has(data)) return
            seen.add(data)
            const done = job.onPart ? job.onPart(data) : true
            if (done) finish(data)
          }}
        />
      ) : (
        <Text style={styles.text}>
          {permission?.canAskAgain === false
            ? 'Allow the camera in Settings to scan.'
            : 'Waiting for camera permission…'}
        </Text>
      )}
      <Pressable onPress={() => finish(null)} style={styles.cancel} accessibilityRole="button">
        <Text style={styles.text}>Cancel</Text>
      </Pressable>
    </View>
  )
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#060913',
    justifyContent: 'center',
  },
  camera: { flex: 1 },
  cancel: { padding: 20, alignItems: 'center', minHeight: 56, justifyContent: 'center' },
  text: { color: '#DCE5F5', fontSize: 16, textAlign: 'center', padding: 16 },
})
