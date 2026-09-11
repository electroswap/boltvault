import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { bundledLogo, bundledLogoFiles, cacheTokenLogo, cachedTokenLogo, markFontSize, markLabel, normaliseTokenAddress, setCoingeckoIds, setTokenLogoStore, siblingExtension, tokenLogoCandidates, TWA_SLUGS } from '../src/tokenLogos'

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

describe('tokenLogoCandidates — the six steps of §10.3, in order', () => {
  it('prefers the bundled file over the remote one', () => {
    const urls = tokenLogoCandidates(52014, BOLT, 'https://static.electroswap.io/tokens/images/whatever.png')
    expect(urls[0]).toBe('/tokens/0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1.svg')
  })

  it('ETN: list logoURI, then the ElectroSwap static .svg and .png, and no Trust Wallet or smol-assets', () => {
    const urls = tokenLogoCandidates(52014, WETN, 'https://cdn.example.com/logo.png')
    expect(urls[0]).toBe(`/tokens/${WETN}.svg`)
    expect(urls[1]).toBe('https://cdn.example.com/logo.png')
    expect(urls[2]).toBe(`https://static.electroswap.io/tokens/images/${WETN}.svg`)
    expect(urls[3]).toBe(`https://static.electroswap.io/tokens/images/${WETN}.png`)
    // Electroneum is on neither host, so asking could only ever 404.
    expect(urls.some((u) => u.includes('trustwallet'))).toBe(false)
    expect(urls.some((u) => u.includes('smold.app'))).toBe(false)
  })

  it('falls back to the sibling extension for an unbundled ETN token', () => {
    const urls = tokenLogoCandidates(52014, UNKNOWN, `https://static.electroswap.io/tokens/images/${UNKNOWN}.svg`)
    expect(urls).toEqual([`https://static.electroswap.io/tokens/images/${UNKNOWN}.svg`, `https://static.electroswap.io/tokens/images/${UNKNOWN}.png`])
  })

  it('off Electroneum: Trust Wallet by slug, then smol-assets by chain id', () => {
    const urls = tokenLogoCandidates(8453, UNKNOWN)
    expect(urls).toEqual([
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${UNKNOWN}/logo.png`,
      `https://assets.smold.app/api/token/8453/${UNKNOWN}/logo-128.png`,
    ])
    expect(urls.some((u) => u.includes('static.electroswap.io'))).toBe(false)
  })

  it('keeps the address exactly as it arrived on the hosts that demand EIP-55', () => {
    // A lower-cased path 404s on both, and the engine already hands the UI a
    // checksummed address — so the case must survive the trip.
    const urls = tokenLogoCandidates(1, WETN)
    expect(urls[0]).toBe(`https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/${WETN}/logo.png`)
  })

  it('the native coin has no address, so no address-shaped host is asked', () => {
    expect(tokenLogoCandidates(8453, 'native')).toEqual([])
  })

  it('CoinGecko only once an id is known — explicitly, or from the cached map', () => {
    expect(tokenLogoCandidates(8453, UNKNOWN).some((u) => u.includes('coingecko'))).toBe(false)
    expect(tokenLogoCandidates(8453, UNKNOWN, null, '42')).toContain('https://assets.coingecko.com/coins/images/42/small/image.png')
    setCoingeckoIds({ [`8453:${UNKNOWN}`]: '99' })
    expect(tokenLogoCandidates(8453, UNKNOWN)).toContain('https://assets.coingecko.com/coins/images/99/small/image.png')
    setCoingeckoIds({})
  })

  it('refuses a javascript: logoUri', () => {
    expect(tokenLogoCandidates(8453, 'native', 'javascript:alert(1)')).toEqual([])
  })

  it('refuses a data: logoUri — an SVG data URI is a document, and a document can carry script', () => {
    expect(tokenLogoCandidates(8453, 'native', 'data:image/svg+xml;base64,x')).toEqual([])
  })

  it('resolves an ipfs: logoUri through the gateway the engine already uses', () => {
    expect(tokenLogoCandidates(8453, 'native', 'ipfs://QmAbc')).toEqual(['https://ipfs.io/ipfs/QmAbc'])
  })

  it('never repeats a url', () => {
    const same = 'https://cdn.example.com/a.png'
    expect(tokenLogoCandidates(8453, 'native', same)).toEqual([same])
  })

  it('TWA_SLUGS covers the nine supported non-ETN chains and nothing else', () => {
    expect(Object.keys(TWA_SLUGS).length).toBe(9)
    expect(TWA_SLUGS[52014]).toBeUndefined()
  })
})

describe('the (chainId, address) cache', () => {
  it('remembers the winner, and remembers that nothing drew', () => {
    const kv = new Map<string, string>()
    setTokenLogoStore({ get: (k) => kv.get(k) ?? null, set: (k, v) => void kv.set(k, v) })
    expect(cachedTokenLogo(8453, UNKNOWN)).toBeNull()
    cacheTokenLogo(8453, UNKNOWN, 'https://cdn.example.com/a.png')
    expect(cachedTokenLogo(8453, UNKNOWN)).toEqual({ uri: 'https://cdn.example.com/a.png' })
    cacheTokenLogo(8453, BOLT, null)
    expect(cachedTokenLogo(8453, BOLT)).toEqual({ uri: null })
    // Keyed by chain as well as address: the same token on two chains is two logos.
    expect(cachedTokenLogo(1, UNKNOWN)).toBeNull()
    expect([...kv.keys()]).toContain(`bv.logo.8453:${UNKNOWN.toLowerCase()}`)
    setTokenLogoStore(null)
  })

  it('survives a store that throws, because private windows do', () => {
    setTokenLogoStore({
      get: () => {
        throw new Error('blocked')
      },
      set: () => {
        throw new Error('blocked')
      },
    })
    expect(() => cacheTokenLogo(1, WETN, 'https://cdn.example.com/b.png')).not.toThrow()
    // The memory layer still answers, so a scrolling list is unaffected.
    expect(cachedTokenLogo(1, WETN)).toEqual({ uri: 'https://cdn.example.com/b.png' })
    setTokenLogoStore(null)
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
