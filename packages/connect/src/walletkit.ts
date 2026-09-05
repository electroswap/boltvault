/**
 * WalletConnect v2, wallet side (master plan §5.3, §2.7 S9): the slice of
 * Reown's WalletKit the engine drives, as plain data. The real SDK lives in
 * the phone app behind this interface; the engine only ever sees proposals,
 * requests and the answers it gives, and treats a peer as unverified unless
 * the Verify API said otherwise.
 */
import { z } from 'zod'

export const PeerMetadataSchema = z.object({
  name: z.string().default(''),
  description: z.string().default(''),
  url: z.string().default(''),
  icons: z.array(z.string()).default([]),
})
export type PeerMetadata = z.infer<typeof PeerMetadataSchema>

/** What Reown's Verify API concluded about the peer's domain. */
export const VerifyValidationSchema = z.enum(['VALID', 'INVALID', 'UNKNOWN'])
export type VerifyValidation = z.infer<typeof VerifyValidationSchema>

const NamespaceRequirementSchema = z.object({
  chains: z.array(z.string()).optional(),
  methods: z.array(z.string()).default([]),
  events: z.array(z.string()).default([]),
})

export const SessionProposalSchema = z.object({
  id: z.number(),
  pairingTopic: z.string().optional(),
  proposer: PeerMetadataSchema,
  requiredNamespaces: z.record(z.string(), NamespaceRequirementSchema).default({}),
  optionalNamespaces: z.record(z.string(), NamespaceRequirementSchema).default({}),
  verified: VerifyValidationSchema.default('UNKNOWN'),
  /** The origin Verify attested (when VALID) — the registrable origin the firewall sees. */
  verifiedOrigin: z.string().nullable().default(null),
})
export type SessionProposal = z.infer<typeof SessionProposalSchema>

export const SessionRequestSchema = z.object({
  id: z.number(),
  topic: z.string(),
  /** CAIP-2, e.g. `eip155:52014`. */
  chainId: z.string(),
  method: z.string(),
  params: z.unknown(),
  verified: VerifyValidationSchema.default('UNKNOWN'),
})
export type SessionRequest = z.infer<typeof SessionRequestSchema>

export const ActiveSessionSchema = z.object({
  topic: z.string(),
  peer: PeerMetadataSchema,
  /** CAIP-2 chains the session was approved for. */
  chains: z.array(z.string()),
  /** CAIP-10 accounts. */
  accounts: z.array(z.string()),
  expiry: z.number(),
})
export type ActiveSession = z.infer<typeof ActiveSessionSchema>

export interface ApprovedNamespaces {
  readonly eip155: { readonly chains: string[]; readonly accounts: string[]; readonly methods: string[]; readonly events: string[] }
}

export type JsonRpcResponse = { readonly id: number; readonly jsonrpc: '2.0'; readonly result: unknown } | { readonly id: number; readonly jsonrpc: '2.0'; readonly error: { readonly code: number; readonly message: string; readonly data?: unknown } }

export interface WalletKitLike {
  /** Start the pairing from a `wc:` URI (scanned or deep-linked). */
  pair(input: { uri: string }): Promise<void>
  approveSession(input: { id: number; namespaces: ApprovedNamespaces }): Promise<ActiveSession>
  rejectSession(input: { id: number; reason: { code: number; message: string } }): Promise<void>
  respondSessionRequest(input: { topic: string; response: JsonRpcResponse }): Promise<void>
  disconnectSession(input: { topic: string; reason: { code: number; message: string } }): Promise<void>
  emitSessionEvent(input: { topic: string; chainId: string; event: { name: string; data: unknown } }): Promise<void>
  getActiveSessions(): ActiveSession[]
  on(event: 'session_proposal', listener: (proposal: SessionProposal) => void): () => void
  on(event: 'session_request', listener: (request: SessionRequest) => void): () => void
  on(event: 'session_delete', listener: (input: { topic: string }) => void): () => void
}

/** WalletConnect's reason codes the wallet uses. */
export const WC_REASON = {
  userRejected: { code: 5000, message: 'User rejected.' },
  unsupportedChains: { code: 5100, message: 'Unsupported chains.' },
  disconnected: { code: 6000, message: 'User disconnected.' },
} as const

/** `eip155:52014` → 52014; null for anything that is not an EVM chain id. */
export function chainIdFromCaip(caip: string): number | null {
  const m = /^eip155:(\d+)$/.exec(caip)
  return m ? Number(m[1]) : null
}

export function caipChain(chainId: number): string {
  return `eip155:${chainId}`
}

export function caipAccount(chainId: number, address: string): string {
  return `eip155:${chainId}:${address}`
}

/** The registrable origin behind a peer's URL, or null when it is not http(s). */
export function peerOrigin(meta: PeerMetadata): string | null {
  try {
    const u = new URL(meta.url)
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}
