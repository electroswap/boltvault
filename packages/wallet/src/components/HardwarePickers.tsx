/**
 * Adding Trezor and Keystone accounts (master plan §8.1): Trezor through
 * Connect's hosted window on the extension (watch-only + remote sign on the
 * phone); Keystone by scanning the device's account QR on every body. Both
 * show BIP-44 and Ledger Live style rows so nobody imports the wrong tree.
 */
import { Body, Column, Input, Key, Row, shortAddress } from '@boltvault/ui'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useHost } from '../host'
import { t } from '../i18n'
import { urPartsDone } from './HardwarePrompt'

type Row_ = { path: string; address: string; index: number }

export function TrezorPicker({ onAdded }: { onAdded: () => void }) {
  const engine = useEngine()
  const host = useHost()
  const [status, setStatus] = useState<Awaited<ReturnType<typeof engine.hardware.trezorStatus>> | null>(null)
  const [rows, setRows] = useState<Array<Row_ & { scheme: 'bip44' | 'live' }>>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])

  const refresh = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const st = await engine.hardware.trezorStatus()
      setStatus(st)
      if (st.available && !st.problem) {
        const [a, b] = await Promise.all([engine.hardware.trezorAddresses({ scheme: 'bip44', count: 5 }), engine.hardware.trezorAddresses({ scheme: 'live', count: 5 })])
        setRows([...a.map((x) => ({ ...x, scheme: 'bip44' as const })), ...b.map((x) => ({ ...x, scheme: 'live' as const }))])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  useEffect(() => {
    engine.hardware.trezorStatus().then(setStatus, () => undefined)
  }, [engine])

  const add = async (row: Row_ & { scheme: 'bip44' | 'live' }): Promise<void> => {
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
        {host.openSecretScreen && host.body !== 'extension-tab' && host.body !== 'mobile' ? <Key label={t({ id: 'acct.openTab', message: 'Continue in a full tab' })} onPress={() => host.openSecretScreen?.('accounts')} /> : null}
      </Column>
    )
  }
  return (
    <Column gap="$3" testID="trezor-picker">
      <Body tone="mute" size="caption">
        {t({ id: 'trezor.body', message: "Plug in your Trezor. Trezor's own window opens at connect.trezor.io to talk to the device — the only thing BoltVault ever loads from outside itself." })}
      </Body>
      <Row gap="$2" flexWrap="wrap">
        <Key label={t({ id: 'trezor.connect', message: 'Connect Trezor' })} kind="secondary" disabled={busy} onPress={() => void refresh()} testID="trezor-connect" />
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
      {(['bip44', 'live'] as const).map((scheme) => {
        const list = rows.filter((r) => r.scheme === scheme)
        if (list.length === 0) return null
        return (
          <Column key={scheme} gap="$1" testID={`trezor-${scheme}`}>
            <Body size="caption">{scheme === 'bip44' ? t({ id: 'ledger.bip44', message: 'BIP-44 (MetaMask, most wallets)' }) : t({ id: 'ledger.live', message: 'Ledger Live' })}</Body>
            {list.map((r) => (
              <Row key={r.path} justifyContent="space-between" alignItems="center" minHeight={44}>
                <Body tone="mute" size="caption" fontFamily="$mono">
                  {shortAddress(r.address)} · {r.path}
                </Body>
                <Key label={added.includes(r.address.toLowerCase()) ? t({ id: 'ledger.added', message: 'Added' }) : t({ id: 'ledger.add', message: 'Add' })} kind="secondary" disabled={busy || added.includes(r.address.toLowerCase())} onPress={() => void add(r)} testID={`trezor-add-${scheme}-${r.index}`} />
              </Row>
            ))}
          </Column>
        )
      })}
      {error ? <Body tone="burn">{error}</Body> : null}
    </Column>
  )
}

export function KeystonePicker({ onAdded }: { onAdded: () => void }) {
  const engine = useEngine()
  const host = useHost()
  const [imported, setImported] = useState<{ xfp: string; name: string | null; addresses: Row_[] } | null>(null)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [added, setAdded] = useState<string[]>([])

  const load = async (parts: string[]): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      setImported(await engine.hardware.keystoneImport({ parts, count: 5 }))
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
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
      <Row gap="$2" flexWrap="wrap">
        {host.scanQr ? <Key label={t({ id: 'keystone.scan.account', message: 'Scan the Keystone' })} kind="secondary" disabled={busy} onPress={() => void scan()} testID="keystone-scan-account" /> : null}
      </Row>
      <Input value={pasted} onChange={setPasted} mono placeholder="UR:CRYPTO-HDKEY/…" testID="keystone-account-paste" />
      <Key label={t({ id: 'keystone.use.account', message: 'Use this account QR' })} kind="secondary" disabled={busy || !pasted.trim()} onPress={() => void load(pasted.split(/\s+/).filter(Boolean))} testID="keystone-account-use" />
      {imported ? (
        <Column gap="$1" testID="keystone-rows">
          <Body size="caption">{t({ id: 'keystone.rows', message: '{n} · fingerprint {x}', values: { n: imported.name ?? 'Keystone', x: imported.xfp } })}</Body>
          {imported.addresses.map((r) => (
            <Row key={r.path} justifyContent="space-between" alignItems="center" minHeight={44}>
              <Body tone="mute" size="caption" fontFamily="$mono">
                {shortAddress(r.address)} · {r.path}
              </Body>
              <Key label={added.includes(r.address.toLowerCase()) ? t({ id: 'ledger.added', message: 'Added' }) : t({ id: 'ledger.add', message: 'Add' })} kind="secondary" disabled={busy || added.includes(r.address.toLowerCase())} onPress={() => void add(r)} testID={`keystone-add-${r.index}`} />
            </Row>
          ))}
        </Column>
      ) : null}
      {error ? <Body tone="burn">{error}</Body> : null}
    </Column>
  )
}
