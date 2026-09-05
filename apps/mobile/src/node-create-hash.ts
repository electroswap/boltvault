/**
 * `create-hash`, as the Keystone UR registry's `hdkey`/`bs58check` call it,
 * over @noble/hashes — so the browserify hash stack (cipher-base, sha.js,
 * Node streams) never enters the phone bundle. Metro maps `create-hash`
 * here (metro.config.js).
 */
import { ripemd160 } from '@noble/hashes/ripemd160'
import { sha1 } from '@noble/hashes/sha1'
import { sha256 } from '@noble/hashes/sha256'
import { sha512 } from '@noble/hashes/sha512'
import { Buffer } from 'buffer'

type Hash = typeof sha256 | typeof sha512 | typeof ripemd160 | typeof sha1

const HASHES: Record<string, Hash> = { sha256, sha512, ripemd160, rmd160: ripemd160, sha1 }

export interface HashApi {
  update(data: Uint8Array | string, encoding?: string): HashApi
  digest(encoding?: string): Buffer | string
}

function createHash(algorithm: string): HashApi {
  const hash = HASHES[algorithm.toLowerCase().replace('-', '')]
  if (!hash) throw new Error(`create-hash shim: unsupported algorithm ${algorithm}`)
  const h = hash.create()
  const api: HashApi = {
    update(data, encoding) {
      h.update(typeof data === 'string' ? Buffer.from(data, (encoding ?? 'utf8') as BufferEncoding) : data)
      return api
    },
    digest(encoding) {
      const out = Buffer.from(h.digest())
      return encoding ? out.toString(encoding as BufferEncoding) : out
    },
  }
  return api
}

export default createHash
export { createHash }
