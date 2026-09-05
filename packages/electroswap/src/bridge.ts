/**
 * Hyperlane warp routes (master plan §2.7 S6, §8.7): a pinned snapshot of
 * the registry (hyperlane-xyz/hyperlane-registry, fetched 2026-09-05) for
 * the corridors that exist today — USDC ↔ Ethereum / Base / Avalanche and
 * USDT ↔ Ethereum — every entry keyed by (chainId, address) because the
 * Avalanche collateral router shares the Electroneum synthetic's address.
 * On Electroneum the token is the router (`EvmHypSynthetic`); on the other
 * side a collateral router wraps the canonical token and needs an
 * `approve(router)`. Verification is by standard (§2.7 S6) and runs at boot.
 */
import { encodeFunctionData, keccak256, pad, parseAbi, toHex, type Hex } from 'viem'

export const TOKEN_ROUTER_ABI = parseAbi([
  'function transferRemote(uint32 _destination, bytes32 _recipient, uint256 _amountOrId) payable returns (bytes32 messageId)',
  'function quoteGasPayment(uint32 _destinationDomain) view returns (uint256)',
  'function domains() view returns (uint32[])',
  'function routers(uint32 _domain) view returns (bytes32)',
  'function mailbox() view returns (address)',
  'function wrappedToken() view returns (address)',
  'function balanceOf(address account) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function decimals() view returns (uint8)',
])

/** Mailbox events the status watcher reads (`DispatchId(bytes32)` on the origin, `ProcessId(bytes32)` on the destination). */
export const DISPATCH_ID_TOPIC = keccak256(toHex('DispatchId(bytes32)'))
export const PROCESS_ID_TOPIC = keccak256(toHex('ProcessId(bytes32)'))

export interface HyperlaneChain {
  readonly chainId: number
  readonly domain: number
  readonly name: string
  readonly mailbox: Hex
  readonly interchainGasPaymaster: Hex
}

/** chains/<name>/addresses.yaml + metadata.yaml in the registry. */
export const HYPERLANE_CHAINS: readonly HyperlaneChain[] = [
  { chainId: 52014, domain: 52014, name: 'electroneum', mailbox: '0x3a464f746D23Ab22155710f44dB16dcA53e0775E', interchainGasPaymaster: '0x1A41a365A693b6A7aED1a46316097d290f569F22' },
  { chainId: 1, domain: 1, name: 'ethereum', mailbox: '0xc005dc82818d67AF737725bD4bf75435d065D239', interchainGasPaymaster: '0x9e6B1022bE9BBF5aFd152483DAD9b88911bC8611' },
  { chainId: 8453, domain: 8453, name: 'base', mailbox: '0xeA87ae93Fa0019a82A727bfd3eBd1cFCa8f64f1D', interchainGasPaymaster: '0xc3F23848Ed2e04C0c6d41bd7804fa8f89F940B94' },
  { chainId: 43114, domain: 43114, name: 'avalanche', mailbox: '0xFf06aFcaABaDDd1fb08371f9ccA15D73D51FeBD6', interchainGasPaymaster: '0x95519ba800BBd0d34eeAE026fEc620AD978176C0' },
]

export type WarpStandard = 'synthetic' | 'collateral'

/** One side of a warp route: the router on a chain, and the token a user holds there. */
export interface WarpEndpoint {
  readonly chainId: number
  readonly router: Hex
  /** What the user holds and bridges: the synthetic itself, or the canonical collateral token. */
  readonly token: Hex
  readonly standard: WarpStandard
  readonly symbol: 'USDC' | 'USDT'
  readonly decimals: number
}

export interface WarpRoute {
  readonly symbol: 'USDC' | 'USDT'
  readonly endpoints: readonly WarpEndpoint[]
}

