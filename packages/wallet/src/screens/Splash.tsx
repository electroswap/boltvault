/**
 * The cold-start splash: the mark, the name, and whose wallet it is.
 *
 * The drawing and its motion are `SplashArt` in @boltvault/ui — this is the
 * screen around it: what the words are, when it may run, and the theme a body
 * that renders it before the app needs.
 *
 * **Cold start only.** It stands in while the engine is being built, and the
 * engine lives in the mobile `App`'s state — which survives backgrounding, so
 * returning from another app never sees this. `spent` guards the case Android
 * can still produce: an activity restored after the process was killed is a
 * cold start and should show it, but a remount inside one session should not.
 */
import { Body, Column, EsWordmark, SPLASH_BEAT, SplashArt, TamaguiProvider, tamaguiConfig, useWindowDimensions } from '@boltvault/ui'
import { t } from '../i18n'

/** How long the ceremony runs; a body holds the splash for exactly this. */
export { SPLASH_BEAT }

let spent = false

/** True once per process. A resumed app has already spent it. */
export function takeSplash(): boolean {
  if (spent) return false
  spent = true
  return true
}

/** Tests and the harness: show it again. */
export function rearmSplash(): void {
  spent = false
}

export function Splash({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const { width, height } = useWindowDimensions()
  return (
    <SplashArt
      width={width}
      height={height}
      reducedMotion={reducedMotion}
      testID="splash"
      name={
        <Body size="title" fontSize={34} lineHeight={40} letterSpacing={-0.5} testID="splash-wordmark">
          {t({ id: 'splash.name', message: 'BoltVault' })}
        </Body>
      }
      brand={
        <Column alignItems="center" testID="splash-brand">
          <EsWordmark />
        </Column>
      }
    />
  )
}

/**
 * The splash with a theme of its own, for a body that renders it before the app.
 *
 * `Splash` is built from Tamagui primitives and theme tokens, and the only
 * `TamaguiProvider` in the product is the one `App` mounts — so on the phone,
 * where the splash stands in for the app while the engine is still being built,
 * it had no theme at all and Tamagui threw `Missing theme` on the very first
 * frame. The wallet crashed on launch.
 *
 * Nothing caught it because every automated view of this screen goes through
 * the harness, which renders it *inside* `App` — where the provider is. The
 * device smoke (`apps/mobile/scripts/device-smoke.sh`) is what catches this
 * class of fault; it exists for exactly this and wants a phone attached.
 *
 * So: `Splash` inside the app (the screen registry, the harness, tests),
 * `SplashRoot` outside it.
 */
export function SplashRoot({ reducedMotion = false }: { reducedMotion?: boolean }) {
  return (
    <TamaguiProvider config={tamaguiConfig} defaultTheme="dark">
      <Splash reducedMotion={reducedMotion} />
    </TamaguiProvider>
  )
}
