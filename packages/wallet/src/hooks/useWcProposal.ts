/**
 * What a WalletConnect peer claims to be (ES-BV-040).
 *
 * A proposal from a peer Verify could not vouch for is given a synthetic
 * origin — `https://<topic>.walletconnect.invalid` — which is right for the
 * firewall and useless to a reader: the Connect sheet rendered that host and
 * nothing else, so the one screen where somebody decides whether to connect
 * showed none of what the app said about itself. The engine has carried the
 * claimed name, URL, icon and a lookalike verdict since the proposal arrived,
 * and nothing read them.
 *
 * Claims, clearly labelled as claims. A peer writes them.
 */
import type { WcProposalView } from '@boltvault/engine'
import { useEffect, useState } from 'react'
import { useEngine } from '../engine/EngineProvider'

export function useWcProposal(origin: string | null): WcProposalView | null {
  const engine = useEngine()
  const [proposals, setProposals] = useState<readonly WcProposalView[]>([])

  useEffect(() => {
    let alive = true
    engine.connect.status().then(
      (s) => {
        if (alive) setProposals(s.proposals)
      },
      () => undefined,
    )
    const off = engine.events.subscribe((e) => {
      if (e.type === 'connect.changed') setProposals(e.proposals)
    })
    return () => {
      alive = false
      off()
    }
  }, [engine])

  if (!origin) return null
  return proposals.find((p) => p.origin === origin) ?? null
}
