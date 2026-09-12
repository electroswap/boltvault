/**
 * The token logo pipeline (master plan §10.3) — and the marks that ship
 * inside the bundle.
 *
 * One ordered list of sources, first success wins, cached by
 * `(chainId, address)`, 2 s per candidate, a 404 is silent:
 *
 *   0. the bundled mark, for the tokens we vendor (below)
 *   1. the list / custom `logoURI` — https: or ipfs: only
 *   2. ElectroSwap static, `tokens/images/{checksum}.svg` then `.png`
 *   3. Trust Wallet assets, `blockchains/{slug}/assets/{checksum}/logo.png`
 *   4. smol-assets, `api/token/{chainId}/{address}/logo-128.png`
 *   5. CoinGecko, by the cached `address -> id` map
 *   6. TokenMark — the token's symbol on a glass disc
 *
 * Step 6 is deliberately NOT the plan's "deterministic identicon". Owner: "I
 * don't want to see pixel based placeholders anywhere in the app. Use token
 * symbol inside a circle instead resized to fit." That decision supersedes
 * the identicon in §10.3; TokenMark.tsx is the terminal frame and the sizing
 * rules for it live at the bottom of this file.
 *
 * The user's address is never sent to any of these hosts: every URL is built
 * from a chain id and a *token* address, and nothing here takes an account.
 *
 * This is the only implementation. `packages/electroswap/src/logos.ts` used
 * to carry a second one with no importers at all.
 *
 * Owner: "You should include caching of images, even potentially including the
 * existing ElectroSwap tokenlist graphics in the app bundle itself." All 15
 * listed tokens plus native ETN are ~94 KB, so they are vendored under
 * apps/extension/public/tokens/ and resolved with no network at all — which
 * also ends the 404-then-placeholder flicker on every remount.
 *
 * Keyed by lower-cased address so the UI never needs to checksum (that would
 * pull viem into the UI bundle); the engine already hands us a logoUri.
 *
 * The two hosts that insist on EIP-55 (ElectroSwap static and Trust Wallet —
 * a lower-cased path 404s) get the address exactly as it arrived, because by
 * the time one reaches a screen it is already checksummed: the engine runs
 * every custom token through `getAddress`, and §10.2 validates EIP-55 on
 * every list entry. Checksumming again here would mean keccak in the popup
 * bundle to re-derive something we were handed.
 *
 * Generated from packages/token-catalog/lists/electroswap-etn.json.
 */

/** Where the vendored files live. Extension pages resolve this against the
 *  extension origin; a body that serves them elsewhere can repoint it. */
let base = '/tokens/'

export function setTokenLogoBase(next: string): void {
  base = next.endsWith('/') ? next : `${next}/`
}

/**
 * How a body can actually draw a bundled mark.
 *
 * The extension serves the files from its own origin, so a URI is enough. The
 * phone has no origin and React Native cannot decode SVG through `Image` at
 * all, so mobile hands back markup for the SVGs and a Metro asset module for
 * the PNGs. Same seam the extension already uses for its disk image cache
 * (`setImageResolver`), so ui stays free of platform branches.
 */
export type LogoSource =
  | { readonly kind: 'uri'; readonly uri: string }
  | { readonly kind: 'svg'; readonly xml: string }
  | { readonly kind: 'asset'; readonly module: number }

type LogoResolver = (chainId: number, address: string) => LogoSource | null

let resolver: LogoResolver | null = null

/** A body that ships the marks itself registers how to reach them. */
export function setTokenLogoResolver(next: LogoResolver | null): void {
  resolver = next
}

/** The native coin has no address of its own, so it gets the sentinel key. */
export const NATIVE_KEY = 'native'

