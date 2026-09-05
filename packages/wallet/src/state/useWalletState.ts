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

/** Vault status + accounts, kept current by engine events. */
export function useWalletState(): WalletState {
  const engine = useEngine()
  const [vault, setVault] = useState<VaultStatus | null>(null)
  const [accounts, setAccounts] = useState<readonly AccountView[]>([])
  const [activeId, setActiveId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(() => {
    Promise.all([engine.vault.status(), engine.accounts.list(), engine.accounts.active()]).then(
      ([v, list, active]) => {
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
      if (e.type === 'vault.status') setVault(e.status)
      if (e.type === 'accounts.changed') {
        setAccounts(e.accounts)
        setActiveId(e.activeId)
      }
    })
  }, [engine, refresh])

  const active = accounts.find((a) => a.id === activeId) ?? accounts[0] ?? null
  return { vault, accounts, active, loading, refresh }
}
