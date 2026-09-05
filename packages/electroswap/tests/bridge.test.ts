/**
 * The Hyperlane snapshot (master plan §2.7 S6, §8.7): corridors keyed by
 * (chainId, address), the Avalanche/Electroneum address collision, the
 * transferRemote encoding, the DispatchId read, and verification by standard.
 */
import { decodeFunctionData, keccak256, toHex, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { DISPATCH_ID_TOPIC, HYPERLANE_CHAINS, PROCESS_ID_TOPIC, TOKEN_ROUTER_ABI, WARP_ROUTES, corridor, corridorsFrom, dispatchIdFrom, encodeApproveRouter, encodeTransferRemote, etaMinutes, hyperlaneChain, recipientBytes32, verificationCalls, verifyCorridor, warpAsset, warpEndpoint } from '../src'

const ETN = 52014
const USDC_ETN = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e' as Hex
const USDT_ETN = '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7' as Hex
const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Hex
const ME = '0x1234567890abcdef1234567890abcdef12345678' as Hex

describe('the pinned Hyperlane snapshot', () => {
  it('knows the four chains with mailboxes and the domain equal to the chain id', () => {
    expect(HYPERLANE_CHAINS.map((c) => c.chainId)).toEqual([ETN, 1, 8453, 43114])
    for (const c of HYPERLANE_CHAINS) {
      expect(c.domain).toBe(c.chainId)
      expect(c.mailbox).toMatch(/^0x[0-9a-fA-F]{40}$/)
      expect(c.interchainGasPaymaster).toMatch(/^0x[0-9a-fA-F]{40}$/)
    }
    expect(hyperlaneChain(ETN)?.mailbox).toBe('0x3a464f746D23Ab22155710f44dB16dcA53e0775E')
    expect(hyperlaneChain(56)).toBeNull()
  })

  it('lists USDC ↔ Ethereum/Base/Avalanche and USDT ↔ Ethereum, synthetic on Electroneum and collateral elsewhere', () => {
    const usdc = WARP_ROUTES.find((r) => r.symbol === 'USDC')
    const usdt = WARP_ROUTES.find((r) => r.symbol === 'USDT')
    expect(usdc?.endpoints.map((e) => e.chainId)).toEqual([ETN, 1, 8453, 43114])
    expect(usdt?.endpoints.map((e) => e.chainId)).toEqual([ETN, 1])
    for (const r of WARP_ROUTES) for (const e of r.endpoints) {
      expect(e.decimals).toBe(6)
      if (e.chainId === ETN) {
        expect(e.standard).toBe('synthetic')
        expect(e.token).toBe(e.router) // the token is the router
      } else {
        expect(e.standard).toBe('collateral')
        expect(e.token).not.toBe(e.router)
      }
    }
  })

  it('keys endpoints by (chainId, address): the Avalanche router shares the ETN synthetic address', () => {
    expect(warpEndpoint(ETN, USDC_ETN)?.standard).toBe('synthetic')
    expect(warpEndpoint(43114, USDC_ETN)).toBeNull() // on Avalanche that address is the router, not what a user holds
    expect(warpEndpoint(43114, '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E')?.router.toLowerCase()).toBe(USDC_ETN.toLowerCase())
    expect(warpEndpoint(ETN, usdcLower())?.symbol).toBe('USDC') // case-insensitive
  })

  it('enumerates corridors both ways', () => {
    expect(corridorsFrom(ETN, USDC_ETN).map((c) => c.destination.chainId)).toEqual([1, 8453, 43114])
    expect(corridorsFrom(ETN).map((c) => `${c.symbol}:${c.destination.chainId}`)).toEqual(['USDC:1', 'USDC:8453', 'USDC:43114', 'USDT:1'])
    expect(corridorsFrom(8453).map((c) => `${c.symbol}:${c.destination.chainId}`)).toEqual(['USDC:52014'])
    expect(corridorsFrom(56)).toEqual([])
    expect(corridor(1, ETN, USDC_ETH)?.origin.standard).toBe('collateral')
    expect(corridor(1, 8453, USDC_ETH)).toBeNull() // collateral ↔ collateral is not offered: every leg touches Electroneum
    expect(corridor(ETN, 56, USDC_ETN)).toBeNull()
    expect(warpAsset(ETN, USDT_ETN)).toEqual({ symbol: 'USDT', destinations: [1] })
    expect(warpAsset(1, '0x1111111111111111111111111111111111111111')).toBeNull()
  })

  it('encodes transferRemote(dest, bytes32(recipient), amount) and approve(router)', () => {
    const data = encodeTransferRemote(8453, ME, 250_000_000n)
    const d = decodeFunctionData({ abi: TOKEN_ROUTER_ABI, data })
    expect(d.functionName).toBe('transferRemote')
    expect(d.args).toEqual([8453, recipientBytes32(ME), 250_000_000n])
    expect(recipientBytes32(ME)).toBe(`0x000000000000000000000000${ME.slice(2)}`)
    const a = decodeFunctionData({ abi: TOKEN_ROUTER_ABI, data: encodeApproveRouter(USDC_ETN, 5n) })
    expect(a.functionName).toBe('approve')
    expect(a.args).toEqual([USDC_ETN, 5n])
  })

  it('reads the DispatchId from the origin mailbox log only', () => {
    expect(DISPATCH_ID_TOPIC).toBe(keccak256(toHex('DispatchId(bytes32)')))
    expect(PROCESS_ID_TOPIC).toBe(keccak256(toHex('ProcessId(bytes32)')))
    const mailbox = hyperlaneChain(ETN)?.mailbox ?? ('0x' as Hex)
    const id = `0x${'ab'.repeat(32)}`
    const logs = [
      { address: USDC_ETN, topics: [DISPATCH_ID_TOPIC, `0x${'11'.repeat(32)}`] }, // a token log with a lookalike topic
      { address: mailbox.toLowerCase(), topics: [DISPATCH_ID_TOPIC, id] },
    ]
    expect(dispatchIdFrom(logs, mailbox)).toBe(id)
    expect(dispatchIdFrom([{ address: mailbox, topics: [PROCESS_ID_TOPIC, id] }], mailbox)).toBeNull()
    expect(dispatchIdFrom([], mailbox)).toBeNull()
  })

  it('verifies by standard: synthetic needs the mailbox and the enrolled domain; collateral also the wrapped token', () => {
    const synthetic = corridor(ETN, 8453, USDC_ETN)
    const collateral = corridor(1, ETN, USDC_ETH)
    if (!synthetic || !collateral) throw new Error('corridors missing')
    expect(verificationCalls(synthetic).map((c) => c.functionName)).toEqual(['mailbox', 'domains'])
    expect(verificationCalls(collateral).map((c) => c.functionName)).toEqual(['mailbox', 'domains', 'wrappedToken'])
    const mailbox = hyperlaneChain(ETN)?.mailbox ?? ''
    expect(verifyCorridor(synthetic, [{ ok: true, value: mailbox.toLowerCase() }, { ok: true, value: [1, 8453, 43114] }])).toEqual({ ok: true, reason: null })
    expect(verifyCorridor(synthetic, [{ ok: true, value: USDC_ETN }, { ok: true, value: [1, 8453] }]).reason).toMatch(/mailbox/)
    expect(verifyCorridor(synthetic, [{ ok: true, value: mailbox }, { ok: true, value: [1, 43114] }]).reason).toMatch(/domain/)
    expect(verifyCorridor(synthetic, [{ ok: false }, { ok: true, value: [8453] }]).ok).toBe(false)
    const ethMailbox = hyperlaneChain(1)?.mailbox ?? ''
    expect(verifyCorridor(collateral, [{ ok: true, value: ethMailbox }, { ok: true, value: [ETN, 8453, 43114] }, { ok: true, value: USDC_ETH.toLowerCase() }]).ok).toBe(true)
    expect(verifyCorridor(collateral, [{ ok: true, value: ethMailbox }, { ok: true, value: [ETN] }, { ok: true, value: '0xdAC17F958D2ee523a2206206994597C13D831ec7' }]).reason).toMatch(/wraps a different token/)
  })

  it('quotes an honest ETA: slower whenever Ethereum is a side', () => {
    expect(etaMinutes(ETN, 8453)).toBe(5)
    expect(etaMinutes(ETN, 1)).toBe(20)
    expect(etaMinutes(1, ETN)).toBe(20)
  })
})

function usdcLower(): string {
  return USDC_ETN.toLowerCase()
}
