/**
 * @boltvault/connect — WalletConnect v2 wallet side (master plan §5.3): the
 * WalletKit interface the engine drives, the CAIP helpers, the approved
 * namespaces builder, and a scripted WalletKit for tests. The SDK itself is
 * the phone app's dependency.
 */
export {
  PeerMetadataSchema,
  VerifyValidationSchema,
  SessionProposalSchema,
  SessionRequestSchema,
  ActiveSessionSchema,
  WC_REASON,
  chainIdFromCaip,
  caipChain,
  caipAccount,
  peerOrigin,
  type PeerMetadata,
  type VerifyValidation,
  type SessionProposal,
  type SessionRequest,
  type ActiveSession,
  type ApprovedNamespaces,
  type JsonRpcResponse,
  type WalletKitLike,
} from './walletkit'
export {
  buildNamespaces,
  WC_METHODS,
  WC_EVENTS,
  type NamespaceInput,
  type NamespaceOutcome,
} from './namespaces'
export { FakeWalletKit, type FakeWalletKitOptions } from './fake'
