/**
 * What the fee-on-transfer detector decides (§8.6), through `swap.quote`.
 *
 * Two answers come out of one probe. A token the detector could not sell back
 * is refused outright — the swap in would succeed, the minimum received would
 * be honoured, and the user would simply never get out again. A token the
 * detector measured any fee on moves the wallet fee onto the input side,
 * because `PAY_PORTION` needs the router to custody the output and the hop from
 * that custody to the user is one more transfer, taken after `Payments.sweep`
 * has already checked its minimum against the router's own balance.
 *
 * The fixtures are the live measurements, not invented ones: PDY, CORE and
 * BUDDY are the taxed tokens the deployed detector was run against, and all
 * three report `feeTakenOnTransfer: false` — the flag is measured by moving an
 * eighth of a thousand-wei probe, which truncates to nothing at that size.
 * Keying the decision on that flag left PDY on the output-side plan, where its
 * swap reverts with `TRANSFER_FAILED` after promising the user 3.05e25.
 *
 * Mainnet for all of it, because it depends on a detector answering and on
 * there being a fee to move; the testnet block at the end is the other half of
 * that, a chain with a detector and no fee recipient at all.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { encodeSwap } from '@boltvault/electroswap'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, maxUint256, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type Engine } from '../src'
import type { SwapQuoteView } from '../src/namespaces/swap'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ETN = 52014
const TESTNET = 5201420

/**
 * One token per answer the detector can give, so a case never has to reach in
 * and change what a token is between quotes.
 *
 *  - HONEY a 3 % token that cannot be sold back at all.
 *  - PDY   as measured live: fees both ways, and a plain transfer that reverted.
 *  - CORE  as measured live: fees both ways, nothing refused.
 *  - BUDDY as measured live: a fee only on the way out, and none on the way in.
 *  - CLEAN measured, and measured at nothing: an ordinary token.
 *  - MUTE  a token the probe could not measure.
 */
const HONEY = '0x2222222222222222222222222222222222222222' as Hex
const PDY = '0x3333333333333333333333333333333333333333' as Hex
const CORE = '0x4444444444444444444444444444444444444444' as Hex
const BUDDY = '0x5555555555555555555555555555555555555555' as Hex
const CLEAN = '0x6666666666666666666666666666666666666666' as Hex
const MUTE = '0x7777777777777777777777777777777777777777' as Hex

/** `ProbeStatus`: 0 measured, 1 no pair, 2 pair too thin, 3 the probe reverted. */
interface Report {
  readonly status: number
  readonly buyFeeBps: bigint
  readonly sellFeeBps: bigint
  readonly sellReverted: boolean
  readonly externalTransferFailed: boolean
  readonly feeTakenOnTransfer: boolean
}
const measured = (over: Partial<Report>): Report => ({ status: 0, buyFeeBps: 0n, sellFeeBps: 0n, sellReverted: false, externalTransferFailed: false, feeTakenOnTransfer: false, ...over })
const REPORTS: Record<string, Report> = {
  [HONEY.toLowerCase()]: measured({ buyFeeBps: 300n, sellFeeBps: 300n, sellReverted: true, externalTransferFailed: true }),
  [PDY.toLowerCase()]: measured({ buyFeeBps: 400n, sellFeeBps: 396n, externalTransferFailed: true }),
  [CORE.toLowerCase()]: measured({ buyFeeBps: 150n, sellFeeBps: 720n }),
  [BUDDY.toLowerCase()]: measured({ buyFeeBps: 0n, sellFeeBps: 400n }),
  [CLEAN.toLowerCase()]: measured({}),
  // `PairTooThin` — an ordinary return value, with zeroes behind it that are not a measurement.
  [MUTE.toLowerCase()]: measured({ status: 2 }),
}
const META: Record<string, { name: string; symbol: string }> = {
  [HONEY.toLowerCase()]: { name: 'Honey Pot', symbol: 'HONEY' },
  [PDY.toLowerCase()]: { name: 'Payday', symbol: 'PDY' },
  [CORE.toLowerCase()]: { name: 'Core', symbol: 'CORE' },
  [BUDDY.toLowerCase()]: { name: 'Buddy', symbol: 'BUDDY' },
  [CLEAN.toLowerCase()]: { name: 'Ordinary Token', symbol: 'CLEAN' },
  [MUTE.toLowerCase()]: { name: 'Unmeasurable', symbol: 'MUTE' },
}
const TOKENS = [HONEY, PDY, CORE, BUDDY, CLEAN, MUTE]

