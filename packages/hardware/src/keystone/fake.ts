/**
 * A scripted Keystone for tests and the harness: an account it exports as a
 * `crypto-hdkey` QR, and a hand that "scans" the wallet's request frames,
 * signs with the matching child key and answers with an `eth-signature` QR.
 */
import { secp256k1 } from '@noble/curves/secp256k1'
import { HDKey } from '@scure/bip32'
import { getAddress, hashMessage, hashTypedData, keccak256, toHex, type Hex } from 'viem'
import { sign } from 'viem/accounts'
import { decodeSignRequest, encodeAccount, encodeSignature } from './ur'

export interface FakeKeystoneOptions {
  readonly seed?: Uint8Array
  readonly xfp?: string
}

export class FakeKeystone {
  rejectNext = false
  readonly log: string[] = []
  readonly xfp: string
  private readonly root: HDKey
  private readonly account: HDKey

  constructor(opts: FakeKeystoneOptions = {}) {
    this.root = HDKey.fromMasterSeed(opts.seed ?? new Uint8Array(64).fill(3))
    this.account = this.root.derive("m/44'/60'/0'")
    this.xfp = opts.xfp ?? 'f23f9fd2'
  }

  /** The QR the device shows under "Connect software wallet". */
  accountFrames(): string[] {
    if (!this.account.publicKey || !this.account.chainCode) throw new Error('no account key')
    return encodeAccount({
      publicKey: this.account.publicKey,
      chainCode: this.account.chainCode,
      xfp: this.xfp,
      name: 'Keystone',
    })
  }

  addressAt(index: number): Hex {
    const k = this.account.deriveChild(0).deriveChild(index)
    if (!k.publicKey) throw new Error('no key')
    const uncompressed = secp256k1.ProjectivePoint.fromHex(k.publicKey).toRawBytes(false)
    return getAddress(`0x${keccak256(uncompressed.slice(1)).slice(-40)}`)
  }

  private keyFor(path: string): Hex {
    const k = this.root.derive(path)
    if (!k.privateKey) throw new Error('no private key')
    return toHex(k.privateKey)
  }

  /** "Scan" the wallet's frames, sign, and answer with the frames the wallet scans back. */
  async answer(frames: readonly string[]): Promise<string[]> {
    const req = decodeSignRequest(frames)
    this.log.push(`${req.dataType}:${req.path}`)
    if (this.rejectNext) {
      this.rejectNext = false
      throw new Error('Rejected on the Keystone.')
    }
    const privateKey = this.keyFor(req.path)
    let hash: Hex
    if (req.dataType === 'transaction' || req.dataType === 'typed_transaction')
      hash = keccak256(req.signData)
    else if (req.dataType === 'personal_message') hash = hashMessage({ raw: req.signData })
    else
      hash = hashTypedData(
        JSON.parse(new TextDecoder().decode(req.signData)) as Parameters<typeof hashTypedData>[0],
      )
    const sig = await sign({ hash, privateKey })
    const yParity = Number(sig.yParity ?? 0)
    // Keystone reports legacy transactions with the EIP-155 v, typed transactions with the bare parity, messages with 27/28.
    const v =
      req.dataType === 'transaction' && req.chainId
        ? req.chainId * 2 + 35 + yParity
        : req.dataType === 'typed_transaction'
          ? yParity
          : 27 + yParity
    const bytes = new Uint8Array(65)
    bytes.set(hexToBytes(sig.r), 0)
    bytes.set(hexToBytes(sig.s), 32)
    bytes[64] = v & 0xff
    return encodeSignature({ signature: bytes, requestId: req.requestId })
  }
}

function hexToBytes(h: Hex): Uint8Array {
  const s = h.slice(2).padStart(64, '0')
  const out = new Uint8Array(32)
  for (let i = 0; i < 32; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