/** deployments/warp_routes/{USDC,USDT}/electroneum-config.yaml. */
export const WARP_ROUTES: readonly WarpRoute[] = [
  {
    symbol: 'USDC',
    endpoints: [
      { chainId: 52014, router: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', token: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', standard: 'synthetic', symbol: 'USDC', decimals: 6 },
      { chainId: 1, router: '0xFC2944e9F1d57Ce82aeD05922887DD660404e50B', token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', standard: 'collateral', symbol: 'USDC', decimals: 6 },
      { chainId: 8453, router: '0xaaDF9558Cf103d394B22b18Ffbaa0D1c0778Ccfa', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', standard: 'collateral', symbol: 'USDC', decimals: 6 },
      { chainId: 43114, router: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', token: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E', standard: 'collateral', symbol: 'USDC', decimals: 6 },
    ],
  },
  {
    symbol: 'USDT',
    endpoints: [
      { chainId: 52014, router: '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7', token: '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7', standard: 'synthetic', symbol: 'USDT', decimals: 6 },
      { chainId: 1, router: '0x97B80b1d89d10E5d2c9396B0ea0BA2dAf917Dc96', token: '0xdAC17F958D2ee523a2206206994597C13D831ec7', standard: 'collateral', symbol: 'USDT', decimals: 6 },
    ],
  },
]

export interface Corridor {
  readonly symbol: 'USDC' | 'USDT'
  readonly origin: WarpEndpoint
  readonly destination: WarpEndpoint
}

export function hyperlaneChain(chainId: number): HyperlaneChain | null {
  return HYPERLANE_CHAINS.find((c) => c.chainId === chainId) ?? null
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

const HOME = 52014

/**
 * Every corridor from a chain (and, when given, from one token on it):
 * Electroneum ↔ each counterpart, both directions. The routers also enroll
 * each other across the other chains, but the wallet is Electroneum-first
 * and only offers legs that touch it (§8.7).
 */
export function corridorsFrom(chainId: number, token?: string): Corridor[] {
  const out: Corridor[] = []
  for (const route of WARP_ROUTES) {
    for (const origin of route.endpoints) {
      if (origin.chainId !== chainId) continue
      if (token && !same(origin.token, token)) continue
      for (const destination of route.endpoints) {
        if (destination.chainId === chainId) continue
        if (origin.chainId !== HOME && destination.chainId !== HOME) continue
        out.push({ symbol: route.symbol, origin, destination })
      }
    }
  }
  return out
}

export function corridor(fromChainId: number, toChainId: number, token: string): Corridor | null {
  return corridorsFrom(fromChainId, token).find((c) => c.destination.chainId === toChainId) ?? null
}

/** The warp endpoint a token address is, on its chain; null for a plain token. */
export function warpEndpoint(chainId: number, token: string): WarpEndpoint | null {
  for (const route of WARP_ROUTES) for (const e of route.endpoints) if (e.chainId === chainId && same(e.token, token)) return e
  return null
}

/** Compatibility with the dossier's warp tag: destinations for a token on a chain. */
export function warpAsset(chainId: number, token: string): { symbol: 'USDC' | 'USDT'; destinations: number[] } | null {
  const e = warpEndpoint(chainId, token)
  if (!e) return null
  return { symbol: e.symbol, destinations: corridorsFrom(chainId, token).map((c) => c.destination.chainId) }
}

/** Hyperlane addresses recipients as left-padded bytes32. */
export function recipientBytes32(address: Hex): Hex {
  return pad(address, { size: 32 })
}

export function encodeTransferRemote(destinationDomain: number, recipient: Hex, amount: bigint): Hex {
  return encodeFunctionData({ abi: TOKEN_ROUTER_ABI, functionName: 'transferRemote', args: [destinationDomain, recipientBytes32(recipient), amount] })
}

export function encodeApproveRouter(router: Hex, amount: bigint): Hex {
  return encodeFunctionData({ abi: TOKEN_ROUTER_ABI, functionName: 'approve', args: [router, amount] })
}

/** The message id from an origin receipt: the mailbox's `DispatchId(bytes32 indexed messageId)` log. */
export function dispatchIdFrom(logs: ReadonlyArray<{ address: string; topics: readonly string[] }>, mailbox: Hex): Hex | null {
  for (const log of logs) {
    if (!same(log.address, mailbox)) continue
    if ((log.topics[0] ?? '').toLowerCase() !== DISPATCH_ID_TOPIC.toLowerCase()) continue
    const id = log.topics[1]
    if (id && /^0x[0-9a-fA-F]{64}$/.test(id)) return id as Hex
  }
  return null
}

/** Rough delivery expectation per corridor for the ETA copy (relayer + destination finality). */
export function etaMinutes(fromChainId: number, toChainId: number): number {
  const slow = fromChainId === 1 || toChainId === 1
  return slow ? 20 : 5
}

/**
 * The reads that prove an endpoint is what the snapshot says (§2.7 S6): a
 * synthetic must report the pinned mailbox and enroll the counterpart's
 * domain; a collateral router must wrap the canonical token and enroll the
 * counterpart too. `results` are the answers to `verificationCalls`, in order.
 */
export function verificationCalls(c: Corridor): Array<{ address: Hex; abi: typeof TOKEN_ROUTER_ABI; functionName: 'mailbox' | 'domains' | 'wrappedToken'; args: readonly [] }> {
  const calls: Array<{ address: Hex; abi: typeof TOKEN_ROUTER_ABI; functionName: 'mailbox' | 'domains' | 'wrappedToken'; args: readonly [] }> = [
    { address: c.origin.router, abi: TOKEN_ROUTER_ABI, functionName: 'mailbox', args: [] },
    { address: c.origin.router, abi: TOKEN_ROUTER_ABI, functionName: 'domains', args: [] },
  ]
  if (c.origin.standard === 'collateral') calls.push({ address: c.origin.router, abi: TOKEN_ROUTER_ABI, functionName: 'wrappedToken', args: [] })
  return calls
}

export function verifyCorridor(c: Corridor, results: ReadonlyArray<{ ok: boolean; value?: unknown }>): { ok: boolean; reason: string | null } {
  const chain = hyperlaneChain(c.origin.chainId)
  if (!chain) return { ok: false, reason: 'origin chain not in the Hyperlane snapshot' }
  const [mailbox, domains, wrapped] = results
  if (!mailbox?.ok || typeof mailbox.value !== 'string' || !same(mailbox.value, chain.mailbox)) return { ok: false, reason: 'router mailbox mismatch' }
  const dest = hyperlaneChain(c.destination.chainId)
  if (!dest) return { ok: false, reason: 'destination chain not in the Hyperlane snapshot' }
  if (!domains?.ok || !Array.isArray(domains.value) || !(domains.value as readonly number[]).some((d) => Number(d) === dest.domain)) return { ok: false, reason: 'destination domain not enrolled' }
  if (c.origin.standard === 'collateral' && (!wrapped?.ok || typeof wrapped.value !== 'string' || !same(wrapped.value, c.origin.token))) return { ok: false, reason: 'collateral router wraps a different token' }
  return { ok: true, reason: null }
}
