/**
 * Accounts (master plan §8.1): the rail of seats grouped by origin, add,
 * rename, hide, reveal (quiet, password), backup state per seed.
 */
import { Body, Column, Icon, Input, Key, Plate, Row, ScrollView, Signature, Toggle, WordGrid, metrics, paint, shortAddress } from '@boltvault/ui'
import type { AccountView, SeedView } from '@boltvault/engine'
import { useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

type Adding = null | 'derive' | 'seed' | 'imported' | 'watch' | 'hardware'

export function Accounts({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const { vault, accounts, active, refresh } = useWalletState()
  const [adding, setAdding] = useState<Adding>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [field, setField] = useState('')
  const [passphrase, setPassphrase] = useState('')
  const [revealFor, setRevealFor] = useState<SeedView | null>(null)
  const [revealPassword, setRevealPassword] = useState('')
  const [revealed, setRevealed] = useState<string[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const seeds = vault?.seeds ?? []

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const groups: Array<{ title: string; items: AccountView[]; seed?: SeedView }> = []
  for (const s of seeds) groups.push({ title: s.label, items: accounts.filter((a) => a.seedId === s.id), seed: s })
  const others = accounts.filter((a) => !a.seedId)
  if (others.some((a) => a.kind === 'imported')) groups.push({ title: t({ id: 'acct.imported', message: 'Imported keys' }), items: others.filter((a) => a.kind === 'imported') })
  if (others.some((a) => a.kind === 'ledger' || a.kind === 'trezor' || a.kind === 'keystone')) groups.push({ title: t({ id: 'acct.hardware', message: 'Hardware' }), items: others.filter((a) => a.kind === 'ledger' || a.kind === 'trezor' || a.kind === 'keystone') })
  if (others.some((a) => a.kind === 'watch')) groups.push({ title: t({ id: 'acct.watch', message: 'Watching' }), items: others.filter((a) => a.kind === 'watch') })

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 16 }} testID="accounts">
      <Row justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'accounts.title', message: 'Accounts' })}</Body>
      </Row>

      {groups.map((g) => (
        <Column key={g.title} gap="$2">
          <Row justifyContent="space-between">
            <Body tone="mute" size="caption">
              {g.title}
            </Body>
            {g.seed ? (
              <Row gap="$3">
                {g.seed.backedUp ? (
                  <Body tone="mute" size="caption">
                    {t({ id: 'acct.backedUp', message: 'Backed up' })}
                  </Body>
                ) : (
                  <Body tone="ember" size="caption" onPress={() => router.navigate('backup')} testID={`backup-${g.seed.id}`}>
                    {t({ id: 'acct.backup', message: 'Back up now' })}
                  </Body>
                )}
                {host.secretsAllowed ? (
                  <Body tone="mute" size="caption" onPress={() => { setRevealFor(g.seed ?? null); setRevealed(null); setRevealPassword('') }} testID={`reveal-${g.seed.id}`}>
                    {t({ id: 'acct.reveal', message: 'Reveal' })}
                  </Body>
                ) : null}
              </Row>
            ) : null}
          </Row>
          {g.items.map((a) => (
            <Plate key={a.id} role={a.id === active?.id ? 'raised' : 'recessed'} gap="$2" testID={`account-${a.id}`}>
              <Row gap="$3" justifyContent="space-between">
                <Row gap="$3" flexShrink={1}>
                  <Signature address={a.address} size={36} />
                  <Column flexShrink={1}>
                    {editing === a.id ? (
                      <Input value={label} onChange={setLabel} autoFocus onSubmit={() => run(async () => { await engine.accounts.rename({ id: a.id, label }); setEditing(null) })} testID={`rename-${a.id}`} />
                    ) : (
                      <Body size="title" numberOfLines={1} onPress={() => { setEditing(a.id); setLabel(a.label) }}>
                        {a.label}
                      </Body>
                    )}
                    <Body tone="mute" size="caption">
                      {shortAddress(a.address)} · {a.kind}
                      {a.hidden ? ` · ${t({ id: 'acct.hidden', message: 'hidden' })}` : ''}
                    </Body>
                  </Column>
                </Row>
                {a.id !== active?.id ? (
                  <Key label={t({ id: 'acct.use', message: 'Use' })} kind="secondary" onPress={() => run(async () => { await engine.accounts.setActive({ id: a.id }); router.back() })} testID={`use-${a.id}`} />
                ) : (
                  <Body tone="arc" size="caption">
                    {t({ id: 'acct.active', message: 'Active' })}
                  </Body>
                )}
              </Row>
              <Row gap="$4">
                <Body tone="mute" size="caption" onPress={() => run(() => engine.accounts.setHidden({ id: a.id, hidden: !a.hidden }).then(() => undefined))}>
                  {a.hidden ? t({ id: 'acct.show', message: 'Show' }) : t({ id: 'acct.hide', message: 'Hide' })}
                </Body>
                {a.kind !== 'hd' ? (
                  <Body tone="burn" size="caption" onPress={() => run(() => engine.accounts.remove({ id: a.id }))}>
                    {t({ id: 'acct.remove', message: 'Remove' })}
                  </Body>
                ) : null}
              </Row>
            </Plate>
          ))}
          {g.seed ? (
            <Body tone="arc" size="caption" onPress={() => run(() => engine.accounts.derive({ seedId: g.seed!.id }).then(() => undefined))} testID={`derive-${g.seed.id}`}>
              {t({ id: 'acct.derive', message: '+ Next account from this seed' })}
            </Body>
          ) : null}
        </Column>
      ))}

      <Plate gap="$3" testID="add-account">
        <Body size="title">{t({ id: 'acct.add', message: 'Add' })}</Body>
        <Row gap="$2" flexWrap="wrap">
          <Key label={t({ id: 'acct.add.seed', message: 'Seed' })} kind={adding === 'seed' ? 'primary' : 'secondary'} onPress={() => setAdding('seed')} />
          <Key label={t({ id: 'acct.add.key', message: 'Private key' })} kind={adding === 'imported' ? 'primary' : 'secondary'} onPress={() => setAdding('imported')} />
          <Key label={t({ id: 'acct.add.watch', message: 'Watch' })} kind={adding === 'watch' ? 'primary' : 'secondary'} onPress={() => setAdding('watch')} />
          <Key label={t({ id: 'acct.add.hardware', message: 'Hardware' })} kind={adding === 'hardware' ? 'primary' : 'secondary'} onPress={() => setAdding('hardware')} />
        </Row>
        {adding === 'seed' && host.secretsAllowed ? (
          <Column gap="$2">
            <Input value={field} onChange={setField} multiline mono placeholder={t({ id: 'ob.import.ph', message: '12 or 24 words, separated by spaces' })} />
            <Input value={passphrase} onChange={setPassphrase} secure label={t({ id: 'ob.passphrase', message: 'BIP-39 passphrase (optional, advanced)' })} />
            <Key label={t({ id: 'acct.add.seed.key', message: 'Add seed' })} disabled={busy} onPress={() => run(async () => { await engine.accounts.addSeed({ mnemonic: field, ...(passphrase ? { passphrase } : {}) }); setField(''); setAdding(null) })} />
          </Column>
        ) : null}
        {adding === 'seed' && !host.secretsAllowed ? <Key label={t({ id: 'acct.openTab', message: 'Continue in a full tab' })} onPress={() => host.openSecretScreen?.('accounts')} /> : null}
        {adding === 'imported' && host.secretsAllowed ? (
          <Column gap="$2">
            <Input value={field} onChange={setField} secure mono placeholder="0x…" />
            <Body tone="mute" size="caption">
              {t({ id: 'acct.add.key.note', message: 'This key is not part of any recovery phrase. Back it up separately.' })}
            </Body>
            <Key label={t({ id: 'acct.add.key.key', message: 'Import key' })} disabled={busy} onPress={() => run(async () => { await engine.accounts.addImported({ privateKey: field.trim() }); setField(''); setAdding(null) })} />
          </Column>
        ) : null}
        {adding === 'imported' && !host.secretsAllowed ? <Key label={t({ id: 'acct.openTab', message: 'Continue in a full tab' })} onPress={() => host.openSecretScreen?.('accounts')} /> : null}
        {adding === 'watch' ? (
          <Column gap="$2">
            <Input value={field} onChange={setField} mono placeholder="0x…" />
            <Key label={t({ id: 'acct.add.watch.key', message: 'Watch address' })} disabled={busy || !/^0x[0-9a-fA-F]{40}$/.test(field.trim())} onPress={() => run(async () => { await engine.accounts.addWatch({ address: field.trim() }); setField(''); setAdding(null) })} />
          </Column>
        ) : null}
        {adding === 'hardware' ? (
          <Body tone="mute" size="caption">
            {t({ id: 'acct.hardware.soon', message: 'Ledger over USB (extension) lands with M5; Ledger Bluetooth, Trezor and Keystone with M8. Until then you can watch the device address.' })}
          </Body>
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
      </Plate>

      {revealFor ? (
        <Plate role="raised" gap="$3" testID="reveal">
          <Row gap="$2">
            <Icon name="lock" size={18} color={paint.mute} />
            <Body size="title">{t({ id: 'reveal.title', message: 'Recovery phrase · {label}', values: { label: revealFor.label } })}</Body>
          </Row>
          {revealed ? (
            <>
              <WordGrid words={revealed} />
              <Key label={t({ id: 'reveal.hide', message: 'Hide' })} kind="secondary" onPress={() => { setRevealed(null); setRevealFor(null) }} />
            </>
          ) : (
            <>
              <Body tone="mute">{t({ id: 'reveal.body', message: 'Enter your password. Make sure nobody can see your screen.' })}</Body>
              <Input value={revealPassword} onChange={setRevealPassword} secure autoFocus testID="reveal-password" />
              <Row gap="$2">
                <Key label={t({ id: 'reveal.key', message: 'Reveal' })} disabled={busy || !revealPassword} onPress={() => run(async () => { const r = await engine.vault.reveal({ seedId: revealFor.id, password: revealPassword }); setRevealed(r.mnemonic.split(' ')); setRevealPassword('') })} testID="reveal-submit" />
                <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" onPress={() => setRevealFor(null)} />
              </Row>
            </>
          )}
        </Plate>
      ) : null}

      <Toggle value={false} onChange={() => undefined} label={t({ id: 'acct.sync.hint', message: 'Sync accounts to paired devices' })} hint={t({ id: 'acct.sync.hint.body', message: 'Watch and hardware accounts sync; seeds and keys never do. Pair in Settings › Devices.' })} disabled />
    </ScrollView>
  )
}
