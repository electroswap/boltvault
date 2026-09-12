/**
 * Keystone over animated QR (master plan §2.7 S7, §8.1): the wallet shows an
 * `eth-sign-request` UR and scans an `eth-signature` UR back; accounts come
 * in as `crypto-hdkey` (one xpub, children 0/*) or `crypto-account`. UR
 * fountain coding and the registry CBOR come from the reference libraries;
 * everything here is plain bytes in and out.
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { HDKey } from '@scure/bip32'
import { UR, URDecoder, UREncoder } from '@ngraveio/bc-ur'
import { CryptoAccount, CryptoHDKey, CryptoKeypath, DataType, ETHSignature, EthSignRequest, PathComponent } from '@keystonehq/bc-ur-registry-eth'
import { getAddress, keccak256, type Hex } from 'viem'

export type KeystoneDataType = 'transaction' | 'typed_transaction' | 'personal_message' | 'typed_data'

const DATA_TYPES: Record<KeystoneDataType, DataType> = { transaction: DataType.transaction, typed_transaction: DataType.typedTransaction, personal_message: DataType.personalMessage, typed_data: DataType.typedData }

export interface KeystoneSignRequestInput {
  readonly requestId: Uint8Array
  readonly signData: Uint8Array
  readonly dataType: KeystoneDataType
  /** Full path, e.g. m/44'/60'/0'/0/0. */
  readonly path: string
  /** The device's master fingerprint, 8 hex chars. */
  readonly xfp: string
  readonly chainId?: number
  readonly address?: Hex
}

const toBuf = (u: Uint8Array): Buffer => Buffer.from(u.buffer, u.byteOffset, u.byteLength)
const toHexStr = (u: Uint8Array): string => Array.from(u, (b) => b.toString(16).padStart(2, '0')).join('')

/** The registry insists on a real UUID: 16 random bytes with the v4 version and variant bits set. */
export function asUuidBytes(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(16)
  out.set(bytes.slice(0, 16))
  out[6] = ((out[6] ?? 0) & 0x0f) | 0x40
  out[8] = ((out[8] ?? 0) & 0x3f) | 0x80
  return out
}

function uuidOf(bytes: Uint8Array): string {
  const h = toHexStr(bytes.length === 16 ? bytes : bytes.slice(0, 16))
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
}

/** The frames of an animated QR for one signing request (a small request is one frame). */
export function encodeSignRequest(input: KeystoneSignRequestInput, maxFragmentLength = 200): string[] {
  const req = EthSignRequest.constructETHRequest(toBuf(input.signData), DATA_TYPES[input.dataType], input.path, input.xfp, uuidOf(asUuidBytes(input.requestId)), input.chainId, input.address)
  const encoder = req.toUREncoder(maxFragmentLength)
  const frames: string[] = []
  for (let i = 0; i < encoder.fragmentsLength; i++) frames.push(encoder.nextPart().toUpperCase())
  return frames
}

/** Collect scanned parts until the UR completes; `null` while more frames are needed. */
export class UrCollector {
  private decoder = new URDecoder()

  receive(part: string): { type: string; cbor: Uint8Array } | null {
    this.decoder.receivePart(part.trim())
    if (!this.decoder.isComplete()) return null
    if (!this.decoder.isSuccess()) throw new Error('The QR could not be read; try again.')
    const ur = this.decoder.resultUR()
    return { type: ur.type, cbor: new Uint8Array(ur.cbor) }
  }

  /** Progress for the scanner: parts received over the expected count. */
  progress(): { received: number; expected: number } {
    return { received: this.decoder.receivedPartIndexes().length, expected: this.decoder.expectedPartCount() }
  }

  reset(): void {
    this.decoder = new URDecoder()
  }
}

export function decodeUr(parts: readonly string[]): { type: string; cbor: Uint8Array } {
  const c = new UrCollector()
  let out: { type: string; cbor: Uint8Array } | null = null
  for (const p of parts) {
    out = c.receive(p)
    if (out) break
  }
  if (!out) throw new Error('The QR was not complete; keep scanning.')
  return out
}

export interface KeystoneSignature {
  readonly requestId: Uint8Array | null
  /** r || s || v, 65 bytes; v as the device sent it. */
  readonly signature: Uint8Array
}

export function decodeSignature(parts: readonly string[]): KeystoneSignature {
  const ur = decodeUr(parts)
  if (ur.type !== 'eth-signature') throw new Error(`Expected an eth-signature QR, got ${ur.type}.`)
  const sig = ETHSignature.fromCBOR(toBuf(ur.cbor))
  const requestId = sig.getRequestId()
  const signature = new Uint8Array(sig.getSignature())
  if (signature.length !== 65) throw new Error('The signature has the wrong length.')
  return { requestId: requestId ? new Uint8Array(requestId) : null, signature }
}

export interface KeystoneAccountImport {
  readonly xfp: string
  readonly name: string | null
  readonly note: string | null
  readonly addresses: Array<{ path: string; address: Hex; index: number }>
}

function addressOf(publicKey: Uint8Array): Hex {
  const uncompressed = secp256k1.ProjectivePoint.fromHex(publicKey).toRawBytes(false)
  return getAddress(`0x${keccak256(uncompressed.slice(1)).slice(-40)}`)
}

