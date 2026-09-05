/**
 * WalletConnect sessions (master plan §5.3, §2.7 S9): a proposal becomes the
 * ordinary Connect sheet (an `eth_requestAccounts` through a virtual dApp
 * session), a session request becomes an rpcFlow request on that session
 * with the chain aligned first, and the provider's events flow back to the
 * peer. The peer counts as verified only when Reown's Verify said VALID —
 * otherwise the firewall shows ORIGIN_UNVERIFIED on every signature.
 */
import { buildNamespaces, caipChain, chainIdFromCaip, peerOrigin, WC_REASON, type ActiveSession, type SessionProposal, type SessionRequest, type WalletKitLike } from '@boltvault/connect'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { WcProposalView, WcSessionView } from '../schema'
import type { ChainsService } from './chains'
import type { DappsService } from './dapps'
import type { SitesService } from './sites'
import type { VaultManager } from './vault'

export interface ConnectDeps {
  readonly walletKit: WalletKitLike | null
  readonly dapps: DappsService
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly sites: SitesService
  readonly bus: EventBus
  readonly homeChainId?: number
}

interface Pending {
  readonly proposal: SessionProposal
  readonly view: WcProposalView
  readonly sessionId: string
}

interface Live {
  readonly topic: string
  readonly sessionId: string
  readonly origin: string
  session: ActiveSession
}

export class ConnectService {
  private proposals = new Map<number, Pending>()
  private live = new Map<string, Live>()
  private offs: Array<() => void> = []

  constructor(private readonly deps: ConnectDeps) {}

  get available(): boolean {
    return this.deps.walletKit !== null
  }

  /** Subscribe to the kit; restore the sessions it still holds. */
  init(): void {
    const kit = this.deps.walletKit
    if (!kit) return
    this.offs.push(kit.on('session_proposal', (p) => void this.onProposal(p)))
    this.offs.push(kit.on('session_request', (r) => void this.onRequest(r)))
    this.offs.push(kit.on('session_delete', ({ topic }) => void this.onDelete(topic)))
    for (const s of kit.getActiveSessions()) {
      const origin = peerOrigin(s.peer) ?? `wc:${s.topic}`
      const dapp = this.deps.dapps.open({ url: origin.startsWith('wc:') ? `https://${s.topic}.walletconnect.invalid` : origin, kind: 'walletconnect', verified: false })
      this.live.set(s.topic, { topic: s.topic, sessionId: dapp.sessionId, origin: dapp.origin, session: s })
    }
    this.offs.push(
      this.deps.bus.subscribe((e) => {
        if (e.type !== 'dapp.event') return
        const l = [...this.live.values()].find((x) => x.sessionId === e.sessionId)
        if (!l || (e.event !== 'accountsChanged' && e.event !== 'chainChanged')) return
        const chainId = this.deps.sites.get(l.origin)?.chainId ?? this.deps.homeChainId ?? 52014
        void kit.emitSessionEvent({ topic: l.topic, chainId: caipChain(chainId), event: { name: e.event, data: e.payload } }).catch(() => undefined)
      }),
    )
  }

  private emit(): void {
    this.deps.bus.emit({ type: 'connect.changed', proposals: [...this.proposals.values()].map((p) => p.view), sessions: this.sessions() })
  }

  async pair(input: { uri: string }): Promise<void> {
    const kit = this.deps.walletKit
    if (!kit) throw new EngineError('not_implemented', 'WalletConnect is available in the phone app.')
    if (!input.uri.startsWith('wc:')) throw new EngineError('invalid_argument', 'That is not a WalletConnect link.')
    await kit.pair({ uri: input.uri })
  }

