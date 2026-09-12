import 'react-native-get-random-values'
import { createEngine, type Engine } from '@boltvault/engine'
import { App as WalletApp, SPLASH_BEAT, SplashRoot, takeSplash, type UiHost } from '@boltvault/wallet'
import { StatusBar } from 'expo-status-bar'
import { useEffect, useState } from 'react'
import { AppState, Linking, Share, StyleSheet, View } from 'react-native'
import Animated, { cubicBezier } from 'react-native-reanimated'
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context'
/*
  The version, from `version.json` at the repo root — the same file the
  extension manifest and `app.config.ts` read (the release checklist).

  It was `EXPO_PUBLIC_APP_VERSION` out of `apps/mobile/.env`, which is
  gitignored, so the number Settings › About showed and the number the API saw
  as `clientVersion` came from a file that is different on every machine and
  absent on CI — falling back to a literal that nobody was bumping. A build's
  own version is not local configuration.
*/
import { version as APP_VERSION } from '../../version.json'
import { haptic, sound } from './src/feel'
import { mobileLedgerProvider } from './src/ledger'
import { links } from './src/links'
import { PAGE_PROVIDER_SCRIPT } from './src/page-provider.generated'
import { DEVICE_KEY_ID, ensureDeviceKey, readDeviceKey, removeDeviceKey } from './src/device-key'
import { createMobilePlatform, isAndroid } from './src/platform'
import { pushStatus, registerPush, unregisterPush } from './src/push'
import { ScanHost, scanQr } from './src/scan'
import { registerTokenLogos } from './src/token-logos'
import { createWalletKit } from './src/walletkit'
import { clearWidgetSnapshot, publishWidgetSnapshot } from './src/widget'

/** The phone's capabilities (master plan §5): everything the shared screens may ask their body for. */
const host: Partial<UiHost> = {
  body: 'mobile',
  // The Android keystore factor is PIN-strength, not biometric (ES-BV-005).
  isAndroid,
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
  widget: { publish: publishWidgetSnapshot, clear: clearWidgetSnapshot },
  version: APP_VERSION,
  buildHash: process.env['EXPO_PUBLIC_BUILD_HASH'] ?? null,
}

registerTokenLogos()

/** Inside SafeAreaProvider, so the insets are real by the time the shell lays out. */
function Shell({ engine }: { engine: Engine['engine'] }) {
  const insets = useSafeAreaInsets()
  return <WalletApp engine={engine} body="mobile" host={host} insets={insets} />
}

/**
 * A beat longer on the mark, then out through the ground.
 *
 * `SPLASH_BEAT` is how long the ceremony itself runs — the strike, the
 * shockwaves, the name and the lock-up all land by then. The hold is time spent
 * on the finished picture afterwards, which is the part worth having and the
 * part the owner asked for more of: "I want the splash screen to persist for
 * 750ms longer than it currently does."
 */
const SPLASH_HOLD = 750

/**
 * The splash leaving: it dissolves into the ground, and the wallet comes up out
 * of it.
 *
 * The wallet is not rendered at all until then. It used to be mounted
 * underneath from the first frame with the splash laid over it, which is a
 * cover, not a transition — owner: "the splash is being overlaid over the
 * unlock/home screen, instead of delaying the display of either ... screen fade
 * to the navy background color before transitioning to the unlock screen."
 *
 * So: for `LEAVE` the splash fades out and there is nothing behind it but this
 * component's own `paint.void`, which IS the navy the owner means. Only when it
 * has gone does the shell mount, and it rises over `REVEAL`. Never two
 * compositions on screen at once.
 *
 * The cost is that the shell builds after the splash rather than behind it —
 * a frame or two, under a fade, against an engine that is already made.
 */
const LEAVE = 420
const REVEAL = 300

/** `paint.void`; the same value `styles.root` carries. */
const VOID = '#070A1F'

