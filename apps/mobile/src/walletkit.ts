/**
 * Reown WalletKit on the phone (master plan §5.3) behind the engine's
 * `WalletKitLike`: every event payload is validated before the engine sees
 * it, Verify's verdict rides along with proposals and requests, and the
 * project id is the wallet's own (never the interface's dApp id). Without a
 * project id WalletConnect is simply off.
 */
import '@walletconnect/react-native-compat'
import { SessionProposalSchema, SessionRequestSchema, type ActiveSession, type JsonRpcResponse, type SessionProposal, type SessionRequest, type WalletKitLike } from '@boltvault/connect'
import { z } from 'zod'

/** The wallet's own Reown project (a public identifier); an env value overrides it. */
export const WALLETCONNECT_PROJECT_ID = process.env['EXPO_PUBLIC_WALLETCONNECT_PROJECT_ID'] ?? 'f1eaee6b74bd39f43339dfff17927630'

const METADATA = { name: 'BoltVault', description: 'The Electroneum wallet and ElectroSwap uber-app.', url: 'https://wallet.electroswap.io', icons: ['https://wallet.electroswap.io/icon.png'] }

/*
  `isScam` is read as well as `validation`. They answer different questions —
  one whether the metadata matches the domain it was registered from, the other
  whether that domain is on Reown's malicious list — and only the first was
  parsed, so a proposal Verify had flagged outright reached the Connect sheet
  as merely "unverified".
*/
const Verify = z.object({ verified: z.object({ validation: z.enum(['VALID', 'INVALID', 'UNKNOWN']).optional(), origin: z.string().optional(), isScam: z.boolean().optional() }).optional() }).optional()
const ProposalEvent = z.object({ id: z.number(), params: z.object({ pairingTopic: z.string().optional(), proposer: z.object({ metadata: z.object({ name: z.string().optional(), description: z.string().optional(), url: z.string().optional(), icons: z.array(z.string()).optional() }) }), requiredNamespaces: z.record(z.string(), z.object({ chains: z.array(z.string()).optional(), methods: z.array(z.string()).optional(), events: z.array(z.string()).optional() })).optional(), optionalNamespaces: z.record(z.string(), z.object({ chains: z.array(z.string()).optional(), methods: z.array(z.string()).optional(), events: z.array(z.string()).optional() })).optional() }), verifyContext: Verify })
const RequestEvent = z.object({ id: z.number(), topic: z.string(), params: z.object({ request: z.object({ method: z.string(), params: z.unknown() }), chainId: z.string() }), verifyContext: Verify })
const SessionStruct = z.object({ topic: z.string(), expiry: z.number(), peer: z.object({ metadata: z.object({ name: z.string().optional(), description: z.string().optional(), url: z.string().optional(), icons: z.array(z.string()).optional() }) }), namespaces: z.record(z.string(), z.object({ chains: z.array(z.string()).optional(), accounts: z.array(z.string()) })) })

interface KitApi {
  pair(input: { uri: string }): Promise<unknown>
  approveSession(input: { id: number; namespaces: unknown }): Promise<unknown>
  rejectSession(input: { id: number; reason: { code: number; message: string } }): Promise<void>
  respondSessionRequest(input: { topic: string; response: JsonRpcResponse }): Promise<void>
  disconnectSession(input: { topic: string; reason: { code: number; message: string } }): Promise<void>
  emitSessionEvent(input: { topic: string; chainId: string; event: { name: string; data: unknown } }): Promise<void>
  getActiveSessions(): Record<string, unknown>
  on(event: string, listener: (payload: unknown) => void): unknown
  off(event: string, listener: (payload: unknown) => void): unknown
}

function toSession(raw: unknown): ActiveSession | null {
  const s = SessionStruct.safeParse(raw)
  if (!s.success) return null
  const eip = s.data.namespaces['eip155']
  return { topic: s.data.topic, expiry: s.data.expiry, peer: { name: s.data.peer.metadata.name ?? '', description: s.data.peer.metadata.description ?? '', url: s.data.peer.metadata.url ?? '', icons: s.data.peer.metadata.icons ?? [] }, chains: eip?.chains ?? [], accounts: eip?.accounts ?? [] }
}

/** Build the adapter; resolves null when no project id is configured. */
export async function createWalletKit(): Promise<WalletKitLike | null> {
  if (!WALLETCONNECT_PROJECT_ID) return null
  const [{ WalletKit }, { Core }] = await Promise.all([import('@reown/walletkit'), import('@walletconnect/core')])
  const core = new Core({ projectId: WALLETCONNECT_PROJECT_ID })
  const kit = (await WalletKit.init({ core, metadata: METADATA })) as unknown as KitApi
  return {
    pair: async ({ uri }) => {
      await kit.pair({ uri })
    },
    approveSession: async ({ id, namespaces }) => {
      const s = toSession(await kit.approveSession({ id, namespaces }))
      if (!s) throw new Error('WalletConnect returned a session the wallet cannot read.')
      return s
    },
    rejectSession: (input) => kit.rejectSession(input),
    respondSessionRequest: (input) => kit.respondSessionRequest(input),
    disconnectSession: (input) => kit.disconnectSession(input),
    emitSessionEvent: (input) => kit.emitSessionEvent(input),
    getActiveSessions: () => Object.values(kit.getActiveSessions()).map(toSession).filter((s): s is ActiveSession => s !== null),
    on: ((event: 'session_proposal' | 'session_request' | 'session_delete', listener: (arg: never) => void): (() => void) => {
      const wrapped = (payload: unknown): void => {
        if (event === 'session_proposal') {
          const p = ProposalEvent.safeParse(payload)
          if (!p.success) return
          const proposal: SessionProposal = SessionProposalSchema.parse({ id: p.data.id, pairingTopic: p.data.params.pairingTopic, proposer: { name: p.data.params.proposer.metadata.name ?? '', description: p.data.params.proposer.metadata.description ?? '', url: p.data.params.proposer.metadata.url ?? '', icons: p.data.params.proposer.metadata.icons ?? [] }, requiredNamespaces: p.data.params.requiredNamespaces ?? {}, optionalNamespaces: p.data.params.optionalNamespaces ?? {}, verified: p.data.verifyContext?.verified?.validation ?? 'UNKNOWN', verifiedOrigin: p.data.verifyContext?.verified?.validation === 'VALID' ? (p.data.verifyContext.verified.origin ?? null) : null, isScam: p.data.verifyContext?.verified?.isScam ?? null })
          ;(listener as (p: SessionProposal) => void)(proposal)
        } else if (event === 'session_request') {
          const r = RequestEvent.safeParse(payload)
          if (!r.success) return
          const request: SessionRequest = SessionRequestSchema.parse({ id: r.data.id, topic: r.data.topic, chainId: r.data.params.chainId, method: r.data.params.request.method, params: r.data.params.request.params, verified: r.data.verifyContext?.verified?.validation ?? 'UNKNOWN' })
          ;(listener as (r: SessionRequest) => void)(request)
        } else {
          const d = z.object({ topic: z.string() }).safeParse(payload)
          if (d.success) (listener as (i: { topic: string }) => void)(d.data)
        }
      }
      kit.on(event, wrapped)
      return () => {
        kit.off(event, wrapped)
      }
    }) as WalletKitLike['on'],
  }
}
