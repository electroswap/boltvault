/**
 * What a scanned code means to the Send screen (master plan §8.4).
 *
 * A camera can hand back a bare address or an EIP-681 payment request, and the
 * request carries a chain, a token and an amount as well as the address. Taking
 * only the address would make the user retype what the code already said, and
 * getting the units wrong would be worse than that: EIP-681 states `value` and
 * `uint256` in base units, so a request for one ETN reads as
 * `1000000000000000000` and must be scaled by the token's decimals before it
 * reaches an amount field. Our own `pay` links use `amount`, which is what a
 * person typed, and needs no scaling.
 *
 * `parseLink` cannot tell the two apart — it folds `amount`, `value` and
 * `uint256` into one field — so the distinction is drawn here, from the raw
 * text, and stated in the result rather than guessed at the other end.
 */
import { parseLink } from '../links'

export type Scanned =
  | { readonly kind: 'address'; readonly to: string }
  | {
      readonly kind: 'request'
      readonly to: string
      readonly chainId: number | null
      /** The token contract, or null for the chain's native coin. */
      readonly token: string | null
      readonly amount: string | null
      /** True when `amount` is a raw integer that the token's decimals scale. */
      readonly baseUnits: boolean
    }
  | { readonly kind: 'unreadable' }

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
const BASE_UNIT_PARAM = /[?&](value|uint256)=/

export function readScannedCode(raw: string): Scanned {
  const text = raw.trim()
  if (ADDRESS.test(text)) return { kind: 'address', to: text }
  const action = parseLink(text)
  if (!action || action.kind !== 'pay') return { kind: 'unreadable' }
  return {
    kind: 'request',
    to: action.to,
    chainId: action.chainId,
    token: action.token,
    amount: action.amount,
    baseUnits: BASE_UNIT_PARAM.test(text),
  }
}
