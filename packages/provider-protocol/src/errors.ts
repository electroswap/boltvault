/**
 * MetaMask-compatible JSON-RPC error codes (T3.5).
 *
 * Design §"Errors (copy MetaMask codes)". A dApp written for MetaMask treats
 * these exact numeric codes as signals (4001 = "user tapped reject", -32002 =
 * "another request is in flight"). Getting them wrong is a compatibility bug,
 * not a cosmetic one — so they are constants, not literals.
 */
export const RPC = {
  /** User rejected (the common "user pressed cancel" case). */
  USER_REJECTED: 4001,
  /** Not connected / unauthorized for this origin. */
  NOT_CONNECTED: 4100,
  /** Method unsupported by the provider. */
  METHOD_UNSUPPORTED: 4200,
  /** Disconnected. */
  DISCONNECTED: 4900,
  /** Chain disconnected. */
  CHAIN_DISCONNECTED: 4901,
  /** Unrecognized chain (wallet_addEthereumChain of a non-registry chain). */
  UNRECOGNIZED_CHAIN: 4902,
  /** Already pending — one in-flight signing request per origin. */
  ALREADY_PENDING: -32002,
  /** Internal / simulation failed. */
  INTERNAL: -32603,
  /** Standard JSON-RPC: method not found. */
  METHOD_NOT_FOUND: -32601,
  /** Standard JSON-RPC: invalid params. */
  INVALID_PARAMS: -32602,
} as const

/** JSON-RPC error payload shape (what the page provider receives). */
export interface RpcErrorPayload {
  readonly code: number
  readonly message: string
  /** Optional structured payload (e.g. simulation diffs). */
  readonly data?: unknown
}

/** Thrown by the router; the SW boundary converts it to a JSON-RPC error payload. */
export class RpcError extends Error {
  code: number
  data?: unknown

  constructor(code: number, message: string, data?: unknown) {
    super(message)
    this.name = 'RpcError'
    this.code = code
    this.data = data
  }

  /** Convert to the wire payload the page provider sees. */
  toPayload(): RpcErrorPayload {
    return { code: this.code, message: this.message, data: this.data }
  }
}
