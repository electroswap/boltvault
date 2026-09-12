/**
 * A scripted Ledger for tests and the harness: a `HidDeviceLike` that
 * speaks the real HID framing and an Ethereum-app emulation that derives a
 * key per path from a seed, signs with the app's exact conventions (the
 * truncated legacy `v` included) and honours the blind-signing flag and
 * a "reject on device" switch. No real device is needed to exercise every
 * byte the wallet sends and parses.
 */
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hashMessage, hexToBytes, keccak256, parseTransaction, type Hex } from 'viem'
import { privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { CLA, concatBytes, INS, statusWord } from './apdu'
import { ApduAssembler, frameApdu, LEDGER_VENDOR_ID, type HidDeviceLike } from './hid'

export interface FakeLedgerOptions {
  /** Any bytes; keys are HMAC-derived per path so addresses are stable per seed. */
  readonly seed?: Uint8Array
  readonly blindSigning?: boolean
  readonly version?: readonly [number, number, number]
  /** The device is locked / not on the Ethereum app. */
  readonly locked?: boolean
  readonly productId?: number
  readonly productName?: string
}

function pathKey(seed: Uint8Array, pathBytes: Uint8Array): Hex {
  const k = hmac(sha256, seed, pathBytes)
  let s = '0x'
  for (const b of k) s += b.toString(16).padStart(2, '0')
  return s as Hex
}

/** The Ethereum app's behaviour over APDUs. Exported so a BLE fake can reuse it. */
export class FakeEthApp {
  rejectNext = false
  blindSigning: boolean
  locked: boolean
  private readonly seed: Uint8Array
  private readonly version: readonly [number, number, number]
  private txBuffer: Uint8Array = new Uint8Array()
  private txPath: Uint8Array = new Uint8Array()
  private msgBuffer: Uint8Array = new Uint8Array()
  private msgPath: Uint8Array = new Uint8Array()
  private msgExpected = 0
  readonly log: Array<{ ins: number; p1: number; len: number }> = []

  constructor(opts: FakeLedgerOptions = {}) {
    this.seed = opts.seed ?? new Uint8Array(32).fill(7)
    this.blindSigning = opts.blindSigning ?? true
    this.locked = opts.locked ?? false
    this.version = opts.version ?? [1, 12, 0]
  }

  accountFor(pathBytes: Uint8Array): PrivateKeyAccount {
    return privateKeyToAccount(pathKey(this.seed, pathBytes))
  }

  private static pathLength(data: Uint8Array): number {
    return 1 + (data[0] as number) * 4
  }

  private sig(pk: Hex, hash: Hex, v: number): Uint8Array {
    const s = secp256k1.sign(hexToBytes(hash), hexToBytes(pk), { lowS: true })
    const out = new Uint8Array(65)
    out[0] = v
    out.set(s.toCompactRawBytes(), 1)
    return out
  }

  async handle(apdu: Uint8Array): Promise<Uint8Array> {
    const [cla, ins, p1, , lc] = apdu as unknown as [number, number, number, number, number]
    const data = apdu.subarray(5, 5 + lc)
    this.log.push({ ins, p1, len: data.length })
    if (cla !== CLA) return statusWord(0x6e00)
    if (this.locked) return statusWord(0x6b0c)
    switch (ins) {
      case INS.GET_APP_CONFIGURATION:
        return concatBytes(new Uint8Array([(this.blindSigning ? 1 : 0) | 0x02, ...this.version]), statusWord(0x9000))
      case INS.GET_ADDRESS: {
        if (p1 === 1 && this.rejectNext) {
          this.rejectNext = false
          return statusWord(0x6985)
        }
        const acct = this.accountFor(data)
        const pub = hexToBytes(acct.publicKey)
        const addr = new TextEncoder().encode(acct.address.slice(2))
        return concatBytes(new Uint8Array([pub.length]), pub, new Uint8Array([addr.length]), addr, statusWord(0x9000))
      }
      case INS.SIGN_TRANSACTION: {
        if (p1 === 0x00) {
          const n = FakeEthApp.pathLength(data)
          this.txPath = data.subarray(0, n)
          this.txBuffer = data.subarray(n).slice()
        } else {
          this.txBuffer = concatBytes(this.txBuffer, data)
        }
        const raw = this.txBuffer
        let done = false
        try {
          parseTransaction(bytesToHex(raw))
          done = true
        } catch {
          done = false
        }
        if (!done) return statusWord(0x9000)
        if (this.rejectNext) {
          this.rejectNext = false
          return statusWord(0x6985)
        }
        const parsed = parseTransaction(bytesToHex(raw))
        const hasData = !!parsed.data && parsed.data !== '0x'
        if (hasData && !this.blindSigning) return statusWord(0x6a80)
        const pk = pathKey(this.seed, this.txPath)
        const hash = keccak256(bytesToHex(raw))
        const parity = secp256k1.sign(hexToBytes(hash), hexToBytes(pk), { lowS: true }).recovery ?? 0
        const legacy = (raw[0] ?? 0) >= 0xc0
        const chainId = parsed.chainId ?? 0
        // The app's exact convention: legacy v is EIP-155 truncated to one byte; typed v is the parity.
        const v = legacy ? (chainId * 2 + 35 + parity) % 256 : parity
        return concatBytes(this.sig(pk, hash, v), statusWord(0x9000))
      }
      case INS.SIGN_PERSONAL_MESSAGE: {
        if (p1 === 0x00) {
          const n = FakeEthApp.pathLength(data)
          this.msgPath = data.subarray(0, n)
          this.msgExpected = new DataView(data.buffer, data.byteOffset + n, 4).getUint32(0)
          this.msgBuffer = data.subarray(n + 4).slice()
        } else {
          this.msgBuffer = concatBytes(this.msgBuffer, data)
        }
        if (this.msgBuffer.length < this.msgExpected) return statusWord(0x9000)
        if (this.rejectNext) {
          this.rejectNext = false
          return statusWord(0x6985)
        }
        const pk = pathKey(this.seed, this.msgPath)
        const hash = hashMessage({ raw: this.msgBuffer })
        const sig = secp256k1.sign(hexToBytes(hash), hexToBytes(pk), { lowS: true })
        return concatBytes(this.sig(pk, hash, 27 + (sig.recovery ?? 0)), statusWord(0x9000))
      }
      case INS.SIGN_EIP712_HASHED: {
        if (this.rejectNext) {
          this.rejectNext = false
          return statusWord(0x6985)
        }
        const n = FakeEthApp.pathLength(data)
        const pk = pathKey(this.seed, data.subarray(0, n))
        const domain = data.subarray(n, n + 32)
        const message = data.subarray(n + 32, n + 64)
        const hash = keccak256(concatBytes(new Uint8Array([0x19, 0x01]), domain, message))
        const sig = secp256k1.sign(hexToBytes(hash), hexToBytes(pk), { lowS: true })
        return concatBytes(this.sig(pk, hash, 27 + (sig.recovery ?? 0)), statusWord(0x9000))
      }
      default:
        return statusWord(0x6d00)
    }
  }
}

function bytesToHex(b: Uint8Array): Hex {
  let s = '0x'
  for (const x of b) s += x.toString(16).padStart(2, '0')
  return s as Hex
}

/** A `HidDeviceLike` wired to a `FakeEthApp` through the real framing. */
export class FakeLedgerDevice implements HidDeviceLike {
  readonly vendorId = LEDGER_VENDOR_ID
  readonly productId: number
  readonly productName: string
  opened = false
  readonly app: FakeEthApp
  private readonly listeners = new Set<(event: { readonly data: DataView }) => void>()
  private readonly assembler = new ApduAssembler()
  /** Every APDU the wallet sent, for assertions. */
  readonly sent: Uint8Array[] = []

  constructor(opts: FakeLedgerOptions = {}) {
    this.app = new FakeEthApp(opts)
    this.productId = opts.productId ?? 0x5011
    this.productName = opts.productName ?? 'Nano S Plus'
  }

  async open(): Promise<void> {
    this.opened = true
  }

  async close(): Promise<void> {
    this.opened = false
  }

  addEventListener(_type: 'inputreport', listener: (event: { readonly data: DataView }) => void): void {
    this.listeners.add(listener)
  }

  removeEventListener(_type: 'inputreport', listener: (event: { readonly data: DataView }) => void): void {
    this.listeners.delete(listener)
  }

  async sendReport(_reportId: number, data: Uint8Array): Promise<void> {
    if (!this.opened) throw new Error('device not open')
    const apdu = this.assembler.push(data)
    if (!apdu) return
    this.sent.push(apdu)
    const response = await this.app.handle(apdu)
    for (const packet of frameApdu(response)) {
      const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength)
      for (const l of [...this.listeners]) l({ data: view })
    }
  }
}

/** A stand-in for `navigator.hid` holding one fake device. */
export function fakeHidProvider(device: HidDeviceLike): { getDevices(): Promise<HidDeviceLike[]> } {
  return { getDevices: async () => [device] }
}
