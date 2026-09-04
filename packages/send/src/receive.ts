/**
 * Receive — EIP-681 URI (T4.5).
 *
 * The receive QR encodes an EIP-681 URI. Per the design, the scheme stays
 * `ethereum:` and the chain is disambiguated with the `@chainId` caption
 * (verify: "QR encodes `ethereum:0x…@52014`"). Native receive is the common
 * case (amount in native units); an ERC-20 receive adds `address` + `asset`.
 *
 * `buildReceiveUri` is pure — the QR encoder is the UI's job (any QR lib).
 */
import { isAddress, parseUnits, type Hex } from 'viem'

/** Native asset sentinel (EIP-681 `asset=` for the chain's native token). */
export const NATIVE_ASSET: Hex = '0x0000000000000000000000000000000000000000'

export interface ReceiveOptions {
  /** Chain id — rendered as the `@chainId` caption. */
  readonly chainId?: number
  /** Human amount to request (e.g. "1.5"). Native units for a native receive. */
  readonly amount?: string
  /** For an ERC-20 receive: the token contract address (adds address + asset). */
  readonly token?: string
  /** Short memo / tag (URL-encoded). */
  readonly tag?: string
  /** Longer free-text message (URL-encoded). */
  readonly message?: string
}

/**
 * Build an EIP-681 receive URI for an address.
 *
 * - Native:   `ethereum:0xRecipient@52014?amount=1.5&tag=...`
 * - ERC-20:   `ethereum:0xRecipient@52014?address=0xToken&asset=0xToken&amount=...`
 */
export function buildReceiveUri(address: string, opts: ReceiveOptions = {}): string {
  const checksum = address.toLowerCase().startsWith('0x') ? address : `0x${address}`
  if (!isAddress(checksum)) throw new Error(`not an address: ${address}`)

  const base = `ethereum:${checksum}${opts.chainId != null ? `@${opts.chainId}` : ''}`

  // Manual percent-encoding (EIP-681 wants %20 for space, not form "+").
  const pairs: string[] = []
  const add = (k: string, v: string) => pairs.push(`${k}=${encodeURIComponent(v)}`)
  const token = opts.token
  if (token != null) {
    add('address', token)
    add('asset', token)
  }
  if (opts.amount != null && opts.amount !== '') add('amount', normalizeAmount(opts.amount))
  if (opts.tag != null && opts.tag !== '') add('tag', opts.tag)
  if (opts.message != null && opts.message !== '') add('message', opts.message)

  const query = pairs.join('&')
  return query ? `${base}?${query}` : base
}

/** "1.0" → "1", "1.500" → "1.5", "1.5" → "1.5" (EIP-681 wants clean decimals). */
export function normalizeAmount(amount: string): string {
  const trimmed = amount.trim()
  const parts = trimmed.split('.')
  const int = parts[0] ?? ''
  const frac = parts[1]
  if (frac == null) return int
  const trimmedFrac = frac.replace(/0+$/, '')
  return trimmedFrac === '' ? int : `${int}.${trimmedFrac}`
}

/**
 * Parse the `amount` back to a base-unit bigint for a given token (decimals).
 * Handy for the review card ("Requesting 1.5 ETN").
 */
export function receiveAmountWei(amount: string, decimals: number): bigint {
  return parseUnits(amount, decimals)
}
