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
import {
  ChainSelectPill,
  ChainSheet,
  ManageNetworksKey,
  useChainBalances,
  type ChainOption,
} from './ChainSelect'

const ETN = 52014
export type Scope = 'all' | number

export interface HomeScope {
  /**
   * False until the remembered choice has arrived.
   *
   * Until then `scope` is only the default — Electroneum — and a caller that
   * fetches on it paints another chain's money for a beat. Anything that reads
   * money should hold rather than guess.
   */
  readonly loaded: boolean
  readonly scope: Scope
  /** The chains a snapshot covers: Electroneum first, then the rest. */
  readonly chainIds: readonly number[]
  readonly label: string
  readonly enabled: readonly number[]
  readonly chains: readonly ChainView[]
  setScope(scope: Scope): void
}

/*
  The last settings and chain list, shared for the life of this page.

  They were per-mount state, and the shell unmounts a screen on every
  navigation — so `loaded` was false for a Port round trip on EVERY return to
  Home. Home passes `null` chainIds while the scope is unsettled, which
  `usePortfolio` correctly reads as "hold rather than show another chain's
  money", and holding renders the total as a dash. So coming back to Home
  flashed "—" over a figure the engine already had.

  This is the same fix `usePrefs` carries, for the same reason, in the same
  words: the preference is one value for the whole app, it does not vary by
  screen, and the second screen to ask should not have to ask again. The read
  still happens; it just happens behind what is already correct on screen.
*/
let scopeSnapshot: { settings: Settings | null; chains: ChainView[] } = {
  settings: null,
  chains: [],
}

/** Tests and the harness: forget the shared snapshot. */
export function clearScopeSnapshot(): void {
  scopeSnapshot = { settings: null, chains: [] }
}

export function useHomeScope(): HomeScope {
  const engine = useEngine()
  const { prefs, loaded: prefsLoaded, set } = usePrefs()
  const [settings, setSettings] = useState<Settings | null>(scopeSnapshot.settings)
  const [chains, setChains] = useState<ChainView[]>(scopeSnapshot.chains)
  useEffect(() => {
    let alive = true
    const holdSettings = (s: Settings): void => {
      scopeSnapshot = { ...scopeSnapshot, settings: s }
      if (alive) setSettings(s)
    }
    engine.settings.get().then(holdSettings, () => undefined)
    engine.chains.list().then(
      (c) => {
        scopeSnapshot = { ...scopeSnapshot, chains: c }
        if (alive) setChains(c)
      },
      () => undefined,
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'settings.changed') holdSettings(e.settings)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine])
  const enabled = useMemo(() => settings?.enabledChains ?? [], [settings])
  const scope: Scope =
    prefs.homeScope === 'all'
      ? 'all'
      : prefs.homeScope === ETN || enabled.includes(prefs.homeScope)
        ? prefs.homeScope
        : ETN
  const chainIds = useMemo(
    () => (scope === 'all' ? [ETN, ...enabled.filter((c) => c !== ETN)] : [scope]),
    [scope, enabled],
  )
  const label =
    scope === 'all'
      ? t({ id: 'home.scope.all', message: 'All chains' })
      : scope === ETN
        ? t({ id: 'home.scope.etn', message: 'Electroneum' })
        : (chains.find((c) => c.chainId === scope)?.name ?? `Chain ${scope}`)
  // Settings decide which chains "all" covers and whether a remembered chain is
  // still switched on, so the scope is not settled until both have answered.
  return {
    loaded: prefsLoaded && settings !== null,
    scope,
    chainIds,
    label,
    enabled,
    chains,
    setScope: (s) => set({ homeScope: s }),
  }
}

export function ScopePill({
  scope,
  label,
  onPress,
  size = 'md',
  testID,
}: {
  scope: Scope
  label: string
  onPress: () => void
  size?: 'sm' | 'md'
  testID?: string
}) {
  return (
    <ChainSelectPill chainId={scope} label={label} onPress={onPress} size={size} testID={testID} />
  )
}

export function ChainScopeSheet({
  open,
  onClose,
  scope,
  enabled,
  chains,
  accountId = null,
  total = null,
  onSelect,
  onManage,
  reducedMotion = false,
}: {
  open: boolean
  onClose: () => void
  scope: Scope
  enabled: readonly number[]
  chains: readonly ChainView[]
  accountId?: string | null
  total?: string | null
  onSelect: (scope: Scope) => void
  onManage: () => void
  reducedMotion?: boolean
}) {
  const balances = useChainBalances(accountId)
  const others = enabled.filter((c) => c !== ETN)
  const options: ChainOption[] = [
    {
      id: 'all',
      name: t({ id: 'home.scope.all', message: 'All chains' }),
      caption: t({
        id: 'home.scope.all.caption',
        message: 'Electroneum and {n} more',
        values: { n: others.length },
      }),
      value: total,
    },
    {
      id: ETN,
      name: t({ id: 'home.scope.etn', message: 'Electroneum' }),
      caption: t({ id: 'home.scope.etn.caption', message: 'Your home chain' }),
      value: balances.get(ETN) ?? null,
    },
    ...others.map((c): ChainOption => ({
      id: c,
      name: chains.find((x) => x.chainId === c)?.name ?? `Chain ${c}`,
      value: balances.get(c) ?? null,
    })),
  ]
  return (
    <ChainSheet
      open={open}
      onClose={onClose}
      title={t({ id: 'home.scope.title', message: 'Show balances for' })}
      options={options}
      selected={scope}
      onSelect={onSelect}
      footer={<ManageNetworksKey onPress={onManage} testID="scope-networks" />}
      reducedMotion={reducedMotion}
      testID="scope-sheet"
      rowTestID={(id) => `scope-${id}`}
    />
  )
}
