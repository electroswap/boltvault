/** Settings › Security (master plan §8.14): password, auto-lock, passkeys, export. */
import { AnimatedQR, Body, Column, Input, Key, Plate, Row, ScrollView, metrics } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { AutoLock } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'

const AUTO_LOCKS: AutoLock[] = ['5min', '15min', '60min', 'never']

export function Security({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const { vault, refresh } = useWalletState()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [exportPassword, setExportPassword] = useState('')
  const [exportCode, setExportCode] = useState('')
  const [frames, setFrames] = useState<string[] | null>(null)
  const [passkeysSupported, setPasskeysSupported] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
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
        <Input value={next} onChange={setNext} secure placeholder={t({ id: 'security.new', message: 'New password (12+ characters)' })} />
        <Key label={t({ id: 'security.password.key', message: 'Change password' })} disabled={busy || !current || next.length < 12} onPress={() => run(async () => { await engine.vault.changePassword({ current, next }); setCurrent(''); setNext(''); setNote(t({ id: 'security.password.done', message: 'Password changed.' })) })} />
      </Plate>

      <Plate gap="$3" testID="passkeys">
        <Body size="title">{t({ id: 'security.passkeys', message: 'Passkeys' })}</Body>
        {passkeys.length === 0 ? (
          <Body tone="mute" size="caption">
            {t({ id: 'security.passkeys.none', message: 'No passkey enrolled. A passkey unlocks the vault with your face or fingerprint on this device; the password stays required for reveal and export.' })}
          </Body>
        ) : (
          passkeys.map((p) => (
            <Row key={p.id} justifyContent="space-between">
              <Body tone="mute" size="caption">
                {t({ id: 'security.passkey.row', message: 'Passkey' })} · {p.id.slice(0, 8)}…
              </Body>
              <Body tone="burn" size="caption" onPress={() => run(() => engine.vault.removePasskey({ credentialId: p.id }).then(() => undefined))}>
                {t({ id: 'remove', message: 'Remove' })}
              </Body>
            </Row>
          ))
        )}
        {passkeysSupported ? (
          <Key
            label={t({ id: 'security.passkeys.add', message: 'Add passkey' })}
            kind="secondary"
            disabled={busy}
            onPress={() =>
              run(async () => {
                if (!host.passkeys) return
                const r = await host.passkeys.create({ userName: 'BoltVault', userIdHex: '01', rpName: 'BoltVault' })
                await engine.vault.enrolPasskey({ credentialId: r.credentialId, prfSecretHex: r.prfSecretHex })
              })
            }
          />
        ) : (
          <Body tone="mute" size="caption">
            {t({ id: 'security.passkeys.unsupported', message: 'Passkeys with the PRF feature are not available in this browser or on this device.' })}
          </Body>
        )}
      </Plate>

      {host.deviceKey ? (
        <Plate gap="$3" testID="biometrics">
          <Body size="title">{t({ id: 'security.biometrics', message: 'Biometric unlock' })}</Body>
          <Body tone="mute" size="caption">
            {t({
              id: 'security.biometrics.body',
              message: 'Your face or fingerprint unlocks the vault on this device. What is stored in the keystore is a random device key — never your password and never your keys — so this adds a way in and takes none away. The password is still required to reveal or export the phrase.',
            })}
          </Body>
          {devices.length === 0 ? (
            biometricOk ? (
              <Key
                label={t({ id: 'security.biometrics.add', message: 'Turn on biometric unlock' })}
                kind="secondary"
                disabled={busy}
                testID="biometrics-add"
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
          ) : (
            <Key
              label={t({ id: 'security.biometrics.remove', message: 'Turn off biometric unlock' })}
              kind="secondary"
              disabled={busy}
              testID="biometrics-remove"
              onPress={() =>
                run(async () => {
                  if (!host.deviceKey) return
                  await engine.vault.removeDevice({ keyId: host.deviceKey.id })
                  await host.deviceKey.remove()
                })
              }
            />
          )}
        </Plate>
      ) : null}

      {host.secretsAllowed ? (
        <Plate gap="$3" testID="export">
          <Body size="title">{t({ id: 'security.export', message: 'Move this vault to another device' })}</Body>
          <Body tone="mute" size="caption">
            {t({ id: 'security.export.body', message: 'An animated code the other device scans, sealed under a one-time phrase you type there. Your seeds never touch the internet.' })}
          </Body>
          {frames ? (
            <>
              <AnimatedQR frames={frames} />
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