const FILES: Readonly<Record<string, string>> = {
  '52014:0x043faa1b5c5fc9a7dc35171f290c29ecde0ccff1':
    '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1.svg', // BOLT
  '52014:0xc9fc4ab00911793d99b5c7bd01f01203c21d4131':
    '0xC9FC4AB00911793D99b5c7Bd01f01203C21D4131.png', // CLUB
  '52014:0x309b916b3a90cb3e071697ea9680e9217a30066f':
    '0x309B916b3A90cb3E071697Ea9680e9217A30066f.png', // CORE
  '52014:0xe74e4e7a064310466f3bdbd3f3ce4e8c8f7cf1d5':
    '0xE74e4E7A064310466f3bdBd3F3Ce4e8c8F7CF1d5.png', // DCNT
  '52014:0xee432c220273e4f949007b4c1946562826efa055':
    '0xEe432C220273e4F949007B4c1946562826Efa055.svg', // DYNO
  '52014:0x075533ab8eec6a6999f07c8bc2f1900eb8312e25':
    '0x075533AB8EeC6A6999F07C8bc2f1900eB8312e25.png', // FUGAZI
  '52014:0xc20d02538368d8f7debeaeb99d9a8b4d4d1ddc1c':
    '0xc20d02538368D8F7deBeAeB99D9a8b4d4D1DDC1C.png', // PDY
  '52014:0x3187dead7a2bd6770f5fe81495d1b715926aae6e':
    '0x74d64C56926E3D758404600B4B6f3954F4216e51.svg', // USDC
  '52014:0x48e722f1458b253c2fb0e573f939318d7dbd54e7':
    '0xD70B4b2e14cBA41fE011ea0c7021B6E64d960d87.svg', // USDT
  '52014:0x138dafbda0ccb3d8e39c19edb0510fc31b7c1c77':
    '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77.svg', // WETN
  '5201420:0x8768cca8591160b423a5b7efa72842a0ac55382d':
    '0x8768CcA8591160B423A5b7eFA72842A0AC55382D.svg', // tBOLT
  '5201420:0x162d5a58096b63d89d83e0c66b4731a6cc8b10af':
    '0x162D5a58096b63D89D83e0C66b4731A6CC8b10aF.svg', // tDYNO
  '5201420:0x9a110a3ecc8704e93bd4fa1ba44d5cf93327202b':
    '0x9a110A3Ecc8704e93Bd4FA1bA44D5CF93327202B.svg', // tUSDC
  '5201420:0x02fec8c559fb598762df8d033bd7a3df9b374771':
    '0x02FeC8c559fB598762df8D033bD7A3Df9b374771.svg', // tUSDT
  '5201420:0x154c9fd7f006b92b6afa746098d8081a831dc1fc':
    '0x154c9fD7F006b92b6afa746098d8081A831DC1FC.svg', // tWETN
  '52014:native': 'etn.svg', // ETN
  '5201420:native': 'etn.svg', // tETN
}

/** The bundled file for a token, or null when we do not ship one. */
export function bundledLogo(chainId: number, address: string): string | null {
  const file = FILES[`${chainId}:${address.toLowerCase()}`]
  return file === undefined ? null : `${base}${file}`
}

/** Every file this map expects to find under the bundle's token directory. */
export function bundledLogoFiles(): string[] {
  return [...new Set(Object.values(FILES))]
}

const STATIC_HOST = 'static.electroswap.io'
const ES_STATIC = `https://${STATIC_HOST}/tokens/images/`

/** Electroneum mainnet and testnet: the only chains the static host serves. */
const ETN_CHAINS: ReadonlySet<number> = new Set([52014, 5201420])

/**
 * Trust Wallet asset chain slugs (§10.3). Electroneum has no Trust Wallet
 * chain, so there is nothing to ask for and ETN skips this step.
 */
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

/**
 * How long one candidate gets before the walk moves on (§10.3).
 *
 * Spent on the image element rather than on a `fetch`: a fetch to
 * raw.githubusercontent.com from an extension page is a cross-origin request
 * we have no host permission for, so it would fail CORS and throw away a
 * logo that an `<img>` loads perfectly well. An image has no timeout of its
 * own, which is what this number is for — a host that accepts the connection
 * and then never answers must not leave a token blank forever.
 */
export const LOGO_TIMEOUT_MS = 2_000

/** The gateway the engine already uses for NFT media (`nftCustom.ts`). */
const IPFS_GATEWAY = 'https://ipfs.io/ipfs/'

/**
 * A list's `logoURI`, or null if we will not load it.
 *
 * https: and ipfs: only (§10.3). A token list is data from a third party:
 * `javascript:` is an obvious attack, and `data:` is a real one too — an SVG
 * data URI is a document, and a document can carry script. Both are refused
 * rather than sanitised.
 */
function listLogo(uri: string | null | undefined): string | null {
  if (uri === null || uri === undefined) return null
  const u = uri.trim()
  if (u.startsWith('https://')) return u
  if (u.startsWith('ipfs://'))
    return `${IPFS_GATEWAY}${u.slice('ipfs://'.length).replace(/^ipfs\//, '')}`
  return null
}

/** An address we can put in a URL path: the native coin has none. */
function pathAddress(address: string): string | null {
  const a = address.trim()
  return /^0x[0-9a-fA-F]{40}$/.test(a) ? a : null
}

