import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import {
  logoCandidates,
  identiconSvg,
  identiconDataUri,
  TWA_SLUGS,
} from '../src'

// A known EIP-55 checksummed address (WETN on ETN).
const WETN = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'

describe('logoCandidates (T4.3 pipeline order)', () => {
  it('ETN: list logoURI first, then ElectroSwap static .svg then .png, no TWA', () => {
    const urls = logoCandidates({ chainId: 52014, address: WETN, logoURI: 'https://cdn.example.com/logo.png' })
    expect(urls[0]).toBe('https://cdn.example.com/logo.png')
    expect(urls[1]).toBe(`https://static.electroswap.io/tokens/images/${WETN}.svg`)
    expect(urls[2]).toBe(`https://static.electroswap.io/tokens/images/${WETN}.png`)
    // ETN has no Trust Wallet chain — no TWA URL.
    expect(urls.some((u) => u.includes('trustwallet'))).toBe(false)
    expect(urls).toHaveLength(3)
  })

  it('ETN without logoURI: just the two ElectroSwap static frames', () => {
    const urls = logoCandidates({ chainId: 52014, address: WETN })
    expect(urls).toHaveLength(2)
    expect(urls.every((u) => u.startsWith('https://static.electroswap.io/'))).toBe(true)
  })

  it('Base: TWA slug base, no ElectroSwap static, coingecko only if id present', () => {
    const baseAddr = '0x' + 'ab'.repeat(20)
    const checksum = getAddress(baseAddr)
    const withCoin = logoCandidates({ chainId: 8453, address: baseAddr, coingeckoId: '42' })
    expect(withCoin).toContain(
      `https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/base/assets/${checksum}/logo.png`,
    )
    expect(withCoin).toContain('https://assets.coingecko.com/coins/images/42/small/image.png')
    expect(withCoin.some((u) => u.includes('static.electroswap.io'))).toBe(false)
  })

  it('skips javascript: and data: logoURIs (XSS / inline rules)', () => {
    const js = logoCandidates({ chainId: 52014, address: WETN, logoURI: 'javascript:alert(1)' })
    expect(js).not.toContain('javascript:alert(1)')
    const data = logoCandidates({ chainId: 52014, address: WETN, logoURI: 'data:image/svg+xml;base64,x' })
    expect(data).not.toContain('data:image/svg+xml;base64,x')
  })

  it('keeps ipfs: logoURIs (the pipeline can resolve them)', () => {
    const urls = logoCandidates({ chainId: 52014, address: WETN, logoURI: 'ipfs://QmAbc' })
    expect(urls[0]).toBe('ipfs://QmAbc')
  })

  it('uses the EIP-55 checksummed address in static + TWA paths', () => {
    // Lowercase input must still produce checksummed URLs.
    const lower = WETN.toLowerCase()
    const urls = logoCandidates({ chainId: 52014, address: lower })
    // The checksummed form is present in the generated URLs.
    expect(urls[0]).toContain(WETN)
  })

  it('TWA_SLUGS covers the 9 supported non-ETN chains and nothing else', () => {
    expect(Object.keys(TWA_SLUGS).length).toBe(9)
    expect((TWA_SLUGS as Record<number, string>)[52014]).toBeUndefined()
  })
})

describe('identicon (T4.3 guaranteed last frame)', () => {
  it('is deterministic: same address → identical SVG', () => {
    const a = identiconSvg(WETN)
    const b = identiconSvg(WETN)
    expect(a).toBe(b)
  })

  it('differs for different addresses', () => {
    const a = identiconSvg(WETN)
    const b = identiconSvg('0x' + 'cd'.repeat(20))
    expect(a).not.toBe(b)
  })

  it('produces a valid SVG with the requested size', () => {
    const svg = identiconSvg(WETN, 32)
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg).toContain('width="32"')
    expect(svg).toContain('<rect')
    expect(svg.endsWith('</svg>')).toBe(true)
  })

  it('identiconDataUri is a base64 data URI that decodes to the SVG', () => {
    const uri = identiconDataUri(WETN, 32)
    expect(uri.startsWith('data:image/svg+xml;base64,')).toBe(true)
    const b64 = uri.slice('data:image/svg+xml;base64,'.length)
    const decoded = atob(b64)
    expect(decoded).toBe(identiconSvg(WETN, 32))
  })
})
