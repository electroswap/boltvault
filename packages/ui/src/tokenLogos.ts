/**
 * Token logos that ship inside the extension.
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
 * Generated from packages/token-catalog/lists/electroswap-etn.json.
 */

/** Where the vendored files live. Extension pages resolve this against the
 *  extension origin; a body that serves them elsewhere can repoint it. */
let base = '/tokens/'

export function setTokenLogoBase(next: string): void {
  base = next.endsWith('/') ? next : `${next}/`
}

/** The native coin has no address of its own, so it gets the sentinel key. */
export const NATIVE_KEY = 'native'

const FILES: Readonly<Record<string, string>> = {
  '52014:0x043faa1b5c5fc9a7dc35171f290c29ecde0ccff1': '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1.svg', // BOLT
  '52014:0xc9fc4ab00911793d99b5c7bd01f01203c21d4131': '0xC9FC4AB00911793D99b5c7Bd01f01203C21D4131.png', // CLUB
  '52014:0x309b916b3a90cb3e071697ea9680e9217a30066f': '0x309B916b3A90cb3E071697Ea9680e9217A30066f.png', // CORE
  '52014:0xe74e4e7a064310466f3bdbd3f3ce4e8c8f7cf1d5': '0xE74e4E7A064310466f3bdBd3F3Ce4e8c8F7CF1d5.png', // DCNT
  '52014:0xee432c220273e4f949007b4c1946562826efa055': '0xEe432C220273e4F949007B4c1946562826Efa055.svg', // DYNO
  '52014:0x075533ab8eec6a6999f07c8bc2f1900eb8312e25': '0x075533AB8EeC6A6999F07C8bc2f1900eB8312e25.png', // FUGAZI
  '52014:0xc20d02538368d8f7debeaeb99d9a8b4d4d1ddc1c': '0xc20d02538368D8F7deBeAeB99D9a8b4d4D1DDC1C.png', // PDY
  '52014:0x3187dead7a2bd6770f5fe81495d1b715926aae6e': '0x74d64C56926E3D758404600B4B6f3954F4216e51.svg', // USDC
  '52014:0x48e722f1458b253c2fb0e573f939318d7dbd54e7': '0xD70B4b2e14cBA41fE011ea0c7021B6E64d960d87.svg', // USDT
  '52014:0x138dafbda0ccb3d8e39c19edb0510fc31b7c1c77': '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77.svg', // WETN
  '5201420:0x8768cca8591160b423a5b7efa72842a0ac55382d': '0x8768CcA8591160B423A5b7eFA72842A0AC55382D.svg', // tBOLT
  '5201420:0x162d5a58096b63d89d83e0c66b4731a6cc8b10af': '0x162D5a58096b63D89D83e0C66b4731A6CC8b10aF.svg', // tDYNO
  '5201420:0x9a110a3ecc8704e93bd4fa1ba44d5cf93327202b': '0x9a110A3Ecc8704e93Bd4FA1bA44D5CF93327202B.svg', // tUSDC
  '5201420:0x02fec8c559fb598762df8d033bd7a3df9b374771': '0x02FeC8c559fB598762df8D033bD7A3Df9b374771.svg', // tUSDT
  '5201420:0x154c9fd7f006b92b6afa746098d8081a831dc1fc': '0x154c9fD7F006b92b6afa746098d8081A831DC1FC.svg', // tWETN
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

/** Ordered logo URLs to try for a token, best first. */
export function tokenLogoCandidates(chainId: number, address: string, logoUri?: string | null): string[] {
  const out: string[] = []
  const push = (u: string | null | undefined): void => {
    if (u !== null && u !== undefined && u !== '' && !out.includes(u)) out.push(u)
  }
  push(bundledLogo(chainId, normaliseTokenAddress(address)))
  if (logoUri !== null && logoUri !== undefined && /^(https?|data|blob):/.test(logoUri)) {
    push(logoUri)
    push(siblingExtension(logoUri))
  }
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
