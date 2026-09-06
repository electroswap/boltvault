/**
 * Adding hardware accounts (master plan §8.1; plan C2): Ledger over USB
 * from a full tab, Trezor through Connect's hosted window, Keystone by
 * scanning the device's account QR. Every picker shares one row (a
 * signature, "BIP-44 · #3", the short address, an Add key), one loading
 * state, a "Show paths" pill and a "5 more" key; both derivation trees are
 * shown so nobody imports the wrong one.
 */
import { Body, Column, Input, Key, Pill, Row, Signature, SkeletonRows, shortAddress } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { useOpenInTab } from '../hooks/useOpenInTab'
import { t } from '../i18n'
import { urPartsDone } from './HardwarePrompt'

type Row_ = { path: string; address: string; index: number }
type Scheme = 'bip44' | 'live'
type SchemeRow = Row_ & { scheme: Scheme }
const PAGE = 5

export function schemeLabel(scheme: Scheme): string {
  return scheme === 'bip44' ? t({ id: 'ledger.bip44', message: 'BIP-44 (MetaMask, most wallets)' }) : t({ id: 'ledger.live', message: 'Ledger Live' })
}

/** Skeleton rows while a device answers (owner item A2). */
export function HardwareLoading({ what, reducedMotion = false, testID }: { what: string; reducedMotion?: boolean; testID?: string }) {
  return (
    <Column gap="$2" testID={testID}>
      <SkeletonRows rows={3} reducedMotion={reducedMotion} />
      <Body tone="mute" size="caption">
        {what}
      </Body>
    </Column>
  )
}

export function HardwareAddressRow({ row, scheme, showPath, added, busy, onAdd, testID }: { row: Row_; scheme: Scheme | null; showPath: boolean; added: boolean; busy: boolean; onAdd: () => void; testID: string }) {
  const title = scheme ? `${scheme === 'live' ? 'Ledger Live' : 'BIP-44'} · #${row.index}` : `#${row.index}`
  return (
    <Row gap="$3" alignItems="center" minHeight={52}>
      <Signature address={row.address} size={28} />
      <Column flex={1} alignItems="flex-start">
        <Body fontWeight="600">{title}</Body>
        <Body tone="mute" size="caption" numberOfLines={1} >
          {showPath ? row.path : shortAddress(row.address)}
        </Body>
      </Column>
      <Key label={added ? t({ id: 'ledger.added', message: 'Added' }) : t({ id: 'ledger.add', message: 'Add' })} kind="secondary" size="compact" disabled={busy || added} onPress={onAdd} testID={testID} />
    </Row>
  )
}

function SchemeList({ prefix, rows, added, busy, showPath, onAdd, onMore }: { prefix: string; rows: SchemeRow[]; added: string[]; busy: boolean; showPath: boolean; onAdd: (r: SchemeRow) => void; onMore: (scheme: Scheme) => void }) {
  return (
    <>
      {(['bip44', 'live'] as const).map((scheme) => {
        const list = rows.filter((r) => r.scheme === scheme)
        if (list.length === 0) return null
        return (
          <Column key={scheme} gap={2} testID={`${prefix}-${scheme}`}>
            <Body tone="mute" size="caption">
              {schemeLabel(scheme)}
            </Body>
            {list.map((r) => (
              <HardwareAddressRow key={r.path} row={r} scheme={scheme} showPath={showPath} added={added.includes(r.address.toLowerCase())} busy={busy} onAdd={() => onAdd(r)} testID={`${prefix}-add-${scheme}-${r.index}`} />
            ))}
            <Key label={t({ id: 'hardware.more', message: '{n} more', values: { n: PAGE } })} kind="secondary" size="compact" disabled={busy} onPress={() => onMore(scheme)} testID={`${prefix}-more-${scheme}`} />
          </Column>
        )
      })}
    </>
  )
}

