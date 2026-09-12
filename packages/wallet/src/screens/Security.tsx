/** Settings › Security (master plan §8.14): password, auto-lock, passkeys, export. */
import {
  AnimatedQR,
  Body,
  Column,
  Icon,
  Input,
  Key,
  Plate,
  Row,
  ScrollView,
  Toggle,
  metrics,
  paint,
} from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AutoLock, Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'
import { PASSKEY_USER_ID } from './Onboarding'
import { useSecretGuard } from './onboarding/useSecretGuard'
import { passwordStrength } from './onboarding/rules'

/*
  What this body offers (ES-BV-041).

  `background` locks the moment the app leaves the foreground, which is the
  only setting that helps an unattended phone — the others are timers, and a
  phone put down on a table is unattended from the second it is put down. And
  `never` keeps the key in process memory for as long as the app lives, which
  on a phone is days: it is not offered there at all.
*/
const AUTO_LOCKS_MOBILE: AutoLock[] = ['background', '5min', '15min', '60min']
const AUTO_LOCKS_EXTENSION: AutoLock[] = ['5min', '15min', '60min', 'never']

export function Security({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const { vault, refresh } = useWalletState()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const nextStrength = passwordStrength(next)
  const [exportPassword, setExportPassword] = useState('')
  // Adding or removing an unlock factor is a change to who can open the vault,
  // so it costs the password — not merely an unlocked wallet.
  const [quickPassword, setQuickPassword] = useState('')
  const [exportCode, setExportCode] = useState('')
  const [frames, setFrames] = useState<string[] | null>(null)
  const [passkeysSupported, setPasskeysSupported] = useState(false)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  /*
    The export envelope holds every seed, passphrase and imported key in this
    vault. It is the same secret the recovery-phrase screens show, so it gets
    the same treatment: screenshots blocked while it is up, masked whenever
    this surface is not in front.
  */
  const { masked } = useSecretGuard(frames !== null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    let alive = true
    host.passkeys?.supported().then(
      (ok) => alive && setPasskeysSupported(ok),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [host.passkeys])

  useEffect(() => {
    engine.settings.get().then(setSettings, () => undefined)
  }, [engine])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      await fn()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const passkeys = (vault?.wraps ?? []).filter((w) => w.by === 'prf')
  // Device wraps were returned by the engine all along; no screen read them.
  const devices = (vault?.wraps ?? []).filter((w) => w.by === 'device')
  const [biometricOk, setBiometricOk] = useState(false)
  useEffect(() => {
    let alive = true
    if (host.deviceKey)
      host.deviceKey.available().then(
        (ok) => alive && setBiometricOk(ok),
        () => undefined,
      )
    return () => {
      alive = false
    }
  }, [host.deviceKey])

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 16 }} testID="security">
      <PageHeader title={t({ id: 'security.title', message: 'Security' })} />

      <Plate gap="$3" testID="autolock">
        <Body size="title">{t({ id: 'security.autolock', message: 'Auto-lock' })}</Body>
        <Body tone="mute" size="caption">
          {t({
            id: 'security.autolock.hint',
            message:
              'Locks after this long without activity. Always locks when the browser closes.',
          })}
        </Body>
        <Row gap="$2" flexWrap="wrap">
          {(body === 'mobile' ? AUTO_LOCKS_MOBILE : AUTO_LOCKS_EXTENSION).map((a) => (
            <Key
              key={a}
              label={
                a === 'background'
                  ? t({ id: 'al.background', message: 'On leaving' })
                  : a === '5min'
                    ? t({ id: 'al.5', message: '5 min' })
                    : a === '15min'
                      ? t({ id: 'al.15', message: '15 min' })
                      : a === '60min'
                        ? t({ id: 'al.60', message: '1 hour' })
                        : t({ id: 'al.never', message: 'Never' })
              }
              kind={vault?.autoLock === a ? 'primary' : 'secondary'}
              size="compact"
              onPress={() =>
                run(() => engine.vault.setAutoLock({ autoLock: a }).then(() => undefined))
              }
              testID={`autolock-${a}`}
            />
          ))}
        </Row>
      </Plate>

      <Plate gap="$3" testID="change-password">
        <Body size="title">{t({ id: 'security.password', message: 'Change password' })}</Body>
        <Input
          value={current}
          onChange={setCurrent}
          secure
          sensitive
          placeholder={t({ id: 'security.current', message: 'Current password' })}
        />
        {/*
          The same rule onboarding applies, from the same function.

          This was `next.length < 12`, so a password refused when creating a
          vault — twelve identical characters, say — was accepted when changing
          one. A second, weaker definition of "strong enough" is worse than no
          check, because it is the one an attacker gets to choose.
        */}
        <Input
          value={next}
          onChange={setNext}
          secure
          sensitive
          placeholder={t({ id: 'security.new', message: 'New password' })}
          hint={next ? nextStrength.label : null}
        />
        <Key
          label={t({ id: 'security.password.key', message: 'Change password' })}
          disabled={busy || !current || nextStrength.score === 0}
          onPress={() =>
            run(async () => {
              await engine.vault.changePassword({ current, next })
              setCurrent('')
              setNext('')
              setNote(t({ id: 'security.password.done', message: 'Password changed.' }))
            })
          }
        />
      </Plate>

      {/*
        One plate, not two. Owner: "Security settings has both passkeys and
        biometric unlock sections now and they should probably be merged."
        They are the same idea — a second way past the password — and which of
        them a body can offer is a detail of that body: the browser has
        passkeys, the phone has the OS keystore. The vault already treats them
        identically, as two more wraps of the one DEK, so the screen should
        too.
      */}
      <Plate gap="$3" testID="quick-unlock">
        <Body size="title">{t({ id: 'security.quick', message: 'Quick unlock' })}</Body>
        <Body tone="mute" size="caption">
          {t({
            id: 'security.quick.body',
            message:
              'Unlock with your face or fingerprint instead of typing your password. What gets stored is a key this device will only release once you have authenticated — never your password, and never your keys. The password keeps working, and is still required to reveal or export your phrase.',
          })}
        </Body>
        <Input
          value={quickPassword}
          onChange={setQuickPassword}
          secure
          placeholder={t({ id: 'security.current', message: 'Current password' })}
          hint={t({
            id: 'security.quick.why',
            message: 'Required to add or remove a way into this vault.',
          })}
          sensitive
          testID="quick-password"
        />
        {passkeys.length === 0 && devices.length === 0 ? (
          <Body tone="mute" size="caption">
            {t({
              id: 'security.quick.none',
              message: 'Nothing enrolled yet, so the password is the only way in.',
            })}
          </Body>
        ) : (
          <Column gap="$2">
            {passkeys.map((w) => (
              <Row key={w.id} justifyContent="space-between" alignItems="center">
                <Body tone="mute" size="caption">
                  {t({ id: 'security.quick.passkey', message: 'Passkey' })} · {w.id.slice(0, 8)}…
                </Body>
                <Body
                  tone="burn"
                  size="caption"
                  onPress={() =>
                    run(() =>
                      engine.vault
                        .removePasskey({ credentialId: w.id, password: quickPassword })
                        .then(() => undefined),
                    )
                  }
                >
                  {t({ id: 'remove', message: 'Remove' })}
                </Body>
              </Row>
            ))}
            {devices.map((w) => (
              <Row key={w.id} justifyContent="space-between" alignItems="center">
                <Body tone="mute" size="caption">
                  {t({
                    id: 'security.quick.device',
                    message: 'Fingerprint or face on this device',
                  })}
                </Body>
                <Body
                  tone="burn"
                  size="caption"
                  testID="quick-remove-device"
                  onPress={() =>
                    run(async () => {
                      if (!host.deviceKey) return
                      await engine.vault.removeDevice({ keyId: w.id, password: quickPassword })
                      await host.deviceKey.remove()
                    })
                  }
                >
                  {t({ id: 'remove', message: 'Remove' })}
                </Body>
              </Row>
            ))}
          </Column>
        )}
        {passkeysSupported ? (
          <Key
            label={t({ id: 'security.passkeys.add', message: 'Add passkey' })}
            kind="secondary"
            disabled={busy}
            testID="quick-add-passkey"
            onPress={() =>
              run(async () => {
                if (!host.passkeys) return
                // The same handle onboarding enrols with: "one vault, one user
                // handle, re-enrolling replaces the credential" only holds if
                // both places agree. This used to be '01' and did not.
                const r = await host.passkeys.create({
                  userName: 'BoltVault',
                  userIdHex: PASSKEY_USER_ID,
                  rpName: 'BoltVault',
                })
                await engine.vault.enrolPasskey({
                  credentialId: r.credentialId,
                  prfSecretHex: r.prfSecretHex,
                  password: quickPassword,
                })
              })
            }
          />
        ) : null}
        {host.deviceKey && devices.length === 0 ? (
          biometricOk ? (
            <Key
              label={t({ id: 'security.biometrics.add', message: 'Turn on biometric unlock' })}
              kind="secondary"
              disabled={busy}
              testID="quick-add-device"
              onPress={() =>
                run(async () => {
                  if (!host.deviceKey) return
                  const keyHex = await host.deviceKey.ensure()
                  await engine.vault.enrolDevice({
                    keyId: host.deviceKey.id,
                    keyHex,
                    password: quickPassword,
                  })
                })
              }
            />
          ) : (
            <Body tone="mute" size="caption">
              {t({
                id: 'security.biometrics.none',
                message:
                  'No fingerprint or face is enrolled on this device yet. Add one in the system settings, then come back.',
              })}
            </Body>
          )
        ) : null}
        {!passkeysSupported && !host.deviceKey ? (
          <Body tone="mute" size="caption">
            {t({
              id: 'security.quick.unsupported',
              message: 'Neither passkeys nor a device keystore are available here.',
            })}
          </Body>
        ) : null}
      </Plate>

      {/*
        The phrase is the whole wallet, for ever, on any device — and `reveal`
        used to accept any enrolled factor, so a household member who could
        pass a registered fingerprint could open Accounts → Back up and read
        the words, while this screen told the user the password was still
        required. Code and copy agree now, and the switch is here because a
        wallet set up behind a passkey may have a password nobody has typed in
        months, and locking somebody out of their own phrase is its own loss.
      */}
      <Plate gap="$2" testID="reveal-password">
        {/*
          Not switchable on Android (ES-BV-005).

          `react-native-keychain` creates the Android wrap key with
          `AUTH_BIOMETRIC_STRONG or AUTH_DEVICE_CREDENTIAL` and a five-second
          validity window, and never calls
          `setInvalidatedByBiometricEnrollment` — so the device PIN releases
          it, it stays usable for five seconds after any strong
          authentication, and it survives somebody enrolling their own
          fingerprint (which on Android needs only the PIN). It is a
          PIN-strength factor wearing a biometric label, and PIN strength is
          not enough to reveal a recovery phrase.
        */}
        {host.body === 'mobile' && host.isAndroid ? (
          <Body tone="mute" size="caption" testID="reveal-password-android">
            {t({
              id: 'security.reveal.android',
              message: 'Your password is always required to show a recovery phrase on Android: the device keystore there can be released by the screen-lock PIN, and survives a new fingerprint being added.',
            })}
          </Body>
        ) : null}
        <Toggle
          disabled={host.body === 'mobile' && host.isAndroid === true}
          value={host.body === 'mobile' && host.isAndroid ? true : (settings?.revealNeedsPassword ?? true)}
          onChange={(v) =>
            engine.settings.set({ revealNeedsPassword: v }).then(setSettings, () => undefined)
          }
          label={t({
            id: 'security.reveal',
            message: 'Require your password to show a recovery phrase',
          })}
          hint={t({
            id: 'security.reveal.hint',
            message:
              'On. Your face or fingerprint unlocks the wallet on this device; the phrase opens it on any device, for ever, so it costs the password. Turn this off only if you would rather use a device factor for that too.',
          })}
          testID="reveal-password-toggle"
        />
      </Plate>

      {/*
        `eth_sign` is the one signature whose contents nobody can read: a raw
        32-byte hash, which may be a transaction that empties the account. The
        engine refuses it by default and its refusal names this screen, so the
        switch has to be here — and it has to say what it hands over, because
        "legacy signing method" tells a person nothing about what they are
        agreeing to.
      */}
      <Plate gap="$2" testID="eth-sign">
        <Toggle
          value={settings?.ethSignEnabled ?? false}
          onChange={(v) =>
            engine.settings.set({ ethSignEnabled: v }).then(setSettings, () => undefined)
          }
          label={t({ id: 'security.ethsign', message: 'Allow raw hash signatures (eth_sign)' })}
          hint={t({
            id: 'security.ethsign.hint',
            message:
              'Off. A site asking for one asks you to sign 32 bytes nobody can read back — it may be a transaction that moves everything you hold, and BoltVault cannot tell you which. Turn it on only for a site you trust that will not work otherwise, and turn it off again afterwards.',
          })}
          testID="eth-sign-toggle"
        />
        {settings?.ethSignEnabled ? (
          <Body tone="burn" size="caption" testID="eth-sign-on">
            {t({
              id: 'security.ethsign.on',
              message:
                'On. Every eth_sign request still opens the full sheet with the hash shown, and it is still the most dangerous thing this wallet will do.',
            })}
          </Body>
        ) : null}
      </Plate>

      {host.secretsAllowed ? (
        <Plate gap="$3" testID="export">
          <Body size="title">
            {t({ id: 'security.export', message: 'Move this vault to another device' })}
          </Body>
          <Body tone="mute" size="caption">
            {t({
              id: 'security.export.body',
              message:
                'An animated code the other device scans, sealed under a one-time phrase you type there. Your seeds never touch the internet.',
            })}
          </Body>
          {frames ? (
            <>
              {masked ? (
                <Column
                  minHeight={168}
                  alignItems="center"
                  justifyContent="center"
                  gap="$2"
                  testID="export-masked"
                >
                  <Icon name="eyeOff" size={20} color={paint.mute} />
                  <Body tone="mute" size="caption">
                    {t({
                      id: 'secret.masked',
                      message: 'Hidden while this window is not in front',
                    })}
                  </Body>
                </Column>
              ) : (
                <AnimatedQR frames={frames} />
              )}
              {/*
                The phrase is generated, not invented: this envelope holds every
                seed and key in the vault and is shown as a QR, so the phrase is
                the whole of the protection. Six BIP-39 words is still typeable
                on the other device and out of reach of an offline search.
              */}
              <Body size="caption" tone="mute">
                {t({
                  id: 'security.export.phrase',
                  message: 'Type this phrase on the other device:',
                })}
              </Body>
              <Body selectable testID="export-code">
                {exportCode}
              </Body>
              <Key
                label={t({ id: 'security.export.done', message: 'Done' })}
                kind="secondary"
                onPress={() => {
                  setFrames(null)
                  setExportCode('')
                }}
              />
            </>
          ) : (
            <>
              <Input
                value={exportPassword}
                onChange={setExportPassword}
                secure
                sensitive
                placeholder={t({ id: 'security.current', message: 'Current password' })}
              />
              <Key
                label={t({ id: 'security.export.key', message: 'Show export code' })}
                disabled={busy || !exportPassword}
                onPress={() =>
                  run(async () => {
                    const r = await engine.vault.export({ password: exportPassword })
                    setFrames(r.frames)
                    setExportCode(r.code)
                    setExportPassword('')
                  })
                }
              />
            </>
          )}
        </Plate>
      ) : (
        <Key
          label={t({ id: 'security.export.tab', message: 'Export vault (opens a full tab)' })}
          kind="secondary"
          onPress={() => host.openSecretScreen?.('security')}
        />
      )}

      {error ? <Body tone="burn">{error}</Body> : null}
      {note ? <Body tone="arc">{note}</Body> : null}
      <Column gap="$1">
        <Body tone="mute" size="caption">
          {t({
            id: 'security.about',
            message:
              'Encryption: Argon2id → XChaCha20-Poly1305, one data key per vault, wrapped per unlock factor.',
          })}
        </Body>
      </Column>
    </ScrollView>
  )
}
