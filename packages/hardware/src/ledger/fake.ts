/**
 * A scripted Ledger for tests and the harness: a `HidDeviceLike` that
 * speaks the real HID framing and an Ethereum-app emulation that derives a
 * key per path from a seed, signs with the app's exact conventions (the
 * truncated legacy `v` included) and honours the blind-signing flag and
 * a "reject on device" switch. No real device is needed to exercise every
 * byte the wallet sends and parses.
 *
 * For EIP-712 it does what the real app does and what makes the flow worth
 * having (ES-BV-006): it takes the struct definitions and the walked values,
 * rebuilds the typed-data object from those APDUs alone, and hashes *that*.
 * A signature it returns is therefore proof that the bytes the wallet sent
 * describe the message the wallet meant — if the encoding were wrong, the
 * recovered signer would not match.
 */
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { secp256k1 } from '@noble/curves/secp256k1'
import { hashMessage, hashTypedData, hexToBytes, keccak256, parseTransaction, type Hex } from 'viem'
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
  /** What the device has been told about the typed data it is being shown. */
  private typed: {
    types: Record<string, FakeField[]>
    lastDef: string | null
    roots: string[]
    buckets: ImplEvent[][]
    chunk: Uint8Array | null
  } = FakeEthApp.emptyTyped()
  readonly log: Array<{ ins: number; p1: number; p2: number; len: number; data: Uint8Array }> = []

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

  private static emptyTyped(): FakeEthApp['typed'] {
    return { types: {}, lastDef: null, roots: [], buckets: [], chunk: null }
  }

  private resetTyped(): void {
    this.typed = FakeEthApp.emptyTyped()
  }

  /** Ethereum app 1.9.19 is where the struct instructions become trustworthy. */
  private clearSigningCapable(): boolean {
    const [major, minor, patch] = this.version
    if (major !== 1) return major > 1
    if (minor !== 9) return minor > 9
    return patch >= 19
  }

  /**
   * The EIP-712 hash, rebuilt from the APDUs alone.
   *
   * Nothing here looks at what the wallet meant to send: the struct
   * definitions give the schema, the implementation stream gives the values,
   * and viem hashes the object that comes out. That is what makes a matching
   * signature evidence rather than a tautology.
   */
  private hashFromStructs(): Hex {
    const { types, roots, buckets } = this.typed
    if (roots.length !== 2 || roots[0] !== 'EIP712Domain') throw new Error('fake ledger: the message was never described')
    const primaryType = roots[1] as string
    const domainReader = new ImplReader(buckets[0] as ImplEvent[], types)
    const domain = domainReader.struct('EIP712Domain')
    const messageReader = new ImplReader(buckets[1] as ImplEvent[], types)
    const message = messageReader.struct(primaryType)
    if (!domainReader.done() || !messageReader.done()) throw new Error('fake ledger: more values than the schema has fields')
    // viem derives `EIP712Domain` from the domain object itself, exactly as the
    // wallet did when it built the definitions.
    const { EIP712Domain: _derived, ...rest } = types
    return hashTypedData({ domain, types: rest, primaryType, message } as unknown as Parameters<typeof hashTypedData>[0])
  }

  private sig(pk: Hex, hash: Hex, v: number): Uint8Array {
    const s = secp256k1.sign(hexToBytes(hash), hexToBytes(pk), { lowS: true })
    const out = new Uint8Array(65)
    out[0] = v
    out.set(s.toCompactRawBytes(), 1)
    return out
  }

  async handle(apdu: Uint8Array): Promise<Uint8Array> {
    const [cla, ins, p1, p2, lc] = apdu as unknown as [number, number, number, number, number]
    const data = apdu.subarray(5, 5 + lc)
    this.log.push({ ins, p1, p2, len: data.length, data: data.slice() })
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
      case INS.EIP712_STRUCT_DEF: {
        // An app that predates the flow answers "no such instruction", which
        // is what sends a real wallet back to the hashed one.
        if (!this.clearSigningCapable()) return statusWord(0x6d00)
        if (p2 === 0x00) {
          // A fresh message: the previous one is finished with.
          if (this.typed.roots.length > 0) this.resetTyped()
          const name = asciiOf(data)
          this.typed.types[name] = []
          this.typed.lastDef = name
          return statusWord(0x9000)
        }
        if (p2 !== 0xff) return statusWord(0x6a80)
        const fields = this.typed.lastDef === null ? undefined : this.typed.types[this.typed.lastDef]
        if (!fields) return statusWord(0x6a80)
        fields.push(decodeDefinitionField(data))
        return statusWord(0x9000)
      }
      case INS.EIP712_STRUCT_IMPL: {
        if (!this.clearSigningCapable()) return statusWord(0x6d00)
        if (p2 === 0x00) {
          this.typed.roots.push(asciiOf(data))
          this.typed.buckets.push([])
          return statusWord(0x9000)
        }
        const bucket = this.typed.buckets.at(-1)
        if (!bucket) return statusWord(0x6a80)
        if (p2 === 0x0f) {
          bucket.push({ kind: 'array', n: data[0] as number })
          return statusWord(0x9000)
        }
        if (p2 !== 0xff) return statusWord(0x6a80)
        // A long value arrives across several APDUs; P1 0x01 means "more".
        this.typed.chunk = this.typed.chunk ? concatBytes(this.typed.chunk, data) : data.slice()
        if (p1 === 0x01) return statusWord(0x9000)
        const buf = this.typed.chunk
        this.typed.chunk = null
        if (buf.length < 2) return statusWord(0x6a80)
        const declared = ((buf[0] as number) << 8) | (buf[1] as number)
        const bytes = buf.subarray(2)
        if (bytes.length !== declared) return statusWord(0x6a80)
        bucket.push({ kind: 'field', bytes })
        return statusWord(0x9000)
      }
      case INS.SIGN_EIP712: {
        if (this.rejectNext) {
          this.rejectNext = false
          return statusWord(0x6985)
        }
        const n = FakeEthApp.pathLength(data)
        const pk = pathKey(this.seed, data.subarray(0, n))
        let hash: Hex
        if (p2 === 0x01) {
          if (!this.clearSigningCapable()) return statusWord(0x6d00)
          try {
            hash = this.hashFromStructs()
          } catch {
            this.resetTyped()
            return statusWord(0x6a80)
          }
          this.resetTyped()
        } else {
          const domain = data.subarray(n, n + 32)
          const message = data.subarray(n + 32, n + 64)
          hash = keccak256(concatBytes(new Uint8Array([0x19, 0x01]), domain, message))
        }
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

function asciiOf(b: Uint8Array): string {
  let s = ''
  for (const c of b) s += String.fromCharCode(c)
  return s
}

interface FakeField {
  readonly name: string
  readonly type: string
}

/**
 * Read one struct-definition field back out of its bytes.
 *
 * Deliberately written from the protocol rather than from the encoder: the
 * point of the fake is to disagree when the encoder is wrong.
 */
export function decodeDefinitionField(data: Uint8Array): FakeField {
  let i = 0
  const desc = data[i++] as number
  const key = desc & 0x0f
  let custom = ''
  if (key === 0) {
    const n = data[i++] as number
    custom = asciiOf(data.subarray(i, i + n))
    i += n
  }
  const size = (desc & 0x40) !== 0 ? (data[i++] as number) : null
  const base =
    key === 0
      ? custom
      : key === 1
        ? `int${(size ?? 32) * 8}`
        : key === 2
          ? `uint${(size ?? 32) * 8}`
          : key === 3
            ? 'address'
            : key === 4
              ? 'bool'
              : key === 5
                ? 'string'
                : key === 6
                  ? `bytes${size ?? 32}`
                  : 'bytes'
  let suffix = ''
  if ((desc & 0x80) !== 0) {
    const levels = data[i++] as number
    for (let l = 0; l < levels; l += 1) {
      const kind = data[i++] as number
      if (kind === 0x01) suffix += `[${String(data[i++] as number)}]`
      else suffix += '[]'
    }
  }
  const nameLen = data[i++] as number
  return { name: asciiOf(data.subarray(i, i + nameLen)), type: base + suffix }
}

function decodeLeafValue(type: string, bytes: Uint8Array): unknown {
  if (type === 'address') return bytesToHex(bytes)
  if (type === 'bool') return bytes.some((b) => b !== 0)
  if (type === 'string') return new TextDecoder().decode(bytes)
  if (type === 'bytes' || /^bytes\d+$/.test(type)) return bytesToHex(bytes)
  const m = /^(u?)int(\d+)$/.exec(type)
  if (!m) throw new Error(`fake ledger: unknown leaf type ${type}`)
  let n = 0n
  for (const b of bytes) n = (n << 8n) | BigInt(b)
  if (!m[1]) {
    const bits = BigInt(Number(m[2]))
    if (n >= 1n << (bits - 1n)) n -= 1n << bits
  }
  return n
}

/** One implementation APDU, as the device sees it. */
type ImplEvent = { readonly kind: 'array'; readonly n: number } | { readonly kind: 'field'; readonly bytes: Uint8Array }

/** Replays the implementation stream against the definitions it was given. */
class ImplReader {
  private at = 0
  constructor(
    private readonly events: readonly ImplEvent[],
    private readonly types: Readonly<Record<string, readonly FakeField[]>>,
  ) {}

  struct(name: string): Record<string, unknown> {
    const fields = this.types[name]
    if (!fields) throw new Error(`fake ledger: no definition for ${name}`)
    const out: Record<string, unknown> = {}
    for (const f of fields) out[f.name] = this.value(f.type)
    return out
  }

  done(): boolean {
    return this.at === this.events.length
  }

  private next(): ImplEvent {
    const e = this.events[this.at]
    if (!e) throw new Error('fake ledger: the message ended before the struct did')
    this.at += 1
    return e
  }

  private value(type: string): unknown {
    const arr = /^(.+)\[(\d*)\]$/.exec(type)
    if (arr) {
      const head = this.next()
      if (head.kind !== 'array') throw new Error('fake ledger: expected an array header')
      const out: unknown[] = []
      for (let k = 0; k < head.n; k += 1) out.push(this.value(arr[1] as string))
      return out
    }
    if (this.types[type]) return this.struct(type)
    const ev = this.next()
    if (ev.kind !== 'field') throw new Error('fake ledger: expected a field value')
    return decodeLeafValue(type, ev.bytes)
  }
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
