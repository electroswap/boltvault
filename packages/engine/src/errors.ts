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
  | 'rejected'
  | 'disconnected'
  | 'timeout'
  /** Too many requests already waiting for a human (§3.5: a page must not be able to bury the sheet). */
  | 'limit_exceeded'
  /**
   * Too many wrong answers, too fast (ES-BV-004, ES-BV-008).
   *
   * The only cost of a guess used to be Argon2id, which is a few per second —
   * enough to grind a weak password through the UI port, silently, with the
   * profile in hand. `data` carries `{ seconds }` so a screen can count down
   * rather than say "try again" and mean nothing.
   */
  | 'throttled'
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