const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])
/** What each token charges on the way in, which is all the quote's tax slippage reads. */
const BUY_BPS: Record<string, number> = { [HONEY]: 300, [PDY]: 400, [CORE]: 150, [BUDDY]: 0, [CLEAN]: 0, [MUTE]: 0 }
/** Tier 0 on mainnet — Static, in `packages/chains/fees.json`. */
const MAINNET_BIPS = 50n
/** Mainnet's addresses, for the one case that re-runs the encoder outside the engine. */
const MAINNET = ELECTRONEUM_ADDRESSES[ETN]
/** Anybody: the encoder's recipient does not enter the floor it writes. */
const ANYONE = '0x9999999999999999999999999999999999999999' as Hex

interface Harness {
  readonly rpc: MockRpc
  readonly engine: Engine
  readonly quote: (arg: Record<string, unknown>) => Promise<SwapQuoteView>
  readonly close: () => Promise<void>
}

/**
 * An engine on a mock chain that prices any pair at 1 : 2 through the 0.3 %
 * V3 pool, and answers the detector from `REPORTS`.
 *
 * The price is deliberately not 1 : 1: the wallet fee is a percentage of one
 * side or the other, and at parity the two are the same number, so a test
 * could not tell which side it had been taken from.
 */
async function boot(chainId: 52014 | 5201420): Promise<Harness> {
  resetMulticallCache()
  const A = ELECTRONEUM_ADDRESSES[chainId]
  const WETN = A.wetn as Hex
  const QUOTER = A.quoterV2 as Hex
  const DETECTOR = A.feeOnTransferDetector as Hex
  const rpc = await startMockRpc({ chainId })
  rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
  for (const a of [...TOKENS, WETN, QUOTER, DETECTOR, A.universalRouter as Hex, A.permit2 as Hex]) rpc.state.code.set(a.toLowerCase(), '0x6080')
  for (const token of TOKENS) {
    const meta = META[token.toLowerCase()] ?? { name: '', symbol: '' }
    rpc.state.calls.set(token.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str(meta.name)
      if (sel === '0x95d89b41') return str(meta.symbol)
      if (sel === '0x313ce567') return u(18n)
      // Enough of it, and Permit2 already allowed, so the only problems are the ones under test.
      if (sel === '0x70a08231') return u(500n * 10n ** 18n)
      if (sel === '0xdd62ed3e') return u(maxUint256)
      return u(0n)
    })
  }
  rpc.state.calls.set(WETN.toLowerCase(), ({ data }) => {
    const sel = data.slice(0, 10)
    if (sel === '0x06fdde03') return str('Wrapped ETN')
    if (sel === '0x95d89b41') return str('WETN')
    if (sel === '0x313ce567') return u(18n)
    return u(0n)
  })
  rpc.state.calls.set((A.permit2 as Hex).toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint160, uint48, uint48'), [maxUint256 >> 96n, 2_000_000_000, 0]))
  // FeeOnTransferDetectorV2's `inspect`: the status first, so "could not measure" is a value rather than a revert.
  rpc.state.calls.set(DETECTOR.toLowerCase(), ({ data }) => {
    const token = `0x${data.slice(34, 74)}`.toLowerCase()
    const r = REPORTS[token] ?? measured({})
    return encodeAbiParameters(parseAbiParameters('uint8, uint256, uint256, bool, bool, bool'), [r.status, r.buyFeeBps, r.sellFeeBps, r.sellReverted, r.externalTransferFailed, r.feeTakenOnTransfer])
  })
  // One pool per pair, at the 0.3 % tier, quoting two units out for every one in.
  rpc.state.calls.set(QUOTER.toLowerCase(), ({ data }) => {
    const sel = data.slice(0, 10)
    const amount = BigInt(`0x${data.slice(10 + 64 * 2, 10 + 64 * 3)}`)
    const fee = Number(BigInt(`0x${data.slice(10 + 64 * 3, 10 + 64 * 4)}`))
    if (fee !== 3000) throw new Error('no pool')
    if (sel === '0xc6a5026a') return encodeAbiParameters(parseAbiParameters('uint256, uint160, uint32, uint256'), [amount * 2n, 0n, 0, 90_000n])
    throw new Error('no route')
  })
  const list = { name: 'fixture', tokens: TOKENS.map((address) => ({ chainId, address, name: META[address.toLowerCase()]?.name ?? '', symbol: META[address.toLowerCase()]?.symbol ?? '', decimals: 18 })) }
  const fetchImpl: typeof fetch = async (input) => {
    if (String(input).includes('tokenlist.json')) return new Response(JSON.stringify(list), { status: 200, headers: { 'content-type': 'application/json' } })
    return new Response('not found', { status: 404 })
  }
  const engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
  await engine.ready
  const created = await engine.engine.vault.create({ password: PASSWORD })
  const accountId = created.accounts[0]?.id ?? ''
  const words = created.mnemonic.split(' ')
  const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
  await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
  await engine.chains.setRpc(chainId, rpc.url)
  rpc.state.balances.set((created.accounts[0]?.address ?? '').toLowerCase(), 500n * 10n ** 18n)
  return {
    rpc,
    engine,
    quote: async (arg) => (await engine.host.invoke('swap', 'quote', { accountId, chainId, ...arg }, 'ui')) as SwapQuoteView,
    close: async () => {
      engine.dispose()
      await rpc.close()
    },
  }
}

