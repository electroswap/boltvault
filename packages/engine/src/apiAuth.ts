/**
 * How the wallet proves it is the wallet (§9.1).
 *
 * Every install ships the same key, so it was never a secret — but it was a
 * *bearer* token, and that is the part worth fixing. Anyone who opened the
 * network tab saw `X-BoltVault-Key: <40 chars>` and had a credential that
 * worked forever, on any route, from anywhere. Owner: "I'm concerned about
 * someone opening the dev tools and seeing the key and then being able to abuse
 * the tracer."
 *
 * So the key stops travelling. What travels is a MAC over the request:
 *
 *   X-BoltVault-Auth: v1.<keyId>.<ts>.<nonce>.<mac>
 *   mac = HMAC-SHA256(key, "v1\n{ts}\n{nonce}\n{METHOD}\n{path}\n{sha256hex(body)}")
 *
 * `keyId` is the first eight hex of SHA-256(key): it tells the server which key
 * to verify against without trying all of them, and it makes rotation a config
 * change rather than a flag day. `ts` and `nonce` make every call look
 * different and let the server refuse anything outside a minute or replayed
 * inside it. The body hash is what stops a captured header being lifted onto a
 * different, nastier payload.
 *
 * What this buys, precisely: what devtools shows is no longer usable. It is
 * bound to one body, expires in a minute, and is refused on replay. Abusing the
 * tracer now means extracting the key from the bundle and reimplementing this —
 * which is possible, and is why the real bounds are server-side rate limits.
 * Nothing here is a secret-keeping mechanism, and the obfuscation in
 * `packedKey` is not one either. Say so out loud rather than letting a later
 * reader mistake either for one.
 *
 * The algorithm is duplicated in `services/api/src/http/auth/walletAuth.ts`.
 * Neither side may change without the other, so both carry the same test
 * vector: a fixed key and inputs whose MAC is written down. If they drift, both
 * test suites fail rather than production.
 */
import { hmac } from '@noble/hashes/hmac'
import { sha256 } from '@noble/hashes/sha256'

const VERSION = 'v1'
const enc = new TextEncoder()

function hex(bytes: Uint8Array): string {
  let out = ''
  for (const b of bytes) out += b.toString(16).padStart(2, '0')
  return out
}

/** Base64url without padding — safe in a header, and what the server splits on tolerates no '='. */
function b64url(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Which key signed this, so the server need not try every one it knows. */
export function keyIdOf(key: string): string {
  return hex(sha256(enc.encode(key))).slice(0, 8)
}

/**
 * The signed part of a request.
 *
 * The path INCLUDES the query string: `/api/wallet/prices?chainId=1&tokens=…`
 * is a different request from the same path with fifty tokens, and a MAC that
 * did not cover the query would let one be swapped for the other.
 */
export function signingString(
  ts: number,
  nonce: string,
  method: string,
  path: string,
  body: string,
): string {
  return [
    VERSION,
    String(ts),
    nonce,
    method.toUpperCase(),
    path,
    hex(sha256(enc.encode(body))),
  ].join('\n')
}

/** 16 random bytes, base64url. */
function newNonce(random: (n: number) => Uint8Array): string {
  return b64url(random(16))
}

function defaultRandom(n: number): Uint8Array {
  const out = new Uint8Array(n)
  globalThis.crypto.getRandomValues(out)
  return out
}

export interface AuthInput {
  readonly key: string
  readonly method: string
  /** Absolute URL or a path; only the path and query are signed. */
  readonly url: string
  /** The exact bytes that will be sent, or '' for a request with no body. */
  readonly body?: string
  /** Unix milliseconds. */
  readonly now: number
  readonly random?: (n: number) => Uint8Array
}

/** The `X-BoltVault-Auth` value for one request. Different every call. */
export function walletAuthHeader(input: AuthInput): string {
  const ts = Math.floor(input.now / 1000)
  const nonce = newNonce(input.random ?? defaultRandom)
  const mac = hmac(
    sha256,
    enc.encode(input.key),
    enc.encode(signingString(ts, nonce, input.method, pathOf(input.url), input.body ?? '')),
  )
  return [VERSION, keyIdOf(input.key), String(ts), nonce, b64url(mac)].join('.')
}

/**
 * The path and query of a URL, as the server sees it.
 *
 * A relative path is returned unchanged so a caller that already has one need
 * not know the origin; anything the URL parser rejects is passed through rather
 * than throwing on the signing path, where the worst outcome of a bad path is
 * an auth failure and the best is not a crash mid-signature.
 */
export function pathOf(url: string): string {
  if (url.startsWith('/')) return url
  try {
    const u = new URL(url)
    return `${u.pathname}${u.search}`
  } catch {
    return url
  }
}

/**
 * Headers for one keyed call to our API.
 *
 * Deliberately does NOT also send `X-BoltVault-Key`. Sending both would leave
 * the bearer token in the network tab and make the whole exercise decorative;
 * the server accepts the legacy header during the rollout, from wallets that
 * have not been updated, not from ones that have.
 */
export function authHeaders(input: AuthInput): Record<string, string> {
  return { 'X-BoltVault-Auth': walletAuthHeader(input) }
}
