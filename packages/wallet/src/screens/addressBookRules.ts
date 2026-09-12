/**
 * What the address book will take in its address field, with no React in it.
 *
 * Kept apart from the screen so it can be unit-tested: `packages/wallet/tests/*`
 * run under plain vitest, so this module must not reach `@boltvault/ui`
 * (react-native) even indirectly.
 *
 * The book used to answer this with one regex that allowed `0x…` and `.etn`,
 * and then handed whatever was typed straight to `contacts.add` — which opens
 * with `isAddress()`. So the `.etn` it invited was refused by the layer below
 * with "not an address", and `.eth` never got that far: the Save key simply
 * stayed inert, with nothing on screen saying why. The tester's report was
 * exact: "At address book the wallet does not recognize by ENS name."
 */

/** The suffixes `names.chainFor` knows: `.etn` on Electroneum, `.eth` on Ethereum. */
const NAME_SUFFIX = /\.(etn|eth)$/i
const HEX_ADDRESS = /^0x[0-9a-fA-F]{40}$/

export type BookEntryKind = 'address' | 'name' | 'unusable'

/**
 * How to treat what the user typed.
 *
 * `0x`-prefixed input is never a name however it ends: `0xYou….etn` in the slot
 * where an address goes is a lookalike, not a lookup, and the same refusal
 * `displayName` makes for reverse records applies to what is typed forward.
 */
export function bookEntryKind(input: string): BookEntryKind {
  const typed = input.trim()
  if (HEX_ADDRESS.test(typed)) return 'address'
  if (typed.startsWith('0x')) return 'unusable'
  // Longer than the suffix itself: ".etn" is a suffix, not a name.
  if (NAME_SUFFIX.test(typed) && typed.length > 4) return 'name'
  return 'unusable'
}