describe('a token the detector could not sell back', () => {
  let h: Harness
  beforeAll(async () => {
    h = await boot(ETN)
  })
  afterAll(async () => {
    await h.close()
  })

  /*
    The honeypot, refused at the quote rather than described in it.

    Nothing downstream can protect this user: the swap in succeeds, the minimum
    received is honoured, and the position is stuck for good. The detector this
    replaced could not report it at all — it caught the failing sell and echoed
    `buyFeeBps`, so a token nobody could sell came back looking like an ordinary
    3 % one. HONEY charges exactly that 3 %, so the flag is the whole difference
    between this case and the tradeable tokens below.
  */
  it('is not bought for the user, whatever its fee looks like', async () => {
    const q = await h.quote({ tokenIn: 'native', tokenOut: HONEY, amountIn: '10' })
    expect(q.ok).toBe(false)
    expect(q.taxBips).toBe(BUY_BPS[HONEY])
    const said = q.problems.join(' ')
    expect(said).toMatch(/HONEY cannot be sold back/)
    expect(said).toMatch(/BoltVault will not buy it for you/)
  })

  /*
    And the other direction, where the refusal is about the chain rather than
    the user: a token that reverts when it is sold cannot be the input to a
    swap. Quoting it would put a sheet in front of somebody for a transaction
    that can only fail, after two signatures and the gas to find out.
  */
  it('is not sold for them either, because that swap cannot succeed', async () => {
    const q = await h.quote({ tokenIn: HONEY, tokenOut: 'native', amountIn: '10' })
    expect(q.ok).toBe(false)
    const said = q.problems.join(' ')
    expect(said).toMatch(/HONEY refuses to be sold/)
    expect(said).toMatch(/would fail on chain/)
  })
})

