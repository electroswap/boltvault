/**
 * Logo pipeline (T4.3) — the ordered, fail-soft candidate list + identicon.
 *
 * Design §"Logo pipeline (synchronous fallbacks, all fail-soft)": first success
 * wins, cached by (chainId, address). Order:
 *   1. token-list / custom logoURI (https: or ipfs: only — no javascript:, no
 *      data: unless already inlined from our ETN static)
 *   2. ElectroSwap static (ETN only): …/images/{checksum}.svg then .png
 *   3. Trust Wallet assets (MIT) — by chain slug; ETN has no TWA chain → skip
 *   4. CoinGecko (only if we already mapped address→id) — caller-supplied
 *   5. local identicon (jazzicon-style, generated from address, no network) —
 *      the guaranteed last frame so a bus bar is never a blank disc.
 *
 * Rules: checksum (EIP-55) addresses for the TWA paths (lowercase → 404);
 * never inline untrusted SVG into the DOM (the identicon is *ours*, generated,
 * so it's safe to render via <img data:>).
 *
 * `logoCandidates` is pure (no fetch) — the caller walks it with a 2s timeout
 * and caches the winner. The identicon is deterministic (same address → same
 * pixels) so it doubles as a stable cache key.
 */
import { getAddress } from 'viem'
import { isElectroneumChainId } from '@boltvault/chains'

/** Trust Wallet asset chain slugs. Electroneum has no TWA chain (skip). */
export const TWA_SLUGS: Readonly<Record<number, string>> = {
  1: 'ethereum',
  56: 'smartchain',
  8453: 'base',
  42161: 'arbitrum',
  10: 'optimism',
  137: 'polygon',
  43114: 'avalanchec',
  59144: 'linea',
  130: 'unichain',
}

export interface LogoCandidatesInput {
  readonly chainId: number
  /** Token address (EIP-55 checksummed preferred). */
  readonly address: string
  /** Token-list / custom logoURI, if any. */
  readonly logoURI?: string
  /** Optional pre-mapped CoinGecko id (step 4; caller caches this). */
  readonly coingeckoId?: string
}

/** Ordered candidate URLs; the caller tries each until one loads (2s timeout). */
export function logoCandidates(input: LogoCandidatesInput): string[] {
  const out: string[] = []
  const checksum = getAddress(input.address)

  // 1. list logoURI — https: or ipfs: only.
  const logo = input.logoURI
  if (logo && (logo.startsWith('https://') || logo.startsWith('ipfs://'))) {
    out.push(logo)
  }

  // 2. ElectroSwap static (ETN only).
  if (isElectroneumChainId(input.chainId)) {
    out.push(`https://static.electroswap.io/tokens/images/${checksum}.svg`)
    out.push(`https://static.electroswap.io/tokens/images/${checksum}.png`)
  }

  // 3. Trust Wallet assets (by slug; ETN has none → skip).
  const slug = TWA_SLUGS[input.chainId]
  if (slug) {
    out.push(
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${checksum}/logo.png`,
    )
  }

  // 4. CoinGecko asset platform image — only if we already have the id.
  if (input.coingeckoId) {
    out.push(`https://assets.coingecko.com/coins/images/${input.coingeckoId}/small/image.png`)
  }

  return out
}

// ---- identicon (guaranteed last frame) --------------------------------------

/** mulberry32 PRNG — deterministic from a 32-bit seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-1a 32-bit hash → stable seed from the address bytes. */
function seedFromAddress(address: string): number {
  let h = 0x811c9dc5
  const s = address.replace(/^0x/, '')
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h >>> 0
}

function hsl(h: number, s: number, l: number): string {
  return `hsl(${Math.round(h)}, ${Math.round(s)}%, ${Math.round(l)}%)`
}

/**
 * A deterministic jazzicon-style identicon for an address, as an SVG string.
 * Symmetric 5×5 grid over a colored background. Same address → same SVG always.
 */
export function identiconSvg(address: string, size = 32): string {
  const seed = seedFromAddress(address)
  const rnd = mulberry32(seed)

  // Background: a saturated color from the seed.
  const bgHue = Math.floor(rnd() * 360)
  const bg = hsl(bgHue, 65, 32)

  // Build a symmetric 5×5 grid (mirror the left 3 columns across the center).
  const cell = size / 5
  const rects: string[] = []
  // Pre-generate the left half (cols 0..1) + center column (2) for symmetry.
  const grid: boolean[][] = []
  for (let y = 0; y < 5; y++) {
    grid.push([rnd() > 0.55, rnd() > 0.55, rnd() > 0.5])
  }
  const light = hsl(bgHue, 40, 88)
  for (let y = 0; y < 5; y++) {
    for (let x = 0; x < 3; x++) {
      if (!grid[y]?.[x]) continue
      // Mirror: col x and col (4 - x).
      for (const cx of new Set([x, 4 - x])) {
        rects.push(
          `<rect x="${(cx * cell).toFixed(2)}" y="${(y * cell).toFixed(2)}" width="${cell.toFixed(2)}" height="${cell.toFixed(2)}" fill="${light}"/>`,
        )
      }
    }
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><rect width="${size}" height="${size}" fill="${bg}"/>${rects.join('')}</svg>`
}

/** The identicon as a CSP-safe data: URI (render via <img src>, never inline). */
export function identiconDataUri(address: string, size = 32): string {
  const svg = identiconSvg(address, size)
  return `data:image/svg+xml;base64,${btoa(svg)}`
}
