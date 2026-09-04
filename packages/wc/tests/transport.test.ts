import { describe, expect, it } from 'vitest'
import { mobileTransport, pairingVia } from '../src/transport'

describe('mobileTransport', () => {
  for (const platform of ['ios', 'android'] as const) {
    it(`decides correctly for ${platform}`, () => {
      expect(mobileTransport(platform)).toEqual({
        platform,
        inAppBrowser: true,
        pageProviderInWebView: true,
        hardwareLedger: 'ble',
        hardwareTrezor: 'otg',
      })
    })
  }
})

describe('pairingVia', () => {
  it("is 'qr' (air-gapped)", () => {
    expect(pairingVia).toBe('qr')
  })
})