  /** A proposal opens a virtual session for the peer and runs the Connect sheet; the answer approves or rejects the session. */
  private async onProposal(proposal: SessionProposal): Promise<void> {
    const kit = this.deps.walletKit
    if (!kit) return
    const verified = proposal.verified === 'VALID'
    const origin = (verified ? proposal.verifiedOrigin : null) ?? peerOrigin(proposal.proposer)
    if (!origin) {
      await kit.rejectSession({ id: proposal.id, reason: WC_REASON.userRejected }).catch(() => undefined)
      return
    }
    const dapp = this.deps.dapps.open({ url: origin, kind: 'walletconnect', verified })
    const view: WcProposalView = { id: proposal.id, name: proposal.proposer.name, url: proposal.proposer.url, icon: proposal.proposer.icons[0] ?? null, origin: dapp.origin, verified, requiredChains: proposal.requiredNamespaces['eip155']?.chains ?? [], optionalChains: proposal.optionalNamespaces['eip155']?.chains ?? [] }
    this.proposals.set(proposal.id, { proposal, view, sessionId: dapp.sessionId })
    this.emit()
    try {
      const answer = await this.deps.dapps.request({ sessionId: dapp.sessionId, id: 1, method: 'eth_requestAccounts', params: [] })
      const address = Array.isArray(answer.result) ? String(answer.result[0] ?? '') : ''
      if (answer.error || !address) throw new EngineError('rejected', answer.error?.message ?? 'No account.')
      const home = this.deps.sites.get(dapp.origin)?.chainId ?? this.deps.homeChainId ?? 52014
      const known = this.deps.chains.list().filter((c) => !c.testnet).map((c) => c.chainId)
      const built = buildNamespaces({ proposal, knownChainIds: known, address, homeChainId: home })
      if (!built.ok) {
        await kit.rejectSession({ id: proposal.id, reason: WC_REASON.unsupportedChains })
        throw new EngineError('invalid_argument', `The app needs chains BoltVault does not have: ${built.missing.join(', ')}.`)
      }
      const session = await kit.approveSession({ id: proposal.id, namespaces: built.namespaces })
      this.live.set(session.topic, { topic: session.topic, sessionId: dapp.sessionId, origin: dapp.origin, session })
    } catch (err) {
      if (!(err instanceof EngineError && err.code === 'invalid_argument')) await kit.rejectSession({ id: proposal.id, reason: WC_REASON.userRejected }).catch(() => undefined)
      this.deps.dapps.close({ sessionId: dapp.sessionId })
      await this.deps.sites.disconnect(dapp.origin).catch(() => undefined)
    } finally {
      this.proposals.delete(proposal.id)
      this.emit()
    }
  }

  private async onRequest(req: SessionRequest): Promise<void> {
    const kit = this.deps.walletKit
    const l = this.live.get(req.topic)
    if (!kit) return
    if (!l) {
      await kit.respondSessionRequest({ topic: req.topic, response: { id: req.id, jsonrpc: '2.0', error: { code: 4900, message: 'No such session.' } } }).catch(() => undefined)
      return
    }
    // The request names its chain; the site session follows it when the wallet knows the chain (§4.6 wallet_switchEthereumChain semantics).
    const chainId = chainIdFromCaip(req.chainId)
    if (chainId !== null && this.deps.chains.known(chainId) && this.deps.sites.get(l.origin)?.chainId !== chainId) await this.deps.sites.setChain(l.origin, chainId).catch(() => undefined)
    const answer = await this.deps.dapps.request({ sessionId: l.sessionId, id: req.id, method: req.method, params: req.params })
    await kit.respondSessionRequest({ topic: req.topic, response: answer.error ? { id: req.id, jsonrpc: '2.0', error: answer.error } : { id: req.id, jsonrpc: '2.0', result: answer.result ?? null } }).catch(() => undefined)
  }

  private async onDelete(topic: string): Promise<void> {
    const l = this.live.get(topic)
    if (!l) return
    this.live.delete(topic)
    this.deps.dapps.close({ sessionId: l.sessionId })
    await this.deps.sites.disconnect(l.origin).catch(() => undefined)
    this.emit()
  }

  async disconnect(input: { topic: string }): Promise<void> {
    const kit = this.deps.walletKit
    if (!kit) return
    await kit.disconnectSession({ topic: input.topic, reason: WC_REASON.disconnected }).catch(() => undefined)
    await this.onDelete(input.topic)
  }

  sessions(): WcSessionView[] {
    return [...this.live.values()].map((l) => ({ topic: l.topic, name: l.session.peer.name, url: l.session.peer.url, icon: l.session.peer.icons[0] ?? null, origin: l.origin, chains: l.session.chains.map(chainIdFromCaip).filter((c): c is number => c !== null), expiry: l.session.expiry }))
  }

  proposalsPending(): WcProposalView[] {
    return [...this.proposals.values()].map((p) => p.view)
  }

  dispose(): void {
    for (const off of this.offs) off()
    this.offs = []
  }
}

export function connectNamespace(connect: ConnectService): NamespaceSpec {
  return {
    status: { handler: async () => ({ available: connect.available, proposals: connect.proposalsPending(), sessions: connect.sessions() }) },
    pair: { input: z.object({ uri: z.string().min(4).max(2048) }), handler: (arg) => connect.pair(arg as { uri: string }) },
    disconnect: { input: z.object({ topic: z.string() }), handler: (arg) => connect.disconnect(arg as { topic: string }) },
  }
}