function OpenInTabKey({ testID }: { testID?: string }) {
  const host = useHost()
  const openInTab = useOpenInTab()
  if (openInTab) return <Key label={t({ id: 'acct.openTab', message: 'Continue in a full tab' })} size="compact" onPress={() => openInTab({ screen: 'accounts' })} testID={testID} />
  if (host.openSecretScreen && host.body !== 'extension-tab' && host.body !== 'mobile') return <Key label={t({ id: 'acct.openTab', message: 'Continue in a full tab' })} size="compact" onPress={() => host.openSecretScreen?.('accounts')} testID={testID} />
  return null
}

/** Pair a Ledger over USB and pick addresses from both derivation schemes (§8.1). */
export function LedgerPicker({ onAdded, reducedMotion = false }: { onAdded: () => void; reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const [status, setStatus] = useState<Awaited<ReturnType<typeof engine.hardware.ledgerStatus>> | null>(null)
  const [rows, setRows] = useState<SchemeRow[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [showPath, setShowPath] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])

  const load = async (from: Record<Scheme, number> = { bip44: 0, live: 0 }, append = false): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const st = await engine.hardware.ledgerStatus()
      setStatus(st)
      if (st.devices.length > 0 && st.app) {
        const [a, b] = await Promise.all([engine.hardware.ledgerAddresses({ scheme: 'bip44', from: from.bip44, count: PAGE }), engine.hardware.ledgerAddresses({ scheme: 'live', from: from.live, count: PAGE })])
        const next = [...a.map((x) => ({ ...x, scheme: 'bip44' as const })), ...b.map((x) => ({ ...x, scheme: 'live' as const }))]
        setRows((cur) => (append ? [...cur, ...next] : next))
      } else if (!append) {
        setRows([])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    void load()
  }, [])

  const more = (scheme: Scheme): void => {
    const count = rows.filter((r) => r.scheme === scheme).length
    void load({ bip44: scheme === 'bip44' ? count : 0, live: scheme === 'live' ? count : 0 }, true)
  }
  const pair = async (): Promise<void> => {
    if (!host.requestHid) return
    setError(null)
    try {
      const ok = await host.requestHid()
      if (!ok) setError(t({ id: 'ledger.nopick', message: 'No device was chosen.' }))
      await load()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const add = async (row: SchemeRow): Promise<void> => {
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
        <OpenInTabKey />
      </Column>
    )
  }
  // WebHID's device chooser only opens from a full tab. A device paired there works from the popup afterwards.
  if (status && status.devices.length === 0 && !host.requestHid && (host.body === 'extension-popup' || host.body === 'extension-sign')) {
    return (
      <Column gap="$2" testID="ledger-pair-in-tab">
        <Body tone="mute" size="caption">
          {t({ id: 'ledger.tabonly', message: 'Pairing a Ledger over USB happens in a full tab: the browser’s device chooser cannot open from this window. Once paired, it works from here too.' })}
        </Body>
        <OpenInTabKey testID="ledger-open-tab" />
      </Column>
    )
  }
  return (
    <Column gap="$3" testID="ledger-picker">
      <Body tone="mute" size="caption">
        {t({ id: 'ledger.body', message: 'Plug in your Ledger, unlock it and open the Ethereum app. Your keys never leave the device; BoltVault only shows you what it will sign.' })}
      </Body>
      <Row gap="$2" flexWrap="wrap" alignItems="center">
        {host.requestHid ? <Key label={t({ id: 'ledger.pair', message: 'Pair Ledger' })} kind="secondary" size="compact" disabled={loading} onPress={() => void pair()} testID="ledger-pair" /> : null}
        <Key label={t({ id: 'ledger.refresh', message: 'Refresh' })} kind="secondary" size="compact" disabled={loading} onPress={() => void load()} testID="ledger-refresh" />
        {rows.length ? <Pill label={t({ id: 'hardware.paths', message: 'Show paths' })} selected={showPath} size="sm" onPress={() => setShowPath((v) => !v)} testID="ledger-paths" /> : null}
      </Row>
      {status?.devices[0] ? (
        <Body size="caption" tone={status.app ? 'arc' : 'ember'} testID="ledger-status">
          {status.app ? t({ id: 'ledger.ready', message: '{m} · Ethereum app {v}{b}', values: { m: status.devices[0].model, v: status.app.version, b: status.app.blindSigning ? '' : ' · blind signing off' } }) : (status.problem ?? t({ id: 'ledger.openapp', message: 'Open the Ethereum app on the device.' }))}
        </Body>
      ) : status && !loading ? (
        <Body tone="mute" size="caption">
          {t({ id: 'ledger.none', message: 'No Ledger paired yet. Press Pair Ledger, then pick your Ledger in the browser’s device list.' })}
        </Body>
      ) : null}
      {status?.app && !status.app.blindSigning ? (
        <Body tone="ember" size="caption">
          {t({ id: 'ledger.blind', message: 'Swaps and contract calls need blind signing: Ethereum app › Settings › Blind signing on the device. Plain sends work without it.' })}
        </Body>
      ) : null}
      {loading && rows.length === 0 ? <HardwareLoading what={t({ id: 'ledger.loading', message: 'Reading addresses from your Ledger…' })} reducedMotion={reducedMotion} testID="ledger-loading" /> : null}
      <SchemeList prefix="ledger" rows={rows} added={added} busy={busy || loading} showPath={showPath} onAdd={(r) => void add(r)} onMore={more} />
      {error ? <Body tone="burn">{error}</Body> : null}
    </Column>
  )
}

