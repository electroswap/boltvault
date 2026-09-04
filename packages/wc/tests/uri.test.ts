import { describe, expect, it } from 'vitest'
import {
  WC_SCHEME,
  buildWcPairingUri,
  isHex64,
  isWcUri,
  parseWcPairingUri,
  type WcPairing,
} from '../src/uri'

const topic =
  'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'
const symKey =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
const relay = 'relay.walletconnect.com'

const pairing: WcPairing = { topic, relay, symKey, protocols: 'wallet' }

describe('isWcUri', () => {
  it("accepts 'wc:' URIs", () => {
    expect(isWcUri('wc:abc@relay?symKey=1&protocols=wallet')).toBe(true)
  })

  it('rejects other schemes', () => {
    expect(isWcUri('ethereum:0xabc?value=1')).toBe(false)
  })

  it('rejects empty string', () => {
    expect(isWcUri('')).toBe(false)
  })

  it('exposes the scheme constant', () => {
    expect(WC_SCHEME).toBe('wc')
  })
})

describe('buildWcPairingUri', () => {
  it('builds the exact URI format', () => {
    expect(buildWcPairingUri(pairing)).toBe(
      `wc:${topic}@${relay}?symKey=${symKey}&protocols=wallet`,
    )
  })
})

describe('parseWcPairingUri', () => {
  it('parses a built URI with all fields', () => {
    const parsed = parseWcPairingUri(buildWcPairingUri(pairing))
    expect(parsed).toEqual({
      topic,
      relay,
      symKey,
      protocols: 'wallet',
    })
  })

  it('round-trips buildWcPairingUri', () => {
    expect(parseWcPairingUri(buildWcPairingUri(pairing))).toEqual(pairing)
  })

  it('round-trips a comma-joined protocols list', () => {
    const multi: WcPairing = {
      topic,
      relay,
      symKey,
      protocols: 'wallet,snap',
    }
    const uri = buildWcPairingUri(multi)
    expect(uri).toBe(`wc:${topic}@${relay}?symKey=${symKey}&protocols=wallet,snap`)
    expect(parseWcPairingUri(uri)).toEqual(multi)
  })

  it("throws on missing 'wc:' prefix", () => {
    expect(() => parseWcPairingUri('ethereum:abc')).toThrow()
  })

  it("throws on missing '@'", () => {
    expect(() => parseWcPairingUri('wc:abc?symKey=x')).toThrow()
  })

  it('throws on missing symKey param', () => {
    expect(() => parseWcPairingUri(`wc:${topic}@${relay}?protocols=wallet`)).toThrow()
  })

  it('throws on missing topic', () => {
    expect(() => parseWcPairingUri(`wc:@${relay}?symKey=${symKey}`)).toThrow()
  })
})

describe('isHex64', () => {
  const hex64 = 'a'.repeat(64)
  it('accepts 0x-prefixed 64 hex', () => {
    expect(isHex64(`0x${hex64}`)).toBe(true)
  })
  it('accepts bare 64 hex', () => {
    expect(isHex64(hex64)).toBe(true)
  })
  it('rejects 63 hex', () => {
    expect(isHex64('a'.repeat(63))).toBe(false)
  })
  it('rejects 65 hex', () => {
    expect(isHex64('a'.repeat(65))).toBe(false)
  })
  it('rejects non-hex characters', () => {
    expect(isHex64('g'.repeat(64))).toBe(false)
    expect(isHex64('a'.repeat(32) + 'z' + 'a'.repeat(31))).toBe(false)
  })
  it('rejects 0x with wrong length', () => {
    expect(isHex64(`0x${'a'.repeat(63)}`)).toBe(false)
  })
})
