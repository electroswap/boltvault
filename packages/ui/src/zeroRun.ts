/**
 * Zero-run notation — 0.000000000000000001 BOLT reads as 0.0₁₇1 BOLT, and
 * $0.0000023 reads as $0.0₅23.
 *
 * Owner, looking at one wei of BOLT in the token screen's "Yours" plate:
 * "it takes up the entire row". Eighteen decimals is what an ERC-20 holds, not
 * what a person reads — the digits between the point and the first real one
 * carry no information beyond *how many of them there are*, and printed in
 * full they push the symbol off the line and make the row impossible to scan
 * beside its neighbours. Every DEX front end solves it the same way: state the
 * count of zeros once, small, and spend the width on the digits that matter.
 *
 * A sub-cent price has exactly the same problem — a token at $0.0000023 is a
 * real listing, not an edge case — so the rule is about the *shape* of the
 * number rather than what it counts. Anything the app prints as `0.` followed
 * by a long run of zeros gets the treatment, dollars included.
 *
 * This module is the *notation* — where the run starts and how long it is. The
 * *precision* (how many digits survive after it) is `packages/wallet/src/format`,
 * which keeps `ZERO_RUN_DIGITS` significant figures once a run qualifies. The
 * two agree because they ask the same question of the same string: a formatter
 * emits a plain decimal number and nothing else, so what it returns can still
 * be parsed, compared and asserted on. Only a text primitive ever compresses
 * it, at the moment it paints.
 */

/**
 * Zeros after the point before the notation is worth it.
 *
 * Three a reader counts at a glance and the plain form is no longer; from the
 * fourth the eye has to count, which is exactly the work the subscript does
 * for it. Below this the number is left exactly as the formatter wrote it.
 */
export const ZERO_RUN_MIN = 4

/** Significant digits kept after a compressed run. */
export const ZERO_RUN_DIGITS = 6

/**
 * One piece of a line of text: a literal string, or a count of zeros to be
 * drawn small and low. A number is always preceded by the "0.0" that
 * introduces it, so a run reads `'0.0'`, `17`, `'1'`.
 */
export type AmountRun = string | number

/*
  The integer part has to be exactly `0`, so the `0.00001` inside `10.00001`
  is never mistaken for a run of its own. Anything else may sit in front of
  it: `$` (owner, on a sub-cent token price: "I'd also like to apply the same
  logic to small USD values") and `−` (U+2212, what `cut` writes) both leave
  the match standing, and both ride along on the head of the run so the figure
  is never split from its sign or its currency.
*/
const RUN = new RegExp(`(^|[^\\d.])0\\.(0{${ZERO_RUN_MIN},})(\\d+)`, 'g')

/**
 * Split `text` into runs, or `null` when it holds no compressible number —
 * the common case, which allocates nothing.
 */
export function amountRuns(text: string): readonly AmountRun[] | null {
  // Necessary for any match, and far cheaper than running the expression over
  // every label the app paints.
  if (!text.includes(`0.${'0'.repeat(ZERO_RUN_MIN)}`)) return null
  RUN.lastIndex = 0
  const out: AmountRun[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = RUN.exec(text)) !== null) {
    const [whole, before = '', zeros = '', digits = ''] = m
    out.push(`${text.slice(last, m.index)}${before}0.0`)
    out.push(zeros.length)
    /*
      Truncated, never rounded: a shown amount must not exceed the held one.

      Trailing zeros go with it. The amount formatters already strip their own,
      but `formatPrice` pads to two significant figures — so a token priced at
      exactly 1e-9 arrives as "0.0000000010", and the padding that reads as
      precision in the long form is only noise next to a subscript. The first
      kept digit is never a zero (the run above is greedy), so the tail cannot
      strip away to nothing.
    */
    out.push(digits.slice(0, ZERO_RUN_DIGITS).replace(/0+$/, ''))
    last = m.index + whole.length
  }
  if (out.length === 0) return null
  if (last < text.length) out.push(text.slice(last))
  return out
}
