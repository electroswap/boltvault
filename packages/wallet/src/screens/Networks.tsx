/**
 * Settings › Networks (master plan §8.14): the ten chains with enable /
 * disable (Electroneum is always on), the testnet toggle, and a custom RPC
 * per chain validated by `eth_chainId` before it is kept.
 */
import { Body, ChainMark, Chip, Column, Input, Key, Plate, Row, ScrollView, Toggle, metrics } from '@boltvault/ui'
import { PageHeader } from '../components/PageHeader'
import type { ChainView, Settings } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'

const ETN = 52014
const ETN_TESTNET = 5201420

export function Networks({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const [chains, setChains] = useState<ChainView[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [rpcs, setRpcs] = useState<Record<string, { url: string; trace?: string }>>({})
  const [editing, setEditing] = useState<number | null>(null)
  const [url, setUrl] = useState('')
  const [problem, setProblem] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.chains.list().then(setChains, () => undefined)
    engine.settings.get().then(setSettings, () => undefined)
    engine.chains.rpcs().then(setRpcs, () => undefined)
  }, [engine])

  const set = (patch: Partial<Settings>): void => {
    // Hiding the testnet also turns it off, so it cannot linger in Home's scope or the activity scan.
    const p = patch.showTestnet === false && settings ? { ...patch, enabledChains: settings.enabledChains.filter((c) => c !== ETN_TESTNET) } : patch
    engine.settings.set(p).then(setSettings, () => undefined)
  }
  const enabled = new Set(settings?.enabledChains ?? [])
  const toggle = (chainId: number, on: boolean): void => {
    const next = new Set(enabled)
    if (on) next.add(chainId)
    else next.delete(chainId)
    set({ enabledChains: [...next] })
  }
  const saveRpc = async (chainId: number, value: string | null): Promise<void> => {
    setBusy(true)
    setProblem(null)
    try {
      await engine.chains.setRpc({ chainId, url: value })
      setRpcs(await engine.chains.rpcs())
      setEditing(null)
      setUrl('')
    } catch (err) {
      setProblem(err instanceof Error ? err.message : t({ id: 'networks.rpc.bad', message: 'That RPC did not answer with this chain id.' }))
    } finally {
      setBusy(false)
    }
  }
  const shown = chains.filter((c) => !c.testnet || settings?.showTestnet || c.chainId === ETN_TESTNET)

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 14 }} testID="networks">
      <PageHeader title={t({ id: 'settings.networks', message: 'Networks' })} />
      <Body tone="mute" size="caption">
        {t({ id: 'networks.body', message: 'Electroneum is home and always on. Other chains show balances, send, receive, activity and approvals through public RPCs; swaps and markets stay on Electroneum.' })}
      </Body>

      <Plate gap="$2" testID="networks-testnet">
        <Toggle value={settings?.showTestnet ?? false} onChange={(v) => set({ showTestnet: v })} label={t({ id: 'networks.testnet', message: 'Show Electroneum testnet' })} hint={t({ id: 'networks.testnet.hint', message: 'Chain 5201420. Test ETN has no value; names do not resolve there.' })} testID="networks-testnet-toggle" />
      </Plate>

      {shown
        .filter((c) => c.chainId !== ETN_TESTNET || settings?.showTestnet)
        .map((c) => {
          const home = c.chainId === ETN
          const on = home || enabled.has(c.chainId)
          const custom = rpcs[String(c.chainId)]?.url ?? null
          const isEditing = editing === c.chainId
          return (
            <Plate key={c.chainId} gap="$2" role={home ? 'raised' : undefined} testID={`network-${c.chainId}`}>
              <Row justifyContent="space-between" alignItems="center">
                <Column gap={2} flex={1}>
                  <Row gap="$2" alignItems="center">
                    <ChainMark chainId={c.chainId} size={22} />
                    <Body size="title">{c.name}</Body>
                    {home ? (
                      <Chip>
                        <Body tone="arc" size="caption">
                          {t({ id: 'networks.home', message: 'Home' })}
                        </Body>
                      </Chip>
                    ) : null}
                  </Row>
                  <Body tone="mute" size="caption">
                    {c.symbol} · {c.chainId}
                    {custom ? ` · ${t({ id: 'networks.rpc.custom', message: 'custom RPC' })}` : ''}
                  </Body>
                </Column>
                {home ? null : <Toggle value={on} onChange={(v) => toggle(c.chainId, v)} label="" testID={`network-${c.chainId}-toggle`} />}
              </Row>
              {isEditing ? (
                <Column gap="$2">
                  <Input value={url} onChange={setUrl} mono placeholder="https://" error={problem} autoFocus testID={`network-${c.chainId}-rpc-input`} />
                  <Row gap="$2">
                    <Key label={t({ id: 'networks.rpc.save', message: 'Use this RPC' })} disabled={busy || !/^https?:\/\//.test(url.trim())} onPress={() => void saveRpc(c.chainId, url.trim())} testID={`network-${c.chainId}-rpc-save`} />
                    {custom ? <Key label={t({ id: 'networks.rpc.clear', message: 'Back to default' })} kind="secondary" disabled={busy} onPress={() => void saveRpc(c.chainId, null)} testID={`network-${c.chainId}-rpc-clear`} /> : null}
                    <Key label={t({ id: 'cancel', message: 'Cancel' })} kind="secondary" onPress={() => (setEditing(null), setProblem(null))} />
                  </Row>
                </Column>
              ) : (
                <Row gap="$2">
                  <Key label={custom ? t({ id: 'networks.rpc.edit', message: 'Change RPC' }) : t({ id: 'networks.rpc.add', message: 'Custom RPC' })} kind="secondary" onPress={() => (setEditing(c.chainId), setUrl(custom ?? ''), setProblem(null))} testID={`network-${c.chainId}-rpc`} />
                  {c.explorerUrl ? (
                    <Body tone="mute" size="caption" alignSelf="center" flexShrink={1} numberOfLines={1}>
                      {c.explorerUrl.replace(/^https?:\/\//, '').replace(/\/$/, '')}
                    </Body>
                  ) : null}
                </Row>
              )}
            </Plate>
          )
        })}
    </ScrollView>
  )
}
