import { describe, expect, it } from 'vitest'
import {
  decideTransport,
  hardwareSignMode,
  printSheet,
  isValidDevice,
  HASH_SIGN_NOTE,
  type DecodedSheet,
  type Platform,
} from '../src'

describe('decideTransport (T6.4)', () => {
  it('desktop → bundled Connect iframe, no watch-only fallback', () => {
    const d = decideTransport('desktop')
    expect(d.transport).toBe('iframe')
    expect(d.watchOnlyFallback).toBe(false)
  })

  it('iOS → deeplink + watch-only fallback (no USB on iOS)', () => {
    const d = decideTransport('ios')
    expect(d.transport).toBe('deeplink')
    expect(d.watchOnlyFallback).toBe(true)
  })

  it('Android → USB-OTG', () => {
    expect(decideTransport('android').transport).toBe('otg')
  })

  it('unknown platform → deeplink to desktop', () => {
    const d = decideTransport('other' as Platform)
    expect(d.transport).toBe('deeplink')
  })
})

describe('hardwareSignMode (T6.4, blind-sign OFF)', () => {
  const sheet: DecodedSheet = {
    tokenIn: 'ETN',
    tokenOut: 'USDC',
    minOut: 997n,
    feeBps: 25,
    sink: '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1',
  }
  it('a decoded sheet → hash mode (device shows a hash, require hash sign)', () => {
    expect(hardwareSignMode(sheet)).toBe('hash')
  })
  it('no decoded sheet → no-arm (do not arm the breaker)', () => {
    expect(hardwareSignMode(null)).toBe('no-arm')
  })
  it('the hash-sign note names the hash + the amounts-above policy', () => {
    expect(HASH_SIGN_NOTE).toMatch(/hash/i)
    expect(HASH_SIGN_NOTE).toMatch(/amounts/i)
  })
})

describe('printSheet (T6.4 — the 5-field sheet)', () => {
  it('prints tokenIn/tokenOut/minOut/feeBps/sink', () => {
    const s = printSheet({
      tokenIn: 'ETN',
      tokenOut: 'USDC',
      minOut: 123n,
      feeBps: 25,
      sink: '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1',
    })
    expect(s).toEqual({ tokenIn: 'ETN', tokenOut: 'USDC', minOut: 123n, feeBps: 25, sink: '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1' })
  })
})

describe('isValidDevice (T6.4 metadata shape)', () => {
  it('accepts a well-formed device', () => {
    expect(
      isValidDevice({
        deviceId: 'dev-1',
        path: "m/44'/60'/0'/0/0",
        address: '0xA1A1a1a1A1A1A1A1A1A1a1A1A1A1A1A1A1A1a1a1',
      }),
    ).toBe(true)
  })
  it('rejects a bad address / missing path / empty id', () => {
    expect(
      isValidDevice({ deviceId: 'dev-1', path: "m/44'/60'/0'/0/0", address: '0x123' }),
    ).toBe(false)
    expect(
      isValidDevice({ deviceId: 'dev-1', path: '44/60', address: '0xA1A1a1a1A1A1A1A1A1A1a1A1A1A1A1A1A1A1a1a1' }),
    ).toBe(false)
    expect(
      isValidDevice({ deviceId: '', path: "m/44'/60'/0'/0/0", address: '0xA1A1a1a1A1A1A1A1A1A1a1A1A1A1A1A1A1A1a1a1' }),
    ).toBe(false)
  })
})
