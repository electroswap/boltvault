import type { AccountView, VaultStatus } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

export interface WalletState {
  readonly vault: VaultStatus | null
  readonly accounts: readonly AccountView[]
  readonly active: AccountView | null
  readonly loading: boolean
  refresh(): void
}

/**
 * The last answer, shared by every instance for the life of this page.
 *
 * There are ~28 of these mounted across the app and each one used to start at
 * `{ vault: null, loading: true }` and ask again — three Port round trips per
 * instance, on every mount. Since the shell unmounts a screen on every
 * navigation, that meant a screen you had already seen still rendered its
 * logged-out / empty shape for a beat before flipping, which is the "there ->
 * gone -> there" being reported. It is also what made `active?.id` arrive a
 * round trip late and re-key half the cached lists.
 *
 * The data is identical for every caller, so one snapshot is the honest shape
 * for it. The refresh still runs; it just happens behind what is on screen.
 */
let snapshot: { vault: VaultStatus | null; accounts: readonly AccountView[]; activeId: string | null; loaded: boolean } = {
  vault: null,
  accounts: [],
  activeId: null,
  loaded: false,
}

/** Tests and the harness: forget the shared snapshot. */
export function clearWalletSnapshot(): void {
  snapshot = { vault: null, accounts: [], activeId: null, loaded: false }
}

/** Vault status + accounts, kept current by engine events. */
export function useWalletState(): WalletState {
  const engine = useEngine()
  const [vault, setVault] = useState<VaultStatus | null>(snapshot.vault)
  const [accounts, setAccounts] = useState<readonly AccountView[]>(snapshot.accounts)
  const [activeId, setActiveId] = useState<string | null>(snapshot.activeId)
  const [loading, setLoading] = useState(!snapshot.loaded)

  const refresh = useCallback(() => {
    Promise.all([engine.vault.status(), engine.accounts.list(), engine.accounts.active()]).then(
      ([v, list, active]) => {
        snapshot = { vault: v, accounts: list, activeId: active?.id ?? null, loaded: true }
        setVault(v)
        setAccounts(list)
        setActiveId(active?.id ?? null)
        setLoading(false)
      },
      () => setLoading(false),
    )
  }, [engine])

  useEffect(() => {
    refresh()
    return engine.events.subscribe((e) => {
      if (e.type === 'vault.status') {
        snapshot = { ...snapshot, vault: e.status, loaded: true }
        setVault(e.status)
      }
      if (e.type === 'accounts.changed') {
        snapshot = { ...snapshot, accounts: e.accounts, activeId: e.activeId, loaded: true }
        setAccounts(e.accounts)
        setActiveId(e.activeId)
      }
    })
  }, [engine, refresh])

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null
  return { vault, accounts, active, loading, refresh }
}
