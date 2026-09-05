/** Settings › Security (master plan §8.14): password, auto-lock, passkeys, export. */
import { AnimatedQR, Body, Column, Icon, Input, Key, Plate, Row, ScrollView, metrics, paint } from '@boltvault/ui'
import type { AutoLock } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

const AUTO_LOCKS: AutoLock[] = ['immediately', '1min', '5min', '30min', 'never']

export function Security({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
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

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 16 }} testID="security">
      <Row justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'security.title', message: 'Security' })}</Body>
      </Row>

      <Plate gap="$3" testID="autolock">
        <Body size="title">{t({ id: 'security.autolock', message: 'Auto-lock' })}</Body>
        <Row gap="$2" flexWrap="wrap">
          {AUTO_LOCKS.map((a) => (
            <Key key={a} label={a === 'immediately' ? t({ id: 'al.now', message: 'On close' }) : a === 'never' ? t({ id: 'al.never', message: 'Never' }) : a} kind={vault?.autoLock === a ? 'primary' : 'secondary'} onPress={() => run(() => engine.vault.setAutoLock({ autoLock: a }).then(() => undefined))} testID={`autolock-${a}`} />
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
