/**
 * Air-gapped QR vault pairing — pure logic, no DOM, no network.
 *
 * v1 is NOT a WalletConnect relay: the operator scans QR codes (one per
 * chunk) from a screen on the online device into the air-gapped device, and
 * back. The payload is split into fixed-size chunks so each chunk fits one QR.
 *
 * Crypto (simple, deterministic, documented):
 *   - Plaintext is UTF-8 encoded.
 *   - A keystream is derived from the shared `secret` using SHA-256 (via
 *     @noble/hashes) in a counter mode: block k is `sha256(secret || k)`,
 *     where `k` is a 4-byte big-endian counter starting at 0. Blocks are
 *     concatenated until we have enough bytes.
 *   - Each chunk is XORed with a slice of the keystream offset by
 *     `chunkIndex * chunkSize` (so re-ordering chunks is fine — each chunk
 *     always XORs the same keystream bytes), then base64-encoded.
 *   - Import: chunks are re-sorted by `i`, the XOR is applied again (XOR is
 *     its own inverse), and the result is decoded as UTF-8.
 *
 * Tamper detection: `completeImport` throws if the chunk indices do not
 * cover exactly 0..n-1 (missing/duplicated/out-of-range indices), if chunks
 * disagree on `n`, or if non-final chunks have inconsistent lengths. A wrong
 * secret does NOT throw here — it yields garbled bytes that will usually
 * fail UTF-8/JSON validation by the caller.
 */
import { sha256 } from '@noble/hashes/sha2.js'

export interface PairingChunk {
  /** 0-based chunk index. */
  i: number
  /** Total number of chunks in this export. */
  n: number
  /** base64(XORed chunk bytes). */
  payload: string
}

export interface BeginExportOptions {
  /** Bytes per chunk (default 32). Must be a positive integer. */
  chunkSize?: number
  /** Shared secret known to both devices (any length). */
  secret: Uint8Array
}

const enc = new TextEncoder()
const dec = new TextDecoder()

const b64 = {
  encode(bytes: Uint8Array): string {
    let bin = ''
    for (const b of bytes) bin += String.fromCharCode(b)
    return btoa(bin)
  },
  decode(s: string): Uint8Array {
    const bin = atob(s)
    const out = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
    return out
  },
}

/** Keystream block k = sha256(secret || uint32be(k)). Deterministic per (secret, k). */
function keystreamBlock(secret: Uint8Array, k: number): Uint8Array {
  const input = new Uint8Array(secret.length + 4)
  input.set(secret, 0)
  input[secret.length] = (k >>> 24) & 0xff
  input[secret.length + 1] = (k >>> 16) & 0xff
  input[secret.length + 2] = (k >>> 8) & 0xff
  input[secret.length + 3] = k & 0xff
  return sha256(input)
}

/** `length` keystream bytes starting at absolute byte offset `offset`. */
function keystreamAt(secret: Uint8Array, offset: number, length: number): Uint8Array {
  const out = new Uint8Array(length)
  let produced = 0
  for (let k = Math.floor(offset / 32); produced < length; k++) {
    const block = keystreamBlock(secret, k)
    const skip = offset - k * 32 // bytes into this block
    const take = Math.min(32 - skip, length - produced)
    out.set(block.subarray(skip, skip + take), produced)
    produced += take
  }
  return out
}

function xor(data: Uint8Array, key: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length)
  for (let i = 0; i < data.length; i++) {
    const d = data[i]
    const k = key[i]
    if (d === undefined || k === undefined) throw new Error('xor: length mismatch')
    out[i] = d ^ k
  }
  return out
}

/**
 * Split `plaintext` into `PairingChunk[]` for QR transport.
 * See module docs for the keystream scheme.
 */
export function beginExport(
  plaintext: string,
  opts: BeginExportOptions,
): PairingChunk[] {
  const chunkSize = opts.chunkSize ?? 32
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) {
    throw new Error(`chunkSize must be a positive integer, got ${chunkSize}`)
  }
  const bytes = enc.encode(plaintext)
  if (bytes.length === 0) return []

  const n = Math.ceil(bytes.length / chunkSize)
  const chunks: PairingChunk[] = []
  for (let i = 0; i < n; i++) {
    const slice = bytes.subarray(i * chunkSize, (i + 1) * chunkSize)
    const key = keystreamAt(opts.secret, i * chunkSize, slice.length)
    chunks.push({
      i,
      n,
      payload: b64.encode(xor(slice, key)),
    })
  }
  return chunks
}

