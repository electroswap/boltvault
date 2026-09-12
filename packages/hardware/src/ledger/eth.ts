/**
 * The Ethereum app over one transport: configuration (blind-signing flag,
 * version), addresses (with on-device verification), transaction, personal
 * message and EIP-712 hashed signatures. Chunking mirrors LedgerHQ's
 * hw-app-eth (150-byte chunks; a legacy transaction's EIP-155 tail is never
 * split). Nothing here knows about the wallet — only APDUs.
 */
import { buildApdu, concatBytes, INS, LedgerError, unwrapResponse } from './apdu'
import { pathToBytes } from './paths'

export interface ApduTransport {
  /** `timeoutMs` is a per-exchange override; a transport may ignore it. */
  exchange(apdu: Uint8Array, timeoutMs?: number): Promise<Uint8Array>
}

/**
 * Whether the device can be asked to sign, and what to do when it cannot.
 *
 * Every state here is one a person can fix in a few seconds, which is the
 * whole reason to ask before sending rather than after.
 */
export type LedgerReadiness =
  | { readonly state: 'ready'; readonly app: AppConfiguration }
  | { readonly state: 'locked' | 'wrong_app' | 'no_answer' | 'error'; readonly message: string }

export interface AppConfiguration {
  /** Arbitrary (blind) data signing is enabled in the app's settings. */
  readonly blindSigning: boolean
  /** ERC-20 token metadata must be provisioned before a clear-signed transfer (informational). */
  readonly erc20Provisioning: boolean
  readonly version: string
}

export interface RawSignature {
  readonly v: number
  readonly r: `0x${string}`
  readonly s: `0x${string}`
}

const CHUNK = 150
/**
 * The APDU data field is one byte of length, so 255 is the hard ceiling. The
 * EIP-155 tail rule is allowed to run a chunk past `CHUNK`; this is the bound
 * it may not pass.
 */
const APDU_DATA_MAX = 255

function hex(bytes: Uint8Array): `0x${string}` {
  let s = '0x'
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s as `0x${string}`
}

function parseSignature(payload: Uint8Array): RawSignature {
  if (payload.length < 65) throw new LedgerError('device', 0x9000, 'The device answered with a short signature.')
  return { v: payload[0] as number, r: hex(payload.subarray(1, 33)), s: hex(payload.subarray(33, 65)) }
}

/** Where a legacy transaction's `[chainId, 0, 0]` tail starts, or 0 for typed transactions. */
export function eip155TailOffset(raw: Uint8Array, chainId: number): number {
  const typed = (raw[0] ?? 0) < 0xc0
  if (typed) return 0
  // RLP of chainId: a single byte below 0x80, else 0x80+len followed by the big-endian bytes.
  let len = 1
  if (chainId >= 0x80) {
    let n = chainId
    let bytes = 0
    while (n > 0) {
      bytes += 1
      n = Math.floor(n / 256)
    }
    len = 1 + bytes
  }
  return raw.length - (len + 2)
}

export class LedgerEthApp {
  constructor(private readonly transport: ApduTransport) {}

  private async send(ins: number, p1: number, p2: number, data: Uint8Array, timeoutMs?: number): Promise<Uint8Array> {
    return unwrapResponse(await this.transport.exchange(buildApdu(ins, p1, p2, data), timeoutMs))
  }

  /**
   * Is the device ready to sign? Asked before anything is sent to it.
   *
   * `getAppConfiguration` is the cheapest APDU the Ethereum app answers and
   * the only one that is safe to send unprompted — it shows nothing on the
   * screen and asks the user for nothing. What it tells us is everything that
   * goes wrong at this step: a locked device, the dashboard instead of the
   * app, or a device that does not answer at all.
   *
   * The short deadline is the point. Without it a send begins, the first
   * signing APDU goes out to a dashboard that will not answer, and the sheet
   * spins for a full minute before saying so.
   */
  async ready(timeoutMs = 3_000): Promise<LedgerReadiness> {
    try {
      return { state: 'ready', app: await this.getAppConfiguration(timeoutMs) }
    } catch (err) {
      if (err instanceof LedgerError) {
        if (err.code === 'locked') return { state: 'locked', message: err.message }
        if (err.code === 'wrong_app') return { state: 'wrong_app', message: err.message }
        return { state: 'error', message: err.message }
      }
      // A transport timeout on THIS apdu means the dashboard, not a slow device:
      // the app answers its own configuration immediately or not at all.
      return { state: 'no_answer', message: 'Open the Ethereum app on your Ledger, then try again.' }
    }
  }

