/**
 * Capability matrix (T7.3) — what each chain supports, and whether a feature
 * comes from the ETN ElectroSwap GraphQL/indexer or the generic viem+multicall
 * path. This drives the UI (e.g. "history on Base is bounded-getLogs, not the
 * indexer") and keeps the design rule "do not extend the indexer to other
 * chains" testable.
 *
 *   - ETN (52014/5201420): full — GraphQL portfolio/history/token-info/NFT/farm.
 *   - other 9 chains: multicall balances/allowances/simulate/send/revoke;
 *     history via bounded getLogs; ENS only on Ethereum; market-data enrichment
 *     via GeckoTerminal (display-only).
 */

import { isElectroneumChainId, ELECTRONEUM_MAINNET_CHAIN_ID } from '@boltvault/chains'
import { ENS_CHAIN_ID } from './ens'

export type HistorySource = 'graphql' | 'bounded-getlogs'
export type EnrichSource = 'electroswap' | 'geckoterminal' | 'none'

export interface ChainCapabilities {
  readonly chainId: number
  readonly isElectroneum: boolean
  readonly history: HistorySource
  readonly portfolioSource: 'electroswap-graphql' | 'multicall'
  readonly ens: boolean
  readonly marketData: EnrichSource
  readonly approvalsScan: boolean
  readonly swap: boolean
  /** Other chains never get the indexer (design "must not"). */
  readonly usesIndexer: boolean
}

export function capabilities(chainId: number): ChainCapabilities {
  const etn = isElectroneumChainId(chainId)
  return {
    chainId,
    isElectroneum: etn,
    history: etn ? 'graphql' : 'bounded-getlogs',
    portfolioSource: etn ? 'electroswap-graphql' : 'multicall',
    ens: chainId === ENS_CHAIN_ID,
    marketData: etn ? 'electroswap' : 'geckoterminal',
    // approvals + swap are on-chain (multicall/UR) on all EVM chains we ship.
    approvalsScan: true,
    swap: true,
    usesIndexer: etn,
  }
}

/** The 10 supported chains' capabilities (for the settings/portfolio UI). */
export function allCapabilities(chainIds: readonly number[]): ChainCapabilities[] {
  return chainIds.map(capabilities)
}

/** The ETN mainnet chainId, re-exported for convenience. */
export const ETN_MAINNET_CHAIN_ID = ELECTRONEUM_MAINNET_CHAIN_ID
