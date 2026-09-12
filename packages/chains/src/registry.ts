/**
 * Chain registry — the 10 supported chains with RPC failover pairs.
 *
 * Every chain ships >=2 RPC URLs (primary + fallback). PublicNode keyless tier is
 * the fallback-of-record. All URLs verified 2026-09-04 (see the design spec
 * rev 7, C3).
 *
 * `rpcUrls` is a preference order, and it is measured rather than assumed —
 * `pnpm rpc:probe` drives every endpoint with the wallet's own request pattern
 * (a head poll at `pollMs`, a balance and a Multicall3 aggregate every 30 s,
 * all chains at once) and reports success rate, latency and refusals. Run
 * 2026-09-09, 150 s per endpoint: every URL below answered 100% with no 429 at
 * that rate, so the ordering is by "loosest limit first, then latency" — the
 * chain's own endpoint leads where it measured within about 1.5x of the
 * fastest, because an official endpoint is the one least likely to start
 * charging us. The exception is Electroneum, where the owner's call is Ankr
 * first (the two measured within 5 ms of each other over the run, and Ankr
 * answered a cold single call in 159 ms against 413 ms).
 *
 * Removed in the same pass: `cloudflare-eth.com`, which answered 4.2% of
 * requests — "Cannot fulfill request" and "Internal error" — and had been
 * sitting in Ethereum's list as a fallback that could not fall back.
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
  /**
   * Ordered by preference — first is tried first, and the rest are silent
   * failover. All verified to return the right chainId (`pnpm registry:verify`)
   * and measured under wallet load (`pnpm rpc:probe`).
   */
  readonly rpcUrls: readonly string[]
  readonly explorer?: {
    readonly name: string
    readonly url: string
  }
  /** ~ms between blocks. Drives the heartbeat's honesty *and* `pollMs`. */
  readonly blockTimeMs?: number
  /** The wrapped native token (WETH-style), for display prices by address; absent on chains we do not price. */
  readonly wrappedNative?: string
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
  rpcUrls: [
    'https://eth.drpc.org',
    'https://ethereum-rpc.publicnode.com',
    'https://eth-pokt.nodies.app',
  ],
  explorer: { name: 'Etherscan', url: 'https://etherscan.io' },
  blockTimeMs: 12_000,
  wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
}

const BSC: ChainDef = {
  chainId: 56,
  name: 'BNB Smart Chain',
  shortName: 'BSC',
  nativeCurrency: { name: 'BNB', symbol: 'BNB', decimals: 18 },
  rpcUrls: ['https://bsc-dataseed.binance.org', 'https://bsc-rpc.publicnode.com'],
  explorer: { name: 'BscScan', url: 'https://bscscan.com' },
  blockTimeMs: 3_000,
  wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c',
}

const OPTIMISM: ChainDef = {
  chainId: 10,
  name: 'Optimism',
  shortName: 'OP',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.optimism.io', 'https://optimism-rpc.publicnode.com'],
  explorer: { name: 'Optimism Explorer', url: 'https://optimism.io' },
  blockTimeMs: 2_000,
  wrappedNative: '0x4200000000000000000000000000000000000006',
}

const POLYGON: ChainDef = {
  chainId: 137,
  name: 'Polygon',
  shortName: 'POL',
  nativeCurrency: { name: 'Polygon', symbol: 'POL', decimals: 18 },
  rpcUrls: ['https://polygon.drpc.org', 'https://polygon-bor-rpc.publicnode.com'],
  explorer: { name: 'PolygonScan', url: 'https://polygonscan.com' },
  blockTimeMs: 2_000,
  wrappedNative: '0x0d500B1d8E8eF31E21C99d1Db9A6444d3ADf1270',
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
  wrappedNative: '0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7',
}

const ARBITRUM: ChainDef = {
  chainId: 42161,
  name: 'Arbitrum One',
  shortName: 'ARB',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum-one-rpc.publicnode.com'],
  explorer: { name: 'Arbiscan', url: 'https://arbiscan.io' },
  blockTimeMs: 250,
  wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1',
}

const BASE: ChainDef = {
  chainId: 8453,
  name: 'Base',
  shortName: 'BASE',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://base.drpc.org'],
  explorer: { name: 'BaseScan', url: 'https://basescan.org' },
  blockTimeMs: 2_000,
  wrappedNative: '0x4200000000000000000000000000000000000006',
}

const UNICHAIN: ChainDef = {
  chainId: 130,
  name: 'Unichain',
  shortName: 'UNI',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://mainnet.unichain.org', 'https://unichain-rpc.publicnode.com'],
  explorer: { name: 'Unichain Explorer', url: 'https://uniscan.xyz' },
  blockTimeMs: 1_000,
  wrappedNative: '0x4200000000000000000000000000000000000006',
}

const LINEA: ChainDef = {
  chainId: 59144,
  name: 'Linea',
  shortName: 'LINEA',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: ['https://rpc.linea.build', 'https://linea.drpc.org'],
  explorer: { name: 'Lineascan', url: 'https://lineascan.build' },
  blockTimeMs: 1_000,
  wrappedNative: '0xe5D7C2a44FfDDf6b295A15c148167daaAf5Cf34f',
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

export function chainIdToGraphQLChain(chainId: number): 'ELECTRONEUM' | 'ELECTRONEUM_TEST' {
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

/**
 * Whether a chain is the one being looked at, or one of the others in scope.
 *
 * "All chains" puts ten chains in scope, and they are not equally interesting:
 * one of them is on screen and the rest are contributing a number to a total.
 * Polling all ten as if each were the one in front of you is where a wallet's
 * request budget goes.
 */
export type PollMode = 'foreground' | 'background'

/**
 * Nothing is polled faster than the home chain produces blocks. Chains with
 * sub-second blocks (Arbitrum at 250 ms, Unichain and Linea at 1 s) have
 * nothing to tell a wallet at their own cadence — the balance did not change
 * four times a second — and asking at that rate is how a free endpoint starts
 * refusing.
 */
const FOREGROUND_FLOOR_MS = 5_000
/** A chain that is only feeding a total gets asked at a walking pace. */
const BACKGROUND_FLOOR_MS = 30_000

/**
 * How often to ask a chain for its head.
 *
 * The chain's own block time is the upper bound on what is worth knowing —
 * asking Ethereum every five seconds returns the same number twice out of
 * three times — and the floors above are the lower bound on what is worth
 * asking. Owner: "Many of those chains don't have 5 second blocks, so polling
 * as frequently as we do doesn't serve any purpose."
 */
export function pollMs(chainId: number, mode: PollMode = 'foreground'): number {
  const block = byId.get(chainId)?.blockTimeMs ?? 12_000
  return mode === 'background'
    ? Math.max(block * 4, BACKGROUND_FLOOR_MS)
    : Math.max(block, FOREGROUND_FLOOR_MS)
}