export function TrezorPicker({ onAdded, reducedMotion = false }: { onAdded: () => void; reducedMotion?: boolean }) {
  const engine = useEngine()
  const [status, setStatus] = useState<Awaited<ReturnType<typeof engine.hardware.trezorStatus>> | null>(null)
  const [rows, setRows] = useState<SchemeRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPath, setShowPath] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])

  const load = async (from: Record<Scheme, number> = { bip44: 0, live: 0 }, append = false): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const st = await engine.hardware.trezorStatus()
      setStatus(st)
      if (st.available && !st.problem) {
        const [a, b] = await Promise.all([engine.hardware.trezorAddresses({ scheme: 'bip44', from: from.bip44, count: PAGE }), engine.hardware.trezorAddresses({ scheme: 'live', from: from.live, count: PAGE })])
        const next = [...a.map((x) => ({ ...x, scheme: 'bip44' as const })), ...b.map((x) => ({ ...x, scheme: 'live' as const }))]
        setRows((cur) => (append ? [...cur, ...next] : next))
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    engine.hardware.trezorStatus().then(setStatus, () => undefined)
  }, [engine])

  const more = (scheme: Scheme): void => {
    const count = rows.filter((r) => r.scheme === scheme).length
    void load({ bip44: scheme === 'bip44' ? count : 0, live: scheme === 'live' ? count : 0 }, true)
  }
  const add = async (row: SchemeRow): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await engine.accounts.addHardware({ kind: 'trezor', address: row.address, path: row.path, label: `Trezor ${row.scheme === 'live' ? 'Live' : 'BIP-44'} #${row.index}` })
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
      <Column gap="$2" testID="trezor-unavailable">
        <Body tone="mute" size="caption">
          {t({ id: 'trezor.unavailable', message: 'A Trezor connects from the browser extension. On the phone you can watch its address and sign on your paired computer — pair it under Settings › Devices.' })}
        </Body>
        <OpenInTabKey />
      </Column>
    )
  }
  return (
    <Column gap="$3" testID="trezor-picker">
      <Body tone="mute" size="caption">
        {t({ id: 'trezor.body', message: "Plug in your Trezor. Trezor's own window opens at connect.trezor.io to talk to the device — the only thing BoltVault ever loads from outside itself." })}
      </Body>
      <Row gap="$2" flexWrap="wrap" alignItems="center">
        <Key label={t({ id: 'trezor.connect', message: 'Connect Trezor' })} kind="secondary" size="compact" disabled={loading} onPress={() => void load()} testID="trezor-connect" />
        {rows.length ? <Pill label={t({ id: 'hardware.paths', message: 'Show paths' })} selected={showPath} size="sm" onPress={() => setShowPath((v) => !v)} testID="trezor-paths" /> : null}
      </Row>
      {status?.problem ? (
        <Body tone="ember" size="caption" testID="trezor-status">
          {status.problem}
        </Body>
      ) : status?.model ? (
        <Body tone="arc" size="caption" testID="trezor-status">
          {t({ id: 'trezor.ready', message: 'Trezor {m}{l}', values: { m: status.model, l: status.label ? ` · ${status.label}` : '' } })}
        </Body>
      ) : null}
      {loading && rows.length === 0 ? <HardwareLoading what={t({ id: 'trezor.loading', message: 'Reading addresses from your Trezor…' })} reducedMotion={reducedMotion} testID="trezor-loading" /> : null}
      <SchemeList prefix="trezor" rows={rows} added={added} busy={busy || loading} showPath={showPath} onAdd={(r) => void add(r)} onMore={more} />
      {error ? <Body tone="burn">{error}</Body> : null}
    </Column>
  )
}

