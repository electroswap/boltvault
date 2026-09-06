/**
 * The sheets behind the account rail (plan C2): the row menu, the technical
 * details, a confirm for anything destructive, rename, and the recovery
 * phrase reveal (password re-verified; secrets-allowed surfaces only).
 */
import { Body, Column, Icon, IconButton, Input, Key, Pressable, Row, Sheet, WordGrid, paint, shortAddress, type IconName } from '@boltvault/ui'
import type { AccountView, SeedView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../../engine/EngineProvider'
import { useHost } from '../../host'
import { t } from '../../i18n'
import { derivationLabel, kindLabel } from './AccountRow'

export interface MenuItem {
  readonly id: string
  readonly icon: IconName
  readonly label: string
  readonly tone?: 'ink' | 'burn'
  readonly onPress: () => void
  readonly testID?: string
}

export function MenuSheet({ open, onClose, title, items, reducedMotion = false, testID }: { open: boolean; onClose: () => void; title: string; items: readonly MenuItem[]; reducedMotion?: boolean; testID?: string }) {
  return (
    <Sheet open={open} onClose={onClose} title={title} reducedMotion={reducedMotion} testID={testID}>
      <Column gap={2}>
        {items.map((it) => (
          <Pressable key={it.id} onPress={it.onPress} accessibilityRole="button" accessibilityLabel={it.label} style={{ minHeight: 52, justifyContent: 'center' }} testID={it.testID}>
            <Row gap="$3" alignItems="center">
              <Icon name={it.icon} size={18} color={it.tone === 'burn' ? paint.burn : paint.mute} />
              <Body tone={it.tone === 'burn' ? 'burn' : 'ink'}>{it.label}</Body>
            </Row>
          </Pressable>
        ))}
      </Column>
    </Sheet>
  )
}

export function ConfirmSheet({ open, onClose, title, body, confirmLabel, onConfirm, danger = true, reducedMotion = false, testID }: { open: boolean; onClose: () => void; title: string; body: string; confirmLabel: string; onConfirm: () => void; danger?: boolean; reducedMotion?: boolean; testID?: string }) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      reducedMotion={reducedMotion}
      footer={
        <Row gap="$2">
          <Column flex={1}>
            <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" size="compact" onPress={onClose} testID="confirm-cancel" />
          </Column>
          <Column flex={1}>
            <Key label={confirmLabel} kind={danger ? 'danger' : 'primary'} size="compact" onPress={onConfirm} testID="confirm-ok" />
          </Column>
        </Row>
      }
      testID={testID}
    >
      <Body tone="mute">{body}</Body>
    </Sheet>
  )
}

export function RenameSheet({ open, onClose, title, value, onSave, reducedMotion = false, testID }: { open: boolean; onClose: () => void; title: string; value: string; onSave: (label: string) => Promise<void>; reducedMotion?: boolean; testID?: string }) {
  const [label, setLabel] = useState(value)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (open) setLabel(value)
  }, [open, value])
  const save = async (): Promise<void> => {
    const v = label.trim()
    if (!v) return
    setBusy(true)
    try {
      await onSave(v)
      onClose()
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={title} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'save', message: 'Save' })} size="compact" disabled={busy || !label.trim()} onPress={() => void save()} testID="rename-save" />} testID={testID}>
      <Input value={label} onChange={setLabel} autoFocus onSubmit={() => void save()} testID="rename-input" />
    </Sheet>
  )
}

export function AccountDetailsSheet({ open, onClose, account, seed, reducedMotion = false }: { open: boolean; onClose: () => void; account: AccountView | null; seed: SeedView | null; reducedMotion?: boolean }) {
  const host = useHost()
  const [copied, setCopied] = useState(false)
  if (!account) return null
  const rows: Array<{ label: string; value: string }> = [
    { label: t({ id: 'acct.details.type', message: 'Type' }), value: kindLabel(account) },
    ...(seed ? [{ label: t({ id: 'acct.details.wallet', message: 'Wallet' }), value: seed.label }] : []),
    ...(derivationLabel(account) ? [{ label: t({ id: 'acct.details.derivation', message: 'Derivation' }), value: derivationLabel(account) ?? '' }] : []),
    ...(account.hardware ? [{ label: t({ id: 'acct.details.path', message: 'Path' }), value: account.hardware.path }] : []),
    ...(account.hardware?.deviceId ? [{ label: t({ id: 'acct.details.device', message: 'Device' }), value: account.hardware.deviceId }] : []),
    { label: t({ id: 'acct.details.signs', message: 'Signs' }), value: account.hasKey ? t({ id: 'acct.details.signs.here', message: 'Here, with your password' }) : account.kind === 'watch' ? t({ id: 'acct.details.signs.no', message: 'Never — watch only' }) : t({ id: 'acct.details.signs.device', message: 'On the device' }) },
    { label: t({ id: 'acct.details.added', message: 'Added' }), value: new Date(account.createdAt).toLocaleDateString() },
  ]
  const copy = async (): Promise<void> => {
    if (!host.copy) return
    await host.copy(account.address)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }
  return (
    <Sheet open={open} onClose={onClose} title={account.label} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'close', message: 'Close' })} kind="secondary" size="compact" onPress={onClose} />} testID="account-details">
      <Column gap="$3">
        <Row gap="$2" alignItems="center">
          <Body size="caption" flexShrink={1} testID="account-details-address">
            {account.address}
          </Body>
          <IconButton icon={copied ? 'check' : 'copy'} label={t({ id: 'token.copyAddress', message: 'Copy address' })} active={copied} onPress={() => void copy()} testID="account-details-copy" />
        </Row>
        <Column gap={6}>
          {rows.map((r) => (
            <Row key={r.label} justifyContent="space-between" gap="$3" minHeight={22}>
              <Body tone="mute" size="caption">
                {r.label}
              </Body>
              <Body size="caption" textAlign="right" flexShrink={1}>
                {r.value}
              </Body>
            </Row>
          ))}
        </Column>
        <Body tone="mute" size="caption">
          {shortAddress(account.address)}
        </Body>
      </Column>
    </Sheet>
  )
}

export function RevealSheet({ open, onClose, seed, reducedMotion = false }: { open: boolean; onClose: () => void; seed: SeedView | null; reducedMotion?: boolean }) {
  const engine = useEngine()
  const [password, setPassword] = useState('')
  const [words, setWords] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) {
      setPassword('')
      setWords(null)
      setError(null)
    }
  }, [open])
  if (!seed) return null
  const reveal = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const r = await engine.vault.reveal({ seedId: seed.id, password })
      setWords(r.mnemonic.split(' '))
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title={t({ id: 'reveal.title', message: 'Recovery phrase · {label}', values: { label: seed.label } })} quiet reducedMotion={reducedMotion} footer={words ? <Key label={t({ id: 'reveal.hide', message: 'Hide' })} kind="secondary" size="compact" onPress={onClose} /> : <Key label={t({ id: 'reveal.key', message: 'Reveal' })} size="compact" disabled={busy || !password} onPress={() => void reveal()} testID="reveal-submit" />} testID="reveal">
      {words ? (
        <WordGrid words={words} />
      ) : (
        <Column gap="$2">
          <Body tone="mute">{t({ id: 'reveal.body', message: 'Enter your password. Make sure nobody can see your screen.' })}</Body>
          <Input value={password} onChange={setPassword} secure autoFocus onSubmit={() => void reveal()} testID="reveal-password" />
          {error ? <Body tone="burn">{error}</Body> : null}
        </Column>
      )}
    </Sheet>
  )
}