function fromHDKey(key: CryptoHDKey, count: number): KeystoneAccountImport {
  const origin = key.getOrigin()
  const xfp = toHexStr(new Uint8Array(origin?.getSourceFingerprint() ?? key.getParentFingerprint() ?? Buffer.alloc(4)))
  const basePath = `m/${origin?.getPath() ?? "44'/60'/0'"}`
  const hd = new HDKey({ publicKey: new Uint8Array(key.getKey()), chainCode: new Uint8Array(key.getChainCode()) })
  const addresses: KeystoneAccountImport['addresses'] = []
  const children = key.getChildren()?.getPath() ?? '0/*'
  const [branch] = children.split('/')
  const b = Number.parseInt(branch ?? '0', 10) || 0
  for (let i = 0; i < count; i++) {
    const child = hd.deriveChild(b).deriveChild(i)
    if (!child.publicKey) continue
    addresses.push({ path: `${basePath}/${b}/${i}`, address: addressOf(child.publicKey), index: i })
  }
  return { xfp, name: key.getName() ?? null, note: key.getNote() ?? null, addresses }
}

/** Addresses from a Keystone account export (`crypto-hdkey`, or the first descriptors of a `crypto-account`). */
export function decodeAccount(parts: readonly string[], count = 5): KeystoneAccountImport {
  const ur = decodeUr(parts)
  if (ur.type === 'crypto-hdkey') return fromHDKey(CryptoHDKey.fromCBOR(toBuf(ur.cbor)), count)
  if (ur.type === 'crypto-account') {
    const account = CryptoAccount.fromCBOR(toBuf(ur.cbor))
    const xfp = toHexStr(new Uint8Array(account.getMasterFingerprint()))
    const addresses: KeystoneAccountImport['addresses'] = []
    account.getOutputDescriptors().forEach((d, i) => {
      const key = d.getHDKey()
      if (!key || addresses.length >= count) return
      const origin = key.getOrigin()
      const basePath = `m/${origin?.getPath() ?? `44'/60'/${i}'`}`
      const hd = new HDKey({ publicKey: new Uint8Array(key.getKey()), chainCode: new Uint8Array(key.getChainCode()) })
      const child = hd.deriveChild(0).deriveChild(0)
      if (child.publicKey) addresses.push({ path: `${basePath}/0/0`, address: addressOf(child.publicKey), index: i })
    })
    return { xfp, name: null, note: null, addresses }
  }
  throw new Error(`Expected a Keystone account QR, got ${ur.type}.`)
}

/** Build a `crypto-hdkey` UR from an xpub-like key (the fake device and fixtures). */
export function encodeAccount(input: { publicKey: Uint8Array; chainCode: Uint8Array; xfp: string; path?: string; name?: string }): string[] {
  const path = input.path ?? "44'/60'/0'"
  const components = path.split('/').map((p) => new PathComponent({ index: Number.parseInt(p.replace("'", ''), 10), hardened: p.endsWith("'") }))
  const key = new CryptoHDKey({
    isMaster: false,
    key: toBuf(input.publicKey),
    chainCode: toBuf(input.chainCode),
    origin: new CryptoKeypath(components, Buffer.from(input.xfp, 'hex'), components.length),
    children: new CryptoKeypath([new PathComponent({ index: 0, hardened: false }), new PathComponent({ hardened: false })]),
    parentFingerprint: Buffer.from(input.xfp, 'hex'),
    name: input.name ?? 'Keystone',
  })
  const encoder = new UREncoder(new UR(key.toCBOR(), 'crypto-hdkey'), 400)
  const frames: string[] = []
  for (let i = 0; i < encoder.fragmentsLength; i++) frames.push(encoder.nextPart().toUpperCase())
  return frames
}

/** Build an `eth-signature` UR (the fake device). */
export function encodeSignature(input: { signature: Uint8Array; requestId: Uint8Array | null }): string[] {
  const sig = new ETHSignature(toBuf(input.signature), input.requestId ? toBuf(input.requestId) : undefined)
  const encoder = sig.toUREncoder(400)
  const frames: string[] = []
  for (let i = 0; i < encoder.fragmentsLength; i++) frames.push(encoder.nextPart().toUpperCase())
  return frames
}

/** Parse a request the device would see (the fake device, and tests of what we show). */
export function decodeSignRequest(parts: readonly string[]): { requestId: Uint8Array | null; signData: Uint8Array; dataType: KeystoneDataType; path: string; chainId: number | null; address: Uint8Array | null } {
  const ur = decodeUr(parts)
  if (ur.type !== 'eth-sign-request') throw new Error(`Expected an eth-sign-request QR, got ${ur.type}.`)
  const req = EthSignRequest.fromCBOR(toBuf(ur.cbor))
  const t = req.getDataType()
  const dataType: KeystoneDataType = t === DataType.transaction ? 'transaction' : t === DataType.typedTransaction ? 'typed_transaction' : t === DataType.personalMessage ? 'personal_message' : 'typed_data'
  const requestId = req.getRequestId()
  const address = req.getSignRequestAddress()
  return { requestId: requestId ? new Uint8Array(requestId) : null, signData: new Uint8Array(req.getSignData()), dataType, path: `m/${req.getDerivationPath()}`, chainId: req.getChainId() ?? null, address: address ? new Uint8Array(address) : null }
}

