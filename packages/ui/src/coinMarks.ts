/**
 * The native coin of every supported chain, drawn from the bundle.
 *
 * Owner: "Bundle should include default icons for all supported chains native
 * currencies." Only Electroneum had one. `tokens.logoFor(chainId, 'native')`
 * answers null for every other chain — there is no list entry for a coin that
 * has no address — so ether on Base, BNB, POL and AVAX all arrived with no
 * logo at all and fell through to the lettered disc. Not a missing file: a
 * mark that never existed.
 *
 * A coin's mark is its home chain's mark, so nothing new is drawn here — the
 * ether diamond, the BNB rhombus, the Polygon and Avalanche marks are already
 * in ChainMark, authored in repo and free of any network. This file only says
 * which one stands for which coin. Base's native currency is ether, so Base's
 * native row wears Ethereum's mark, not Base's; the chain is named beside it
 * by the chain selector, which is where the chain belongs.
 *
 * The wrapped natives are here for the same reason and are the addresses in
 * `@boltvault/chains`' registry (`ChainDef.wrappedNative`), lower-cased. They
 * are matched by *address*, never by symbol: a token calling itself "WETH" is
 * a claim anyone can make, and a wallet that hands out a real mark on a claim
 * is a wallet that helps a fake token look real.
 */
import { NATIVE_KEY, normaliseTokenAddress } from './tokenLogos'

/**
 * Chain -> the chain whose mark stands for its native coin.
 *
 * Six of the ten run on ether, so they all point at Ethereum; Electroneum's
 * testnet points at mainnet so tETN wears the ETN mark rather than the dashed
 * testnet ring, which belongs to the chain and not to the coin.
 */
const NATIVE_COIN_OF: Readonly<Record<number, number>> = {
  52014: 52014,
  5201420: 52014,
  1: 1,
  8453: 1,
  10: 1,
  42161: 1,
  130: 1,
  59144: 1,
  56: 56,
  137: 137,
  43114: 43114,
}

/** `ChainDef.wrappedNative` per chain, lower-cased. Electroneum's WETN ships its own file. */
const WRAPPED_NATIVE: Readonly<Record<number, string>> = {
  1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
  56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c',
  10: '0x4200000000000000000000000000000000000006',
  137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',
  43114: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',
  42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',
  8453: '0x4200000000000000000000000000000000000006',
  130: '0x4200000000000000000000000000000000000006',
  59144: '0xe5d7c2a44ffddf6b295a15c148167daaaf5cf34f',
}

/**
 * The chain mark to draw for a token, or null when the symbol disc is right.
 *
 * Answers for the chain's own coin and for its wrapped form; everything else
 * is a token with a list entry, which brings its own logo.
 */
export function coinMarkChain(chainId: number, address: string): number | null {
  const coin = NATIVE_COIN_OF[chainId]
  if (coin === undefined) return null
  const a = normaliseTokenAddress(address)
  if (a === NATIVE_KEY) return coin
  return WRAPPED_NATIVE[chainId] === a ? coin : null
}