/**
 * Reassemble and decrypt chunks produced by {@link beginExport}.
 *
 * Throws `Error` on tampering: chunk indices not covering exactly 0..n-1,
 * disagreeing `n` values, or inconsistent non-final chunk lengths.
 * A wrong secret does not throw here; it yields garbled bytes that will
 * usually fail UTF-8/JSON validation by the caller.
 */
export function completeImport(chunks: PairingChunk[], secret: Uint8Array): string {
  if (chunks.length === 0) return ''

  const declaredN = new Set(chunks.map((c) => c.n))
  if (declaredN.size !== 1) {
    throw new Error('chunks disagree on total count n (tampered)')
  }
  const firstChunk = chunks[0]
  if (!firstChunk) return '' // unreachable: length 0 handled above
  const n = firstChunk.n
  if (n !== chunks.length) {
    throw new Error(
      `expected ${n} chunks, got ${chunks.length} (missing/duplicated — tampered)`,
    )
  }

  // Index each chunk by `i`; reject gaps/duplicates/out-of-range.
  const byIndex = new Map<number, PairingChunk>()
  for (const c of chunks) {
    if (typeof c.i !== 'number' || !Number.isInteger(c.i) || c.i < 0 || c.i >= n) {
      throw new Error(`chunk index out of range: ${c.i} (tampered)`)
    }
    if (byIndex.has(c.i)) {
      throw new Error(`duplicate chunk index ${c.i} (tampered)`)
    }
    byIndex.set(c.i, c)
  }
  for (let i = 0; i < n; i++) {
    if (!byIndex.has(i)) {
      throw new Error(`missing chunk ${i} (tampered)`)
    }
  }

  const ordered: PairingChunk[] = []
  for (let i = 0; i < n; i++) {
    const c = byIndex.get(i)
    if (!c) throw new Error(`missing chunk ${i} (tampered)`) // unreachable
    ordered.push(c)
  }

  // We don't carry the chunk size in the chunk shape; recover it as the max
  // decoded length and validate that only the last chunk may be short.
  const decoded = ordered.map((c) => b64.decode(c.payload))
  const maxLen = Math.max(...decoded.map((d) => d.length))
  for (let i = 0; i < n; i++) {
    const d = decoded[i]
    if (!d) throw new Error(`missing decoded chunk ${i} (tampered)`) // unreachable
    if (i < n - 1 && d.length !== maxLen) {
      throw new Error(`inconsistent chunk size at index ${i} (tampered)`)
    }
  }

  const pieces: Uint8Array[] = []
  for (let i = 0; i < n; i++) {
    const data = decoded[i]
    if (!data) throw new Error(`missing decoded chunk ${i} (tampered)`) // unreachable
    const key = keystreamAt(secret, i * maxLen, data.length)
    pieces.push(xor(data, key))
  }
  const total = pieces.reduce((s, p) => s + p.length, 0)
  const out = new Uint8Array(total)
  let off = 0
  for (const piece of pieces) {
    out.set(piece, off)
    off += piece.length
  }
  return dec.decode(out)
}

/**
 * Export a vault JSON for a watch-only import: same chunking/secret as
 * {@link beginExport}, but the `seedHex` field is blanked (`""`) first so
 * the receiving device gets balances/activity WITHOUT the recovery seed.
 * Watch-only excludes the seed — that is the whole point.
 *
 * Throws if `plaintext` is not a JSON object or lacks a `seedHex` string field.
 */
export function watchOnlyExport(
  plaintext: string,
  secret: Uint8Array,
): PairingChunk[] {
  const parsed = JSON.parse(plaintext) as { seedHex?: unknown }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('watchOnlyExport: plaintext must be a JSON object')
  }
  if (typeof parsed.seedHex !== 'string') {
    throw new Error('watchOnlyExport: plaintext is missing a seedHex string field')
  }
  parsed.seedHex = ''
  return beginExport(JSON.stringify(parsed), { secret })
}
