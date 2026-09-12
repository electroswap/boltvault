/**
 * EIP-1193 / MetaMask-compatible error codes (master plan §4.6). dApps branch
 * on these numbers (4001 = the user said no, -32002 = one is already open),
 * so they are constants, never literals.
 */
export const RPC = {
  USER_REJECTED: 4001,
  UNAUTHORIZED: 4100,
  UNSUPPORTED_METHOD: 4200,
  DISCONNECTED: 4900,
  CHAIN_DISCONNECTED: 4901,
  UNRECOGNIZED_CHAIN: 4902,
  INVALID_INPUT: -32000,
  RESOURCE_UNAVAILABLE: -32002,
  LIMIT_EXCEEDED: -32005,
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
} as const

export interface RpcErrorPayload {
  readonly code: number
  readonly message: string
  /** Our firewall rule code(s) when a block caused the rejection. */
  readonly data?: unknown
}

export class RpcError extends Error {
  override readonly name = 'RpcError'
  constructor(
    readonly code: number,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }

  toPayload(): RpcErrorPayload {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }

  static from(err: unknown): RpcError {
    if (err instanceof RpcError) return err
    if (
      err &&
      typeof err === 'object' &&
      'code' in err &&
      typeof (err as { code: unknown }).code === 'number'
    ) {
      const e = err as { code: number; message?: string; data?: unknown }
      return new RpcError(e.code, e.message ?? 'error', e.data)
    }
    // The engine's own codes are strings. Only the ones with an exact JSON-RPC
    // counterpart are translated, so a dApp sees a standard code rather than a
    // generic internal error it cannot act on.
    if (err && typeof err === 'object' && (err as { code?: unknown }).code === 'limit_exceeded') {
      return new RpcError(
        RPC.LIMIT_EXCEEDED,
        err instanceof Error ? err.message : 'Too many requests.',
      )
    }
    return new RpcError(RPC.INTERNAL, err instanceof Error ? err.message : String(err))
  }
}

export const userRejected = (): RpcError =>
  new RpcError(RPC.USER_REJECTED, 'User rejected the request.')
