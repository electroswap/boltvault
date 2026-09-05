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

/** Probe one token against the wrapped native; null when the detector is absent or the probe failed. */
export async function detectTax(detector: Hex | null, token: Hex, baseToken: Hex, read: Reader, amountToBorrow = 1000n): Promise<TokenTax | null> {
  if (!detector) return null
  const call: ReadCall = { address: detector, abi: FOT_DETECTOR_ABI, functionName: 'validate', args: [token, baseToken, amountToBorrow] }
  const [r] = await read([call])
  if (!r?.ok || !r.value || typeof r.value !== 'object') return null
  const v = r.value as { buyFeeBps: bigint; sellFeeBps: bigint; feeTakenOnTransfer: boolean; sellReverted: boolean }
  return { buyFeeBps: Number(v.buyFeeBps), sellFeeBps: Number(v.sellFeeBps), feeTakenOnTransfer: v.feeTakenOnTransfer, sellReverted: v.sellReverted }
}

/** Slippage the user must accept to cover the taxes on this pair, in bips. */
export function taxSlippageBips(taxIn: TokenTax | null, taxOut: TokenTax | null): number {
  return (taxIn?.sellFeeBps ?? 0) + (taxOut?.buyFeeBps ?? 0)
}