/**
 * `chainId:address` -> CoinGecko image id, learned by whoever prices tokens
 * (§10.3 step 5: "by cached `address -> id` map"). Empty until a body fills
 * it, and an empty map simply drops the step.
 */
let coingeckoIds: Readonly<Record<string, string>> = {}

export function setCoingeckoIds(ids: Readonly<Record<string, string>>): void {
  coingeckoIds = ids
}

function coingeckoId(chainId: number, key: string): string | null {
  return coingeckoIds[`${chainId}:${key}`] ?? null
}

/**
 * Which candidate won for a token, remembered across sessions (§10.3: cached
 * by `(chainId, address)`).
 *
 * A body installs the store; the default uses `localStorage` where there is
 * one, which is every extension page. Without it the memory layer below still
 * spares a scrolling list a second walk, it just does not survive a reopen.
 */
export interface TokenLogoStore {
  get(key: string): string | null
  set(key: string, value: string): void
}

const localStore: TokenLogoStore | null = (() => {
  try {
    const ls = globalThis.localStorage
    return typeof ls?.getItem === 'function'
      ? { get: (k: string) => ls.getItem(k), set: (k: string, v: string) => ls.setItem(k, v) }
      : null
  } catch {
    // Private windows and blocked storage throw on access, not on use.
    return null
  }
})()

let store: TokenLogoStore | null = localStore

export function setTokenLogoStore(next: TokenLogoStore | null): void {
  store = next
}

/**
 * A token with no logo anywhere is remembered too — that is the expensive
 * case, five hosts deep — but only for a week, because a token that gets a
 * logo next month should get it here as well.
 */
const NEGATIVE_TTL_MS = 7 * 24 * 60 * 60_000
const memory = new Map<string, { uri: string | null; at: number }>()

const cacheKey = (chainId: number, address: string): string =>
  `${chainId}:${normaliseTokenAddress(address)}`

/** What won last time, or null when we have never resolved this token. */
export function cachedTokenLogo(
  chainId: number,
  address: string,
): { readonly uri: string | null } | null {
  const key = cacheKey(chainId, address)
  let hit = memory.get(key)
  if (hit === undefined && store !== null) {
    try {
      const raw = store.get(`bv.logo.${key}`)
      const parsed: unknown = raw === null ? null : JSON.parse(raw)
      if (typeof parsed === 'object' && parsed !== null) {
        const { u, t } = parsed as { u?: unknown; t?: unknown }
        if ((typeof u === 'string' || u === null) && typeof t === 'number') {
          hit = { uri: u ?? null, at: t }
          memory.set(key, hit)
        }
      }
    } catch {
      // A corrupt entry is a cache miss, never an error on screen.
    }
  }
  if (hit === undefined) return null
  if (hit.uri === null && Date.now() - hit.at > NEGATIVE_TTL_MS) return null
  return { uri: hit.uri }
}

/** Remember the winner — or, with null, that nothing drew. */
export function cacheTokenLogo(chainId: number, address: string, uri: string | null): void {
  const key = cacheKey(chainId, address)
  const entry = { uri, at: Date.now() }
  memory.set(key, entry)
  if (store === null) return
  try {
    store.set(`bv.logo.${key}`, JSON.stringify({ u: entry.uri, t: entry.at }))
  } catch {
    // A full or blocked quota costs us persistence, nothing else.
  }
}

/**
 * Callers used to each write `address === 'native' ? '0x000…0' : address`
 * before handing an address to TokenAvatar. That belongs here, once.
 */
export function normaliseTokenAddress(address: string): string {
  const a = address.trim()
  if (a === '' || a === NATIVE_KEY) return NATIVE_KEY
  if (/^0x0{40}$/i.test(a)) return NATIVE_KEY
  return a.toLowerCase()
}

/** The other extension for an ElectroSwap static image (.svg <-> .png). */
export function siblingExtension(uri: string): string | null {
  if (!uri.includes(STATIC_HOST)) return null
  if (uri.endsWith('.png')) return `${uri.slice(0, -4)}.svg`
  if (uri.endsWith('.svg')) return `${uri.slice(0, -4)}.png`
  return null
}

/**
 * Ordered sources to try for a token, best first — the same order as
 * `tokenLogoCandidates`, but able to carry markup and asset modules as well as
 * URLs. A bundled source never needs a load event; a remote one does.
 */
