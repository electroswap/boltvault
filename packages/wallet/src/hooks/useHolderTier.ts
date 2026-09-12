/**
 * The holder tier (§8.18) for the seat mark and the Grid's warmth: the
 * cached tier paints at once, the chain read replaces it.
 */
import type { HolderTier } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'
import { useLastGood } from './useLastGood'

const ETN = 52014

export function useHolderTier(accountId: string | null): HolderTier | null {
  const engine = useEngine()
  const [loaded, setTier] = useState<HolderTier | null>(null)
  // Home is a tab, so the shell unmounts it on every switch and this hook
  // starts empty again. Remembering the last answer per account is what stops
  // Home coming back as a dash, an absent tier badge and a missing dividends
  // row before everything pops in a beat later.
  const tier = useLastGood(accountId === null ? null : `tier:${accountId}`, loaded)
  useEffect(() => {
    setTier(null)
    if (!accountId) return
    let alive = true
    engine.holder.cachedTier({ accountId, chainId: ETN }).then(
      (c) => alive && c && setTier((cur) => cur ?? c.value),
      () => undefined,
    )
    engine.holder.tier({ accountId, chainId: ETN }).then(
      (x) => alive && setTier(x),
      () => undefined,
    )
    return () => {
      alive = false
    }
  }, [engine, accountId])
  return tier
}