export function KeystonePicker({ onAdded, reducedMotion = false }: { onAdded: () => void; reducedMotion?: boolean }) {
  const engine = useEngine()
  const host = useHost()
  const [imported, setImported] = useState<{ xfp: string; name: string | null; addresses: Row_[] } | null>(null)
  const [pasted, setPasted] = useState('')
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [showPath, setShowPath] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])

  const load = async (parts: string[]): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      setImported(await engine.hardware.keystoneImport({ parts, count: PAGE }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }
  const scan = async (): Promise<void> => {
    if (!host.scanQr) return
    const parts: string[] = []
    try {
      await host.scanQr((text) => {
        parts.push(text)
        return urPartsDone(parts)
      })
      await load(parts)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }
  const add = async (row: Row_): Promise<void> => {
    if (!imported) return
    setBusy(true)
    setError(null)
    try {
      await engine.accounts.addHardware({ kind: 'keystone', address: row.address, path: row.path, deviceId: imported.xfp, label: `${imported.name ?? 'Keystone'} #${row.index}` })
      setAdded((xs) => [...xs, row.address.toLowerCase()])
      onAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Column gap="$3" testID="keystone-picker">
      <Body tone="mute" size="caption">
        {t({ id: 'keystone.import.body', message: 'On the Keystone choose Connect software wallet › BoltVault (or any EVM wallet) and scan the QR it shows. Signing later works the same way: a QR each way, nothing plugged in.' })}
      </Body>
      <Row gap="$2" flexWrap="wrap" alignItems="center">
        {host.scanQr ? <Key label={t({ id: 'keystone.scan.account', message: 'Scan the Keystone' })} kind="secondary" size="compact" disabled={loading} onPress={() => void scan()} testID="keystone-scan-account" /> : null}
        {imported ? <Pill label={t({ id: 'hardware.paths', message: 'Show paths' })} selected={showPath} size="sm" onPress={() => setShowPath((v) => !v)} testID="keystone-paths" /> : null}
      </Row>
      <Input value={pasted} onChange={setPasted} placeholder="UR:CRYPTO-HDKEY/…" testID="keystone-account-paste" />
      <Key label={t({ id: 'keystone.use.account', message: 'Use this account QR' })} kind="secondary" size="compact" disabled={loading || !pasted.trim()} onPress={() => void load(pasted.split(/\s+/).filter(Boolean))} testID="keystone-account-use" />
      {loading ? <HardwareLoading what={t({ id: 'keystone.loading', message: 'Reading the account QR…' })} reducedMotion={reducedMotion} testID="keystone-loading" /> : null}
      {imported ? (
        <Column gap={2} testID="keystone-rows">
          <Body tone="mute" size="caption">
            {t({ id: 'keystone.rows', message: '{n} · fingerprint {x}', values: { n: imported.name ?? 'Keystone', x: imported.xfp } })}
          </Body>
          {imported.addresses.map((r) => (
            <HardwareAddressRow key={r.path} row={r} scheme={null} showPath={showPath} added={added.includes(r.address.toLowerCase())} busy={busy} onAdd={() => void add(r)} testID={`keystone-add-${r.index}`} />
          ))}
        </Column>
      ) : null}
      {error ? <Body tone="burn">{error}</Body> : null}
    </Column>
  )
}
