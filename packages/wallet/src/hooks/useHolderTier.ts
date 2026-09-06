/**
 * The holder tier (§8.18) for the seat mark and the Grid's warmth: the
 * cached tier paints at once, the chain read replaces it.
 */
import type { HolderTier } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

const ETN = 52014

export function useHolderTier(accountId: string | null): HolderTier | null {
  const engine = useEngine()
  const [tier, setTier] = useState<HolderTier | null>(null)
  useEffect(() => {
    setTier(null)
    if (!accountId) return
    let alive = true
    engine.holder.cachedTier({ accountId, chainId: ETN }).then((c) => alive && c && setTier((cur) => cur ?? c.value), () => undefined)
    engine.holder.tier({ accountId, chainId: ETN }).then((x) => alive && setTier(x), () => undefined)
    return () => {
      alive = false
    }
  }, [engine, accountId])
  return tier
}