export default function App() {
  const [engine, setEngine] = useState<Engine | null>(null)
  /*
    The splash is held for exactly its ceremony and then pushed through.

    `takeSplash` is spent once per process, so a resume costs nothing here —
    and resuming from another app does not come through this path at all,
    because `engine` is already set and this component never unmounted.

    Two states: `beat` is "the ceremony has finished and been looked at", `gone`
    is "the splash has left the tree" — and `gone` is also the gate on the shell
    ever being rendered, which is what makes this a transition rather than a
    cover.
  */
  const [cold] = useState(takeSplash)
  const [beat, setBeat] = useState(!cold)
  const [gone, setGone] = useState(!cold)
  useEffect(() => {
    if (beat) return
    const t = setTimeout(() => setBeat(true), SPLASH_BEAT + SPLASH_HOLD)
    return () => clearTimeout(t)
  }, [beat])
  const leaving = beat && engine !== null
  useEffect(() => {
    if (!leaving || gone) return
    const t = setTimeout(() => setGone(true), LEAVE)
    return () => clearTimeout(t)
  }, [leaving, gone])
  useEffect(() => {
    let alive = true
    Promise.all([createMobilePlatform(), createWalletKit().catch(() => null)])
      .then(([platform, walletKit]) => {
        if (alive) setEngine(createEngine({ platform, ledger: mobileLedgerProvider(), walletKit, body: 'mobile', clientVersion: `BoltVault/${APP_VERSION}`, ...(process.env['EXPO_PUBLIC_BOLTVAULT_API'] ? { apiOrigin: process.env['EXPO_PUBLIC_BOLTVAULT_API'] } : {}), ...(process.env['EXPO_PUBLIC_BOLTVAULT_KEY'] ? { clientKey: process.env['EXPO_PUBLIC_BOLTVAULT_KEY'] } : {}), ...(process.env['EXPO_PUBLIC_QUOTER_URL'] ? { quoterUrl: process.env['EXPO_PUBLIC_QUOTER_URL'] } : {}), features: { limitOrders: process.env['EXPO_PUBLIC_BOLTVAULT_LIMIT_ORDERS'] === '1' } }))
      })
      .catch((err: unknown) => console.error('platform failed', err))
    return () => {
      alive = false
    }
  }, [])
  /*
    Leaving the app locks the wallet (ES-BV-041).

    The session store is an in-memory map and the auto-lock timers were
    re-checked only on foreground, so a phone put down with BoltVault open
    stayed unlocked until it was picked up again — and `autoLock: 'never'`
    kept the key in process memory for the life of the app, which on a phone
    is days. An unattended phone is unattended from the second it is put down;
    a timer cannot help with that and this can.
  */
  useEffect(() => {
    if (!engine) return
    const sub = AppState.addEventListener('change', (state) => {
      /*
        `background` only, never `inactive` (ES-BV-067).

        iOS reports `inactive` for a Face ID sheet, the control centre, an
        incoming call banner and the app switcher's first frame. Locking on it
        would tear the vault down underneath the biometric prompt that is
        unlocking it, and underneath a hardware signature in progress. The
        state that means the user left is `background`.
      */
      if (state !== 'background') return
      void engine.engine.settings
        .get()
        .then((s) => (s.autoLock === 'background' ? engine.engine.vault.lock() : undefined))
        .catch(() => undefined)
    })
    return () => sub.remove()
  }, [engine])
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
        {/*
          The wallet, once the splash has gone and not a frame before. It mounts
          into the ground and rises out of it — the fade is on the mount, which
          is the one moment a declarative animation is certain to run.
        */}
        {engine && gone ? (
          <Animated.View
            style={[
              styles.root,
              cold
                ? {
                    animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
                    animationDuration: `${REVEAL}ms`,
                    animationTimingFunction: cubicBezier(0.2, 0, 0.2, 1),
                    animationFillMode: 'both',
                  }
                : null,
            ]}
          >
            <Shell engine={engine.engine} />
          </Animated.View>
        ) : null}
        {/* `SplashRoot`, not `Splash`: out here there is no TamaguiProvider yet — WalletApp owns it. */}
        {gone ? null : (
          <Animated.View
            pointerEvents={leaving ? 'none' : 'auto'}
            style={[
              StyleSheet.absoluteFill,
              leaving
                ? {
                    animationName: { from: { opacity: 1, transform: [{ scale: 1 }] }, to: { opacity: 0, transform: [{ scale: 1.08 }] } },
                    animationDuration: `${LEAVE}ms`,
                    animationTimingFunction: cubicBezier(0.4, 0, 1, 1),
                    animationFillMode: 'forwards',
                  }
                : null,
            ]}
          >
            <SplashRoot />
          </Animated.View>
        )}
        {/*
          The ground, coming up over the mark.

          A newly mounted layer, because a mount is the one moment a declarative
          animation is certain to run — a keyframe added to a view that is
          already on screen is at the mercy of how the style diff is applied.
          The splash pushes through underneath it; if that animation does not
          take, this one still carries the whole transition on its own.
        */}
        {leaving && !gone ? (
          <Animated.View
            pointerEvents="none"
            style={[
              StyleSheet.absoluteFill,
              {
                backgroundColor: VOID,
                /*
                  Transparent in the static style AND `backwards` in the fill
                  mode, which are two answers to the same one-frame question.

                  A view mounts with its own style before its keyframes engage,
                  and this one's own style is an opaque sheet of void — so for
                  exactly one frame the whole screen went navy, then the
                  animation took over from `from` and faded it in properly. The
                  owner caught it: "it's literally a single frame of navy toward
                  the very end of the splash." `forwards` was the wrong fill
                  mode to reach for: it holds the LAST keyframe after the
                  animation, and says nothing about before it.
                */
                opacity: 0,
                animationName: { from: { opacity: 0 }, to: { opacity: 1 } },
                animationDuration: `${LEAVE}ms`,
                animationTimingFunction: cubicBezier(0.4, 0, 0.2, 1),
                animationFillMode: 'both',
              },
            ]}
          />
        ) : null}
        <ScanHost />
      </View>
    </SafeAreaProvider>
  )
}

const styles = StyleSheet.create({
  // `paint.void`; this was the superseded #060913.
  root: { flex: 1, backgroundColor: '#070A1F' },
})
