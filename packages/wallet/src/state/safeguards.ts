/**
 * What the signing sheet must do, given the rule codes it is handed (master
 * plan §3.4 point 6, §3.6).
 *
 * These two safeguards were named in Settings › Spending and performed by
 * nothing. The first-time-recipient rule arrived at `info` severity, which maps
 * to a zero delay and is filtered out of the sheet with the rest of the `info`
 * rules, so there was neither a pause nor a visible warning; the large-send
 * rule arrived at `warn`, which is a 1.5-second button delay and no
 * re-authentication of any kind.
 *
 * So the decision is taken from the rule CODE, never from its severity: a
 * severity is a presentation hint and it has already been wrong once, whereas a
 * code is a statement about the transaction. If severities are re-tuned the
 * sheet keeps doing the right thing; if the codes change, these constants are
 * the one place to follow them.
 *
 * Pure, and outside the screen, so it can be tested without a renderer.
 */

/** §3.6: a recipient this account has never sent to gets ten seconds. */
export const COOLING_MS = 10_000

export const FIRST_TIME_RECIPIENT = 'RECIPIENT_FIRST_TIME'
export const LARGE_SEND = 'LARGE_SEND'

/** The verb waits, and the whole address is shown while it does. */
export function needsCooling(codes: readonly string[]): boolean {
  return codes.includes(FIRST_TIME_RECIPIENT)
}

/** The verb waits on one of this vault's own unlock factors answering again. */
export function needsStepUp(codes: readonly string[]): boolean {
  return codes.includes(LARGE_SEND)
}

const ERC20_TRANSFER = '0xa9059cbb'
const ERC20_TRANSFER_FROM = '0x23b872dd'

/**
 * Who actually receives.
 *
 * A plain send's recipient is `tx.to`. An ERC-20 `transfer`'s recipient is the
 * first argument, and `tx.to` is the token contract — which is exactly the
 * distinction a poisoned address relies on being blurred, so the cooling plate
 * shows the argument and never the contract. Anything else returns `to`: a
 * call this decoder cannot read is a call whose destination is the only
 * honest answer.
 */
export function recipientOf(tx: { readonly to: string | null; readonly data: string }): string | null {
  const data = tx.data
  if (data.length <= 2) return tx.to
  const selector = data.slice(0, 10).toLowerCase()
  if (selector === ERC20_TRANSFER && data.length >= 74) return `0x${data.slice(34, 74)}`
  if (selector === ERC20_TRANSFER_FROM && data.length >= 138) return `0x${data.slice(98, 138)}`
  return tx.to
}
