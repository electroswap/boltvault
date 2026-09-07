/**
 * The device's back gesture, for bodies that have one.
 *
 * Android sends a `hardwareBackPress` and closes the activity when nobody
 * answers it — which is why BoltVault exited instead of navigating. The
 * listener belongs here because packages/wallet composes ui primitives and
 * never imports react-native directly; the routing decision stays there and
 * arrives as `handler`.
 *
 * `handler` returns true when it consumed the press and false to let the OS
 * have it (i.e. leave the app). On every other body this does nothing.
 */
import { useEffect } from 'react'
import { BackHandler, Platform } from 'react-native'

export function useHardwareBack(handler: () => boolean): void {
  useEffect(() => {
    if (Platform.OS !== 'android') return
    const sub = BackHandler.addEventListener('hardwareBackPress', handler)
    return () => {
      sub.remove()
    }
  }, [handler])
}