export function tokenLogoSources(
  chainId: number,
  address: string,
  logoUri?: string | null,
  coingecko?: string | null,
): LogoSource[] {
  const out: LogoSource[] = []
  const key = normaliseTokenAddress(address)
  const bundled = resolver !== null ? resolver(chainId, key) : null
  if (bundled !== null) {
    out.push(bundled)
  } else {
    const file = bundledLogo(chainId, key)
    if (file !== null) out.push({ kind: 'uri', uri: file })
  }
  for (const uri of tokenLogoCandidates(chainId, address, logoUri, coingecko)) {
    // The bundled URI is already represented above, in whichever form this
    // body can draw.
    if (/^https?:/.test(uri)) out.push({ kind: 'uri', uri })
  }
  return out
}

/**
 * Ordered logo URLs to try for a token, best first — the six steps of §10.3.
 *
 * Pure: it builds URLs and nothing else. Walking them, timing them out and
 * remembering the winner is TokenAvatar's job, because only the thing drawing
 * the image knows whether one drew.
 */
export function tokenLogoCandidates(
  chainId: number,
  address: string,
  logoUri?: string | null,
  coingecko?: string | null,
): string[] {
  const out: string[] = []
  const push = (u: string | null | undefined): void => {
    if (u !== null && u !== undefined && u !== '' && !out.includes(u)) out.push(u)
  }
  const key = normaliseTokenAddress(address)
  const path = pathAddress(address)
  const etn = ETN_CHAINS.has(chainId)

  // 0. The bundled mark: the 15 listed ElectroSwap tokens and native ETN,
  //    which is step 2's file already sitting in the bundle.
  push(bundledLogo(chainId, key))

  // 1. What the list or the user gave us.
  const listed = listLogo(logoUri)
  push(listed)
  // The static host serves .svg for most tokens and .png for a few, and a
  // list's file name is not always the token's own address (USDC's is not),
  // so the sibling is worth a try before we build our own path.
  push(listed === null ? null : siblingExtension(listed))

  // 2. ElectroSwap static, .svg first — the old .png-only convention 404'd
  //    for WETN, USDC, USDT, BOLT, DYNO and native ETN.
  if (etn && path !== null) {
    push(`${ES_STATIC}${path}.svg`)
    push(`${ES_STATIC}${path}.png`)
  }

  // 3. Trust Wallet assets, by chain slug.
  const slug = TWA_SLUGS[chainId]
  if (slug !== undefined && path !== null)
    push(
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/${slug}/assets/${path}/logo.png`,
    )

  // 4. smol-assets. Skipped on Electroneum for the same reason step 3 is:
  //    it does not index the chain, so the request could only ever 404.
  if (!etn && path !== null)
    push(`https://assets.smold.app/api/token/${chainId}/${key}/logo-128.png`)

  // 5. CoinGecko, only when we already know this token's image id.
  const id = coingecko ?? coingeckoId(chainId, key)
  if (id !== null && id !== '')
    push(`https://assets.coingecko.com/coins/images/${id}/small/image.png`)

  // 6. is TokenMark, which is drawn rather than fetched (see the header).
  return out
}

/** Longer symbols exist; past four characters the disc stops being readable. */
const MAX_CHARS = 4

/** The symbol as TokenMark draws it: trimmed, upper-cased, clipped to four. */
export function markLabel(symbol?: string | null): string {
  const clean = (symbol ?? '').trim().replace(/\s+/g, '')
  if (clean === '') return '?'
  return clean.slice(0, MAX_CHARS).toUpperCase()
}

/**
 * Font size in viewBox units. Sora 600 runs about 0.62em per character, and the
 * usable width inside a 24-unit disc is ~19, so n characters fit at 19/(0.62n).
 * Capped at 12 so a one- or two-letter symbol does not swell to fill the disc.
 */
export function markFontSize(chars: number): number {
  if (chars <= 0) return 12
  return Math.min(12, Math.round((19 / (0.62 * chars)) * 10) / 10)
}

/**
 * Decode the bundled marks ahead of first use.
 *
 * They are local files, so this is not a download — it is getting them parsed
 * and rasterised before a list of token rows asks for fifteen at once. Called
 * on idle from a body's entry point; harmless if it never runs.
 */
export function prewarmTokenLogos(): void {
  if (typeof Image === 'undefined') return
  for (const file of bundledLogoFiles()) {
    try {
      const img = new Image()
      img.decoding = 'async'
      img.src = `${base}${file}`
    } catch {
      // Warming is best-effort; a failure here must never reach a screen.
    }
  }
}
