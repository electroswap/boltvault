/**
 * The Home chain scope (plan B3, owner item H1): one chain, or "All chains"
 * meaning every enabled chain. A pill shows the choice; a sheet changes it;
 * the choice is remembered in the prefs document. Electroneum is always in
 * scope and always the fallback when a chosen chain is turned off.
 */
import { Body, ChainMark, Column, Icon, Key, Pill, Pressable, Row, Sheet, paint } from '@boltvault/ui'
import type { ChainView, Settings } from '@boltvault/engine'
import { useEffect, useMemo, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { usePrefs } from '../hooks/usePrefs'
import { t } from '../i18n'

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

export function ScopePill({ scope, label, onPress, testID }: { scope: Scope; label: string; onPress: () => void; testID?: string }) {
  return <Pill label={label} icon={scope === 'all' ? <Icon name="globe" size={14} color={paint.arc} /> : <ChainMark chainId={scope} size={16} />} chevron selected={scope !== ETN} size="sm" onPress={onPress} accessibilityLabel={t({ id: 'home.scope.a11y', message: 'Chains shown: {s}', values: { s: label } })} testID={testID} />
}

export function ChainScopeSheet({ open, onClose, scope, enabled, chains, onSelect, onManage, reducedMotion = false }: { open: boolean; onClose: () => void; scope: Scope; enabled: readonly number[]; chains: readonly ChainView[]; onSelect: (scope: Scope) => void; onManage: () => void; reducedMotion?: boolean }) {
  const others = enabled.filter((c) => c !== ETN)
  const options: Array<{ id: Scope; name: string; caption: string | null }> = [
    { id: 'all', name: t({ id: 'home.scope.all', message: 'All chains' }), caption: t({ id: 'home.scope.all.caption', message: 'Electroneum and {n} more', values: { n: others.length } }) },
    { id: ETN, name: t({ id: 'home.scope.etn', message: 'Electroneum' }), caption: t({ id: 'home.scope.etn.caption', message: 'Your home chain' }) },
    ...others.map((c) => ({ id: c as Scope, name: chains.find((x) => x.chainId === c)?.name ?? `Chain ${c}`, caption: null })),
  ]
  return (
    <Sheet open={open} onClose={onClose} title={t({ id: 'home.scope.title', message: 'Show balances for' })} reducedMotion={reducedMotion} footer={<Key label={t({ id: 'home.scope.manage', message: 'Manage networks' })} kind="secondary" size="compact" onPress={onManage} testID="scope-networks" />} testID="scope-sheet">
      <Column gap={2}>
        {options.map((o) => {
          const selected = o.id === scope
          return (
            <Pressable key={String(o.id)} onPress={() => onSelect(o.id)} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={o.name} testID={`scope-${o.id}`} style={{ minHeight: 52, justifyContent: 'center' }}>
              <Row gap="$3" alignItems="center" paddingVertical={6}>
                {o.id === 'all' ? (
                  <Row width={24} height={24} alignItems="center" justifyContent="center">
                    <Icon name="globe" size={20} color={paint.arc} />
                  </Row>
                ) : (
                  <ChainMark chainId={o.id} size={24} />
                )}
                <Column flex={1}>
                  <Body tone={selected ? 'ink' : 'mute'} fontWeight={selected ? '600' : '400'}>
                    {o.name}
                  </Body>
                  {o.caption ? (
                    <Body tone="mute" size="caption">
                      {o.caption}
                    </Body>
                  ) : null}
                </Column>
                {selected ? <Icon name="check" size={18} color={paint.arc} /> : null}
              </Row>
            </Pressable>
          )
        })}
      </Column>
    </Sheet>
  )
}
