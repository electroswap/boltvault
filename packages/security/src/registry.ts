/**
 * Known contracts by (chainId, address) — never by address alone (§2.7 S6:
 * the Avalanche collateral router shares an address with the ETN synthetic).
 * Roles feed the spender rules ("known spender") and the statements
 * ("ElectroSwap Universal Router" instead of 0x2c12…).
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import type { Hex } from './types'

export type ContractRole =
  | 'router'
  | 'permit2'
  | 'marketplace'
  | 'conduit'
  | 'farm'
  | 'locker'
  | 'launchpad'
  | 'limit_orders'
  | 'position_manager'
  | 'wrapped_native'
  | 'warp_token'
  | 'multicall'
  | 'fee_sink'
  | 'dividends'
  | 'nft'
  | 'minter'

export interface KnownContract {
  readonly name: string
  readonly role: ContractRole
}

const key = (chainId: number, address: string): string => `${chainId}:${address.toLowerCase()}`

const KNOWN = new Map<string, KnownContract & { readonly address: Hex }>()

function add(chainId: number, address: string | null, name: string, role: ContractRole): void {
  if (!address) return
  KNOWN.set(key(chainId, address), { name, role, address: address as Hex })
}

for (const chainId of [52014, 5201420] as const) {
  const a = ELECTRONEUM_ADDRESSES[chainId]
  add(chainId, a.universalRouter, 'ElectroSwap Universal Router', 'router')
  add(chainId, a.swapRouter02, 'ElectroSwap SwapRouter02', 'router')
  add(chainId, a.v2Router02, 'ElectroSwap V2 Router', 'router')
  add(chainId, a.permit2, 'Permit2', 'permit2')
  add(chainId, a.seaport15, 'ElectroSwap NFT marketplace', 'marketplace')
  add(chainId, a.yieldFarm, 'ElectroSwap yield farm', 'farm')
  add(chainId, a.multicall3, 'Multicall3', 'multicall')
  add(chainId, a.wetn, 'Wrapped ETN', 'wrapped_native')
  add(chainId, a.usdc, 'Hyperlane USDC', 'warp_token')
  add(chainId, a.usdt, 'Hyperlane USDT', 'warp_token')
  add(chainId, a.seaportConduit, 'ElectroSwap marketplace conduit', 'conduit')
  add(chainId, a.launchpadManager, 'ElectroSwap launchpad', 'launchpad')
  add(chainId, a.launchpadAffiliate, 'ElectroSwap launchpad referrals', 'launchpad')
  add(chainId, a.limitOrders, 'ElectroSwap limit orders', 'limit_orders')
  add(chainId, a.electricLegends, 'Electric Legends', 'nft')
  add(chainId, a.dividendDistributor, 'Electric Legends dividends', 'dividends')
  add(chainId, a.nftMinter, 'ElectroSwap NFT minter', 'minter')
}
// Mainnet-only addresses from the master plan §8.13 spender registry.
add(52014, '0xcA11bde05977b3631167028862bE2a173976CA11', 'Multicall3', 'multicall')
add(52014, '0x16ca736c8B181772009e598F37f137e9cD36AFAE', 'ElectroSwap V2 liquidity locker', 'locker')
add(52014, '0xfdB0d62Fc929fD53D266B969Bfe4250b205D0899', 'ElectroSwap V3 liquidity locker', 'locker')
// Canonical Permit2 on the other chains.
for (const chainId of [1, 56, 8453, 42161, 10, 137, 43114, 59144, 130]) {
  add(chainId, '0x000000000022D473030F116dDEE9F6B43aC78BA3', 'Permit2', 'permit2')
  add(chainId, '0xcA11bde05977b3631167028862bE2a173976CA11', 'Multicall3', 'multicall')
}

export function knownContract(chainId: number, address: string | null | undefined): KnownContract | null {
  if (!address) return null
  return KNOWN.get(key(chainId, address)) ?? null
}

/** A spender the wallet treats as trusted for approvals and permits. */
export function isKnownSpender(chainId: number, address: string): boolean {
  const c = knownContract(chainId, address)
  if (!c) return false
  return c.role === 'router' || c.role === 'permit2' || c.role === 'marketplace' || c.role === 'conduit' || c.role === 'farm' || c.role === 'locker' || c.role === 'launchpad' || c.role === 'limit_orders' || c.role === 'position_manager'
}

/** Known contracts on a chain by role (defaults to the spender roles). */
export function knownSpenders(chainId: number, roles?: readonly ContractRole[]): Array<{ address: Hex; name: string; role: ContractRole }> {
  const wanted = roles ?? (['router', 'permit2', 'marketplace', 'conduit', 'farm', 'locker', 'launchpad', 'limit_orders', 'position_manager'] as const)
  const out: Array<{ address: Hex; name: string; role: ContractRole }> = []
  for (const [k, v] of KNOWN) {
    if (!k.startsWith(`${chainId}:`) || !wanted.includes(v.role)) continue
    out.push({ address: v.address, name: v.name, role: v.role })
  }
  return out
}

export function permit2Address(chainId: number): Hex | null {
  for (const [k, v] of KNOWN) {
    if (v.role === 'permit2' && k.startsWith(`${chainId}:`)) return v.address
  }
  return null
}

/** Register a contract at runtime (custom tokens, signed spender lists §9.4). */
export function registerKnownContract(chainId: number, address: string, contract: KnownContract): void {
  KNOWN.set(key(chainId, address), { ...contract, address: address as Hex })
}
