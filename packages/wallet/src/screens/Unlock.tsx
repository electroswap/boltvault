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
    setBusy(true)
    setError(null)
    try {
      const keyHex = await host.deviceKey.read(
        t({ id: 'unlock.biometric.reason', message: 'Unlock BoltVault' }),
      )
      // A cancelled prompt is not a failure worth shouting about; the password
      // field is right there.
      if (keyHex === null) return
      await engine.vault.unlockWithDevice({ keyId: host.deviceKey.id, keyHex })
      router.reset()
    } catch {
      setError(
        t({
          id: 'unlock.biometric.fail',
          message: 'That did not unlock the vault. Use your password.',
        }),
      )
    } finally {
      setBusy(false)
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
          Named for what it actually is on each platform (ES-BV-005).

          On Android the keystore wrap is bound to
          `AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL` with no
          invalidation on enrolment, so the screen-lock PIN releases it and a
          newly enrolled fingerprint opens it. Unlocking the wallet with the
          strength of the phone's own lock is a reasonable thing to offer;
          calling it "biometrics" when a PIN will do is not. Reveal and export
          are password-only there, and the large-send step-up does not take
          this factor at all.
        */}
        {biometricOk ? (
          <Key
            label={
              host.isAndroid
                ? t({ id: 'unlock.screenlock', message: 'Unlock with your screen lock' })
                : t({ id: 'unlock.biometric', message: 'Unlock with biometrics' })
            }
            kind="secondary"
            onPress={unlockWithBiometric}
            disabled={busy}
            testID="unlock-biometric"
          />
        ) : null}
        <Plate gap="$1">
          <Body tone="mute" size="caption">
            {t({
              id: 'unlock.help',
              message:
                'Forgot the password? There is no reset. Restore from your recovery phrase on a fresh install instead.',
            })}
          </Body>
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
      <Column alignItems="center" paddingBottom="$6" zIndex={1} testID="unlock-brand">
        <EsWordmark />
      </Column>
    </Column>
  )
}
