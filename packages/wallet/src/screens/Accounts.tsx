/**
 * Accounts (master plan §8.1; plan C2, owner items A1–A3): one wallet card
 * per recovery phrase with its addresses as rows, then imported keys, each
 * hardware device and watched addresses. A row's menu renames, shows the
 * technical details, reorders, hides or removes; the header's Add opens the
 * four ways in. Nothing technical is printed on a row — it lives in Details.
 */
import { Body, Column, Dot, Icon, IconButton, Input, Key, Pill, Plate, Pressable, Row, ScrollView, metrics, paint } from '@boltvault/ui'
import type { AccountView, SeedView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { AccountRow } from '../components/accounts/AccountRow'
import { AccountDetailsSheet, ConfirmSheet, MenuSheet, RenameSheet, RevealSheet, type MenuItem } from '../components/accounts/AccountSheets'
import { AddAccountSheet } from '../components/accounts/AddAccountSheet'
import { PageHeader } from '../components/PageHeader'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useReducedMotion } from '../state/useReducedMotion'
import { useWalletState } from '../state/useWalletState'

type Group = { id: string; title: string; icon: 'key' | 'lock' | 'hardware' | 'eye'; items: AccountView[]; seed?: SeedView }
type SheetState = { kind: 'menu' | 'details' | 'rename' | 'confirm'; account: AccountView } | { kind: 'seedMenu' | 'renameSeed' | 'reveal'; seed: SeedView } | { kind: 'add' } | null

