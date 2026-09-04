import { describe, expect, it } from 'vitest'
import { normalizeSettings, serializeSettings, reseatOriginChain, removeOrigin } from '../src'
import { DEFAULT_SETTINGS, type ConnectedSite } from '@boltvault/core'

function site(origin: string, chainId: number): ConnectedSite {
  return {
    origin,
    chainId,
    accountId: null,
    connected: true,
    permissions: ['eth_accounts'],
    connectedAt: 1,
  }
}

describe('normalizeSettings (T6.6)', () => {
  it('returns full defaults for null/undefined', () => {
    const s = normalizeSettings(null)
    expect(s).toEqual({ ...DEFAULT_SETTINGS, reducedMotion: false })
  })

  it('applies stored values and fills missing with defaults', () => {
    const s = normalizeSettings({ autoLock: 'never', exactApprovals: false, displayCurrency: 'ETN' })
    expect(s.autoLock).toBe('never')
    expect(s.exactApprovals).toBe(false)
    expect(s.displayCurrency).toBe('ETN')
    // untouched fields keep defaults
    expect(s.defaultWallet).toBe(DEFAULT_SETTINGS.defaultWallet)
    expect(s.sendWhitelist).toBe(DEFAULT_SETTINGS.sendWhitelist)
  })

  it('clamps an invalid autoLock to the default', () => {
    const s = normalizeSettings({ autoLock: 'bogus' })
    expect(s.autoLock).toBe(DEFAULT_SETTINGS.autoLock)
  })

  it('clamps an invalid displayCurrency to the default', () => {
    const s = normalizeSettings({ displayCurrency: 'EUR' })
    expect(s.displayCurrency).toBe(DEFAULT_SETTINGS.displayCurrency)
  })

  it('parses a JSON string and ignores corrupt JSON', () => {
    expect(normalizeSettings('{"exactApprovals":false}').exactApprovals).toBe(false)
    expect(normalizeSettings('not-json{').exactApprovals).toBe(DEFAULT_SETTINGS.exactApprovals)
  })

  it('takes reducedMotion from the OS, defaulting false', () => {
    expect(normalizeSettings(null, { reducedMotion: true }).reducedMotion).toBe(true)
    expect(normalizeSettings(null).reducedMotion).toBe(false)
  })

  it('serializeSettings round-trips through normalizeSettings', () => {
    const s = normalizeSettings({ autoLock: '1min', displayCurrency: 'ETN' })
    const parsed = normalizeSettings(serializeSettings(s))
    expect(parsed.autoLock).toBe('1min')
    expect(parsed.displayCurrency).toBe('ETN')
  })
})

describe('per-origin chain editor (T6.6)', () => {
  const sites = [site('https://a.com', 52014), site('https://b.com', 8453)]

  it('reseats only the targeted origin, leaving others untouched', () => {
    const next = reseatOriginChain(sites, { origin: 'https://a.com', chainId: 8453 })
    expect(next.find((s) => s.origin === 'https://a.com')?.chainId).toBe(8453)
    expect(next.find((s) => s.origin === 'https://b.com')?.chainId).toBe(8453)
  })

  it('appends a brand-new origin when reseating', () => {
    const next = reseatOriginChain(sites, { origin: 'https://new.com', chainId: 52014 })
    expect(next).toHaveLength(3)
    expect(next.find((s) => s.origin === 'https://new.com')?.chainId).toBe(52014)
  })

  it('removeOrigin drops just that origin', () => {
    const next = removeOrigin(sites, 'https://a.com')
    expect(next).toHaveLength(1)
    expect(next[0]?.origin).toBe('https://b.com')
  })
})
