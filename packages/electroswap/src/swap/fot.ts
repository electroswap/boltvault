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
  readonly feeTakenOnTransfer: boolean
  readonly sellReverted: boolean
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
export type TaxProbe = TokenTax | 'unavailable' | null

/** Probe one token against the wrapped native. */
export async function detectTax(detector: Hex | null, token: Hex, baseToken: Hex, read: Reader, amountToBorrow = 1000n): Promise<TaxProbe> {
  if (!detector) return null
  const call: ReadCall = { address: detector, abi: FOT_DETECTOR_ABI, functionName: 'validate', args: [token, baseToken, amountToBorrow] }
  const [r] = await read([call]).catch(() => [undefined])
  if (!r?.ok || !r.value || typeof r.value !== 'object') return 'unavailable'
  const v = r.value as { buyFeeBps: bigint; sellFeeBps: bigint; feeTakenOnTransfer: boolean; sellReverted: boolean }
  return { buyFeeBps: Number(v.buyFeeBps), sellFeeBps: Number(v.sellFeeBps), feeTakenOnTransfer: v.feeTakenOnTransfer, sellReverted: v.sellReverted }
}

/** A probe that produced an actual measurement, or null. */
export function taxOf(probe: TaxProbe): TokenTax | null {
  return probe === 'unavailable' ? null : probe
}

/** Slippage the user must accept to cover the taxes on this pair, in bips. */
export function taxSlippageBips(taxIn: TaxProbe, taxOut: TaxProbe): number {
  return (taxOf(taxIn)?.sellFeeBps ?? 0) + (taxOf(taxOut)?.buyFeeBps ?? 0)
}
