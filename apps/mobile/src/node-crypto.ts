/**
 * Node's `crypto`, the two calls the Keystone UR registry's `hdkey` needs
 * on the phone (`createHmac('sha512')` for child derivation and
 * `randomBytes` for wiping), over @noble/hashes and the platform RNG.
 * Metro maps `crypto` here (metro.config.js); nothing else in the bundle
 * touches Node's crypto — the wallet's own kernel is @noble throughout.
 */
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { Buffer } from 'buffer'

type Hash = typeof sha256 | typeof sha512

const HASHES: Record<string, Hash> = { sha256, sha512 }

function toBytes(v: Uint8Array | string): Uint8Array {
  return typeof v === 'string' ? Buffer.from(v, 'utf8') : v
}

export interface Hmac {
  update(data: Uint8Array | string): Hmac
  digest(): Buffer
}

export function createHmac(algorithm: string, key: Uint8Array | string): Hmac {
  const hash = HASHES[algorithm.toLowerCase().replace('-', '')]
  if (!hash) throw new Error(`crypto shim: unsupported HMAC algorithm ${algorithm}`)
  const parts: Uint8Array[] = []
  const api: Hmac = {
    update(data) {
      parts.push(toBytes(data))
      return api
    },
    digest() {
      const total = parts.reduce((n, p) => n + p.length, 0)
      const msg = new Uint8Array(total)
      let o = 0
      for (const p of parts) {
        msg.set(p, o)
        o += p.length
      }
      return Buffer.from(hmac(hash, toBytes(key), msg))
    },
  }
  return api
}

export function randomBytes(size: number): Buffer {
  const out = new Uint8Array(size)
  globalThis.crypto.getRandomValues(out)
  return Buffer.from(out)
}

export default { createHmac, randomBytes }
