/**
 * The engine's two ways of reading a typed amount (ES-BV-048).
 *
 * Both go through `parseAmountStrict`, which never rounds: viem's `parseUnits`
 * rounds half up, so an eighteen-decimal figure typed against a six-decimal
 * token quietly became a larger number than the one on screen, and on a token
 * with no decimals `'1.5'` became `2`. A quote collects the reason as a
 * problem the screen can print beside the field; a verb that is already past
 * quoting throws.
 */
import { AmountPrecisionError, parseAmountStrict } from '@boltvault/core'
import { EngineError } from './errors'

function reason(err: unknown, text: string): string {
  if (err instanceof AmountPrecisionError) return err.message
  return `“${text.trim().slice(0, 32)}” is not a number.`
}

/** For quote paths: returns zero and records why, so every problem is shown at once. */
export function amountOrProblem(text: string, decimals: number, problems: string[]): bigint {
  try {
    return parseAmountStrict(text, decimals)
  } catch (err) {
    problems.push(reason(err, text))
    return 0n
  }
}

/** For verbs: an amount the token cannot hold is refused rather than rounded. */
export function amountOrThrow(text: string, decimals: number): bigint {
  try {
    return parseAmountStrict(text, decimals)
  } catch (err) {
    throw new EngineError('invalid_argument', reason(err, text))
  }
}
