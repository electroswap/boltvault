/**
 * Signed static files (master plan §3.6, §3.7, §9.4): flags, the scam-origin
 * list and the other JSON the wallet fetches from static.electroswap.io are
 * accepted only with a detached ed25519 signature that verifies against the
 * key baked in here — a CDN compromise cannot inject an entry, and a stale
 * file cannot roll a newer one back. Flags can only *disable*.
 */
import { ed25519 } from '@noble/curves/ed25519'
import { z } from 'zod'

/**
 * The statics signing key's public half (hex). The private half lives with
 * ops (an offline signer); rotating it is a wallet release. This value is a
 * key ops generated on 2026-09-05; the private half lives in the ops secrets.
 */
export const STATIC_SIGNING_PUBLIC_KEY = '98b03890bbc570eae1416856bc11e252b603104c040e7a9048e2d7ee088ce567'

export const FlagsSchema = z.object({
  v: z.literal(1),
  /** Unix ms; a file older than the one already held is refused (anti-rollback). */
  issuedAt: z.number().int().nonnegative(),
  minVersion: z.object({ extension: z.string().optional(), mobile: z.string().optional() }).default({}),
  /** Kill-switches (§3.7): a flag can only turn something off. */
  disabled: z
    .object({
      swap: z.boolean().optional(),
      limit: z.boolean().optional(),
      bridge: z.boolean().optional(),
      /** Corridor keys `fromChainId:toChainId:symbol`, e.g. `52014:8453:USDC`. */
      bridgeCorridors: z.array(z.string()).optional(),
      launchpad: z.boolean().optional(),
      nft: z.boolean().optional(),
      farms: z.boolean().optional(),
    })
    .default({}),
  /** A one-line notice shown on Home (an incident, a migration). */
  notice: z.string().max(200).nullable().default(null),
})
export type Flags = z.infer<typeof FlagsSchema>

export const ScamOriginsSchema = z.object({
  v: z.literal(1),
  issuedAt: z.number().int().nonnegative(),
  /** Registrable origins or hosts; subdomains match. */
  origins: z.array(z.string().min(3)).max(50_000),
})
export type ScamOrigins = z.infer<typeof ScamOriginsSchema>

export const DEFAULT_FLAGS: Flags = { v: 1, issuedAt: 0, minVersion: {}, disabled: {}, notice: null }

const fromHex = (h: string): Uint8Array => {
  const s = h.startsWith('0x') ? h.slice(2) : h
  const out = new Uint8Array(s.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(s.slice(i * 2, i * 2 + 2), 16)
  return out
}
const toHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')

/** True when `signatureHex` is a valid ed25519 signature of exactly these bytes by the key. */
export function verifyStatic(bytes: Uint8Array, signatureHex: string, publicKeyHex = STATIC_SIGNING_PUBLIC_KEY): boolean {
  try {
    const sig = fromHex(signatureHex.trim())
    if (sig.length !== 64) return false
    return ed25519.verify(sig, bytes, fromHex(publicKeyHex))
  } catch {
    return false
  }
}

/** Sign bytes (ops tooling and tests; the wallet never holds the private key). */
export function signStatic(bytes: Uint8Array, privateKeyHex: string): string {
  return toHex(ed25519.sign(bytes, fromHex(privateKeyHex)))
}

export function staticKeyPair(privateKey: Uint8Array): { privateKeyHex: string; publicKeyHex: string } {
  return { privateKeyHex: toHex(privateKey), publicKeyHex: toHex(ed25519.getPublicKey(privateKey)) }
}

/** `a >= b` for `major.minor.patch` (extra labels ignored); unparsable versions compare as 0.0.0. */
export function semverAtLeast(a: string, b: string): boolean {
  const parse = (v: string): [number, number, number] => {
    const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(v.trim())
    return m ? [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)] : [0, 0, 0]
  }
  const [a0, a1, a2] = parse(a)
  const [b0, b1, b2] = parse(b)
  if (a0 !== b0) return a0 > b0
  if (a1 !== b1) return a1 > b1
  return a2 >= b2
}
