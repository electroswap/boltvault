/**
 * APDU building and the Ethereum app's status words. The app's protocol is
 * public (LedgerHQ/app-ethereum, doc/ethapp.adoc); this is the subset the
 * wallet uses: configuration, address, transaction, personal message and
 * EIP-712 (hashed) signatures.
 */

export const CLA = 0xe0
export const INS = {
  GET_ADDRESS: 0x02,
  SIGN_TRANSACTION: 0x04,
  GET_APP_CONFIGURATION: 0x06,
  SIGN_PERSONAL_MESSAGE: 0x08,
  SIGN_EIP712_HASHED: 0x0c,
} as const

export type LedgerErrorCode = 'rejected' | 'locked' | 'wrong_app' | 'blind_signing_off' | 'invalid_data' | 'unsupported' | 'device'

export class LedgerError extends Error {
  override readonly name = 'LedgerError'
  constructor(
    readonly code: LedgerErrorCode,
    readonly statusWord: number,
    message: string,
  ) {
    super(message)
  }
}

/** Plain-language mapping of the status words the app returns (§7.10: say what happened and what to do). */
export function errorForStatus(sw: number): LedgerError {
  switch (sw) {
    case 0x6985:
    case 0x5501:
      return new LedgerError('rejected', sw, 'You rejected it on the device.')
    case 0x6b0c:
    case 0x5515:
      return new LedgerError('locked', sw, 'Your Ledger is locked. Unlock it and try again.')
    case 0x6511:
    case 0x6e00:
    case 0x6e01:
    case 0x6d00:
      return new LedgerError('wrong_app', sw, 'Open the Ethereum app on your Ledger.')
    case 0x6a80:
    case 0x6d02:
      return new LedgerError('blind_signing_off', sw, 'This transaction needs blind signing. Turn it on in the Ethereum app’s settings on the device, then try again.')
    case 0x6d05:
      return new LedgerError('unsupported', sw, 'Your Ethereum app is too old for this. Update it in Ledger Live.')
    default:
      return new LedgerError('device', sw, `The device answered with an error (0x${sw.toString(16)}).`)
  }
}

export function buildApdu(ins: number, p1: number, p2: number, data: Uint8Array): Uint8Array {
  if (data.length > 255) throw new Error('APDU data over 255 bytes')
  const out = new Uint8Array(5 + data.length)
  out[0] = CLA
  out[1] = ins
  out[2] = p1
  out[3] = p2
  out[4] = data.length
  out.set(data, 5)
  return out
}

/** Split a response into payload and status word; throws the mapped error on anything but 0x9000. */
export function unwrapResponse(response: Uint8Array): Uint8Array {
  if (response.length < 2) throw new LedgerError('device', 0, 'The device answered with nothing.')
  const sw = ((response[response.length - 2] ?? 0) << 8) | (response[response.length - 1] ?? 0)
  if (sw !== 0x9000) throw errorForStatus(sw)
  return response.subarray(0, response.length - 2)
}

export function statusWord(sw: number): Uint8Array {
  return new Uint8Array([(sw >> 8) & 0xff, sw & 0xff])
}

export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0))
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}
