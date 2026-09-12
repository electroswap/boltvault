import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import {
  parseTokenList,
  tokenUniverse,
  partitionPortfolio,
  type RawTokenList,
  type CustomToken,
} from '../src/index.js'

// Fixture mirrors the live ElectroSwap tokenlist (fetched 2026-09-04): the real
// list has 10 tokens on 52014 and 5 on 5201420. We keep the key ones to assert
// filtering + normalization without pinning all 15.
const WETN = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'
const USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
const BOLT = '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1'
const TWETN = '0x154c9fD7F006b92b6afa746098d8081A831DC1FC'
const TUSDC = '0x9a110A3Ecc8704e93Bd4FA1bA44D5CF93327202B'

const raw: RawTokenList = {
  name: 'ElectroSwap Tokens',
  tokens: [
    {
      chainId: 52014,
      address: WETN,
      name: 'Wrapped Electroneum',
      symbol: 'WETN',
      decimals: 18,
      tags: ['wetn'],
    },
    {
      chainId: 52014,
      address: USDC,
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      tags: ['hyperlane'],
    },
    {
      chainId: 52014,
      address: BOLT,
      name: 'ElectroSwap',
      symbol: 'BOLT',
      decimals: 18,
      tags: ['es'],
    },
    // testnet entries in the SAME file (C5)
    {
      chainId: 5201420,
      address: TWETN,
      name: 'Wrapped Electroneum (Test)',
      symbol: 'tWETN',
      decimals: 18,
    },
    {
      chainId: 5201420,
      address: TUSDC,
      name: 'USD Coin (Test)',
      symbol: 'tUSDC',
      decimals: 6,
    },
  ],
}

describe('parseTokenList', () => {
  it('keeps only entries for the requested chainId (C5: no top-level chainId)', () => {
    const main = parseTokenList(raw, 52014)
    expect(main).toHaveLength(3)
    expect(main.every((t) => t.chainId === 52014)).toBe(true)

    const test = parseTokenList(raw, 5201420)
    expect(test).toHaveLength(2)
    expect(test.every((t) => t.chainId === 5201420)).toBe(true)
  })

  it('normalizes addresses to checksum', () => {
    const [wetn] = parseTokenList(raw, 52014)
    expect(wetn?.address).toBe(getAddress(WETN))
  })

  it('rejects malformed entries (missing fields / bad decimals / bad address)', () => {
    const bad: RawTokenList = {
      tokens: [
        { chainId: 52014, address: WETN, name: 'x', symbol: 'X', decimals: 18 }, // ok
        { chainId: 52014, address: 'nope', name: 'y', symbol: 'Y', decimals: 18 }, // bad addr
        { chainId: 52014, address: USDC, symbol: 'Z', decimals: 18 }, // no name
        { chainId: 52014, address: BOLT, name: 'n', symbol: 'N', decimals: -1 }, // bad decimals
        { chainId: 52014, address: BOLT, name: 'n', symbol: 'N' }, // no decimals
      ],
    }
    const out = parseTokenList(bad, 52014)
    expect(out).toHaveLength(1)
    expect(out[0]?.symbol).toBe('X')
  })
})

describe('tokenUniverse', () => {
  const public52014 = parseTokenList(raw, 52014)

  it('includes a native sentinel first', () => {
    const u = tokenUniverse(52014, public52014)
    expect(u[0]?.address).toBe('native')
  })

  it('merges custom tokens (even zero-balance) and history-discovered', () => {
    const custom: CustomToken[] = [
      {
        chainId: 52014,
        address: WETN,
        name: 'WETN custom',
        symbol: 'WETN',
        decimals: 18,
        source: 'user',
      },
      {
        chainId: 52014,
        address: '0x1111111111111111111111111111111111111111',
        name: 'My Token',
        symbol: 'MYT',
        decimals: 18,
        source: 'user',
      },
    ]
    const history = [
      {
        chainId: 52014,
        address: '0x2222222222222222222222222222222222222222',
        name: 'History Tok',
        symbol: 'HIST',
        decimals: 18,
      },
    ]
    const u = tokenUniverse(52014, public52014, custom, history)
    const syms = new Set(u.map((t) => t.symbol))
    expect(syms.has('MYT')).toBe(true)
    expect(syms.has('HIST')).toBe(true)
    // custom wins on a known address (metadata preserved)
    const wetn = u.find((t) => t.address.toLowerCase() === WETN.toLowerCase())
    expect(wetn?.source).toBe('user')
  })
})

describe('partitionPortfolio', () => {
  const public52014 = parseTokenList(raw, 52014)
  const universe = tokenUniverse(52014, public52014)

  it('splits into native / nonZero / pinnedOnly / custom / zeroListed', () => {
    const balances = new Map<string, bigint>([
      [WETN.toLowerCase(), 5n],
      [USDC.toLowerCase(), 0n],
    ])
    const pinned = new Set([USDC.toLowerCase()])
    const p = partitionPortfolio(universe, balances, pinned)
    expect(p.native?.symbol).toBe('NATIVE')
    expect(p.nonZero.map((t) => t.symbol)).toEqual(['WETN'])
    expect(p.pinnedOnly.map((t) => t.symbol)).toEqual(['USDC'])
    expect(p.zeroListed.length).toBeGreaterThan(0)
  })
})

/*
  ES-BV-037. A token list is a remote file. Its names and symbols land in the
  portfolio, the swap picker and the approval sheet at exactly the places
  on-chain metadata does — and that path has gone through the label bound since
  it was written, while this one did not.
*/
describe('what a list may say', () => {
  const entry = (over: Record<string, unknown>) =>
    parseTokenList({ name: 'x', tokens: [{ chainId: 52014, address: WETN, name: 'Wrapped Electroneum', symbol: 'WETN', decimals: 18, ...over }] } as RawTokenList, 52014)

  it('strips the characters that reorder the row it sits in', () => {
    const [t] = entry({ symbol: 'US\u202eDC', name: 'Circle\u200b USD' })
    expect(t?.symbol).toBe('USDC')
    expect(t?.name).toBe('Circle USD')
    expect(t?.symbol).not.toMatch(/[\u202e\u200b]/u)
  })

  it('caps a name or symbol long enough to push the rest of the row off screen', () => {
    const [t] = entry({ symbol: 'S'.repeat(64), name: 'N'.repeat(200) })
    expect(t?.symbol).toHaveLength(12)
    expect(t?.name).toHaveLength(48)
  })

  it('drops an entry whose name or symbol is nothing but those characters', () => {
    expect(entry({ symbol: '\u200b\u200b' })).toHaveLength(0)
    expect(entry({ name: '\u202e' })).toHaveLength(0)
  })
})
