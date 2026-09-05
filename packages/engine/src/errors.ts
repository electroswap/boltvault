/**
 * Engine errors — the only error shape that crosses the UI↔engine channel.
 *
 * Codes are stable strings (not numbers) so a UI can branch on them without a
 * table, and `data` is always JSON-safe. Provider (EIP-1193) errors keep their
 * own numeric codes in @boltvault/protocol; the engine wraps them when
 * a dApp request surfaces through an ApprovalRequest.
 */
export type EngineErrorCode =
  | 'not_implemented'
  | 'not_found'
  | 'invalid_argument'
  | 'unauthorized'
  | 'locked'
  | 'no_vault'
  | 'wrong_password'
  | 'invalid_mnemonic'
  | 'expired'
  | 'already_decided'
  | 'disconnected'
  | 'timeout'
  | 'internal'

export class EngineError extends Error {
  override readonly name = 'EngineError'
  constructor(
    readonly code: EngineErrorCode,
    message: string,
    readonly data?: unknown,
  ) {
    super(message)
  }

  toJSON(): { code: EngineErrorCode; message: string; data?: unknown } {
    return this.data === undefined
      ? { code: this.code, message: this.message }
      : { code: this.code, message: this.message, data: this.data }
  }

  static from(err: unknown): EngineError {
    if (err instanceof EngineError) return err
    if (err instanceof Error) return new EngineError('internal', err.message)
    return new EngineError('internal', String(err))
  }
}
