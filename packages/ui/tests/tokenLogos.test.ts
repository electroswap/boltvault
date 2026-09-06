import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundledLogo, bundledLogoFiles, markFontSize, markLabel, normaliseTokenAddress, siblingExtension, tokenLogoCandidates } from '../src/tokenLogos'

const WETN = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'
const BOLT = '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1'
const USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
const UNKNOWN = '0x' + 'ab'.repeat(20)

/** Where the vendored files actually live in the extension bundle. */
const PUBLIC_TOKENS = fileURLToPath(new URL('../../../apps/extension/public/tokens/', import.meta.url))

describe('bundled logos', () => {
  it('every file the map names is actually vendored', () => {
    const missing = bundledLogoFiles().filter((f) => !existsSync(`${PUBLIC_TOKENS}${f}`))
    expect(missing).toEqual([])
  })

  it('native ETN resolves — the reported bug was that it never did', () => {
    expect(bundledLogo(52014, 'native')).toBe('/tokens/etn.svg')
    expect(bundledLogo(5201420, 'native')).toBe('/tokens/etn.svg')
  })

  it('is case-insensitive on the address', () => {
    expect(bundledLogo(52014, WETN)).toBe(bundledLogo(52014, WETN.toLowerCase()))
    expect(bundledLogo(52014, WETN)).toContain('.svg')
  })

  it("uses the list's own file name, which is not always the token's address", () => {
    // USDC's logoURI points at a different address than the token's.
    expect(bundledLogo(52014, USDC)).toBe('/tokens/0x74d64C56926E3D758404600B4B6f3954F4216e51.svg')
  })

  it('returns null for a token we do not ship', () => {
    expect(bundledLogo(52014, UNKNOWN)).toBeNull()
    expect(bundledLogo(1, WETN)).toBeNull()
  })
})

describe('normaliseTokenAddress', () => {
  it('folds every spelling of "the native coin" together', () => {
    expect(normaliseTokenAddress('native')).toBe('native')
    expect(normaliseTokenAddress('0x' + '0'.repeat(40))).toBe('native')
    expect(normaliseTokenAddress('  ')).toBe('native')
  })
  it('lower-cases a real address', () => {
    expect(normaliseTokenAddress(BOLT)).toBe(BOLT.toLowerCase())
  })
})

describe('siblingExtension', () => {
  it('swaps .png and .svg on the ElectroSwap static host', () => {
    expect(siblingExtension('https://static.electroswap.io/tokens/images/x.png')).toBe('https://static.electroswap.io/tokens/images/x.svg')
    expect(siblingExtension('https://static.electroswap.io/tokens/images/x.svg')).toBe('https://static.electroswap.io/tokens/images/x.png')
  })
  it('leaves other hosts alone', () => {
    expect(siblingExtension('https://cdn.example.com/x.png')).toBeNull()
  })
})

describe('tokenLogoCandidates', () => {
  it('prefers the bundled file over the remote one', () => {
    const urls = tokenLogoCandidates(52014, BOLT, 'https://static.electroswap.io/tokens/images/whatever.png')
    expect(urls[0]).toBe('/tokens/0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1.svg')
  })

  it('falls back to the sibling extension for an unbundled ETN token', () => {
    const urls = tokenLogoCandidates(52014, UNKNOWN, `https://static.electroswap.io/tokens/images/${UNKNOWN}.svg`)
    expect(urls).toEqual([`https://static.electroswap.io/tokens/images/${UNKNOWN}.svg`, `https://static.electroswap.io/tokens/images/${UNKNOWN}.png`])
  })

  it('refuses a javascript: logoUri', () => {
    expect(tokenLogoCandidates(1, UNKNOWN, 'javascript:alert(1)')).toEqual([])
  })

  it('never repeats a url', () => {
    const same = 'https://cdn.example.com/a.png'
    expect(tokenLogoCandidates(1, UNKNOWN, same)).toEqual([same])
  })
})

describe('the mark that replaces the identicon', () => {
  it('shows the symbol, upper-cased and clipped to four characters', () => {
    expect(markLabel('etn')).toBe('ETN')
    expect(markLabel('WETN')).toBe('WETN')
    expect(markLabel('SUPERLONGNAME')).toBe('SUPE')
    expect(markLabel(' bo lt ')).toBe('BOLT')
  })

  it('never renders an empty disc', () => {
    expect(markLabel(null)).toBe('?')
    expect(markLabel('')).toBe('?')
  })

  it('shrinks the text as the symbol grows, and caps it', () => {
    expect(markFontSize(1)).toBe(12)
    expect(markFontSize(2)).toBe(12)
    expect(markFontSize(3)).toBeLessThan(12)
    expect(markFontSize(4)).toBeLessThan(markFontSize(3))
    // Everything still fits inside the 24-unit disc.
    for (const n of [1, 2, 3, 4]) expect(markFontSize(n) * 0.62 * n).toBeLessThanOrEqual(19.5)
  })
})
