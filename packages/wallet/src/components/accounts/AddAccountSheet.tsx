/**
 * Add an account (plan C2): four ways, each a row that expands in place —
 * a recovery phrase, a private key (both only where secrets may render),
 * an address to watch, a hardware wallet with its picker.
 */
import { Body, Column, Icon, Input, Key, Pill, Pressable, Row, Sheet, paint, type IconName } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../../engine/EngineProvider'
import { useHost } from '../../host'
import { useOpenInTab } from '../../hooks/useOpenInTab'
import { t } from '../../i18n'
import { KeystonePicker, LedgerPicker, TrezorPicker } from '../HardwarePickers'

type Way = 'seed' | 'imported' | 'watch' | 'hardware'
type HwKind = 'ledger' | 'trezor' | 'keystone'

export function AddAccountSheet({ open, onClose, onAdded, reducedMotion = false }: { open: boolean; onClose: () => void; onAdded: () => void; reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const openInTab = useOpenInTab()
  const [way, setWay] = useState<Way | null>(null)
  const [hwKind, setHwKind] = useState<HwKind>('ledger')
  const [field, setField] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    if (!open) {
      setWay(null)
      setField('')
      setPassphrase('')
      setError(null)
    }
  }, [open])

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onAdded()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  const continueInTab = (): void => {
    if (openInTab) openInTab({ screen: 'accounts' })
    else host.openSecretScreen?.('accounts')
  }
  const ways: Array<{ id: Way; icon: IconName; title: string; body: string }> = [
    { id: 'seed', icon: 'key', title: t({ id: 'acct.add.seed.title', message: 'Recovery phrase' }), body: t({ id: 'acct.add.seed.body', message: '12 or 24 words from another wallet' }) },
    { id: 'imported', icon: 'lock', title: t({ id: 'acct.add.key.title', message: 'Private key' }), body: t({ id: 'acct.add.key.body', message: 'One address, backed up on its own' }) },
    { id: 'watch', icon: 'eye', title: t({ id: 'acct.add.watch.title', message: 'Watch an address' }), body: t({ id: 'acct.add.watch.body', message: 'Balances and activity, no signing' }) },
    { id: 'hardware', icon: 'hardware', title: t({ id: 'acct.add.hardware.title', message: 'Hardware wallet' }), body: t({ id: 'acct.add.hardware.body', message: 'Ledger, Trezor or Keystone' }) },
  ]
  const gated = (way === 'seed' || way === 'imported') && !host.secretsAllowed

  return (
    <Sheet open={open} onClose={onClose} title={t({ id: 'acct.add.title', message: 'Add an account' })} reducedMotion={reducedMotion} testID="add-account">
      <Column gap="$2">
        {ways.map((w) => {
          const on = way === w.id
          return (
            <Column key={w.id} gap="$2">
              <Pressable onPress={() => setWay(on ? null : w.id)} accessibilityRole="button" accessibilityState={{ expanded: on }} accessibilityLabel={w.title} style={{ minHeight: 56, justifyContent: 'center' }} testID={`add-${w.id}`}>
                <Row gap="$3" alignItems="center">
                  <Row width={36} height={36} borderRadius={18} backgroundColor="$glassRaised" alignItems="center" justifyContent="center">
                    <Icon name={w.icon} size={18} color={on ? paint.arc : paint.mute} />
                  </Row>
                  <Column flex={1}>
                    <Body fontWeight="600">{w.title}</Body>
                    <Body tone="mute" size="caption">
                      {w.body}
                    </Body>
                  </Column>
                  <Icon name={on ? 'chevronUp' : 'chevronDown'} size={16} color={paint.mute} />
                </Row>
              </Pressable>
              {on && gated ? (
                <Column gap="$2" paddingLeft={48}>
                  <Body tone="mute" size="caption">
                    {t({ id: 'acct.add.gated', message: 'Secrets are typed in a full tab, never in this window.' })}
                  </Body>
                  <Key label={t({ id: 'acct.openTab', message: 'Continue in a full tab' })} size="compact" onPress={continueInTab} testID="add-open-tab" />
                </Column>
              ) : null}
              {on && !gated && w.id === 'seed' ? (
                <Column gap="$2" paddingLeft={48}>
                  <Input value={field} onChange={setField} multiline placeholder={t({ id: 'ob.import.ph', message: '12 or 24 words, separated by spaces' })} testID="add-seed-words" />
                  <Input value={passphrase} onChange={setPassphrase} secure label={t({ id: 'ob.passphrase', message: 'BIP-39 passphrase (optional, advanced)' })} />
                  <Key label={t({ id: 'acct.add.seed.key', message: 'Add recovery phrase' })} size="compact" disabled={busy || !field.trim()} onPress={() => void run(async () => { await engine.accounts.addSeed({ mnemonic: field, ...(passphrase ? { passphrase } : {}) }) })} testID="add-seed-submit" />
                </Column>
              ) : null}
              {on && !gated && w.id === 'imported' ? (
                <Column gap="$2" paddingLeft={48}>
                  <Input value={field} onChange={setField} secure placeholder="0x…" testID="add-key-input" />
                  <Body tone="mute" size="caption">
                    {t({ id: 'acct.add.key.note', message: 'This key is not part of any recovery phrase. Back it up separately.' })}
                  </Body>
                  <Key label={t({ id: 'acct.add.key.key', message: 'Import key' })} size="compact" disabled={busy || !field.trim()} onPress={() => void run(async () => { await engine.accounts.addImported({ privateKey: field.trim() }) })} testID="add-key-submit" />
                </Column>
              ) : null}
              {on && w.id === 'watch' ? (
                <Column gap="$2" paddingLeft={48}>
                  <Input value={field} onChange={setField} placeholder="0x…" testID="add-watch-input" />
                  <Key label={t({ id: 'acct.add.watch.key', message: 'Watch this address' })} size="compact" disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(field.trim())} onPress={() => void run(async () => { await engine.accounts.addWatch({ address: field.trim() }) })} testID="add-watch-submit" />
                </Column>
              ) : null}
              {on && w.id === 'hardware' ? (
                <Column gap="$3" paddingLeft={48}>
                  <Row gap="$2" flexWrap="wrap" testID="hardware-kinds">
                    {(['ledger', 'trezor', 'keystone'] as const).map((k) => (
                      <Pill key={k} label={k === 'ledger' ? 'Ledger' : k === 'trezor' ? 'Trezor' : 'Keystone'} selected={hwKind === k} size="sm" onPress={() => setHwKind(k)} testID={`hardware-kind-${k}`} />
                    ))}
                  </Row>
                  {hwKind === 'ledger' ? <LedgerPicker onAdded={onAdded} reducedMotion={reducedMotion} /> : hwKind === 'trezor' ? <TrezorPicker onAdded={onAdded} reducedMotion={reducedMotion} /> : <KeystonePicker onAdded={onAdded} reducedMotion={reducedMotion} />}
                </Column>
              ) : null}
            </Column>
          )
        })}
        {error ? <Body tone="burn">{error}</Body> : null}
      </Column>
    </Sheet>
  )
}