  async getAppConfiguration(timeoutMs?: number): Promise<AppConfiguration> {
    const r = await this.send(INS.GET_APP_CONFIGURATION, 0, 0, new Uint8Array(), timeoutMs)
    if (r.length < 4) throw new LedgerError('wrong_app', 0x9000, 'Open the Ethereum app on your Ledger.')
    const flags = r[0] as number
    return { blindSigning: (flags & 0x01) !== 0, erc20Provisioning: (flags & 0x02) !== 0, version: `${r[1]}.${r[2]}.${r[3]}` }
  }

  /** The address at `path`; `verify` makes the device show it for confirmation (§8.5 "Verify on device"). */
  async getAddress(path: string, verify = false): Promise<{ address: `0x${string}`; publicKey: `0x${string}` }> {
    const r = await this.send(INS.GET_ADDRESS, verify ? 1 : 0, 0, pathToBytes(path))
    const pkLen = r[0] as number
    const publicKey = hex(r.subarray(1, 1 + pkLen))
    const addrLen = r[1 + pkLen] as number
    const ascii = r.subarray(2 + pkLen, 2 + pkLen + addrLen)
    let address = ''
    for (const b of ascii) address += String.fromCharCode(b)
    return { address: `0x${address}` as `0x${string}`, publicKey }
  }

  /** Sign a serialised unsigned transaction (typed or legacy with the EIP-155 tail). */
  async signTransaction(path: string, raw: Uint8Array, chainId: number): Promise<RawSignature> {
    const pathBytes = pathToBytes(path)
    const tail = eip155TailOffset(raw, chainId)
    let offset = 0
    let response: Uint8Array = new Uint8Array()
    let first = true
    while (first || offset < raw.length) {
      const max = first ? CHUNK - pathBytes.length : CHUNK
      let size = Math.min(max, raw.length - offset)
      /*
        Never end a chunk on the EIP-155 marker: the app must see the tail with
        its predecessor.

        The clamp that used to follow this line put the chunk straight back to
        `CHUNK`, undoing the rule in exactly the case it exists for. When the
        bytes left at a boundary fall in (CHUNK, CHUNK+5], the last APDU
        carried only the `[chainId, 0, 0]` tail, and the Ethereum app either
        refuses the transaction or parses one with no chain id — returning a
        pre-EIP-155 signature that is valid on every chain. Letting the chunk
        run long is deliberate and safe: the APDU data limit is 255, not
        `CHUNK`. The bound below is the real one.
      */
      if (tail !== 0 && offset + size >= tail && offset + size < raw.length) size = raw.length - offset
      if (size > APDU_DATA_MAX - pathBytes.length) throw new LedgerError('unsupported', 0, 'This transaction is too large for the Ethereum app to receive in one piece.')
      const chunk = raw.subarray(offset, offset + size)
      response = await this.send(INS.SIGN_TRANSACTION, first ? 0x00 : 0x80, 0x00, first ? concatBytes(pathBytes, chunk) : chunk)
      offset += size
      first = false
    }
    return parseSignature(response)
  }

  /** personal_sign: the app prefixes "\x19Ethereum Signed Message:\n" + length itself. */
  async signPersonalMessage(path: string, message: Uint8Array): Promise<RawSignature> {
    const pathBytes = pathToBytes(path)
    const len = new Uint8Array(4)
    new DataView(len.buffer).setUint32(0, message.length)
    let offset = 0
    let response: Uint8Array = new Uint8Array()
    let first = true
    while (first || offset < message.length) {
      const max = first ? CHUNK - pathBytes.length - 4 : CHUNK
      const size = Math.min(max, message.length - offset)
      const chunk = message.subarray(offset, offset + size)
      response = await this.send(INS.SIGN_PERSONAL_MESSAGE, first ? 0x00 : 0x80, 0x00, first ? concatBytes(pathBytes, len, chunk) : chunk)
      offset += size
      first = false
    }
    return parseSignature(response)
  }

  /** EIP-712 by hashes (every app version; the device shows the two hashes — our sheet is the source of truth). */
  async signTypedDataHashed(path: string, domainSeparator: Uint8Array, messageHash: Uint8Array): Promise<RawSignature> {
    if (domainSeparator.length !== 32 || messageHash.length !== 32) throw new Error('hashes must be 32 bytes')
    return parseSignature(await this.send(INS.SIGN_EIP712_HASHED, 0x00, 0x00, concatBytes(pathToBytes(path), domainSeparator, messageHash)))
  }
}
