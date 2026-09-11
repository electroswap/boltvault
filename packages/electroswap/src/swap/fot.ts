/**
 * Fee-on-transfer detection (master plan §8.6): the same detector the
 * interface uses. A tax on either side is folded into slippage; when the
 * probe reverts or the split cannot meet `minOut`, the wallet disables the
 * swap with honest copy rather than guessing.
 */
import type { Hex } from 'viem'
import { FOT_DETECTOR_ABI } from './abis'
import type { ReadCall, Reader } from './quote'

export interface TokenTax {
  readonly buyFeeBps: number
  readonly sellFeeBps: number
}

/**
 * "There is no detector on this chain" and "the detector did not answer" are
 * different facts, and both used to come back as `null`.
 *
 * `'unavailable'` is not evidence of a tax, and must not stop a swap: the
 * detector reverts `PairLookupFailed` for any token with no V2 pair against
 * the base, which is an ordinary thing for a token to be. It is a reason to
 * say the tax is unknown, not a reason to refuse.
 *
 * They mean opposite things. The first says the wallet was never going to
 * know; the second says it asked about this particular token and could not
 * find out — which, for a token whose whole trick is charging on transfer, is
 * exactly when it matters. Folding them together meant every failure read as
 * "no tax": a reverting probe, a malformed answer, a rate-limited node.
 */
export type TaxProbe = TokenTax | 'unavailable' | null

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
export async function detectTax(detector: Hex | null, token: Hex, baseToken: Hex, read: Reader, amountToBorrow = 1000n): Promise<TaxProbe> {
  if (!detector) return null
  const call: ReadCall = { address: detector, abi: FOT_DETECTOR_ABI, functionName: 'validate', args: [token, baseToken, amountToBorrow] }
  const [r] = await read([call]).catch(() => [undefined])
  if (!r?.ok || !r.value || typeof r.value !== 'object') return 'unavailable'
  const v = r.value as { buyFeeBps: bigint; sellFeeBps: bigint }
  if (typeof v.buyFeeBps !== 'bigint' || typeof v.sellFeeBps !== 'bigint') return 'unavailable'
  return { buyFeeBps: Number(v.buyFeeBps), sellFeeBps: Number(v.sellFeeBps) }
}

/** A probe that produced an actual measurement, or null. */
export function taxOf(probe: TaxProbe): TokenTax | null {
  return probe === 'unavailable' ? null : probe
}

/** Slippage the user must accept to cover the taxes on this pair, in bips. */
export function taxSlippageBips(taxIn: TaxProbe, taxOut: TaxProbe): number {
  return (taxOf(taxIn)?.sellFeeBps ?? 0) + (taxOf(taxOut)?.buyFeeBps ?? 0)
}
