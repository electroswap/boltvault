/** Settings › Security (master plan §8.14): password, auto-lock, passkeys, export. */
import { AnimatedQR, Body, Column, Icon, Input, Key, Plate, Row, ScrollView, metrics, paint } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AutoLock } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'
import { PASSKEY_USER_ID } from './Onboarding'
import { useSecretGuard } from './onboarding/useSecretGuard'
import { passwordStrength } from './onboarding/rules'

const AUTO_LOCKS: AutoLock[] = ['5min', '15min', '60min', 'never']

export function Security({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const { vault, refresh } = useWalletState()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const nextStrength = passwordStrength(next)
  const [exportPassword, setExportPassword] = useState('')
  const [exportCode, setExportCode] = useState('')
  const [frames, setFrames] = useState<string[] | null>(null)
  const [passkeysSupported, setPasskeysSupported] = useState(false)
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
    host.passkeys?.supported().then((ok) => alive && setPasskeysSupported(ok), () => undefined)
    return () => {
      alive = false
    }
  }, [host.passkeys])

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
    if (host.deviceKey) host.deviceKey.available().then((ok) => alive && setBiometricOk(ok), () => undefined)
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
          {t({ id: 'security.autolock.hint', message: 'Locks after this long without activity. Always locks when the browser closes.' })}
        </Body>
        <Row gap="$2" flexWrap="wrap">
          {AUTO_LOCKS.map((a) => (
            <Key key={a} label={a === '5min' ? t({ id: 'al.5', message: '5 min' }) : a === '15min' ? t({ id: 'al.15', message: '15 min' }) : a === '60min' ? t({ id: 'al.60', message: '1 hour' }) : t({ id: 'al.never', message: 'Never' })} kind={vault?.autoLock === a ? 'primary' : 'secondary'} size="compact" onPress={() => run(() => engine.vault.setAutoLock({ autoLock: a }).then(() => undefined))} testID={`autolock-${a}`} />
          ))}
        </Row>
      </Plate>

      <Plate gap="$3" testID="change-password">
        <Body size="title">{t({ id: 'security.password', message: 'Change password' })}</Body>
        <Input value={current} onChange={setCurrent} secure placeholder={t({ id: 'security.current', message: 'Current password' })} />
        {/*
          The same rule onboarding applies, from the same function.

          This was `next.length < 12`, so a password refused when creating a
          vault — twelve identical characters, say — was accepted when changing
          one. A second, weaker definition of "strong enough" is worse than no
          check, because it is the one an attacker gets to choose.
        */}
        <Input value={next} onChange={setNext} secure placeholder={t({ id: 'security.new', message: 'New password' })} hint={next ? nextStrength.label : null} />
        <Key label={t({ id: 'security.password.key', message: 'Change password' })} disabled={busy || !current || nextStrength.score === 0} onPress={() => run(async () => { await engine.vault.changePassword({ current, next }); setCurrent(''); setNext(''); setNote(t({ id: 'security.password.done', message: 'Password changed.' })) })} />
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
            message: 'Unlock with your face or fingerprint instead of typing your password. What gets stored is a key this device will only release once you have authenticated — never your password, and never your keys. The password keeps working, and is still required to reveal or export your phrase.',
          })}
        </Body>
        {passkeys.length === 0 && devices.length === 0 ? (
          <Body tone="mute" size="caption">
            {t({ id: 'security.quick.none', message: 'Nothing enrolled yet, so the password is the only way in.' })}
          </Body>
        ) : (
          <Column gap="$2">
            {passkeys.map((w) => (
              <Row key={w.id} justifyContent="space-between" alignItems="center">
                <Body tone="mute" size="caption">
                  {t({ id: 'security.quick.passkey', message: 'Passkey' })} · {w.id.slice(0, 8)}…
                </Body>
                <Body tone="burn" size="caption" onPress={() => run(() => engine.vault.removePasskey({ credentialId: w.id }).then(() => undefined))}>
                  {t({ id: 'remove', message: 'Remove' })}
                </Body>
              </Row>
            ))}
            {devices.map((w) => (
              <Row key={w.id} justifyContent="space-between" alignItems="center">
                <Body tone="mute" size="caption">
                  {t({ id: 'security.quick.device', message: 'Fingerprint or face on this device' })}
                </Body>
                <Body
                  tone="burn"
                  size="caption"
                  testID="quick-remove-device"
                  onPress={() =>
                    run(async () => {
                      if (!host.deviceKey) return
                      await engine.vault.removeDevice({ keyId: w.id })
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
                const r = await host.passkeys.create({ userName: 'BoltVault', userIdHex: PASSKEY_USER_ID, rpName: 'BoltVault' })
                await engine.vault.enrolPasskey({ credentialId: r.credentialId, prfSecretHex: r.prfSecretHex })
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
                  await engine.vault.enrolDevice({ keyId: host.deviceKey.id, keyHex })
                })
              }
            />
          ) : (
            <Body tone="mute" size="caption">
              {t({ id: 'security.biometrics.none', message: 'No fingerprint or face is enrolled on this device yet. Add one in the system settings, then come back.' })}
            </Body>
          )
        ) : null}
        {!passkeysSupported && !host.deviceKey ? (
          <Body tone="mute" size="caption">
            {t({ id: 'security.quick.unsupported', message: 'Neither passkeys nor a device keystore are available here.' })}
          </Body>
        ) : null}
      </Plate>

      {host.secretsAllowed ? (
        <Plate gap="$3" testID="export">
          <Body size="title">{t({ id: 'security.export', message: 'Move this vault to another device' })}</Body>
          <Body tone="mute" size="caption">
            {t({ id: 'security.export.body', message: 'An animated code the other device scans, sealed under a one-time phrase you type there. Your seeds never touch the internet.' })}
          </Body>
          {frames ? (
            <>
              {masked ? (
                <Column minHeight={168} alignItems="center" justifyContent="center" gap="$2" testID="export-masked">
                  <Icon name="eyeOff" size={20} color={paint.mute} />
                  <Body tone="mute" size="caption">
                    {t({ id: 'secret.masked', message: 'Hidden while this window is not in front' })}
                  </Body>
                </Column>
              ) : (
                <AnimatedQR frames={frames} />
              )}
              <Key label={t({ id: 'security.export.done', message: 'Done' })} kind="secondary" onPress={() => setFrames(null)} />
            </>
          ) : (
            <>
              <Input value={exportPassword} onChange={setExportPassword} secure placeholder={t({ id: 'security.current', message: 'Current password' })} />
              <Input value={exportCode} onChange={setExportCode} placeholder={t({ id: 'security.export.code', message: 'One-time phrase (3+ words)' })} hint={t({ id: 'security.export.hint', message: 'Type this on the other device. It is not shown there.' })} />
              <Key label={t({ id: 'security.export.key', message: 'Show export code' })} disabled={busy || !exportPassword || exportCode.trim().length < 8} onPress={() => run(async () => { const r = await engine.vault.export({ password: exportPassword, code: exportCode }); setFrames(r.frames); setExportPassword('') })} />
            </>
          )}
        </Plate>
      ) : (
        <Key label={t({ id: 'security.export.tab', message: 'Export vault (opens a full tab)' })} kind="secondary" onPress={() => host.openSecretScreen?.('security')} />
      )}

      {error ? <Body tone="burn">{error}</Body> : null}
      {note ? <Body tone="arc">{note}</Body> : null}
      <Column gap="$1">
        <Body tone="mute" size="caption">
          {t({ id: 'security.about', message: 'Encryption: Argon2id → XChaCha20-Poly1305, one data key per vault, wrapped per unlock factor.' })}
        </Body>
      </Column>
    </ScrollView>
  )
}