describe('which side of the trade the wallet fee comes out of', () => {
  let h: Harness
  beforeAll(async () => {
    h = await boot(ETN)
  })
  afterAll(async () => {
    await h.close()
  })

  /*
    PDY, the token that settled which predicate this is.

    Live, against the deployed detector, it reports `feeTakenOnTransfer: false`
    and `externalTransferFailed: true` — the flag is measured by moving an
    eighth of a thousand wei, and for PDY that transfer reverted, so there was
    no shortfall to see. Keyed on the flag, PDY took the output-side plan and
    the swap reverted `TRANSFER_FAILED` after promising 30571555458945903417624358.
    Keyed on the measurement, it takes the input-side plan and delivers.
  */
  it('comes out of the input for a token whose plain transfers were refused', async () => {
    const q = await h.quote({ tokenIn: 'native', tokenOut: PDY, amountIn: '10' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.taxBips).toBe(BUY_BPS[PDY])
    expect(q.fee.onInput).toBe(true)
    expect(q.fee.bips).toBe(Number(MAINNET_BIPS))
    // Denominated in what the user is spending, which at this price is not the
    // same number as the old one: the pool pays two units out for every one in.
    expect(q.fee.amountRaw).toBe(((BigInt(q.amountInRaw) * MAINNET_BIPS) / 10_000n).toString())
    expect(q.fee.amountRaw).not.toBe(((BigInt(q.amountOutRaw) * MAINNET_BIPS) / 10_000n).toString())
    /*
      And the fee is not deducted again from what lands.

      The fee came off before the pools were asked, so the whole swap output is
      the user's, less the token's own transfer tax. Subtracting the fee here as
      well would under-report what they receive by the fee twice over.
    */
    const afterTax = (BigInt(q.amountOutRaw) * BigInt(10_000 - BUY_BPS[PDY]!)) / 10_000n
    expect(q.receiveRaw).toBe(afterTax.toString())
    const twice = (afterTax * (10_000n - MAINNET_BIPS)) / 10_000n
    expect(BigInt(q.receiveRaw)).toBeGreaterThan(twice)
  })

  /*
    CORE and BUDDY are the other two live shapes, and neither has a flag set.

    Both report `feeTakenOnTransfer: false` and `externalTransferFailed: false`
    — the reading that used to mean "taxed only against its pair, so the
    router's hop is free". It is not a reading the detector can support at a
    thousand-wei probe: a measured fee is a measured fee, and the router's hop
    is one more transfer of a token that charges for transfers.

    BUDDY is the sharper half. Its fee is entirely on the way out, so a purchase
    of it carries no tax slippage at all — `taxBips` is zero, and the fee still
    has to leave the custody path.
  */
  it('comes out of the input for any token the detector measured a fee on, flags or no flags', async () => {
    for (const token of [CORE, BUDDY]) {
      const q = await h.quote({ tokenIn: 'native', tokenOut: token, amountIn: '10' })
      const symbol = META[token.toLowerCase()]?.symbol ?? ''
      expect(q.ok, q.problems.join(' ')).toBe(true)
      expect(q.fee.onInput, symbol).toBe(true)
      expect(q.fee.amountRaw, symbol).toBe(((BigInt(q.amountInRaw) * MAINNET_BIPS) / 10_000n).toString())
      expect(q.receiveRaw, symbol).toBe(((BigInt(q.amountOutRaw) * BigInt(10_000 - BUY_BPS[token]!)) / 10_000n).toString())
    }
    // And the one with no fee on the way in is quoted with no tax slippage at all.
    const buddy = await h.quote({ tokenIn: 'native', tokenOut: BUDDY, amountIn: '10' })
    expect(buddy.taxBips).toBe(0)
    expect(buddy.receiveRaw).toBe(buddy.amountOutRaw)
  })

  /*
    A token measured at nothing keeps the shape every ordinary swap has.

    This is the case that keeps the change narrow: the input-side plan is for
    tokens the detector found something on, and a clean measurement is a
    finding, not an absence.
  */
  it('stays on the output for a token the detector measured no fee on', async () => {
    const q = await h.quote({ tokenIn: 'native', tokenOut: CLEAN, amountIn: '10' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.taxBips).toBe(0)
    expect(q.taxUnknown).toBe(false)
    expect(q.fee.onInput).toBe(false)
    expect(q.fee.amountRaw).toBe(((BigInt(q.amountOutRaw) * MAINNET_BIPS) / 10_000n).toString())
    expect(q.receiveRaw).toBe((BigInt(q.amountOutRaw) - (BigInt(q.amountOutRaw) * MAINNET_BIPS) / 10_000n).toString())
  })

  /*
    A probe that could not answer is not evidence of anything.

    `PairTooThin` comes back as a status with zeroes behind it, and reading
    those zeroes either way would be a decision made on no measurement. It is
    the one case that looks like CLEAN in the numbers and must not be treated
    like it — which is why `custodyIsUnsafe` reads the probe and not the fees.
  */
  it('leaves the fee where it was when the probe could not measure the token', async () => {
    const q = await h.quote({ tokenIn: 'native', tokenOut: MUTE, amountIn: '10' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.taxUnknown).toBe(true)
    expect(q.taxBips).toBe(0)
    expect(q.fee.onInput).toBe(false)
    expect(q.fee.amountRaw).toBe(((BigInt(q.amountOutRaw) * MAINNET_BIPS) / 10_000n).toString())
  })

  /*
    The floor on the screen is the floor in the bytes — asserted against the
    encoder rather than against a second copy of its arithmetic.

    `deliveredMinimumOut` exists because the two had drifted apart once before:
    the screen computed fee-then-slippage while the router enforces
    slippage-then-fee, and the sheet promised a few wei more than the calldata
    guaranteed. Restating the formula here would only move the place they can
    drift, so this runs the real encoder with the arguments `swap.execute` hands
    it and compares the number it writes.

    Two things have to line up for that to hold with the fee on the input: there
    is no portion taken out of the output, so nothing is deducted from the floor
    — and only `amountIn − fee` reaches the pools, so the quote it is derived
    from is scaled by the same proportion. Miss the second and the floor is one
    tier's bips too high, which at 50 bips of tier and 50 bips of slippage is a
    swap that reverts on any ordinary movement.
  */
  it('reports the minimum the encoder will actually write', async () => {
    const q = await h.quote({ tokenIn: 'native', tokenOut: PDY, amountIn: '10' })
    expect(q.fee.onInput).toBe(true)
    const enc = encodeSwap({
      route: { hops: q.route.hops.map((hop) => (hop.kind === 'v3' ? { kind: 'v3' as const, tokenIn: hop.tokenIn as Hex, tokenOut: hop.tokenOut as Hex, fee: hop.fee ?? 3000 } : { kind: 'v2' as const, tokenIn: hop.tokenIn as Hex, tokenOut: hop.tokenOut as Hex })) },
      amountIn: BigInt(q.amountInRaw),
      quotedOut: BigInt(q.amountOutRaw),
      slippageBips: q.slippageBips + q.taxBips,
      nativeIn: true,
      nativeOut: false,
      wrappedNative: MAINNET.wetn as Hex,
      recipient: ANYONE,
      fee: { sink: q.fee.sink as Hex, bips: q.fee.bips },
      feeOnInput: true,
      deadline: 1n,
      universalRouter: MAINNET.universalRouter as Hex,
    })
    expect(q.minimumOutRaw).toBe(enc.minimumOut.toString())
  })
})

/*
  Testnet: a detector, and no fee recipient for it to move.

  `fees.json` names no recipient for 5201420, so `bips` is zero there and swaps
  are free rather than off (mainnet without a recipient is off — that is the
  gate). A zero-bips tier has no fee to take from either side, and the
  input-side plan must not be armed for one: `PAY_PORTION` reverts on zero bips,
  and a transfer of nothing to a null sink is the same mistake in the other
  direction.
*/
describe('a chain with a detector but no fee', () => {
  let h: Harness
  beforeAll(async () => {
    h = await boot(TESTNET)
  })
  afterAll(async () => {
    await h.close()
  })

  it('takes no fee from either side of a token the detector measured a fee on', async () => {
    const q = await h.quote({ tokenIn: 'native', tokenOut: PDY, amountIn: '10' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.fee.sink).toBeNull()
    expect(q.fee.bips).toBe(0)
    expect(q.fee.onInput).toBe(false)
    expect(q.fee.amountRaw).toBe('0')
    // The tax is still measured and still priced in; only the wallet's own cut is absent.
    expect(q.taxBips).toBe(BUY_BPS[PDY])
    expect(q.receiveRaw).toBe(((BigInt(q.amountOutRaw) * BigInt(10_000 - BUY_BPS[PDY]!)) / 10_000n).toString())
  })
})
