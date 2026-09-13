/**
 * Unlock — password, or a passkey when one is enrolled and available here.
 * Quiet custody mode; the Field ignites on success (Ignition on Home).
 */
import {
  Body,
  Column,
  EsWordmark,
  Icon,
  Input,
  Key,
  Plate,
  Row,
  metrics,
  paint,
} from '@boltvault/ui'
import { useEffect, useRef, useState } from 'react'
import { ConfirmSheet } from '../components/accounts/AccountSheets'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { throttleMessage } from '../throttle'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

export function Unlock({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { vault } = useWalletState()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  /*
    The biometric attempt gets its own flag, and this is the whole point of it.

    It used to share `busy` with the password path, and the auto-prompt below
    raises that flag before awaiting a native sheet. If that sheet never
    settles — Android dismissing a `BiometricPrompt` across a configuration
    change is enough — `finally` never runs, `busy` latches true, and the
    Unlock key is `disabled={busy || !password}`. The password stops being a
    way in. A beta tester: "The app got locked because i tabbed out.. all good.
    But i cant re enter again. unlock button doenst work. My password should be
    correct. Atleast it should be possible to press the button and if the pw is
    wrong.. you get a 'wrong password' thingy."

    They are right, and the rule that follows is simple: nothing the biometric
    path does may ever disable the password path. It is the recovery route for
    the biometric path failing.
  */
  const [bioBusy, setBioBusy] = useState(false)
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeyOk, setPasskeyOk] = useState(false)
  const passkeyIds = (vault?.wraps ?? []).filter((w) => w.by === 'prf').map((w) => w.id)
  // Biometric unlock is offered only when this vault actually carries a device
  // wrap AND the phone still has a biometric enrolled — changing the enrolled
  // set invalidates the keystore entry, so the wrap can outlive the key.
  const [biometricOk, setBiometricOk] = useState(false)
  const deviceWrapped = (vault?.wraps ?? []).some((w) => w.by === 'device')

  useEffect(() => {
    let alive = true
    if (passkeyIds.length && host.passkeys)
      host.passkeys.supported().then(
        (ok) => alive && setPasskeyOk(ok),
        () => undefined,
      )
    return () => {
      alive = false
    }
  }, [host.passkeys, passkeyIds.length])

  useEffect(() => {
    let alive = true
    if (deviceWrapped && host.deviceKey)
      host.deviceKey.available().then(
        (ok) => alive && setBiometricOk(ok),
        () => undefined,
      )
    return () => {
      alive = false
    }
  }, [host.deviceKey, deviceWrapped])

  /*
    Owner: "when enrolled you skip the step that makes me click 'unlock with
    biometrics' and just prompt me for the biometrics."

    So the prompt opens itself the moment we know one is enrolled and usable.
    Once only — `prompted` is a ref, not state, so a re-render cannot re-open
    it, and cancelling leaves the password field focused with the key still
    there to try again rather than looping the prompt.
  */
  const prompted = useRef(false)
  useEffect(() => {
    if (!biometricOk || prompted.current) return
    prompted.current = true
    void unlockWithBiometric()
  }, [biometricOk])

  const unlock = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await engine.vault.unlock({ password })
      setPassword('')
      router.reset()
    } catch (err: unknown) {
      /*
        Say which of the two it was (ES-BV-008).

        The vault refuses to even try while it is cooling off after five wrong
        attempts, and this reported that refusal as "that password does not
        open this vault" — so somebody whose password was right was told it
        was wrong, and re-typed it into a door that was not going to open for
        another half a minute.
      */
      setError(throttleMessage(err) ?? t({ id: 'unlock.wrong', message: 'That password does not open this vault.' }))
    } finally {
      setBusy(false)
    }
  }

  /*
    The way out, for someone who cannot get in.

    The device key goes first and separately: it lives in the OS keychain, not
    in the wallet's own storage, so `vault.wipe()` cannot reach it and a
    survivor would be an orphan wrap pointing at a vault that no longer exists.
    It is allowed to fail — on a phone with no keystore entry there is nothing
    to remove — and the wipe proceeds regardless.
  */
  const resetWallet = async (): Promise<void> => {
    setResetting(false)
    setBusy(true)
    setError(null)
    try {
      await host.deviceKey?.remove().catch(() => undefined)
      await engine.vault.wipe()
      setPassword('')
      router.reset()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const unlockWithPasskey = async (): Promise<void> => {
    if (!host.passkeys) return
    setBusy(true)
    setError(null)
    try {
      const r = await host.passkeys.get(passkeyIds)
      await engine.vault.unlockWithPasskey({
        credentialId: r.credentialId,
        prfSecretHex: r.prfSecretHex,
      })
      router.reset()
    } catch {
      setError(
        t({
          id: 'unlock.passkey.fail',
          message: 'The passkey did not unlock the vault. Use your password.',
        }),
      )
    } finally {
      setBusy(false)
    }
  }

  const unlockWithBiometric = async (): Promise<void> => {
    if (!host.deviceKey) return
    setBioBusy(true)
    setError(null)
    try {
      const r = await host.deviceKey.read(
        t({ id: 'unlock.biometric.reason', message: 'Unlock BoltVault' }),
      )
      if (!r.ok) {
        /*
          Only a dismissal is silent. The other two used to be silent as well —
          they all arrived as the same `null` — which is how a phone whose
          sensor is not strong enough ended up with a button that did nothing
          and said nothing (ES-BV-072).
        */
        if (r.reason === 'cancelled') return
        setError(
          r.reason === 'unavailable'
            ? t({
                id: 'unlock.biometric.unavailable',
                message:
                  'This device can no longer open the vault with biometrics — enrolling a new fingerprint or face replaces the key. Use your password, then set it up again in Settings › Security.',
              })
            : t({
                id: 'unlock.biometric.fail',
                message: 'That did not unlock the vault. Use your password.',
              }),
        )
        return
      }
      await engine.vault.unlockWithDevice({ keyId: host.deviceKey.id, keyHex: r.keyHex })
      router.reset()
    } catch {
      setError(
        t({
          id: 'unlock.biometric.fail',
          message: 'That did not unlock the vault. Use your password.',
        }),
      )
    } finally {
      setBioBusy(false)
    }
  }

  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  return (
    <Column flex={1} testID="unlock">
      <Column
        flex={1}
        padding={inset}
        gap="$5"
        justifyContent="center"
        zIndex={1}
        position="relative"
        maxWidth={480}
        width="100%"
        alignSelf="center"
      >
        <Row gap="$2">
          <Icon name="lock" size={18} color={paint.mute} />
          <Body size="title">{t({ id: 'unlock.title', message: 'Unlock BoltVault' })}</Body>
        </Row>
        <Input
          value={password}
          onChange={setPassword}
          secure
          autoFocus
          placeholder={t({ id: 'unlock.ph', message: 'Password' })}
          onSubmit={unlock}
          error={error}
          sensitive
          testID="unlock-password"
        />
        <Key
          label={t({ id: 'unlock.key', message: 'Unlock' })}
          onPress={unlock}
          disabled={busy || !password}
          testID="unlock-submit"
        />
        {passkeyOk ? (
          <Key
            label={t({ id: 'unlock.passkey', message: 'Unlock with passkey' })}
            kind="secondary"
            onPress={unlockWithPasskey}
            disabled={busy}
            testID="unlock-passkey"
          />
        ) : null}
        {/*
          It is biometrics on both platforms now, so it says so (ES-BV-072).

          The Android label used to read "Unlock with your screen lock", on the
          premise that the keystore wrap took `AUTH_BIOMETRIC_STRONG or
          AUTH_DEVICE_CREDENTIAL` and the PIN would therefore release it. That
          has not been true since `readDeviceKey` started gating on
          `authenticateAsync({ disableDeviceFallback: true,
          biometricsSecurityLevel: 'strong' })` — the PIN is refused, and only a
          Class 3 biometric opens it. The old name promised a way in that the
          code declines, which is a poor thing to write on the one screen
          somebody reads when they cannot get into their wallet.

          `disabled` is `bioBusy`, never `busy`: whatever this key is doing, the
          password below it stays usable.
        */}
        {biometricOk ? (
          <Key
            label={t({ id: 'unlock.biometric', message: 'Unlock with biometrics' })}
            kind="secondary"
            onPress={unlockWithBiometric}
            disabled={bioBusy}
            testID="unlock-biometric"
          />
        ) : null}
        {/*
          A door, not a notice (ES-BV-073).

          This plate used to be the end of the road: "There is no reset.
          Restore from your recovery phrase on a fresh install instead" — true,
          but static text, on a screen with no other navigation, telling the
          user to do something the app gave them no way to do. On Android that
          means finding Clear data in system settings, and a beta tester did
          not: "im stuck here, it seems."

          The copy now says the same thing and offers the action, which is the
          only honest version of that sentence.
        */}
        <Plate gap="$2">
          <Body tone="mute" size="caption">
            {t({
              id: 'unlock.help.v2',
              message:
                'Forgot your password? There is no way to recover it — the password is what encrypts this wallet. You can erase it from this device and restore from your recovery phrase.',
            })}
          </Body>
          <Key
            label={t({ id: 'unlock.reset', message: 'Erase and start again' })}
            kind="secondary"
            size="compact"
            disabled={busy}
            onPress={() => setResetting(true)}
            testID="unlock-reset"
          />
        </Plate>
      </Column>
      {/*
        Whose wallet this is. Owner: "this is the flagship wallet from
        ElectroSwap, and there's very little ElectroSwap branding anywhere. I
        want you to feature the full ElectroSwap logo on the bottom center of
        the unlock screen." The lock screen is the one place the product is
        idle and looked at, so the full lock-up belongs here and nowhere it
        would compete with a number.
      */}
      <ConfirmSheet
        open={resetting}
        onClose={() => setResetting(false)}
        title={t({ id: 'unlock.reset.title', message: 'Erase this wallet?' })}
        body={t({
          id: 'unlock.reset.body',
          message:
            'This deletes the wallet, its accounts and its history from this device. Nothing else can undo it, and support cannot restore it. You will be able to get your funds back only if you have your recovery phrase — if you do not, they are gone for good.',
        })}
        confirmLabel={t({ id: 'unlock.reset.confirm', message: 'Erase wallet' })}
        onConfirm={() => void resetWallet()}
        testID="unlock-reset-confirm"
      />
      <Column alignItems="center" paddingBottom="$6" zIndex={1} testID="unlock-brand">
        <EsWordmark />
      </Column>
    </Column>
  )
}
