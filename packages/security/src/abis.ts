/**
 * The decoder's ABI registry (master plan §3.4 step 1).
 *
 * Every ABI here that can come from a deployed contract's artifact does: the
 * artifacts are synced from the ElectroSwap workspace by `pnpm abi:sync`, hashed
 * into `packages/electroswap/abis/manifest.json`, and generated into
 * `src/generated/abis.ts` with the hash beside each one. A hand-written
 * signature is a guess about somebody else's bytecode, and the guess is wrong
 * often enough to matter: `FOT_DETECTOR_ABI` declared five return fields
 * against a detector that returns two, so the fee-on-transfer probe failed on
 * every token for its entire lifetime while the correct artifact sat unread in
 * the tree. The three fragments still written by hand below are written by hand
 * because no artifact for them exists anywhere in the workspace, and each says
 * so where it stands.
 *
 * The selector index at the bottom is what the decoder actually reads. Trying
 * thirteen ABIs in order both cost thirteen decode attempts per call and made
 * "which ABI claimed this selector" unanswerable — and the answer matters,
 * because `approve(address,uint256)` and `transferFrom(address,address,uint256)`
 * are claimed by more than one standard and mean different things in each.
 */
import {
  parseAbi,
  parseAbiItem,
  toFunctionSelector,
  toFunctionSignature,
  type Abi,
  type AbiFunction,
  type Hex,
} from 'viem'
import FOUR_BYTE from '../data/four-byte.json'
import { ARTIFACT_ABIS, artifactAbi } from './generated/abis'
import type { ContractRole } from './registry'

// ---- hand-written fragments -------------------------------------------------------

/*
  ERC-20 extensions that `apps/interface/src/abis/erc20.json` does not declare,
  because they are not in the ERC-20 standard: `increaseAllowance` /
  `decreaseAllowance` are an OpenZeppelin addition, and `permit` is ERC-2612,
  whose own artifact (`eip_2612.json`) declares only `DOMAIN_SEPARATOR` and
  `nonces`. They are on a large share of deployed tokens and the firewall has to
  read them — `increaseAllowance` raises an allowance exactly as `approve` does
  — so they are kept as their own registry entry rather than being folded into
  the ERC-20 artifact, which would make that artifact's hash a lie.
*/
const ERC20_EXTENSIONS_ABI = parseAbi([
  'function increaseAllowance(address spender, uint256 added) returns (bool)',
  'function decreaseAllowance(address spender, uint256 subtracted) returns (bool)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
])

/*
  Hyperlane's `TokenRouter`. No Hyperlane contracts are vendored in the
  ElectroSwap workspace — §2.7 S6 pins a snapshot of the Hyperlane *registry*
  (addresses and domains), not the Solidity — so there is no artifact to sync.
  This single function is the whole of what the wallet sends to a warp route,
  and §2.7 S6 pins its shape: `transferRemote(uint32 destination, bytes32
  recipient, uint256 amountOrId)` paid with `quoteGasPayment(destination)`.
*/
export const WARP_ROUTER_ABI = parseAbi([
  'function transferRemote(uint32 _destination, bytes32 _recipient, uint256 _amountOrId) payable returns (bytes32 messageId)',
])

// ---- the registry -----------------------------------------------------------------

export interface RegistryEntry {
  readonly name: string
  readonly abi: Abi
  /** sha256 of the synced artifact, or null for the fragments written by hand. */
  readonly sha256: string | null
  /** Where the ABI came from, or why it has no artifact. */
  readonly source: string
}

const HAND_WRITTEN: readonly RegistryEntry[] = [
  {
    name: 'ERC20Extensions',
    abi: ERC20_EXTENSIONS_ABI,
    sha256: null,
    source: 'hand-written: not part of ERC-20, and eip_2612.json declares no permit',
  },
  {
    name: 'HyperlaneTokenRouter',
    abi: WARP_ROUTER_ABI,
    sha256: null,
    source:
      'hand-written: no Hyperlane contracts are vendored (§2.7 S6 pins the registry, not the Solidity)',
  },
]

export const ABI_REGISTRY: readonly RegistryEntry[] = [
  ...ARTIFACT_ABIS.map((a) => ({ name: a.name, abi: a.abi, sha256: a.sha256, source: a.source })),
  ...HAND_WRITTEN,
]

function fragments(abi: Abi): readonly AbiFunction[] {
  return abi.filter((item): item is AbiFunction => item.type === 'function')
}

/**
 * One ABI from two, for the few places where a single role spans two deployed
 * contracts. Deduplicated by selector so a shared getter cannot appear twice.
 */
