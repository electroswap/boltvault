/** Settings › Connected sites (master plan §8.14): origins as plugs, per-site chain, disconnect. */
import { Body, Chip, Column, Icon, Key, Plate, Row, ScrollView, metrics, paint, shortAddress } from '@boltvault/ui'
import type { ChainView, SiteView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { t } from '../i18n'
import { useRouter } from '../navigation/router'
import { useWalletState } from '../state/useWalletState'

export function ConnectedSites({ body }: { body: 'extension-popup' | 'extension-tab' | 'mobile' }) {
  const engine = useEngine()
  const router = useRouter()
  const { accounts } = useWalletState()
  const [sites, setSites] = useState<SiteView[]>([])
  const [chains, setChains] = useState<ChainView[]>([])
  const [editing, setEditing] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const inset = body === 'extension-popup' ? metrics.inset : metrics.insetWide

  useEffect(() => {
    engine.sites.list().then(setSites, () => undefined)
    engine.chains.list().then(setChains, () => undefined)
    return engine.events.subscribe((e) => {
      if (e.type === 'sites.changed') setSites(e.sites)
    })
  }, [engine])

  const hostOf = (origin: string): string => {
    try {
      return new URL(origin).host
    } catch {
      return origin
    }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: inset, gap: 12 }} testID="sites">
      <Row justifyContent="space-between">
        <Key label={t({ id: 'back', message: 'Back' })} kind="secondary" onPress={() => router.back()} icon={<Icon name="back" size={18} color={paint.ink} />} testID="back" />
        <Body size="title">{t({ id: 'sites.title', message: 'Connected sites' })}</Body>
      </Row>
      {sites.length === 0 ? (
        <Plate gap="$1">
          <Body tone="mute">{t({ id: 'sites.none', message: 'No site is connected. When a site asks to connect, it appears here with the account and chain it sees.' })}</Body>
        </Plate>
      ) : null}
      {sites.map((s) => {
        const account = accounts.find((a) => a.id === s.accountId)
        const chain = chains.find((c) => c.chainId === s.chainId)
        return (
          <Plate key={s.origin} gap="$2" testID={`site-${hostOf(s.origin)}`}>
            <Row justifyContent="space-between">
              <Body size="title" numberOfLines={1}>
                {hostOf(s.origin)}
              </Body>
              <Chip onPress={() => setEditing(editing === s.origin ? null : s.origin)} cursor="pointer" borderColor={paint.arc} minHeight={32} justifyContent="center" testID={`site-chain-${hostOf(s.origin)}`}>
                <Body tone="arc" size="caption">
                  {chain?.name ?? String(s.chainId)}
                </Body>
              </Chip>
            </Row>
            <Body tone="mute" size="caption">
              {account ? `${account.label} · ${shortAddress(account.address)}` : t({ id: 'sites.noaccount', message: 'No account' })}
              {s.lastUsed ? ` · ${new Date(s.lastUsed).toLocaleDateString()}` : ''}
            </Body>
            {editing === s.origin ? (
              <Row gap="$2" flexWrap="wrap">
                {chains.map((c) => (
                  <Chip
                    key={c.chainId}
                    onPress={() => {
                      setError(null)
                      engine.sites.setChain({ origin: s.origin, chainId: c.chainId }).then(() => setEditing(null), (err: unknown) => setError(err instanceof Error ? err.message : String(err)))
                    }}
                    cursor="pointer"
                    minHeight={44}
                    justifyContent="center"
                    borderColor={c.chainId === s.chainId ? paint.arc : undefined}
                    testID={`site-chain-${hostOf(s.origin)}-${c.chainId}`}
                  >
                    <Body tone={c.chainId === s.chainId ? 'arc' : 'mute'} size="caption">
                      {c.name}
                    </Body>
                  </Chip>
                ))}
              </Row>
            ) : null}
            <Row>
              <Key label={t({ id: 'sites.disconnect', message: 'Disconnect' })} kind="danger" onPress={() => void engine.sites.disconnect({ origin: s.origin })} testID={`site-disconnect-${hostOf(s.origin)}`} />
            </Row>
          </Plate>
        )
      })}
      {error ? <Body tone="burn">{error}</Body> : null}
      <Column gap="$1">
        <Body tone="mute" size="caption">
          {t({ id: 'sites.note', message: 'Each site keeps its own chain. Changing the Home chain never changes a site.' })}
        </Body>
      </Column>
    </ScrollView>
  )
}
