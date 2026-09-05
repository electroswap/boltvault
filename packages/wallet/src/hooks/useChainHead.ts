import type { ChainHead } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'

/**
 * The block heartbeat for one chain: polls `chains.head` on the chain's
 * cadence while mounted and listens for `chains.head` events from any other
 * consumer, so every surface shares one observation.
 */
export function useChainHead(chainId: number, intervalMs = 5_000): ChainHead | null {
  const engine = useEngine()
  const [head, setHead] = useState<ChainHead | null>(null)

  const onHead = useCallback(
    (event: { head: ChainHead }) => {
      if (event.head.chainId === chainId) setHead(event.head)
    },
    [chainId],
  )
  useEngineEvent('chains.head', onHead)

  useEffect(() => {
    let cancelled = false
    const tick = (): void => {
      engine.chains.head({ chainId }).then(
        (h) => {
          if (!cancelled) setHead(h)
        },
        () => {
          if (!cancelled) setHead((prev) => (prev ? { ...prev, live: false } : prev))
        },
      )
    }
    tick()
    const timer = setInterval(tick, intervalMs)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [engine, chainId, intervalMs])

  return head
}