export function Accounts({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const host = useHost()
  const router = useRouter()
  const reducedMotion = useReducedMotion()
  const { vault, accounts, active, refresh } = useWalletState()
  const [sheet, setSheet] = useState<SheetState>(null)
  const [showHidden, setShowHidden] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [ledger, setLedger] = useState<{ available: boolean; devices: ReadonlyArray<{ deviceId: string; model: string }> } | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide
  const seeds = vault?.seeds ?? []

  // The Ledger's presence, for the hero's status line; only a full page can ask the browser for the device.
  useEffect(() => {
    if (active?.kind !== 'ledger') return
    let alive = true
    engine.hardware.ledgerStatus().then((s) => alive && setLedger(s), () => alive && setLedger(null))
    return () => {
      alive = false
    }
  }, [engine, active?.kind, active?.id])
  const connectLedger = (): void => {
    if (host.requestHid) void host.requestHid().then(() => engine.hardware.ledgerStatus()).then(setLedger, () => undefined)
    else host.openInTab?.({ screen: 'accounts' })
  }
  const copy = (a: AccountView): void => {
    if (!host.copy) return
    void host.copy(a.address).then(() => {
      setCopiedId(a.id)
      setTimeout(() => setCopiedId((id) => (id === a.id ? null : id)), 1500)
    }, () => undefined)
  }
  const q = query.trim().toLowerCase()
  const matches = (a: AccountView): boolean => !q || a.label.toLowerCase().includes(q) || a.address.toLowerCase().includes(q)

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
      refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const groups: Group[] = []
  for (const s of seeds) groups.push({ id: `seed-${s.id}`, title: s.label, icon: 'key', items: accounts.filter((a) => a.seedId === s.id), seed: s })
  const others = accounts.filter((a) => !a.seedId)
  const imported = others.filter((a) => a.kind === 'imported')
  if (imported.length) groups.push({ id: 'imported', title: t({ id: 'acct.imported', message: 'Imported keys' }), icon: 'lock', items: imported })
  const hardware = others.filter((a) => a.kind === 'ledger' || a.kind === 'trezor' || a.kind === 'keystone')
  const devices = new Map<string, AccountView[]>()
  for (const a of hardware) {
    const key = `${a.kind}:${a.hardware?.deviceId ?? ''}`
    devices.set(key, [...(devices.get(key) ?? []), a])
  }
  for (const [key, items] of devices) {
    const kind = items[0]?.kind
    groups.push({ id: `hw-${key}`, title: kind === 'ledger' ? 'Ledger' : kind === 'trezor' ? 'Trezor' : 'Keystone', icon: 'hardware', items })
  }
  const watching = others.filter((a) => a.kind === 'watch')
  if (watching.length) groups.push({ id: 'watch', title: t({ id: 'acct.watch', message: 'Watching' }), icon: 'eye', items: watching })

  const select = (a: AccountView): void => {
    if (a.id === active?.id) return
    void run(async () => {
      await engine.accounts.setActive({ id: a.id })
      router.back()
    })
  }
  const move = (a: AccountView, dir: -1 | 1): void => {
    const ids = [...accounts].sort((x, y) => x.order - y.order).map((x) => x.id)
    const i = ids.indexOf(a.id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= ids.length) return
    const next = [...ids]
    next[i] = ids[j] ?? a.id
    next[j] = a.id
    void run(() => engine.accounts.reorder({ ids: next }))
    setSheet(null)
  }
  /**
   * Owner: "It doesn't appear to be possible to rename the currently selected
   * address, only non-selected addresses." The active account is deliberately
   * lifted out of the list into its own block, and Rename lives in a row's
   * menu — so the one account you are using was the one you could not rename.
   * Its block gets the same menu now, minus the two entries that make no sense
   * for the account in use.
   */
  const menuFor = (a: AccountView, isActive = false): MenuItem[] => ([
    { id: 'rename', icon: 'edit', label: t({ id: 'acct.rename', message: 'Rename' }), onPress: () => setSheet({ kind: 'rename', account: a }), testID: 'menu-rename' },
    { id: 'details', icon: 'info', label: t({ id: 'acct.details', message: 'Details' }), onPress: () => setSheet({ kind: 'details', account: a }), testID: 'menu-details' },
    { id: 'up', icon: 'chevronUp', label: t({ id: 'acct.moveUp', message: 'Move up' }), onPress: () => move(a, -1), testID: 'menu-up' },
    { id: 'down', icon: 'chevronDown', label: t({ id: 'acct.moveDown', message: 'Move down' }), onPress: () => move(a, 1), testID: 'menu-down' },
    {
      id: 'hide',
      icon: a.hidden ? 'eye' : 'eyeOff',
      label: a.hidden ? t({ id: 'acct.show', message: 'Show' }) : t({ id: 'acct.hide', message: 'Hide' }),
      onPress: () => {
        void run(() => engine.accounts.setHidden({ id: a.id, hidden: !a.hidden }))
        setSheet(null)
      },
      testID: 'menu-hide',
    },
    ...(a.kind !== 'hd' ? [{ id: 'remove', icon: 'trash' as const, label: t({ id: 'acct.remove', message: 'Remove' }), tone: 'burn' as const, onPress: () => setSheet({ kind: 'confirm', account: a }), testID: 'menu-remove' }] : []),
  ] as MenuItem[]).filter((item) => !(isActive && (item.id === 'hide' || item.id === 'remove')))
  const seedMenu = (s: SeedView): MenuItem[] => [
    { id: 'next', icon: 'plus', label: t({ id: 'acct.derive', message: 'Add the next address' }), onPress: () => { void run(() => engine.accounts.derive({ seedId: s.id })); setSheet(null) }, testID: 'seed-derive' },
    { id: 'rename', icon: 'edit', label: t({ id: 'acct.renameSeed', message: 'Rename this wallet' }), onPress: () => setSheet({ kind: 'renameSeed', seed: s }), testID: 'seed-rename' },
    ...(!s.backedUp ? [{ id: 'backup', icon: 'shield' as const, label: t({ id: 'acct.backup', message: 'Back up now' }), onPress: () => { setSheet(null); router.navigate('backup') }, testID: 'seed-backup' }] : []),
    ...(host.secretsAllowed ? [{ id: 'reveal', icon: 'eye' as const, label: t({ id: 'acct.reveal', message: 'Reveal recovery phrase' }), onPress: () => setSheet({ kind: 'reveal', seed: s }), testID: 'seed-reveal' }] : []),
  ]

  return (
    <Column flex={1}>
      <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="accounts">
        <PageHeader title={t({ id: 'accounts.title', message: 'Accounts' })} right={<Pill label={t({ id: 'acct.add', message: 'Add' })} icon={<Icon name="plus" size={14} color={paint.arc} />} tone="arc" onPress={() => setSheet({ kind: 'add' })} testID="add-account-open" />} />
        {/*
          The active account is NOT lifted out of its group.

          It used to be a plate of its own above the list, and the group it
          belonged to then rendered without it — so a fresh wallet with one
          account showed "Seed 1" as an empty heading under a card. Owner:
          "leave the active wallet in its parent, and just have the 'Active'
          indicator present next to the account that is active", which
          `AccountRow` has always drawn. What the plate carried that a row does
          not is the Ledger's connection state, and that keeps a strip here.
        */}
        {active?.kind === 'ledger' ? (
          <Plate role="raised" gap="$2" testID="current-hardware">
            <Row gap="$2" alignItems="center" justifyContent="space-between" minHeight={36}>
              <Row gap={6} alignItems="center" flexShrink={1}>
                <Dot color={ledger && ledger.devices.length > 0 ? paint.surge : paint.mute} size={6} />
                <Body tone="mute" size="caption" numberOfLines={1}>
                  {ledger && ledger.devices.length > 0 ? t({ id: 'acct.ledger.on', message: 'Ledger connected' }) : t({ id: 'acct.ledger.off', message: 'Ledger is not connected' })}
                </Body>
              </Row>
              {!(ledger && ledger.devices.length > 0) ? <Pill label={t({ id: 'acct.ledger.connect', message: 'Connect' })} tone="arc" size="sm" onPress={connectLedger} testID="current-connect" /> : null}
            </Row>
          </Plate>
        ) : null}
        {accounts.length > 6 ? <Input value={query} onChange={setQuery} placeholder={t({ id: 'acct.search', message: 'Search accounts' })} testID="accounts-search" /> : null}
        {groups.map((g) => {
          const visible = g.items.filter((a) => !a.hidden && matches(a))
          const hidden = g.items.filter((a) => a.hidden && matches(a))
          if (q && visible.length === 0 && hidden.length === 0) return null
          const open = showHidden[g.id] ?? false
          return (
            <Plate key={g.id} role="card" gap={4} paddingVertical="$2" paddingHorizontal="$3" testID={`group-${g.id}`}>
              <Row alignItems="center" gap="$2" minHeight={36}>
                <Row width={28} height={28} borderRadius={14} backgroundColor="$glassRaised" alignItems="center" justifyContent="center">
                  <Icon name={g.icon} size={15} color={paint.arc} />
                </Row>
                <Body fontWeight="600" flex={1} numberOfLines={1}>
                  {g.title}
                </Body>
                {hidden.length ? (
                  <Pressable onPress={() => setShowHidden((s) => ({ ...s, [g.id]: !open }))} accessibilityRole="button" accessibilityLabel={t({ id: 'acct.hidden.toggle', message: 'Hidden accounts' })} style={{ minHeight: 44, marginVertical: -4, justifyContent: 'center', paddingHorizontal: 4 }} testID={`hidden-${g.id}`}>
                    <Row gap={4} alignItems="center">
                      <Body tone="mute" size="caption">
                        {hidden.length === 1 ? t({ id: 'acct.hidden.one', message: '1 hidden' }) : t({ id: 'acct.hidden.many', message: '{n} hidden', values: { n: hidden.length } })}
                      </Body>
                      <Icon name={open ? 'chevronUp' : 'chevronDown'} size={14} color={paint.mute} />
                    </Row>
                  </Pressable>
                ) : null}
                {g.seed ? (
                  g.seed.backedUp ? (
                    <Body tone="mute" size="caption">
                      {t({ id: 'acct.backedUp', message: 'Backed up' })}
                    </Body>
                  ) : (
                    <Pill label={t({ id: 'acct.backup.short', message: 'Back up' })} tone="ember" size="sm" onPress={() => router.navigate('backup')} testID={`backup-${g.seed.id}`} />
                  )
                ) : null}
                {g.seed ? <IconButton icon="more" label={t({ id: 'acct.seedMenu', message: 'Wallet options' })} onPress={() => setSheet({ kind: 'seedMenu', seed: g.seed as SeedView })} testID={`seed-menu-${g.seed.id}`} /> : null}
              </Row>
              {visible.map((a) => (
                <AccountRow key={a.id} account={a} active={a.id === active?.id} onSelect={() => select(a)} onMenu={() => setSheet({ kind: 'menu', account: a })} onCopy={host.copy ? () => copy(a) : undefined} copied={copiedId === a.id} />
              ))}
              {hidden.length && open ? hidden.map((a) => <AccountRow key={a.id} account={a} active={a.id === active?.id} onSelect={() => select(a)} onMenu={() => setSheet({ kind: 'menu', account: a })} onCopy={host.copy ? () => copy(a) : undefined} copied={copiedId === a.id} />) : null}
            </Plate>
          )
        })}
        {accounts.length === 0 ? (
          <Plate gap="$2" testID="accounts-empty">
            <Body tone="mute">{t({ id: 'acct.empty', message: 'No accounts yet. Add a recovery phrase, a key, an address to watch or a hardware wallet.' })}</Body>
            <Key label={t({ id: 'acct.add', message: 'Add' })} size="compact" onPress={() => setSheet({ kind: 'add' })} />
          </Plate>
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
      </ScrollView>

      <MenuSheet open={sheet?.kind === 'menu'} onClose={() => setSheet(null)} title={sheet?.kind === 'menu' ? sheet.account.label : ''} items={sheet?.kind === 'menu' ? menuFor(sheet.account, sheet.account.id === active?.id) : []} reducedMotion={reducedMotion} testID="account-menu" />
      <MenuSheet open={sheet?.kind === 'seedMenu'} onClose={() => setSheet(null)} title={sheet?.kind === 'seedMenu' ? sheet.seed.label : ''} items={sheet?.kind === 'seedMenu' ? seedMenu(sheet.seed) : []} reducedMotion={reducedMotion} testID="seed-menu" />
      <AccountDetailsSheet open={sheet?.kind === 'details'} onClose={() => setSheet(null)} account={sheet?.kind === 'details' ? sheet.account : null} seed={sheet?.kind === 'details' ? (seeds.find((s) => s.id === sheet.account.seedId) ?? null) : null} reducedMotion={reducedMotion} />
      <RenameSheet open={sheet?.kind === 'rename'} onClose={() => setSheet(null)} title={t({ id: 'acct.rename', message: 'Rename' })} value={sheet?.kind === 'rename' ? sheet.account.label : ''} onSave={async (label) => { if (sheet?.kind === 'rename') await run(() => engine.accounts.rename({ id: sheet.account.id, label })) }} reducedMotion={reducedMotion} testID="rename-account" />
      <RenameSheet open={sheet?.kind === 'renameSeed'} onClose={() => setSheet(null)} title={t({ id: 'acct.renameSeed', message: 'Rename this wallet' })} value={sheet?.kind === 'renameSeed' ? sheet.seed.label : ''} onSave={async (label) => { if (sheet?.kind === 'renameSeed') await run(() => engine.accounts.renameSeed({ seedId: sheet.seed.id, label })) }} reducedMotion={reducedMotion} testID="rename-seed" />
      <ConfirmSheet
        open={sheet?.kind === 'confirm'}
        onClose={() => setSheet(null)}
        title={t({ id: 'acct.remove.title', message: 'Remove {label}?', values: { label: sheet?.kind === 'confirm' ? sheet.account.label : '' } })}
        body={sheet?.kind === 'confirm' && sheet.account.kind === 'imported' ? t({ id: 'acct.remove.key', message: 'This key is not part of a recovery phrase. Without its own backup, anything at this address is gone for good.' }) : t({ id: 'acct.remove.body', message: 'BoltVault stops showing this address. Nothing on the chain changes; you can add it again any time.' })}
        confirmLabel={t({ id: 'acct.remove', message: 'Remove' })}
        onConfirm={() => {
          if (sheet?.kind === 'confirm') void run(() => engine.accounts.remove({ id: sheet.account.id }))
          setSheet(null)
        }}
        reducedMotion={reducedMotion}
        testID="confirm-remove"
      />
      <RevealSheet open={sheet?.kind === 'reveal'} onClose={() => setSheet(null)} seed={sheet?.kind === 'reveal' ? sheet.seed : null} reducedMotion={reducedMotion} />
      <AddAccountSheet open={sheet?.kind === 'add'} onClose={() => setSheet(null)} onAdded={refresh} reducedMotion={reducedMotion} />
    </Column>
  )
}
