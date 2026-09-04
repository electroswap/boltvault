/**
 * Chain registry — the 10 supported chains with RPC failover pairs.
 *
 * Every chain ships >=2 RPC URLs (primary + fallback). PublicNode keyless tier is
 * the fallback-of-record. All URLs verified 2026-09-04 (see the design spec
 * rev 7, C3).
 */

export interface NativeCurrency {
  name: string
  symbol: string
  decimals: number
}

export interface ChainDef {
  readonly chainId: number
  readonly name: string
  readonly shortName: string
  readonly nativeCurrency: NativeCurrency
  /** Ordered by preference. All verified to return the right chainId. */
  readonly rpcUrls: readonly string[]
  readonly explorer?: {
    readonly name: string
    readonly url: string
  }
  /** ~ms between blocks; used for heartbeat honesty, not for timing logic. */
  readonly blockTimeMs?: number
}

const ETN: ChainDef = {
  chainId: 52014,
  name: 'Electroneum',
  shortName: 'ETN',
  nativeCurrency: { name: 'Electroneum', symbol: 'ETN', decimals: 18 },
  rpcUrls: ['https://rpc.ankr.com/electroneum', 'https://rpc.electroneum.com'],
  explorer: { name: 'Electroneum Explorer', url: 'https://blockexplorer.electroneum.com' },
  blockTimeMs: 5_000,
}

const ETN_TESTNET: ChainDef = {
  chainId: 5201420,
  name: 'Electroneum Testnet',
  shortName: 'ETN Testnet',
  nativeCurrency: { name: 'Electroneum (Test)', symbol: 'ETN', decimals: 18 },
  rpcUrls: ['https://rpc.ankr.com/electroneum_testnet'],
  explorer: { name: 'Electroneum Explorer', url: 'https://blockexplorer.electroneum.com' },
  blockTimeMs: 5_000,
}

const ETHEREUM: ChainDef = {
  chainId: 1,
  name: 'Ethereum',
  shortName: 'ETH',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://cloudflare-eth.com', 'https://eth.drpc.org'],
  explorer: { name: 'Etherscan', url: 'https://etherscan.io' },
  blockTimeMs: 12_000,
}

const BSC: ChainDef = {
  chainId: 56,
  name: 'BNB Smart Chain',
  shortName: 'BSC',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
  explorer: { name: 'BscScan', url: 'https://bscscan.com' },
  blockTimeMs: 3_000,
}

const OPTIMISM: ChainDef = {
  chainId: 10,
  name: 'Optimism',
  shortName: 'OP',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
  explorer: { name: 'Optimism Explorer', url: 'https://optimism.io' },
  blockTimeMs: 2_000,
}

const POLYGON: ChainDef = {
  chainId: 137,
  name: 'Polygon',
  shortName: 'POL',
  nativeCurrency: { name: 'Polygon', symbol: 'POL', decimals: 18 },
  rpcUrls: ['https://polygon.drpc.org', 'https://polygon-bor-rpc.publicnode.com'],
  explorer: { name: 'PolygonScan', url: 'https://polygonscan.com' },
  blockTimeMs: 2_000,
}

const AVALANCHE: ChainDef = {
  chainId: 43114,
  name: 'Avalanche C-Chain',
  shortName: 'AVAX',
  nativeCurrency: { name: 'Avalanche', symbol: 'AVAX', decimals: 18 },
  rpcUrls: [
    'https://api.avax.network/ext/bc/C/rpc',
    'https://avalanche-c-chain-rpc.publicnode.com',
  ],
  explorer: { name: 'SnowTrace', url: 'https://snowtrace.io' },
  blockTimeMs: 2_000,
}

const ARBITRUM: ChainDef = {
  chainId: 42161,
  name: 'Arbitrum One',
  shortName: 'ARB',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
  explorer: { name: 'Arbiscan', url: 'https://arbiscan.io' },
  blockTimeMs: 250,
}

const BASE: ChainDef = {
  chainId: 8453,
  name: 'Base',
  shortName: 'BASE',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com'],
  explorer: { name: 'BaseScan', url: 'https://basescan.org' },
  blockTimeMs: 2_000,
}

const UNICHAIN: ChainDef = {
  chainId: 130,
  name: 'Unichain',
  shortName: 'UNI',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.unichain.org', 'https://unichain-rpc.publicnode.com'],
  explorer: { name: 'Unichain Explorer', url: 'https://uniscan.xyz' },
  blockTimeMs: 1_000,
}

const LINEA: ChainDef = {
  chainId: 59144,
  name: 'Linea',
  shortName: 'LINEA',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.linea.build', 'https://linea.drpc.org'],
  explorer: { name: 'Lineascan', url: 'https://lineascan.build' },
  blockTimeMs: 1_000,
}

export const ELECTRONEUM_MAINNET_CHAIN_ID = 52014
export const ELECTRONEUM_TESTNET_CHAIN_ID = 5201420

/** The 10 supported chains (ETN + 9 EVM). Home chain first. */
export const CHAINS: readonly ChainDef[] = [
  ETN,
  ETHEREUM,
  BSC,
  BASE,
  OPTIMISM,
  ARBITRUM,
  POLYGON,
  AVALANCHE,
  UNICHAIN,
  LINEA,
]

/** All chains including testnet (for dev profiles). */
export const ALL_CHAINS: readonly ChainDef[] = [ETN_TESTNET, ...CHAINS]

const byId = new Map<number, ChainDef>([...CHAINS, ETN_TESTNET].map((c) => [c.chainId, c]))

export function getChain(chainId: number): ChainDef | undefined {
  return byId.get(chainId)
}

export function requireChain(chainId: number): ChainDef {
  const c = byId.get(chainId)
  if (!c) throw new Error(`Unknown chain id ${chainId}`)
  return c
}

export function isElectroneumChainId(chainId: number): boolean {
  return chainId === ELECTRONEUM_MAINNET_CHAIN_ID || chainId === ELECTRONEUM_TESTNET_CHAIN_ID
}

/**
 * Type guard + assert that a chainId is Electroneum (52014) or Electroneum testnet
 * (5201420). Use before any GraphQL/`@boltvault/electroswap` call — the indexer
 * `Chain` enum stays { ELECTRONEUM, ELECTRONEUM_TEST }.
 */
export function assertElectroneum(chainId: number): asserts chainId is 52014 | 5201420 {
  if (!isElectroneumChainId(chainId)) {
    throw new Error(`assertElectroneum: ${chainId} is not an Electroneum chain`)
  }
}

export function chainIdToGraphQLChain(
  chainId: number,
): 'ELECTRONEUM' | 'ELECTRONEUM_TEST' {
  assertElectroneum(chainId)
  return chainId === ELECTRONEUM_TESTNET_CHAIN_ID ? 'ELECTRONEUM_TEST' : 'ELECTRONEUM'
}

/** GraphQL expects the sentinel string 'NATIVE' for ETN (not an address). */
export const NATIVE_GRAPHQL_TOKEN_ADDRESS = 'NATIVE' as const

/**
 * Default portfolio chains: ETN + the 9 other EVMs. (Testnet excluded by default;
 * dev profiles add it.)
 */
export const DEFAULT_PORTFOLIO_CHAIN_IDS: readonly number[] = CHAINS.map((c) => c.chainId)

/** The home chain. Default for new dApp connections and the hero total. */
export const HOME_CHAIN = ETN

export const HOME_CHAIN_ID = ETN.chainId
