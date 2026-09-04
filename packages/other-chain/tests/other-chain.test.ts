import { describe, expect, it } from 'vitest'
import { getAddress } from 'viem'
import {
  isEnsEnabled,
  identityDisplay,
  shortAddress,
  ENS_CHAIN_ID,
} from '../src/ens'
import {
  TRANSFER_TOPIC,
  toTopic32,
  incomingLogsParams,
  planIncomingWindows,
  reachedBound,
  type BoundedRange,
} from '../src/incoming'
import { capabilities, ETN_MAINNET_CHAIN_ID } from '../src/capabilities'

const ADDR = getAddress('0x1f9090aaE28b8a3dCeaDf281B0F12E262888C277')

describe('ENS (T7.3 — Ethereum only)', () => {
  it('ENS_CHAIN_ID is 1 (Ethereum mainnet) and only chain 1 is enabled', () => {
    expect(ENS_CHAIN_ID).toBe(1)
    expect(isEnsEnabled(1)).toBe(true)
    expect(isEnsEnabled(56)).toBe(false)
    expect(isEnsEnabled(52014)).toBe(false)
    expect(isEnsEnabled(59144)).toBe(false)
  })

  it('shortAddress truncates to 0x + 4 + … + 4 (preserves checksum casing)', () => {
    expect(shortAddress(ADDR)).toBe('0x1F90…C277')
  })

  it('Ethereum + a resolved ENS name → name (short)', () => {
    const id = identityDisplay(1, ADDR, 'vitalik.eth')
    expect(id.ensName).toBe('vitalik.eth')
    expect(id.display).toBe(`vitalik.eth (${shortAddress(ADDR)})`)
  })

  it('Ethereum but no resolved name → just the short address', () => {
    const id = identityDisplay(1, ADDR, null)
    expect(id.ensName).toBeUndefined()
    expect(id.display).toBe(shortAddress(ADDR))
  })

  it('non-Ethereum ignores the ENS name (no ENS off Ethereum)', () => {
    const id = identityDisplay(56, ADDR, 'should-not-show.eth')
    expect(id.ensName).toBeUndefined()
    expect(id.display).toBe(shortAddress(ADDR))
  })

  it('whitespace-only ENS name is treated as no name', () => {
    const id = identityDisplay(1, ADDR, '   ')
    expect(id.ensName).toBeUndefined()
  })
})

describe('bounded incoming getLogs (T7.3)', () => {
  it('TRANSFER_TOPIC is the canonical ERC-20 Transfer event hash', () => {
    expect(TRANSFER_TOPIC).toBe('0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a9df543270f')
  })

  it('toTopic32 left-pads the account into a 32-byte topic', () => {
    const t = toTopic32(ADDR)
    expect(t).toMatch(/^0x[0-9a-f]{64}$/)
    expect(t.endsWith(ADDR.toLowerCase().slice(2))).toBe(true)
  })

  it('incomingLogsParams matches Transfer to=account (topic[2]), optional token', () => {
    const params = incomingLogsParams(
      { fromBlock: 0, head: 100, window: 50 },
      ADDR,
      '0x2f800Db0F5922798662f7778C11aa2506015E5aD',
    )
    expect(params.topics[0]).toBe(TRANSFER_TOPIC)
    expect(params.topics[1]).toBeNull() // from = any
    expect(params.topics[2]).toBe(toTopic32(ADDR)) // to = account
    expect(params.address).toBe('0x2f800Db0F5922798662f7778C11aa2506015E5aD')
  })

  it('no token address → address undefined (all tokens)', () => {
    const params = incomingLogsParams({ fromBlock: 0, head: 100, window: 50 }, ADDR, null)
    expect(params.address).toBeUndefined()
  })

  it('planIncomingWindows paginates backwards, newest first, bounded', () => {
    const range: BoundedRange = { fromBlock: 0, head: 1000, window: 200 }
    const windows = planIncomingWindows(range, 3)
    expect(windows).toHaveLength(3)
    // newest window first
    expect(windows[0]?.toBlock).toBe(1000)
    expect(windows[0]?.fromBlock).toBe(801)
    // second window continues backwards
    expect(windows[1]?.toBlock).toBe(800)
    expect(windows[1]?.fromBlock).toBe(601)
    expect(windows[2]?.toBlock).toBe(600)
  })

  it('reaches the bound and stops (first window below the bound is marked first)', () => {
    const range: BoundedRange = { fromBlock: 50, head: 100, window: 200 }
    const windows = planIncomingWindows(range, 10)
    // 100 -> fromBlock max(50, -99)=50 => first immediately
    expect(windows).toHaveLength(1)
    expect(windows[0]?.first).toBe(true)
    expect(reachedBound(range, windows[0]!)).toBe(true)
  })

  it('a deep backlog is capped by maxWindows', () => {
    const range: BoundedRange = { fromBlock: 0, head: 1_000_000, window: 1000 }
    const windows = planIncomingWindows(range, 5)
    expect(windows).toHaveLength(5)
    // never below the bound unless a window actually hits it
    expect(windows.every((w) => w.fromBlock >= 0)).toBe(true)
  })
})

describe('capabilities (T7.3)', () => {
  it('ETN mainnet → full (graphql history, electroswap, indexer)', () => {
    const c = capabilities(ETN_MAINNET_CHAIN_ID)
    expect(c.isElectroneum).toBe(true)
    expect(c.history).toBe('graphql')
    expect(c.portfolioSource).toBe('electroswap-graphql')
    expect(c.marketData).toBe('electroswap')
    expect(c.usesIndexer).toBe(true)
    expect(c.ens).toBe(false)
  })

  it('Ethereum → multicall + bounded-getlogs + ENS + geckoterminal', () => {
    const c = capabilities(1)
    expect(c.isElectroneum).toBe(false)
    expect(c.history).toBe('bounded-getlogs')
    expect(c.portfolioSource).toBe('multicall')
    expect(c.marketData).toBe('geckoterminal')
    expect(c.ens).toBe(true)
    expect(c.usesIndexer).toBe(false)
  })

  it('Base → same as Ethereum but no ENS', () => {
    const c = capabilities(8453)
    expect(c.ens).toBe(false)
    expect(c.history).toBe('bounded-getlogs')
    expect(c.approvalsScan).toBe(true)
    expect(c.swap).toBe(true)
  })
})
