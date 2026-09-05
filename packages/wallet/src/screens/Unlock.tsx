/**
 * Unlock — password, or a passkey when one is enrolled and available here.
 * Quiet custody mode; the Field ignites on success (Ignition on Home).
 */
import { Body, Column, Field, Icon, Input, Key, Plate, Row, metrics, paint, useWindowDimensions } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

export function Unlock({ body, reducedMotion = false }: { body: 'extension-popup' | 'extension-tab' | 'mobile'; reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { vault } = useWalletState()
  const { width, height } = useWindowDimensions()
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [passkeyOk, setPasskeyOk] = useState(false)
  const passkeyIds = (vault?.wraps ?? []).filter((w) => w.by === 'prf').map((w) => w.id)

  useEffect(() => {
    let alive = true
    if (passkeyIds.length && host.passkeys) host.passkeys.supported().then((ok) => alive && setPasskeyOk(ok), () => undefined)
    return () => {
      alive = false
    }
  }, [host.passkeys, passkeyIds.length])

  const unlock = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await engine.vault.unlock({ password })
      setPassword('')
      router.reset()
    } catch {
      setError(t({ id: 'unlock.wrong', message: 'That password does not open this vault.' }))
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
      await engine.vault.unlockWithPasskey({ credentialId: r.credentialId, prfSecretHex: r.prfSecretHex })
      router.reset()
    } catch {
      setError(t({ id: 'unlock.passkey.fail', message: 'The passkey did not unlock the vault. Use your password.' }))
    } finally {
      setBusy(false)
    }
  }

  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  return (
    <Column flex={1} backgroundColor="$void" testID="unlock">
      <Field address="0x0000000000000000000000000000000000000e7n" quiet width={width} height={height} reducedMotion={reducedMotion} />
      <Column flex={1} padding={inset} gap="$5" justifyContent="center" zIndex={1} position="relative" maxWidth={480} width="100%" alignSelf="center">
        <Row gap="$2">
          <Icon name="lock" size={18} color={paint.mute} />
          <Body size="title">{t({ id: 'unlock.title', message: 'Unlock BoltVault' })}</Body>
        </Row>
        <Input value={password} onChange={setPassword} secure autoFocus placeholder={t({ id: 'unlock.ph', message: 'Password' })} onSubmit={unlock} error={error} testID="unlock-password" />
        <Key label={t({ id: 'unlock.key', message: 'Unlock' })} onPress={unlock} disabled={busy || !password} testID="unlock-submit" />
        {passkeyOk ? <Key label={t({ id: 'unlock.passkey', message: 'Unlock with passkey' })} kind="secondary" onPress={unlockWithPasskey} disabled={busy} testID="unlock-passkey" /> : null}
        <Plate gap="$1">
          <Body tone="mute" size="caption">
            {t({ id: 'unlock.help', message: 'Forgot the password? There is no reset. Restore from your recovery phrase on a fresh install instead.' })}
          </Body>
        </Plate>
      </Column>
    </Column>
  )
}
