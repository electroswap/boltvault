/**
 * @boltvault/nft — media URI resolution for NFT tokenURIs.
 *
 * tokenURI may be an `ipfs://` CID; browsers can't fetch those directly, so we
 * map them through a fixed gateway. SVGs are only safe inside an `<img>` tag
 * (never `innerHTML`/`<object>`).
 */

/** Fixed IPFS gateways, in fallback order. */
export const MEDIA_GATEWAYS = [
  'https://ipfs.io/ipfs/',
  'https://gateway.pinata.cloud/ipfs/',
]

/**
 * Resolve a raw tokenURI to a browser-fetchable URL.
 * `ipfs://<cid>` → first gateway + cid; anything else is returned as-is.
 */
export function resolveMedia(uri: string): string {
  if (uri.startsWith('ipfs://')) {
    return MEDIA_GATEWAYS[0] + uri.slice('ipfs://'.length)
  }
  return uri
}

/** True if the URL looks like an SVG (case-insensitive `.svg` suffix). */
export function isSvg(url: string): boolean {
  return /\.svg(\?.*)?$/i.test(url)
}

/**
 * Whether the SVG can be displayed at all. True — but the caller MUST render
 * it via an `<img>` element (object-URL/object embedding allows scripts).
 */
export function svgSafe(url: string): boolean {
  return true
}
