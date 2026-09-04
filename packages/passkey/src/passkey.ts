/**
 * Passkey unlock (T6.5) — WebAuthn as an *unlock factor* for an HD vault
 * (NOT a chain account in v1).
 *
 * Design (S8 account types, item 5):
 *   - When the authenticator supports the `prf` extension → **PRF** path: the
 *     vault wrap key is derived from the PRF secret, so the *passkey alone*
 *     unlocks (label: "Unlock with passkey").
 *   - Otherwise (older Safari, no PRF) → **passkey + password** path: the
 *     passkey is an extra factor and the password still derives the wrap key
 *     (label: "Passkey + password"). The two labels must look different.
 *
 * HKDF is the key-derivation core. It's implemented here with an injectable
 * HMAC (default = Web Crypto `crypto.subtle` in the browser) so the package has
 * no hard dependency and the derivation is testable with a stub HMAC.
 */

/** HMAC-SHA256(key, data) → 32-byte digest. Injectable for tests. */
export type Hmac = (key: Uint8Array, data: Uint8Array) => Promise<Uint8Array>

/** SHA-256 digest length. */
export const SHA256_LEN = 32

async function defaultHmac(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const subtle = globalThis.crypto.subtle
  const imported = await subtle.importKey('raw', key as BufferSource, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await subtle.sign('HMAC', imported, data as BufferSource)
  return new Uint8Array(sig)
}

export interface HkdfOptions {
  readonly salt?: Uint8Array
  readonly info?: Uint8Array
  readonly length: number
  readonly hmac?: Hmac
}

/**
 * HKDF (RFC 5869) — extract-and-expand with SHA-256. Returns `length` bytes.
 * `hmac` is injectable (defaults to Web Crypto). `salt`/`info` may be omitted.
 */
export async function hkdf(ikm: Uint8Array, opts: HkdfOptions): Promise<Uint8Array> {
  const hmac = opts.hmac ?? defaultHmac
  const salt = opts.salt ?? new Uint8Array(SHA256_LEN)
  const info = opts.info ?? new Uint8Array(0)
  const length = opts.length

  // Extract.
  const prk = await hmac(salt, ikm)
  // Expand.
  const blocks = Math.ceil(length / SHA256_LEN)
  const out = new Uint8Array(blocks * SHA256_LEN)
  let t: Uint8Array = new Uint8Array(0)
  for (let i = 1; i <= blocks; i++) {
    const input = concat3(t, info, new Uint8Array([i]))
    t = await hmac(prk, input)
    out.set(t, (i - 1) * SHA256_LEN)
  }
  return out.slice(0, length)
}

function concat3(a: Uint8Array, b: Uint8Array, c: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length + b.length + c.length)
  out.set(a, 0)
  out.set(b, a.length)
  out.set(c, a.length + b.length)
  return out
}

// --- unlock mode + labels ----------------------------------------------------

export type UnlockMode = 'prf' | 'passkey-plus-password'

/**
 * Decide the unlock mode from authenticator capability. `prfSupported` is true
 * only when the authenticator reports the `prf` extension (WebAuthn `prf` /
 * hmac-secret). Older Safari lacks it.
 */
export function unlockMode(prfSupported: boolean): UnlockMode {
  return prfSupported ? 'prf' : 'passkey-plus-password'
}

/**
 * The two labels must look different (design: "Do not let these look
 * identical"). PRF → passkey alone unlocks; else → passkey + password.
 */
export function unlockLabel(mode: UnlockMode): string {
  return mode === 'prf' ? 'Unlock with passkey' : 'Passkey + password'
}

/** True when the passkey ALONE can unlock (PRF path). */
export function passkeyAlone(mode: UnlockMode): boolean {
  return mode === 'prf'
}

// --- wrap-key derivation -----------------------------------------------------

/** HKDF info string for the PRF wrap-key (identifiable, app-scoped). */
export const WRAP_KEY_INFO = new TextEncoder().encode('BoltVault/vault-wrap-key')

/**
 * Derive the vault wrap key from a PRF secret (the `prf` path). 32 bytes for
 * XChaCha20-Poly1305. Pure except for the (injectable) HMAC.
 */
export async function deriveWrapKeyFromPRF(
  prfSecret: Uint8Array,
  hmac: Hmac = defaultHmac,
): Promise<Uint8Array> {
  return hkdf(prfSecret, { info: WRAP_KEY_INFO, length: 32, hmac })
}

// --- WebAuthn credential options (pure builders) ----------------------------

export interface PasskeyRegistrationOptions {
  readonly challenge: Uint8Array
  readonly userName: string
  readonly displayName: string
  readonly rpId: string
  /** Request the `prf` extension so we can use the PRF path. */
  readonly requestPrt: boolean
}

/**
 * Build `PublicKeyCredentialCreationOptions`-shaped input for
 * `navigator.credentials.create`. Pure (the caller passes a challenge).
 */
export function passkeyRegistration(
  opts: PasskeyRegistrationOptions,
): {
  challenge: Uint8Array
  rp: { name: string }
  user: { id: Uint8Array; name: string; displayName: string }
  pubKeyCredParams: readonly { type: string; alg: number }[]
  authenticatorSelection: { residentKey: 'preferred'; userVerification: 'preferred' }
  extensions: { prf: { 'prf-': { 'prf-secret': boolean } } }
} {
  const enc = new TextEncoder()
  return {
    challenge: opts.challenge,
    rp: { name: opts.rpId },
    user: { id: enc.encode(opts.userName), name: opts.userName, displayName: opts.displayName },
    // ES256 (-7) and EdDSA (-8); authenticators pick what they support.
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },
      { type: 'public-key', alg: -8 },
    ],
    authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
    extensions: { prf: { 'prf-': { 'prf-secret': true } } },
  }
}

/** Build `navigator.credentials.get` options (the challenge comes from the caller). */
export function passkeyGetOptions(challenge: Uint8Array): {
  challenge: Uint8Array
  userVerification: 'preferred'
  timeout: number
} {
  return { challenge, userVerification: 'preferred', timeout: 60_000 }
}
