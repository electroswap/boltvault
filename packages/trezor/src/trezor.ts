/**
 * Trezor Connect (T6.4) — the pure decision layer. The bundled Connect iframe
 * (pinned version) is the transport; the device itself is manual-gated.
 *
 * Design (S8 hardware): same metadata shape as Ledger; iOS cannot use USB, so
 * offer watch-only + "sign on desktop". Blind-sign is OFF: when a decoded
 * hardware sheet exists we arm but the device shows a *hash*, not the amounts,
 * so the user must explicitly "hash sign". If the tx cannot be decoded at all →
 * do not arm.
 */

// --- platform → transport decision ------------------------------------------

export type Platform = 'desktop' | 'ios' | 'android' | 'other'

/** How the bundled Connect reaches the device. */
export type TrezorTransport = 'iframe' | 'deeplink' | 'otg'

export interface TransportDecision {
  readonly transport: TrezorTransport
  /** iOS: also offer watch-only (no USB on iOS). */
  readonly watchOnlyFallback: boolean
  readonly reason: string
}

export function decideTransport(platform: Platform): TransportDecision {
  switch (platform) {
    case 'desktop':
      return {
        transport: 'iframe',
        watchOnlyFallback: false,
        reason: 'bundled Connect iframe (pinned version)',
      }
    case 'ios':
      return {
        transport: 'deeplink',
        watchOnlyFallback: true,
        reason: 'iOS cannot use USB — sign on desktop (deeplink) or run watch-only',
      }
    case 'android':
      return {
        transport: 'otg',
        watchOnlyFallback: false,
        reason: 'Android USB-OTG (bundled Connect)',
      }
    default:
      return {
        transport: 'deeplink',
        watchOnlyFallback: false,
        reason: 'unknown platform — deeplink to desktop',
      }
  }
}

// --- blind-sign / hash-sign policy ------------------------------------------

/**
 * The decoded hardware sheet the decoder must be able to print (design:
 * `{tokenIn, tokenOut, minOut, feeBps, sink}`) — or the breaker does not arm.
 */
export interface DecodedSheet {
  readonly tokenIn: string
  readonly tokenOut: string
  readonly minOut: bigint
  readonly feeBps: number
  readonly sink: string
}

export type HardwareSignMode = 'hash' | 'no-arm'

/**
 * Blind-sign is OFF. If a decoded sheet exists → arm in `hash` mode (the device
 * shows a hash, not the amounts, so require an explicit "hash sign" + print the
 * sheet in our UI). If the tx cannot be decoded → `no-arm`.
 */
export function hardwareSignMode(sheet: DecodedSheet | null): HardwareSignMode {
  return sheet == null ? 'no-arm' : 'hash'
}

/** The extra confirm line shown in `hash` mode (design verbatim intent). */
export const HASH_SIGN_NOTE = 'Your device will show a hash, not the amounts. The amounts are above.'

export interface SheetSummary {
  readonly tokenIn: string
  readonly tokenOut: string
  readonly minOut: bigint
  readonly feeBps: number
  /** Shortened sink (the fee recipient), so the user sees where 0.25% goes. */
  readonly sink: string
}

/** The five-field sheet the decoder prints (or we do not arm). */
export function printSheet(sheet: DecodedSheet): SheetSummary {
  return {
    tokenIn: sheet.tokenIn,
    tokenOut: sheet.tokenOut,
    minOut: sheet.minOut,
    feeBps: sheet.feeBps,
    sink: sheet.sink,
  }
}

// --- device metadata (same shape as Ledger) ---------------------------------

export interface TrezorDevice {
  readonly deviceId: string
  readonly path: string
  readonly address: string
}

export function isValidDevice(d: TrezorDevice): boolean {
  return d.deviceId.length > 0 && d.path.startsWith('m/') && /^0x[0-9a-fA-F]{40}$/.test(d.address)
}