function mergeAbis(...abis: readonly Abi[]): Abi {
  const seen = new Set<string>()
  const out: Abi[number][] = []
  for (const abi of abis) {
    for (const item of abi) {
      const key = item.type === 'function' ? toFunctionSelector(item) : JSON.stringify(item)
      if (seen.has(key)) continue
      seen.add(key)
      out.push(item)
    }
  }
  return out
}

// ---- the ABIs the decoder names ---------------------------------------------------

/** ERC-20 as standardised, plus the extensions above; see `ERC20_CONTRACTS`. */
export const ERC20_ABI: Abi = mergeAbis(artifactAbi('ERC20'), ERC20_EXTENSIONS_ABI)
export const ERC721_ABI: Abi = artifactAbi('ERC721')
export const ERC1155_ABI: Abi = artifactAbi('ERC1155')
export const PERMIT2_ABI: Abi = artifactAbi('Permit2')
export const WETH_ABI: Abi = artifactAbi('WETH9')
export const UNIVERSAL_ROUTER_ABI: Abi = artifactAbi('UniversalRouter')
export const MULTICALL3_ABI: Abi = artifactAbi('Multicall3')

/** EsLimitOrderManagerV1 (§8.6). */
export const LIMIT_ORDERS_ABI: Abi = artifactAbi('LimitOrders')
/** ElectroSwap yield farm (§8.8). */
export const FARM_ABI: Abi = artifactAbi('YieldFarm')
/** Seaport 1.5 (§8.10), pinned by abi-sync to the verification sources of the contract ElectroSwap deployed. */
export const SEAPORT_ABI: Abi = artifactAbi('Seaport15')
/** Electric Legends dividends and the marketplace minter (§8.10). */
export const DIVIDENDS_ABI: Abi = artifactAbi('EsDividendDistributorV2')
export const MINTER_ABI: Abi = artifactAbi('EsMinterV2')
/** Fee-on-transfer detector (§8.5) — the ABI whose hand-written version never matched. */
export const FOT_DETECTOR_ABI: Abi = artifactAbi('FeeOnTransferDetector')

/**
 * Launchpad pools are one contract per campaign and the referral rewards live
 * on a second contract, so the launchpad "ABI" is both (§8.9).
 */
export const LAUNCHPAD_ABI: Abi = mergeAbis(
  artifactAbi('LaunchpadPresalePool'),
  artifactAbi('LaunchpadAffiliateRewards'),
)

/** Registry names the decoder groups, for the selector lookups below. */
export const ERC20_CONTRACTS: readonly string[] = ['ERC20', 'ERC20Extensions']
export const LAUNCHPAD_CONTRACTS: readonly string[] = [
  'LaunchpadPresalePool',
  'LaunchpadAffiliateRewards',
]

/** Event topic0 hashes the simulator reads from traces. */
export const TOPICS = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  approvalForAll: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
  transferSingle: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  transferBatch: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
} as const

// ---- the selector index -----------------------------------------------------------

export interface SelectorClaim {
  /** Registry entry that declares this function. */
  readonly contract: string
  readonly selector: Hex
  readonly signature: string
  readonly name: string
  /** A one-fragment ABI, ready for `decodeFunctionData`. */
  readonly abi: Abi
}

/*
  Collisions are decided here, once, and the same way every time.

  A selector is four bytes of a hash, so two unrelated contracts can claim it by
  accident; far more often two *related* ones claim it on purpose, because
  `approve(address,uint256)` is in both ERC-20 and ERC-721 and
  `transferFrom(address,address,uint256)` is in both with the same argument
  layout. The order is: what the wallet knows sits at that address wins, because
  a known contract is evidence and a hash prefix is not; otherwise the standard
  wins, because an unknown address running a standard selector is far more
  likely to be a token than to be a launchpad pool with an unlucky hash.
*/
const ROLE_CONTRACTS: Partial<Record<ContractRole, readonly string[]>> = {
  router: ['UniversalRouter'],
  permit2: ['Permit2'],
  marketplace: ['Seaport15'],
  farm: ['YieldFarm'],
  locker: ['LockerV2', 'LockerV3'],
  launchpad: [
    'LaunchpadPresalePool',
    'LaunchpadAffiliateRewards',
    'LaunchpadManager',
    'LaunchpadLpFeeProcessor',
  ],
  limit_orders: ['LimitOrders'],
  wrapped_native: ['WETH9'],
  warp_token: ['HyperlaneTokenRouter', 'ERC20'],
  warp_router: ['HyperlaneTokenRouter'],
  multicall: ['Multicall3'],
  dividends: ['EsDividendDistributorV2'],
  nft: ['ElectricLegends', 'ERC721'],
  minter: ['EsMinterV2'],
}

