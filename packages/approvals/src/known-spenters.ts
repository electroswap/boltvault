/**
 * Known spenders (T6.2, design "Approvals").
 *
 * The set of contract addresses BoltVault treats as "expected" spenders when
 * scanning the wallet's token allowances. Everything else is an unknown
 * spender and gets surfaced for manual review.
 */
import { ELECTRONEUM_ADDRESSES, isElectroneumChainId } from '@boltvault/chains'

export type SpenderKind =
  | 'permit2'
  | 'universal-router'
  | 'swap-router02'
  | 'v2-router'
  | 'seaport'
  | 'farm'

export interface KnownSpender {
  readonly kind: SpenderKind
  readonly address: string
  readonly label: string
}

/**
 * The known-spender set for a chain, built from the registry.
 * Throws when the chain is not Electroneum (the registry only covers ETN).
 */
export function knownSpenters(chainId: number): KnownSpender[] {
  if (!isElectroneumChainId(chainId)) {
    throw new Error(`not ETN: ${chainId}`)
  }
  const a = ELECTRONEUM_ADDRESSES[chainId as 52014 | 5201420]
  return [
    { kind: 'permit2', address: a.permit2, label: 'Permit2' },
    { kind: 'universal-router', address: a.universalRouter, label: 'Universal Router' },
    { kind: 'swap-router02', address: a.swapRouter02, label: 'SwapRouter02' },
    { kind: 'v2-router', address: a.v2Router02, label: 'V2 Router' },
    { kind: 'seaport', address: a.seaport15, label: 'Seaport' },
    { kind: 'farm', address: a.yieldFarm, label: 'Yield Farm' },
  ]
}
