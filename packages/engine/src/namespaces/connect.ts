/**
 * WalletConnect sessions (master plan §5.3, §2.7 S9): a proposal becomes the
 * ordinary Connect sheet (an `eth_requestAccounts` through a virtual dApp
 * session), a session request becomes an rpcFlow request on that session
 * with the chain aligned first, and the provider's events flow back to the
 * peer. The peer counts as verified only when Reown's Verify said VALID —
 * otherwise the firewall shows ORIGIN_UNVERIFIED on every signature.
 */
import {
  buildNamespaces,
  caipChain,
  chainIdFromCaip,
  WC_REASON,
  type ActiveSession,
  type SessionProposal,
  type SessionRequest,
  type WalletKitLike,
} from '@boltvault/connect'
import { hostOf, isScamOrigin, registrableOrigin, typosquat } from '@boltvault/security'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { SealedMap } from '../sealed'
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
  /** Scam-listed origins from the signed statics, for screening a peer's claimed URL. */
  readonly scamOrigins?: () => readonly string[]
  /**
   * `topic → { origin, verified }`, sealed under the DEK.
   *
   * A restored session used to be re-keyed to `https://<topic>.walletconnect
   * .invalid`, which orphaned the real site row and put `ORIGIN_UNVERIFIED` on
   * every signature the session made after a restart — every restart, for every
   * live session. What Verify attested at pairing time is remembered instead.
   */
  readonly sessions?: SealedMap<{ origin: string; verified: boolean }>
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
    void this.restore(kit)
    this.offs.push(
      this.deps.bus.subscribe((e) => {
        if (e.type !== 'dapp.event') return
        const l = [...this.live.values()].find((x) => x.sessionId === e.sessionId)
        if (!l || (e.event !== 'accountsChanged' && e.event !== 'chainChanged')) return
        const chainId = this.deps.sites.get(l.origin)?.chainId ?? this.deps.homeChainId ?? 52014
        void kit
          .emitSessionEvent({
            topic: l.topic,
            chainId: caipChain(chainId),
            event: { name: e.event, data: e.payload },
          })
          .catch(() => undefined)
      }),
    )
  }

  /**
   * Re-open the sessions the kit still holds, on the origins they were
   * approved for.
   *
   * The event payload of a restored session carries no Verify result, which is
   * not the same as Verify having said nothing: it said something once, at
   * pairing, and that is what was written down. Falling back to the synthetic
   * topic origin only when there is nothing remembered — a session paired
   * before this shipped, or one whose record cannot be read.
   */
  private async restore(kit: WalletKitLike): Promise<void> {
    for (const s of kit.getActiveSessions()) {
      const held = (await this.deps.sessions?.get(s.topic).catch(() => null)) ?? null
      const url = held?.origin ?? `https://${s.topic}.walletconnect.invalid`
      const verified = held?.verified ?? false
      const dapp = this.deps.dapps.open({
        url,
        kind: 'walletconnect',
        verified,
        verify: verified ? 'valid' : 'unknown',
      })
      this.live.set(s.topic, {
        topic: s.topic,
        sessionId: dapp.sessionId,
        origin: dapp.origin,
        session: s,
      })
    }
    this.emit()
  }

  private emit(): void {
    this.deps.bus.emit({
      type: 'connect.changed',
      proposals: [...this.proposals.values()].map((p) => p.view),
      sessions: this.sessions(),
    })
  }

  async pair(input: { uri: string }): Promise<void> {
    const kit = this.deps.walletKit
    if (!kit)
      throw new EngineError('not_implemented', 'WalletConnect is available in the phone app.')
    if (!input.uri.startsWith('wc:'))
      throw new EngineError('invalid_argument', 'That is not a WalletConnect link.')
    await kit.pair({ uri: input.uri })
  }

  /** A proposal opens a virtual session for the peer and runs the Connect sheet; the answer approves or rejects the session. */
  private async onProposal(proposal: SessionProposal): Promise<void> {
    const kit = this.deps.walletKit
    if (!kit) return
    const verified = proposal.verified === 'VALID'
    /*
      The claimed URL is screened even though it is not trusted as an identity.

      Because the firewall origin is synthetic for anything but a VALID
      proposal, `originScam` and `originTyposquat` never saw `proposer.url` at
      all — the one string the peer does supply about itself went unread. It
      still does not become the origin; it is simply checked, and a proposal
      whose claim is on the scam list, or that Verify itself flagged, is
      refused outright rather than shown as "unverified".
    */
    const claimed = registrableOrigin(proposal.proposer.url) ?? proposal.proposer.url
    const listed = isScamOrigin(claimed, this.deps.scamOrigins?.() ?? [])
    if (proposal.isScam === true || listed) {
      await kit
        .rejectSession({ id: proposal.id, reason: WC_REASON.userRejected })
        .catch(() => undefined)
      this.emit()
      return
    }
    /*
      An unverified peer does not get to name itself.

      The origin decides which stored session a request belongs to, and
      sessions live in one map shared by every transport. Taking it from the
      peer's own metadata meant a proposal could simply claim an origin the
      user had already connected in the in-app browser — `app.electroswap.io`
      is the browser's own home page — and `RpcFlow.connect()` would find that
      session and return the account with no Connect sheet at all. The claim is
      still shown to the user as a claim (`view.url`); it is no longer treated
      as an identity. Only Reown's Verify can supply one.
    */
    const origin =
      verified && proposal.verifiedOrigin
        ? proposal.verifiedOrigin
        : `https://${proposal.pairingTopic ?? proposal.id}.walletconnect.invalid`
    const verdict =
      proposal.verified === 'VALID'
        ? 'valid'
        : proposal.verified === 'INVALID'
          ? 'invalid'
          : 'unknown'
    const dapp = this.deps.dapps.open({
      url: origin,
      kind: 'walletconnect',
      verified,
      verify: verdict,
    })
    const lookalike = typosquat(hostOf(claimed) ?? '')?.protectedHost ?? null
    const view: WcProposalView = {
      id: proposal.id,
      name: proposal.proposer.name,
      url: proposal.proposer.url,
      icon: proposal.proposer.icons[0] ?? null,
      origin: dapp.origin,
      verified,
      claimLooksLike: lookalike,
      requiredChains: proposal.requiredNamespaces['eip155']?.chains ?? [],
      optionalChains: proposal.optionalNamespaces['eip155']?.chains ?? [],
    }
    this.proposals.set(proposal.id, { proposal, view, sessionId: dapp.sessionId })
    this.emit()
    try {
      const answer = await this.deps.dapps.request({
        sessionId: dapp.sessionId,
        id: 1,
        method: 'eth_requestAccounts',
        params: [],
      })
      const address = Array.isArray(answer.result) ? String(answer.result[0] ?? '') : ''
      if (answer.error || !address)
        throw new EngineError('rejected', answer.error?.message ?? 'No account.')
      const home = this.deps.sites.get(dapp.origin)?.chainId ?? this.deps.homeChainId ?? 52014
      const known = this.deps.chains
        .list()
        .filter((c) => !c.testnet)
        .map((c) => c.chainId)
      const built = buildNamespaces({ proposal, knownChainIds: known, address, homeChainId: home })
      if (!built.ok) {
        await kit.rejectSession({ id: proposal.id, reason: WC_REASON.unsupportedChains })
        throw new EngineError(
          'invalid_argument',
          `The app needs chains BoltVault does not have: ${built.missing.join(', ')}.`,
        )
      }
      const session = await kit.approveSession({ id: proposal.id, namespaces: built.namespaces })
      this.live.set(session.topic, {
        topic: session.topic,
        sessionId: dapp.sessionId,
        origin: dapp.origin,
        session,
      })
      // Remembered, so a restart does not re-key the session to a synthetic origin.
      await this.deps.sessions
        ?.set(session.topic, { origin: dapp.origin, verified })
        .catch(() => undefined)
    } catch (err) {
      if (!(err instanceof EngineError && err.code === 'invalid_argument'))
        await kit
          .rejectSession({ id: proposal.id, reason: WC_REASON.userRejected })
          .catch(() => undefined)
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
      await kit
        .respondSessionRequest({
          topic: req.topic,
          response: {
            id: req.id,
            jsonrpc: '2.0',
            error: { code: 4900, message: 'No such session.' },
          },
        })
        .catch(() => undefined)
      return
    }
    /*
      The chain has to be one this session was approved for.

      The site session used to follow whatever chain the peer named, as long as
      the wallet knew it — silently, with no comparison against the approved
      namespaces and none of the once-per-chain consent an injected origin gets
      from `wallet_switchEthereumChain`. A peer approved for Electroneum could
      name `eip155:1` on its next request and sign on Ethereum instead.
    */
    const chainId = chainIdFromCaip(req.chainId)
    const approved = l.session.chains.length === 0 || l.session.chains.includes(req.chainId)
    if (chainId === null || !this.deps.chains.known(chainId) || !approved) {
      await kit
        .respondSessionRequest({
          topic: req.topic,
          response: {
            id: req.id,
            jsonrpc: '2.0',
            error: {
              code: WC_REASON.unsupportedChains.code,
              message: `This session was not approved for ${req.chainId}.`,
            },
          },
        })
        .catch(() => undefined)
      return
    }
    /*
      Inside the approved namespaces, moving is free: those chains are exactly
      what the person agreed to at the Connect sheet, and asking again for each
      one would be asking twice for the same thing. Outside them there is no
      consent to lean on, which is the branch above.
    */
    if (this.deps.sites.get(l.origin)?.chainId !== chainId)
      await this.deps.sites.setChain(l.origin, chainId).catch(() => undefined)
    const answer = await this.deps.dapps.request({
      sessionId: l.sessionId,
      id: req.id,
      method: req.method,
      params: req.params,
    })
    await kit
      .respondSessionRequest({
        topic: req.topic,
        response: answer.error
          ? { id: req.id, jsonrpc: '2.0', error: answer.error }
          : { id: req.id, jsonrpc: '2.0', result: answer.result ?? null },
      })
      .catch(() => undefined)
  }

  private async onDelete(topic: string): Promise<void> {
    const l = this.live.get(topic)
    if (!l) return
    this.live.delete(topic)
    this.deps.dapps.close({ sessionId: l.sessionId })
    await this.deps.sites.disconnect(l.origin).catch(() => undefined)
    // Last, and after the disconnect: forgetting where the session was is
    // bookkeeping, and nothing downstream waits on it.
    await this.deps.sessions?.delete(topic).catch(() => undefined)
    this.emit()
  }

  async disconnect(input: { topic: string }): Promise<void> {
    const kit = this.deps.walletKit
    if (!kit) return
    await kit
      .disconnectSession({ topic: input.topic, reason: WC_REASON.disconnected })
      .catch(() => undefined)
    await this.onDelete(input.topic)
  }

  sessions(): WcSessionView[] {
    return [...this.live.values()].map((l) => ({
      topic: l.topic,
      name: l.session.peer.name,
      url: l.session.peer.url,
      icon: l.session.peer.icons[0] ?? null,
      origin: l.origin,
      chains: l.session.chains.map(chainIdFromCaip).filter((c): c is number => c !== null),
      expiry: l.session.expiry,
    }))
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
    status: {
      handler: async () => ({
        available: connect.available,
        proposals: connect.proposalsPending(),
        sessions: connect.sessions(),
      }),
    },
    pair: {
      input: z.object({ uri: z.string().min(4).max(2048) }),
      handler: (arg) => connect.pair(arg as { uri: string }),
    },
    disconnect: {
      input: z.object({ topic: z.string() }),
      handler: (arg) => connect.disconnect(arg as { topic: string }),
    },
  }
}
