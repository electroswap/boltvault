/**
 * How an address is written on a statement or a rule's detail line
 * (ES-BV-033).
 *
 * Six and six, checksummed. Four-and-four is exactly the shape an
 * address-poisoning generator is built to satisfy — grinding a vanity address
 * that matches four leading and four trailing characters is minutes of
 * ordinary hardware, and six and six is a few hundred thousand times more
 * work. Lowercase throws away EIP-55, which is a checksum a reader can see:
 * one wrong character changes half the letters downstream, and every wallet,
 * explorer and exchange shows it, so a reader is comparing a mixed-case string
 * against a mixed-case string.
 *
 * Spenders, operators and contracts appear on these lines and nowhere else on
 * the sheet, so this is the only look the user gets.
 */
import { getAddress } from 'viem'

const HEX40 = /^0x[0-9a-fA-F]{40}$/

/**
 * The short form, or the input unchanged when it is not an address.
 *
 * Deliberately total: statements are built from whatever the decoder produced,
 * and a sentinel, a name or an empty string must come back as itself rather
 * than throw.
 */
export function shortHex(address: string): string {
  if (!HEX40.test(address)) return address
  let cased: string
  try {
    cased = getAddress(address as `0x${string}`)
  } catch {
    return address
  }
  return `${cased.slice(0, 8)}…${cased.slice(-6)}`
}
