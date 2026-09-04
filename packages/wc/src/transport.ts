/**
 * In-app browser transport decision for BoltVault on mobile (pure).
 *
 * On mobile the dApp runs inside the RN WebView with the same page-provider
 * as the extension; the WC session is the transport. Hardware on mobile:
 * Ledger over BLE, Trezor over OTG. Pairing is air-gapped QR (the QR carries
 * the pairing info, not the key).
 */
export type MobilePlatform = 'ios' | 'android'

export interface TransportDecision {
  readonly platform: MobilePlatform
  readonly inAppBrowser: boolean // always true on mobile (dApp in RN WebView)
  readonly pageProviderInWebView: boolean // true — same page-provider as the extension
  readonly hardwareLedger: 'ble' | 'webhid' // mobile → 'ble'
  readonly hardwareTrezor: 'otg' | 'connect-iframe' // mobile → 'otg'
}

export function mobileTransport(platform: MobilePlatform): TransportDecision {
  return {
    platform,
    inAppBrowser: true,
    pageProviderInWebView: true,
    hardwareLedger: 'ble',
    hardwareTrezor: 'otg',
  }
}

/** Air-gapped QR is the pairing method on mobile. */
export const pairingVia: 'qr' = 'qr'
