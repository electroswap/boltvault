/**
 * The Home chain scope (plan B3, owner item H1): one chain, or "All chains"
 * meaning every enabled chain. The pill is the one chain selector; the sheet
 * is the one chain sheet, each row carrying what the account holds there.
 * The choice is remembered in the prefs document. Electroneum is always in
 * scope and always the fallback when a chosen chain is turned off.
 */
import type { ChainView, Settings } from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { usePrefs } from '../hooks/usePrefs'
import { t } from '../i18n'
import { ChainSelectPill, ChainSheet, ManageNetworksKey, useChainBalances, type ChainOption } from './ChainSelect'

const ETN = 52014
export type Scope = 'all' | number

export interface HomeScope {
  readonly scope: Scope
  /** The chains a snapshot covers: Electroneum first, then the rest. */
  readonly chainIds: readonly number[]
  readonly label: string
  readonly enabled: readonly number[]
  readonly chains: readonly ChainView[]
  setScope(scope: Scope): void
}

export function useHomeScope(): HomeScope {
  const engine = useEngine()
  const { prefs, set } = usePrefs()
  const [settings, setSettings] = useState<Settings | null>(null)
  const [chains, setChains] = useState<ChainView[]>([])
  useEffect(() => {
    let alive = true
    engine.settings.get().then((s) => alive && setSettings(s), () => undefined)
    engine.chains.list().then((c) => alive && setChains(c), () => undefined)
    const off = engine.events.subscribe((e) => {
      if (e.type === 'settings.changed' && alive) setSettings(e.settings)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine])
  const enabled = useMemo(() => settings?.enabledChains ?? [], [settings])
  const scope: Scope = prefs.homeScope === 'all' ? 'all' : prefs.homeScope === ETN || enabled.includes(prefs.homeScope) ? prefs.homeScope : ETN
  const chainIds = useMemo(() => (scope === 'all' ? [ETN, ...enabled.filter((c) => c !== ETN)] : [scope]), [scope, enabled])
  const label = scope === 'all' ? t({ id: 'home.scope.all', message: 'All chains' }) : scope === ETN ? t({ id: 'home.scope.etn', message: 'Electroneum' }) : (chains.find((c) => c.chainId === scope)?.name ?? `Chain ${scope}`)
  return { scope, chainIds, label, enabled, chains, setScope: (s) => set({ homeScope: s }) }
}

export function ScopePill({ scope, label, onPress, size = 'md', testID }: { scope: Scope; label: string; onPress: () => void; size?: 'sm' | 'md'; testID?: string }) {
  return <ChainSelectPill chainId={scope} label={label} onPress={onPress} size={size} testID={testID} />
}

export function ChainScopeSheet({ open, onClose, scope, enabled, chains, accountId = null, total = null, onSelect, onManage, reducedMotion = false }: { open: boolean; onClose: () => void; scope: Scope; enabled: readonly number[]; chains: readonly ChainView[]; accountId?: string | null; total?: string | null; onSelect: (scope: Scope) => void; onManage: () => void; reducedMotion?: boolean }) {
  const balances = useChainBalances(accountId)
  const others = enabled.filter((c) => c !== ETN)
  const options: ChainOption[] = [
    { id: 'all', name: t({ id: 'home.scope.all', message: 'All chains' }), caption: t({ id: 'home.scope.all.caption', message: 'Electroneum and {n} more', values: { n: others.length } }), value: total },
    { id: ETN, name: t({ id: 'home.scope.etn', message: 'Electroneum' }), caption: t({ id: 'home.scope.etn.caption', message: 'Your home chain' }), value: balances.get(ETN) ?? null },
    ...others.map((c): ChainOption => ({ id: c, name: chains.find((x) => x.chainId === c)?.name ?? `Chain ${c}`, value: balances.get(c) ?? null })),
  ]
  return <ChainSheet open={open} onClose={onClose} title={t({ id: 'home.scope.title', message: 'Show balances for' })} options={options} selected={scope} onSelect={onSelect} footer={<ManageNetworksKey onPress={onManage} testID="scope-networks" />} reducedMotion={reducedMotion} testID="scope-sheet" rowTestID={(id) => `scope-${id}`} />
}
