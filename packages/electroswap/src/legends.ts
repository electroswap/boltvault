/**
 * Electric Legends and their dividends (master plan §8.10): the collection
 * (ERC-721 enumerable, mintable), `EsDividendDistributorV2` (⅓ of marketplace
 * fees credited to registered Legends) and `EsMinterV2` (mints through the
 * marketplace with its markup). Reads for the vessel, encoders for Activate
 * dividends · Claim · Mint.
 */
import { encodeFunctionData, parseAbi, type Hex } from 'viem'

export const LEGENDS_ABI = parseAbi([
  'function balanceOf(address owner) view returns (uint256)',
  'function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function isApprovedForAll(address owner, address operator) view returns (bool)',
  'function totalSupply() view returns (uint256)',
  'function tokenURI(uint256 tokenId) view returns (string)',
  'function isMintable() view returns (bool)',
  'function mintPrice() view returns (uint256)',
  'function mintableCount(address account) view returns (uint256)',
  'function MAX_MINTS_PER_WALLET() view returns (uint256)',
])

export const DIVIDENDS_ABI = parseAbi([
  'function getClaimableDividends(uint256[] tokenIds) view returns (uint256)',
  'function tokenDividendInfo(uint256 tokenId) view returns (uint256 entryAccDividends, uint256 lastClaimAccDividends, bool isRegistered)',
  'function dividendsDistributed() view returns (uint256)',
  'function dividendsCollected() view returns (uint256)',
  'function activeTokenCount() view returns (uint256)',
  'function dividendsEnabled() view returns (bool)',
  'function accDividendsPerToken() view returns (uint256)',
  'function register(uint256[] tokenIds)',
  'function claimDividends(uint256[] tokenIds)',
])

export const MINTER_ABI = parseAbi(['function mintPrice(address collection) view returns (uint256)', 'function mintableCount(address collection, address account) view returns (uint256)', 'function mint(address collection, uint256 mintCount) payable'])

/** `getClaimableDividends` dedupes with a fixed 1000-slot array: pass unique ids below 1000 (§8.10 caveat). */
export function claimableIds(tokenIds: readonly bigint[]): bigint[] {
  const seen = new Set<string>()
  const out: bigint[] = []
  for (const id of tokenIds) {
    const k = id.toString()
    if (id < 0n || id >= 1000n || seen.has(k)) continue
    seen.add(k)
    out.push(id)
  }
  return out
}

export function encodeRegister(tokenIds: readonly bigint[]): Hex {
  return encodeFunctionData({ abi: DIVIDENDS_ABI, functionName: 'register', args: [[...tokenIds]] })
}

export function encodeClaimDividends(tokenIds: readonly bigint[]): Hex {
  return encodeFunctionData({ abi: DIVIDENDS_ABI, functionName: 'claimDividends', args: [[...tokenIds]] })
}

export function encodeMint(collection: Hex, count: bigint): Hex {
  return encodeFunctionData({ abi: MINTER_ABI, functionName: 'mint', args: [collection, count] })
}

/** The vessel's level: claimable ÷ the best claim ever, clamped to [0, 1]; 0 when nothing accrued (§8.10 design). */
export function vesselLevel(claimableWei: bigint, bestClaimWei: bigint): number {
  if (claimableWei <= 0n) return 0
  if (bestClaimWei <= 0n) return 1
  const level = Number((claimableWei * 1000n) / bestClaimWei) / 1000
  return Math.max(0, Math.min(1, level))
}

/** "Your share of the next fee": ⅓ of the fee is split over the active pieces (EsDividendDistributorV2). */
export function shareOfNextFee(ownedRegistered: number, activeTokenCount: number): number {
  if (activeTokenCount <= 0 || ownedRegistered <= 0) return 0
  return (ownedRegistered / activeTokenCount) / 3
}
