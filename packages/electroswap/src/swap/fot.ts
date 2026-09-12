/**
 * Fee-on-transfer detection (master plan §8.6): the same detector the
 * interface uses. A tax on either side is priced into the quote, and a token
 * the wallet cannot get a user back out of is refused rather than sold to them.
 */
import type { Hex } from 'viem'
import { FOT_DETECTOR_ABI } from './abis'
import type { ReadCall, Reader } from './quote'

export interface TokenTax {
  readonly buyFeeBps: number
  readonly sellFeeBps: number
  /**
   * The token refused to be sold back at all.
   *
   * Not a large fee — a token nobody can get out of. The detector this replaced
   * caught the failing sell and reported `sellFeeBps = buyFeeBps`, so a
   * honeypot came back looking like an ordinary 3% token and every client
   * priced it as tradeable.
   */
  readonly sellReverted: boolean
  /** A transfer to an ordinary address was refused, though trading against the pair was not. */
  readonly externalTransferFailed: boolean
  /** The fee applies to a plain transfer, not only to trading against the pair. */
  readonly feeTakenOnTransfer: boolean
}

/**
 * "There is no detector on this chain" and "the detector did not answer" are
 * different facts, and both used to come back as `null`.
 *
 * They mean opposite things. The first says the wallet was never going to
 * know; the second says it asked about this particular token and could not
 * find out — which, for a token whose whole trick is charging on transfer, is
 * exactly when it matters. Folding them together meant every failure read as
 * "no tax": a reverting probe, a malformed answer, a rate-limited node.
 */
export type TaxProbe = TokenTax | TaxUnknown | null

/**
 * The probe did not produce a measurement, and why.
 *
 * The reason used to be thrown away — every failure collapsed to one value — and
 * that turned out to matter the moment a failure report tried to say what had
 * happened. `no-pair` is the ordinary case, because the detector reverts
 * `PairLookupFailed` for any token with no V2 pair against the base, and a token
 * not having one is an unremarkable thing. `probe-reverted` is the interesting
 * one: the pair exists, the loan went out, and the token fought it. Reporting
 * the first as the second sends somebody looking for a defect that is not there.
 */
export interface TaxUnknown {
  readonly unavailable: true
  readonly reason: 'no-pair' | 'pair-too-thin' | 'probe-reverted' | 'not-answered'
}

const unknown = (reason: TaxUnknown['reason']): TaxUnknown => ({ unavailable: true, reason })

/** `ProbeStatus` from the detector: 0 measured, 1 no pair, 2 pair too thin, 3 the probe itself reverted. */
const STATUS: Readonly<Record<number, TaxUnknown['reason']>> = {
  1: 'no-pair',
  2: 'pair-too-thin',
  3: 'probe-reverted',
}
const MEASURED = 0

/*
  Probe one token against the wrapped native.

  `amountToBorrow` is an amount of `token` — the detector flash-borrows it from
  the token/base pair and measures what arrives. It is deliberately a small
  fixed number and not a fraction of the trade: the detector reports a *ratio*
  in basis points, so a small borrow measures a percentage fee exactly as well
  as a large one, while a large one is simply more likely to exceed the pair's
  reserves and revert. Sizing it from the trade also got the asset wrong — the
  input amount is denominated in the token being sold, not the one being
  probed.
*/
export async function detectTax(
  detector: Hex | null,
  token: Hex,
  baseToken: Hex,
  read: Reader,
  amountToBorrow = 1000n,
): Promise<TaxProbe> {
  if (!detector) return null
  const call: ReadCall = {
    address: detector,
    abi: FOT_DETECTOR_ABI,
    functionName: 'inspect',
    args: [token, baseToken, amountToBorrow],
  }
  const [r] = await read([call]).catch(() => [undefined])
  // The call itself did not come back: an RPC failure, not a statement about the token.
  if (!r?.ok || !r.value || typeof r.value !== 'object') return unknown('not-answered')
  const v = r.value as {
    status: number
    buyFeeBps: bigint
    sellFeeBps: bigint
    sellReverted: boolean
    externalTransferFailed: boolean
    feeTakenOnTransfer: boolean
  }
  if (typeof v.buyFeeBps !== 'bigint' || typeof v.sellFeeBps !== 'bigint')
    return unknown('not-answered')
  /*
    A status the wallet did not ask for is not a measurement.

    The detector answers `NoPair`, `PairTooThin` and `ProbeReverted` as ordinary
    return values rather than reverts, so the call succeeds and the fees come
    back as zero. Reading those zeros would be the one mistake this whole type
    exists to prevent: a token nobody could measure, reported as a token with no
    fee.
  */
  if (Number(v.status) !== MEASURED) return unknown(STATUS[Number(v.status)] ?? 'probe-reverted')
  return {
    buyFeeBps: Number(v.buyFeeBps),
    sellFeeBps: Number(v.sellFeeBps),
    sellReverted: v.sellReverted === true,
    externalTransferFailed: v.externalTransferFailed === true,
    feeTakenOnTransfer: v.feeTakenOnTransfer === true,
  }
}

/** The probe was asked and could not say. Distinct from there being no detector at all. */
export function isTaxUnknown(probe: TaxProbe): probe is TaxUnknown {
  return probe !== null && 'unavailable' in probe
}

/** A probe that produced an actual measurement, or null. */
export function taxOf(probe: TaxProbe): TokenTax | null {
  return probe === null || isTaxUnknown(probe) ? null : probe
}

/** The token could be bought and then not sold. Measured, not guessed. */
export function sellsAreRefused(probe: TaxProbe): boolean {
  return taxOf(probe)?.sellReverted === true
}

/**
 * Handing this token through the router's custody is not safe.
 *
 * `PAY_PORTION` and `SWEEP` need the router to hold the output, which puts one
 * more transfer between the pool and the user — and it happens *after*
 * `Payments.sweep` has compared its minimum against the router's own balance,
 * so nothing on chain covers it.
 *
 * Deliberately any measured fee, not only `feeTakenOnTransfer`. The flag is
 * measured by moving an eighth of a probe of a thousand wei to a fresh address
 * and looking for a shortfall, and a small percentage of a very small number
 * truncates to nothing — so `false` means "no shortfall was visible at that
 * size", which is weaker than "this token does not charge". PDY is the case
 * that settles it: it reports `feeTakenOnTransfer: false` and
 * `externalTransferFailed: true`, because the transfer did not survive to be
 * measured at all. A token that refuses an ordinary address outright breaks the
 * custody path just as thoroughly as one that taxes it, and keying on the fee
 * itself catches both without relying on a flag measured in wei.
 *
 * The cost of being wrong in this direction is that the wallet takes its fee
 * from the input token for a swap that would have been fine either way. The
 * cost of being wrong in the other direction is a user who receives less than
 * the minimum they were shown, or a transaction that reverts after three
 * signatures.
 */
export function custodyIsUnsafe(probe: TaxProbe): boolean {
  const tax = taxOf(probe)
  if (tax === null) return false
  return (
    tax.buyFeeBps > 0 || tax.sellFeeBps > 0 || tax.externalTransferFailed || tax.feeTakenOnTransfer
  )
}

/** Slippage the user must accept to cover the taxes on this pair, in bips. */
export function taxSlippageBips(taxIn: TaxProbe, taxOut: TaxProbe): number {
  return (taxOf(taxIn)?.sellFeeBps ?? 0) + (taxOf(taxOut)?.buyFeeBps ?? 0)
}
