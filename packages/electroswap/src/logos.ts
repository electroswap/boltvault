/**
 * Logo pipeline (T4.3) — the ordered, fail-soft candidate list for chains we
 * do not bundle logos for. Order:
 *   1. token-list / custom logoURI (https: or ipfs: only — no javascript:, no
 *      data: unless already inlined from our ETN static)
 *   2. ElectroSwap static (ETN only): …/images/{checksum}.svg then .png
 *   3. Trust Wallet assets (MIT) — by chain slug; ETN has no TWA chain → skip
 *   4. CoinGecko (only if we already mapped address→id) — caller-supplied
 *
 * Rules: checksum (EIP-55) addresses for the TWA paths (lowercase → 404).
 *
 * `logoCandidates` is pure (no fetch) — the caller walks it and caches the
 * winner.
 *
 * The last frame is no longer an identicon. The owner asked for pixel
 * placeholders to be gone everywhere, so a token with no logo now draws its
 * symbol on a glass disc (packages/ui/src/TokenMark.tsx), and the ElectroSwap
 * logos ship inside the bundle (packages/ui/src/tokenLogos.ts).
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