const STANDARDS_FIRST: readonly string[] = [
  'ERC20',
  'ERC20Extensions',
  'ERC721',
  'ERC1155',
  'Permit2',
  'WETH9',
  'UniversalRouter',
  'Multicall3',
  'Seaport15',
]

function rank(contract: string): number {
  const i = STANDARDS_FIRST.indexOf(contract)
  return i === -1 ? STANDARDS_FIRST.length : i
}

const BY_SELECTOR = new Map<string, SelectorClaim[]>()
const BY_CONTRACT = new Map<string, SelectorClaim>()

for (const entry of ABI_REGISTRY) {
  for (const fragment of fragments(entry.abi)) {
    const selector = toFunctionSelector(fragment)
    const claim: SelectorClaim = {
      contract: entry.name,
      selector,
      signature: toFunctionSignature(fragment),
      name: fragment.name,
      abi: [fragment],
    }
    const bucket = BY_SELECTOR.get(selector)
    if (bucket) bucket.push(claim)
    else BY_SELECTOR.set(selector, [claim])
    // An ABI that declares one selector twice is malformed; the first wins rather than throwing at import.
    const key = `${entry.name}:${selector}`
    if (!BY_CONTRACT.has(key)) BY_CONTRACT.set(key, claim)
  }
}
for (const bucket of BY_SELECTOR.values())
  bucket.sort((a, b) => rank(a.contract) - rank(b.contract) || a.contract.localeCompare(b.contract))

function normalise(selector: Hex): string {
  return selector.toLowerCase()
}

/** Every registry entry that claims this selector, best first. Answers "who claimed it". */
export function selectorClaims(selector: Hex): readonly SelectorClaim[] {
  return BY_SELECTOR.get(normalise(selector)) ?? []
}

/** The fragment a named registry entry declares for this selector, if it declares one. */
export function fragmentFor(contract: string, selector: Hex): SelectorClaim | null {
  return BY_CONTRACT.get(`${contract}:${normalise(selector)}`) ?? null
}

/** The first of `contracts` that claims this selector — how the decoder reads a role. */
export function fragmentForAny(contracts: readonly string[], selector: Hex): SelectorClaim | null {
  for (const contract of contracts) {
    const hit = fragmentFor(contract, selector)
    if (hit) return hit
  }
  return null
}

/** The one claim to believe: what the wallet knows is at the address, else the standard. */
export function resolveSelector(selector: Hex, role?: ContractRole | null): SelectorClaim | null {
  const claims = selectorClaims(selector)
  if (claims.length === 0) return null
  if (role) {
    const preferred = fragmentForAny(ROLE_CONTRACTS[role] ?? [], selector)
    if (preferred) return preferred
  }
  return claims[0] ?? null
}

// ---- the 4byte fallback -----------------------------------------------------------

/*
  Shipped, never fetched. A wallet that asks a 4byte service what a selector is
  tells that service which contracts its user is about to touch, from the user's
  IP, at signing time — a per-signature tracking beacon in exchange for a
  function name. The table is small on purpose: it covers the selectors a wallet
  actually meets, and a miss is reported as a miss.
*/
const TABLE: Readonly<Record<string, string>> = FOUR_BYTE.selectors

export interface FourByteHit {
  readonly signature: string
  readonly name: string
  /** A one-fragment ABI, or null when the shipped signature will not parse. */
  readonly abi: Abi | null
}

const PARSED = new Map<string, FourByteHit | null>()

/** The shipped local table's answer for a selector, or null. Never touches the network. */
export function fourByte(selector: Hex): FourByteHit | null {
  const key = normalise(selector)
  const memo = PARSED.get(key)
  if (memo !== undefined) return memo
  const signature = TABLE[key]
  if (!signature) {
    PARSED.set(key, null)
    return null
  }
  const name = signature.slice(0, signature.indexOf('('))
  let abi: Abi | null = null
  try {
    const item = parseAbiItem(`function ${signature}`)
    // A shipped key that does not hash to its own signature would name the wrong
    // function; trust the bytes over the key.
    if (item.type === 'function' && toFunctionSelector(item) === key) abi = [item]
  } catch {
    abi = null
  }
  const hit: FourByteHit = { signature, name, abi }
  PARSED.set(key, hit)
  return hit
}
