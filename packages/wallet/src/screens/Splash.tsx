/**
 * The cold-start splash (owner ask): the mark, the name, and whose wallet it is.
 *
 * What it replaces is the literal string `<Text>BoltVault</Text>` on a flat
 * `#060913` — the app's first impression was unstyled body copy in the top-left
 * corner, over a native splash that was **white** (`colors.xml`), so a dark
 * wallet opened on a white flash.
 *
 * **Cold start only.** It renders while the engine is being built, and the
 * engine lives in `App`'s state — which survives backgrounding, so returning
 * from another app never sees this. `spent` guards the case Android can still
 * produce: an activity restored after the process was killed is a cold start
 * and should show it, but a remount inside one session should not.
 *
 * The ceremony is `Ignition`, the product's one orchestrated enter (§7.7),
 * rather than a new animation vocabulary: the mark, then the name, then the
 * ElectroSwap lock-up, 70 ms apart.
 */
import { Body, BoltMark, Column, EsWordmark, Field, Ignition, useWindowDimensions } from '@boltvault/ui'
import { t } from '../i18n'

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
    <Column flex={1} backgroundColor="$void" alignItems="center" justifyContent="center" testID="splash">
      {/*
        The circuit, quiet, so the splash is the same world as the wallet
        rather than a title card in front of it.
      */}
      <Field scene="circuit" address="0x0000000000000000000000000000000000000e7n" quiet width={width} height={height} reducedMotion={reducedMotion} />
      <Column flex={1} alignItems="center" justifyContent="center" gap="$5" zIndex={1}>
        <Ignition active={!reducedMotion} reducedMotion={reducedMotion} order={0}>
          <BoltMark size={Math.min(230, width * 0.58)} testID="splash-mark" />
        </Ignition>
        <Ignition active={!reducedMotion} reducedMotion={reducedMotion} order={1}>
          <Body size="title" fontSize={34} lineHeight={40} letterSpacing={-0.5} testID="splash-wordmark">
            {t({ id: 'splash.name', message: 'BoltVault' })}
          </Body>
        </Ignition>
      </Column>
      {/* The same lock-up, in the same place, as Unlock and Onboarding. */}
      <Ignition active={!reducedMotion} reducedMotion={reducedMotion} order={2}>
        <Column alignItems="center" paddingBottom="$8" zIndex={1} testID="splash-brand">
          <EsWordmark />
        </Column>
      </Ignition>
    </Column>
  )
}
