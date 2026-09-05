/**
 * Accounts (master plan §8.1): the rail of seats grouped by origin, add,
 * rename, hide, reveal (quiet, password), backup state per seed.
 */
import { Body, Column, Icon, Input, Key, Plate, Row, ScrollView, Signature, Toggle, WordGrid, metrics, paint, shortAddress, Chip } from '@boltvault/ui'
import type { AccountView, SeedView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { KeystonePicker, TrezorPicker } from '../components/HardwarePickers'
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
  const [hwKind, setHwKind] = useState<'ledger' | 'trezor' | 'keystone'>('ledger')
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
          <Column gap="$3">
            <Row gap="$2" flexWrap="wrap" testID="hardware-kinds">
              {(['ledger', 'trezor', 'keystone'] as const).map((k) => (
                <Chip key={k} onPress={() => setHwKind(k)} cursor="pointer" minHeight={36} justifyContent="center" borderColor={hwKind === k ? paint.arc : undefined} testID={`hardware-kind-${k}`}>
                  <Body tone={hwKind === k ? 'arc' : 'mute'} size="caption">
                    {k === 'ledger' ? 'Ledger' : k === 'trezor' ? 'Trezor' : 'Keystone'}
                  </Body>
                </Chip>
              ))}
            </Row>
            {hwKind === 'ledger' ? <LedgerPicker onAdded={() => setAdding(null)} /> : hwKind === 'trezor' ? <TrezorPicker onAdded={() => setAdding(null)} /> : <KeystonePicker onAdded={() => setAdding(null)} />}
          </Column>
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

/** Pair a Ledger over USB and pick addresses from both derivation schemes (§8.1). */
function LedgerPicker({ onAdded }: { onAdded: () => void }) {
  const engine = useEngine()
  const host = useHost()
  const [status, setStatus] = useState<Awaited<ReturnType<typeof engine.hardware.ledgerStatus>> | null>(null)
  const [rows, setRows] = useState<Array<{ scheme: 'bip44' | 'live'; path: string; address: string; index: number }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const st = await engine.hardware.ledgerStatus()
      setStatus(st)
      if (st.devices.length > 0 && st.app) {
        const [a, b] = await Promise.all([engine.hardware.ledgerAddresses({ scheme: 'bip44', count: 5 }), engine.hardware.ledgerAddresses({ scheme: 'live', count: 5 })])
        setRows([...a.map((x) => ({ ...x, scheme: 'bip44' as const })), ...b.map((x) => ({ ...x, scheme: 'live' as const }))])
      } else {
        setRows([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const pair = async (): Promise<void> => {
    if (!host.requestHid) return
    setError(null)
    try {
      const ok = await host.requestHid()
      if (!ok) setError(t({ id: 'ledger.nopick', message: 'No device was chosen.' }))
      await refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const add = async (row: { scheme: 'bip44' | 'live'; path: string; address: string; index: number }): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await engine.accounts.addHardware({ kind: 'ledger', address: row.address, path: row.path, ...(status?.devices[0] ? { deviceId: status.devices[0].deviceId } : {}), label: `Ledger ${row.scheme === 'live' ? 'Live' : 'BIP-44'} #${row.index}` })
      setAdded((xs) => [...xs, row.address.toLowerCase()])
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  if (status && !status.available) {
    return (
      <Column gap="$2" testID="ledger-unavailable">
        <Body tone="mute" size="caption">
          {t({ id: 'ledger.unavailable', message: 'Ledger over USB works from the full tab in Chrome, and over Bluetooth on the phone. In this window you can watch its address, or sign on a paired device.' })}
        </Body>
        {host.openSecretScreen && host.body !== 'extension-tab' ? <Key label={t({ id: 'acct.openTab', message: 'Continue in a full tab' })} onPress={() => host.openSecretScreen?.('accounts')} /> : null}
      </Column>
    )
  }
  return (
    <Column gap="$3" testID="ledger-picker">
      <Body tone="mute" size="caption">
        {t({ id: 'ledger.body', message: 'Plug in your Ledger, unlock it and open the Ethereum app. Your keys never leave the device; BoltVault only shows you what it will sign.' })}
      </Body>
      <Row gap="$2" flexWrap="wrap">
        {host.requestHid ? <Key label={t({ id: 'ledger.pair', message: 'Pair Ledger' })} kind="secondary" disabled={busy} onPress={() => void pair()} testID="ledger-pair" /> : null}
        <Key label={t({ id: 'ledger.refresh', message: 'Refresh' })} kind="secondary" disabled={busy} onPress={() => void refresh()} testID="ledger-refresh" />
      </Row>
      {status?.devices[0] ? (
        <Body size="caption" tone={status.app ? 'arc' : 'ember'} testID="ledger-status">
          {status.app ? t({ id: 'ledger.ready', message: '{m} · Ethereum app {v}{b}', values: { m: status.devices[0].model, v: status.app.version, b: status.app.blindSigning ? '' : ' · blind signing off' } }) : (status.problem ?? t({ id: 'ledger.openapp', message: 'Open the Ethereum app on the device.' }))}
        </Body>
      ) : status ? (
        <Body tone="mute" size="caption">
          {t({ id: 'ledger.none', message: 'No Ledger paired yet.' })}
        </Body>
      ) : null}
      {status?.app && !status.app.blindSigning ? (
        <Body tone="ember" size="caption">
          {t({ id: 'ledger.blind', message: 'Swaps and contract calls need blind signing: Ethereum app › Settings › Blind signing on the device. Plain sends work without it.' })}
        </Body>
      ) : null}
      {(['bip44', 'live'] as const).map((scheme) => {
        const list = rows.filter((r) => r.scheme === scheme)
        if (list.length === 0) return null
        return (
          <Column key={scheme} gap="$1" testID={`ledger-${scheme}`}>
            <Body size="caption">{scheme === 'bip44' ? t({ id: 'ledger.bip44', message: 'BIP-44 (MetaMask, most wallets)' }) : t({ id: 'ledger.live', message: 'Ledger Live' })}</Body>
            {list.map((r) => (
              <Row key={r.path} justifyContent="space-between" alignItems="center" minHeight={44}>
                <Body tone="mute" size="caption" fontFamily="$mono">
                  {shortAddress(r.address)} · {r.path}
                </Body>
                <Key label={added.includes(r.address.toLowerCase()) ? t({ id: 'ledger.added', message: 'Added' }) : t({ id: 'ledger.add', message: 'Add' })} kind="secondary" disabled={busy || added.includes(r.address.toLowerCase())} onPress={() => void add(r)} testID={`ledger-add-${scheme}-${r.index}`} />
              </Row>
            ))}
          </Column>
        )
      })}
      {error ? <Body tone="burn">{error}</Body> : null}
    </Column>
  )
}
