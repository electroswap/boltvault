/**
 * Add a custom token (plan A3, owner item G7): pick the chain, paste the
 * contract, read its name, symbol and decimals from the chain, confirm.
 * The token joins the list with `source: 'user'` and the portfolio
 * refreshes at once.
 */
import { Body, ChainMark, Column, Input, Key, Pill, Plate, Row, Sheet } from '@boltvault/ui'
import type { ChainView, Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useWalletState } from '../state/useWalletState'

const ETN = 52014
type Meta = { address: string; name: string; symbol: string; decimals: number; hasCode: boolean }

export function AddTokenSheet({ open, onClose, onAdded, initialChainId, initialAddress, reducedMotion = false }: { open: boolean; onClose: () => void; onAdded?: (chainId: number, address: string) => void; initialChainId?: number; initialAddress?: string; reducedMotion?: boolean }) {
  const engine = useEngine()
  const { active } = useWalletState()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [chains, setChains] = useState<ChainView[]>([])
  const [chainId, setChainId] = useState(initialChainId ?? ETN)
  const [address, setAddress] = useState(initialAddress ?? '')
  const [meta, setMeta] = useState<Meta | null>(null)
  const [looking, setLooking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setChainId(initialChainId ?? ETN)
    setAddress(initialAddress ?? '')
    setMeta(null)
    setError(null)
    engine.settings.get().then(setSettings, () => undefined)
    engine.chains.list().then(setChains, () => undefined)
  }, [open, engine, initialChainId, initialAddress])

  const valid = /^0x[0-9a-fA-F]{40}$/.test(address.trim())
  useEffect(() => {
    if (!open || !valid) {
      setMeta(null)
      return
    }
    let alive = true
    setLooking(true)
    setError(null)
    engine.tokens.metadata({ chainId, address: address.trim() }).then(
      (m) => {
        if (!alive) return
        setMeta(m)
        setLooking(false)
        if (!m.hasCode) setError(t({ id: 'token.add.nocode', message: 'There is no contract at that address on this chain.' }))
      },
      (err: unknown) => {
        if (!alive) return
        setLooking(false)
        setError(err instanceof Error ? err.message : String(err))
      },
    )
    return () => {
      alive = false
    }
  }, [engine, open, valid, address, chainId])

  const add = async (): Promise<void> => {
    if (!meta || !meta.hasCode) return
    setBusy(true)
    setError(null)
    try {
      await engine.tokens.addCustom({ chainId, address: address.trim(), source: 'user' })
      if (active) void engine.portfolio.refresh({ accountId: active.id, chainIds: [chainId] }).catch(() => undefined)
      onAdded?.(chainId, address.trim())
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const options = [ETN, ...(settings?.enabledChains ?? []).filter((c) => c !== ETN)]
  return (
    <Sheet open={open} onClose={onClose} title={t({ id: 'token.add.title', message: 'Add a token' })} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'token.add.key', message: 'Add token' })} size="compact" disabled={busy || looking || !meta?.hasCode} onPress={() => void add()} testID="add-token-submit" />} testID="add-token">
      <Column gap="$3">
        <Row gap="$2" flexWrap="wrap" testID="add-token-chains">
          {options.map((c) => (
            <Pill key={c} label={c === ETN ? 'Electroneum' : (chains.find((x) => x.chainId === c)?.name ?? `Chain ${c}`)} icon={<ChainMark chainId={c} size={14} />} selected={chainId === c} size="sm" onPress={() => setChainId(c)} testID={`add-token-chain-${c}`} />
          ))}
        </Row>
        <Input value={address} onChange={setAddress} mono placeholder={t({ id: 'token.add.ph', message: 'Contract address 0x…' })} autoFocus={!initialAddress} testID="add-token-address" />
        {looking ? (
          <Body tone="mute" size="caption">
            {t({ id: 'token.add.looking', message: 'Reading the contract…' })}
          </Body>
        ) : null}
        {meta?.hasCode ? (
          <Plate role="raised" gap={2} testID="add-token-preview">
            <Body size="title">{meta.symbol}</Body>
            <Body tone="mute" size="caption">
              {t({ id: 'token.add.preview', message: '{name} · {d} decimals', values: { name: meta.name, d: meta.decimals } })}
            </Body>
            <Body tone="mute" size="caption">
              {t({ id: 'token.add.note', message: 'Anyone can deploy a token with any name. Check the address against the project’s own site before you trust it.' })}
            </Body>
          </Plate>
        ) : null}
        {error ? <Body tone="burn">{error}</Body> : null}
      </Column>
    </Sheet>
  )
}
