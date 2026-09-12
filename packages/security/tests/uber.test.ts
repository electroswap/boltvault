/**
 * The firewall reads the M6 calls (§8.8–8.10): farm deposit / withdraw /
 * collect, launchpad contribute / claim, Seaport fulfil / cancel, Legends
 * dividends register / claim, and a mint — each with a statement in the
 * closed verb set and no "unknown function" warning on a known contract.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { encodeFunctionData, parseAbi, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { DIVIDENDS_ABI, FARM_ABI, LAUNCHPAD_ABI, MINTER_ABI, SEAPORT_ABI } from '../src/abis'
import { assess, emptyContext } from '../src/assess'
import { decodeCalldata } from '../src/decode'
import type { SignRequest } from '../src/types'

const A = ELECTRONEUM_ADDRESSES[52014]
const ME = '0x3333333333333333333333333333333333333333' as Hex
const OTHER = '0x4444444444444444444444444444444444444444' as Hex
const POOL = '0x9999999999999999999999999999999999999999' as Hex
const PREVIOUS = '0x5555555555555555555555555555555555555555' as Hex
const tx = (to: Hex, data: Hex, value = 0n): SignRequest => ({ kind: 'transaction', tx: { from: ME, to, data, value, chainId: 52014 } })
const run = (r: SignRequest) => assess({ origin: 'internal:farm', chainId: 52014, account: ME, request: r, context: emptyContext({ tokens: { [A.bolt!.toLowerCase()]: { symbol: 'BOLT', decimals: 18 } }, boltToken: A.bolt as Hex }) })

describe('farm', () => {
  it('deposit with native ETN and a BOLT boost', () => {
    const data = encodeFunctionData({ abi: FARM_ABI, functionName: 'deposit', args: [3n, 0n, 1_000_000n, 50_000n * 10n ** 18n] })
    const d = decodeCalldata({ chainId: 52014, to: A.yieldFarm as Hex, data, value: 10n ** 18n })
    expect(d.kind).toBe('farm_deposit')
    const a = run(tx(A.yieldFarm as Hex, data, 10n ** 18n))
    expect(a.statements[0]?.text).toBe('Deposit into farm #3 with 1 ETN and 50000 BOLT as boost')
    expect(a.rules.map((r) => r.code)).not.toContain('UNKNOWN_FUNCTION')
  })
  it('collect is withdraw(id, 0) and reads as Collect', () => {
    const data = encodeFunctionData({ abi: FARM_ABI, functionName: 'withdraw', args: [3n, 0n, true] })
    expect(run(tx(A.yieldFarm as Hex, data)).statements[0]?.text).toBe('Collect rewards and fees from farm #3')
    const w = encodeFunctionData({ abi: FARM_ABI, functionName: 'withdraw', args: [3n, 500n, false] })
    expect(run(tx(A.yieldFarm as Hex, w)).statements[0]?.text).toMatch(/^Withdraw 500 liquidity units from farm #3/)
  })
})

describe('launchpad', () => {
  it('contribute on any pool, claims, and referral rewards on the affiliate contract', () => {
    const c = encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: 'contribute', args: [OTHER] })
    const a = run(tx(POOL, c, 5n * 10n ** 18n))
    expect(a.statements[0]?.text).toMatch(/^Contribute 5 ETN to the campaign at/)
    expect(run(tx(POOL, encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: 'claimTokens', args: [ME] }))).statements[0]?.text).toMatch(/^Claim your tokens/)
    expect(run(tx(POOL, encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: 'claimRefund', args: [ME] }))).statements[0]?.text).toMatch(/^Claim your refund/)
    expect(run(tx(A.launchpadAffiliate as Hex, encodeFunctionData({ abi: LAUNCHPAD_ABI, functionName: 'claimReferralRewards' }))).statements[0]?.text).toBe('Claim your referral rewards')
  })
})

describe('marketplace', () => {
  const item = (itemType: number, token: Hex, id: bigint, amount: bigint) => ({ itemType, token, identifierOrCriteria: id, startAmount: amount, endAmount: amount })
  const price = 4_200_000_000_000_000_000n
  const fee = (price * 300n) / 10_000n
  const listing = {
    offerer: OTHER,
    zone: '0x0000000000000000000000000000000000000000' as Hex,
    offer: [item(2, A.electricLegends as Hex, 12n, 1n)],
    consideration: [{ ...item(0, '0x0000000000000000000000000000000000000000' as Hex, 0n, price - fee), recipient: OTHER }, { ...item(0, '0x0000000000000000000000000000000000000000' as Hex, 0n, fee), recipient: A.nftFeeReceiver as Hex }],
    orderType: 1,
    startTime: 1n,
    endTime: 2n,
    zoneHash: `0x${'00'.repeat(32)}` as Hex,
    salt: 1n,
    conduitKey: A.seaportConduitKey as Hex,
    totalOriginalConsiderationItems: 2n,
  }
  it('buying a listing states the price with the fee inside it', () => {
    const data = encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillOrder', args: [{ parameters: listing, signature: '0x' }, `0x${'00'.repeat(32)}` as Hex] })
    const a = run(tx(A.seaport15 as Hex, data, price))
    expect(a.statements[0]?.text).toBe('Buy Electric Legends #12 for 4.2 ETN')
    expect(a.statements[1]?.text).toMatch(/3% marketplace fee/)
  })
  it('accepting an offer states what you receive after fees', () => {
    const bid = { ...listing, offerer: OTHER, offer: [item(1, A.wetn as Hex, 0n, price)], consideration: [{ ...item(1, A.wetn as Hex, 0n, price - fee), recipient: ME }, { ...item(1, A.wetn as Hex, 0n, fee), recipient: A.nftFeeReceiver as Hex }, { ...item(2, A.electricLegends as Hex, 12n, 1n), recipient: OTHER }], totalOriginalConsiderationItems: 3n }
    const data = encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillOrder', args: [{ parameters: bid, signature: '0x' }, `0x${'00'.repeat(32)}` as Hex] })
    const a = run(tx(A.seaport15 as Hex, data))
    expect(a.statements[0]?.text).toBe('Sell Electric Legends #12 for 4.2 WETN')
    expect(a.statements[1]?.text).toMatch(/^You receive 4.074 WETN/)
  })
  /*
    ES-BV-001: a bid names the owner-at-bid-time as the seller recipient and
    stays valid after the piece is resold, so the new owner's inbox can hold a
    bid that takes the piece and pays the person they bought it from.
  */
  it('a bid whose proceeds pay someone else is blocked and never claims receipt', () => {
    const stale = { ...listing, offerer: OTHER, offer: [item(1, A.wetn as Hex, 0n, price)], consideration: [{ ...item(1, A.wetn as Hex, 0n, price - fee), recipient: PREVIOUS }, { ...item(1, A.wetn as Hex, 0n, fee), recipient: A.nftFeeReceiver as Hex }, { ...item(2, A.electricLegends as Hex, 12n, 1n), recipient: OTHER }], totalOriginalConsiderationItems: 3n }
    const data = encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillOrder', args: [{ parameters: stale, signature: '0x' }, `0x${'00'.repeat(32)}` as Hex] })
    const a = run(tx(A.seaport15 as Hex, data))
    expect(a.rules.map((r) => r.code)).toContain('SEAPORT_PROCEEDS_NOT_SELF')
    expect(a.presentation.blocked).toBe(true)
    expect(a.statements.map((s) => s.text).join(' ')).not.toMatch(/You receive/)
    expect(a.statements[1]?.text).toContain(PREVIOUS)
  })
  it('buying does not raise the proceeds rule — the consideration is the price', () => {
    const data = encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'fulfillOrder', args: [{ parameters: listing, signature: '0x' }, `0x${'00'.repeat(32)}` as Hex] })
    expect(run(tx(A.seaport15 as Hex, data, price)).rules.map((r) => r.code)).not.toContain('SEAPORT_PROCEEDS_NOT_SELF')
  })
  it('cancel, dividends and mint', () => {
    const cancel = encodeFunctionData({ abi: SEAPORT_ABI, functionName: 'cancel', args: [[{ ...listing, counter: 0n }]] })
    expect(run(tx(A.seaport15 as Hex, cancel)).statements[0]?.text).toBe('Cancel your marketplace order')
    expect(run(tx(A.dividendDistributor as Hex, encodeFunctionData({ abi: DIVIDENDS_ABI, functionName: 'register', args: [[1n, 2n]] }))).statements[0]?.text).toBe('Activate dividends for 2 Electric Legends')
    expect(run(tx(A.dividendDistributor as Hex, encodeFunctionData({ abi: DIVIDENDS_ABI, functionName: 'claimDividends', args: [[1n]] }))).statements[0]?.text).toBe('Claim marketplace dividends for 1 Electric Legend')
    const mint = encodeFunctionData({ abi: MINTER_ABI, functionName: 'mint', args: [A.electricLegends as Hex, 2n] })
    expect(run(tx(A.nftMinter as Hex, mint, 2n * 10n ** 18n)).statements[0]?.text).toBe('Mint 2 from Electric Legends for 2 ETN')
    expect(typeof parseAbi).toBe('function')
  })
})
