import { pollMs, type ChainHead } from '@boltvault/engine'
import { useCallback, useEffect, useState } from 'react'
import { useEngine, useEngineEvent } from '../engine/EngineProvider'

/**
 * The block heartbeat for one chain: polls `chains.head` on the chain's own
 * cadence while mounted and listens for `chains.head` events from any other
 * consumer, so every surface shares one observation.
 *
 * The cadence used to be five seconds for every chain, which is Electroneum's
 * block time and nobody else's. Ethereum was asked three times a block and
 * told the same number twice; Arbitrum, at 250 ms, could never be current
 * anyway. Owner: "Many of those chains don't have 5 second blocks, so polling
 * as frequently as we do doesn't serve any purpose." `pollMs` is the registry's
 * answer — the chain's block time, floored so nothing is asked faster than
 * home.
 *
 * `mode` says whether this chain is the one on screen or one of the others
 * making up a total; a background chain is asked at a walking pace.
 */
export function useChainHead(chainId: number, mode: 'foreground' | 'background' = 'foreground', intervalMsOverride?: number): ChainHead | null {
  const engine = useEngine()
  const [head, setHead] = useState<ChainHead | null>(null)
  const intervalMs = intervalMsOverride ?? pollMs(chainId, mode)

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
