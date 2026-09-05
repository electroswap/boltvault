/**
 * A scripted WalletKit for tests and the harness: `pair()` raises a
 * proposal for the peer you configured, `simulateRequest()` plays a dApp
 * request and returns the response the wallet gave, sessions live in memory.
 */
import { SessionProposalSchema, type ActiveSession, type ApprovedNamespaces, type JsonRpcResponse, type PeerMetadata, type SessionProposal, type SessionRequest, type VerifyValidation, type WalletKitLike } from './walletkit'

type Listeners = { session_proposal: Set<(p: SessionProposal) => void>; session_request: Set<(r: SessionRequest) => void>; session_delete: Set<(i: { topic: string }) => void> }

export interface FakeWalletKitOptions {
  readonly peer?: PeerMetadata
  readonly verified?: VerifyValidation
  readonly required?: string[]
  readonly optional?: string[]
}

export class FakeWalletKit implements WalletKitLike {
  readonly log: string[] = []
  readonly sessions = new Map<string, ActiveSession>()
  readonly responses = new Map<number, JsonRpcResponse>()
  readonly emitted: Array<{ topic: string; chainId: string; event: { name: string; data: unknown } }> = []
  private listeners: Listeners = { session_proposal: new Set(), session_request: new Set(), session_delete: new Set() }
  private nextId = 1
  private waiting = new Map<number, (r: JsonRpcResponse) => void>()
  peer: PeerMetadata
  verified: VerifyValidation
  required: string[]
  optional: string[]

  constructor(opts: FakeWalletKitOptions = {}) {
    this.peer = opts.peer ?? { name: 'ElectroSwap', description: 'The Electroneum DEX', url: 'https://app.electroswap.io', icons: [] }
    this.verified = opts.verified ?? 'VALID'
    this.required = opts.required ?? ['eip155:52014']
    this.optional = opts.optional ?? ['eip155:1', 'eip155:8453']
  }

  async pair(input: { uri: string }): Promise<void> {
    this.log.push(`pair:${input.uri.slice(0, 12)}`)
    const id = this.nextId++
    const proposal = SessionProposalSchema.parse({ id, pairingTopic: `pairing-${id}`, proposer: this.peer, requiredNamespaces: { eip155: { chains: this.required, methods: ['eth_sendTransaction', 'personal_sign'], events: ['chainChanged', 'accountsChanged'] } }, optionalNamespaces: { eip155: { chains: this.optional, methods: [], events: [] } }, verified: this.verified, verifiedOrigin: this.verified === 'VALID' ? new URL(this.peer.url).origin : null })
    queueMicrotask(() => {
      for (const l of this.listeners.session_proposal) l(proposal)
    })
  }

  async approveSession(input: { id: number; namespaces: ApprovedNamespaces }): Promise<ActiveSession> {
    this.log.push(`approve:${input.id}`)
    const topic = `topic-${input.id}`
    const session: ActiveSession = { topic, peer: this.peer, chains: input.namespaces.eip155.chains, accounts: input.namespaces.eip155.accounts, expiry: Math.floor(Date.now() / 1000) + 7 * 86_400 }
    this.sessions.set(topic, session)
    return session
  }

  async rejectSession(input: { id: number; reason: { code: number; message: string } }): Promise<void> {
    this.log.push(`reject:${input.id}:${input.reason.code}`)
  }

  async respondSessionRequest(input: { topic: string; response: JsonRpcResponse }): Promise<void> {
    this.log.push(`respond:${input.response.id}`)
    this.responses.set(input.response.id, input.response)
    this.waiting.get(input.response.id)?.(input.response)
    this.waiting.delete(input.response.id)
  }

  async disconnectSession(input: { topic: string; reason: { code: number; message: string } }): Promise<void> {
    this.log.push(`disconnect:${input.topic}`)
    this.sessions.delete(input.topic)
  }

  async emitSessionEvent(input: { topic: string; chainId: string; event: { name: string; data: unknown } }): Promise<void> {
    this.emitted.push(input)
  }

  getActiveSessions(): ActiveSession[] {
    return [...this.sessions.values()]
  }

  on(event: 'session_proposal', listener: (proposal: SessionProposal) => void): () => void
  on(event: 'session_request', listener: (request: SessionRequest) => void): () => void
  on(event: 'session_delete', listener: (input: { topic: string }) => void): () => void
  on(event: keyof Listeners, listener: (arg: never) => void): () => void {
    const set = this.listeners[event] as Set<(arg: never) => void>
    set.add(listener)
    return () => {
      set.delete(listener)
    }
  }

  /** A dApp request over the session; resolves with the wallet's JSON-RPC response. */
  simulateRequest(input: { topic: string; method: string; params?: unknown; chainId?: string; verified?: VerifyValidation }): Promise<JsonRpcResponse> {
    const id = this.nextId++
    const req: SessionRequest = { id, topic: input.topic, chainId: input.chainId ?? 'eip155:52014', method: input.method, params: input.params ?? [], verified: input.verified ?? this.verified }
    return new Promise((resolve) => {
      this.waiting.set(id, resolve)
      for (const l of this.listeners.session_request) l(req)
    })
  }

  /** The peer went away. */
  simulateDelete(topic: string): void {
    this.sessions.delete(topic)
    for (const l of this.listeners.session_delete) l({ topic })
  }
}
