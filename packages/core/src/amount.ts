/**
 * Turning what somebody typed into base units, without inventing digits
 * (ES-BV-048).
 *
 * `parseUnits` rounds. `parseUnits('1.5', 0)` is `2n`, and `parseUnits` of an
 * eighteen-decimal figure into a six-decimal token rounds at the seventh
 * place — half up, so it can round *away* from the user. The form showed what
 * they typed, the sheet showed the rounded figure, and on a token with few
 * decimals the difference is a whole unit. Nothing in the wallet should ever
 * move more than was asked for because of a display convention.
 *
 * So: a fraction longer than the token can hold is a question, not a value.
 * The caller is told which token and how many places it has, and the person
 * can decide what they meant.
 */

/** Thrown for input a token cannot represent; callers map it to their own error type. */
export class AmountPrecisionError extends Error {
  constructor(
    readonly decimals: number,
    readonly typed: string,
  ) {
    super(
      decimals === 0
        ? 'This token has no decimal places, so it can only be sent in whole units.'
        : `This token has ${decimals} decimal place${decimals === 1 ? '' : 's'}, so it cannot hold every digit you typed.`,
    )
    this.name = 'AmountPrecisionError'
  }
}

/** Thrown for input that is not a number at all. */
export class AmountFormatError extends Error {
  constructor(readonly typed: string) {
    super('That amount is not a number.')
    this.name = 'AmountFormatError'
  }
}

const AMOUNT = /^(\d*)(?:\.(\d*))?$/

/**
 * Parse a typed decimal amount into base units, exactly.
 *
 * Accepts an empty string as zero, the way every amount field in the wallet
 * starts. Refuses a sign, an exponent, separators and any fraction the token
 * cannot represent. Never rounds.
 */
export function parseAmountStrict(text: string, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 77)
    throw new AmountFormatError(text)
  const trimmed = text.trim()
  if (trimmed === '') return 0n
  const m = AMOUNT.exec(trimmed)
  if (!m) throw new AmountFormatError(text)
  const whole = m[1] ?? ''
  const fraction = m[2] ?? ''
  if (whole === '' && fraction === '') throw new AmountFormatError(text)
  /*
    Trailing zeros beyond the token's precision carry no value, so "1.500" on a
    two-decimal token is 1.50 and not a mistake. Anything else the token cannot
    hold is refused rather than rounded.
  */
  const significant = fraction.replace(/0+$/, '')
  if (significant.length > decimals) throw new AmountPrecisionError(decimals, trimmed)
  const padded = fraction.slice(0, decimals).padEnd(decimals, '0')
  return BigInt(`${whole === '' ? '0' : whole}${padded}`)
}

/** The same, as an answer rather than an exception: `null` when it cannot be represented. */
export function tryParseAmountStrict(text: string, decimals: number): bigint | null {
  try {
    return parseAmountStrict(text, decimals)
  } catch {
    return null
  }
}
