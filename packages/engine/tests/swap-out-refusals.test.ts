/**
 * What an exact-output swap will not do (§8.6).
 *
 * A token that charges a fee when it moves cannot honour an exact output, and
 * the failure is the quiet kind: the number the router enforces is measured on
 * its own balance BEFORE the transfer out, so the tax is taken after the check
 * has already passed and the user is handed less than the amount they typed.
 * Exact-in survives this — it folds the tax into slippage and reports a smaller
 * "you receive", so the floor moves but the promise holds — and exact-out has
 * no equivalent room. So it refuses, and says which token and what to do
 * instead.
 *
 * Run against the mainnet addresses, because testnet ships no fee-on-transfer
 * detector and the refusal depends on one answering.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type Engine } from '../src'
import type { SwapQuoteView } from '../src/namespaces/swap'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ETN = 52014
const A = ELECTRONEUM_ADDRESSES[ETN]
const TAXED = '0x2222222222222222222222222222222222222222' as Hex
const WETN = A.wetn as Hex
const QUOTER = A.quoterV2 as Hex
const DETECTOR = A.feeOnTransferDetector as Hex

const LIST = { name: 'fixture', tokens: [{ chainId: ETN, address: TAXED, name: 'Taxed Token', symbol: 'TAX', decimals: 18 }] }
const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])
/** 3 % on the way in, which is what a tax token usually charges. */
const BUY_FEE_BPS = 300n

describe('an exact output a token cannot honour', () => {
  let rpc: MockRpc
  let engine: Engine
  let accountId: string

  const quote = async (arg: Record<string, unknown>): Promise<SwapQuoteView> => (await engine.host.invoke('swap', 'quote', { accountId, chainId: ETN, ...arg }, 'ui')) as SwapQuoteView

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: ETN })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    for (const a of [TAXED, WETN, QUOTER, DETECTOR, A.universalRouter as Hex, A.permit2 as Hex]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    rpc.state.calls.set(TAXED.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str('Taxed Token')
      if (sel === '0x95d89b41') return str('TAX')
      if (sel === '0x313ce567') return u(18n)
      return u(0n)
    })
    rpc.state.calls.set(WETN.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str('Wrapped ETN')
      if (sel === '0x95d89b41') return str('WETN')
      if (sel === '0x313ce567') return u(18n)
      return u(0n)
    })
    // The detector reports the tax only for the taxed token; anything else is clean.
    rpc.state.calls.set(DETECTOR.toLowerCase(), ({ data }) => {
      const token = `0x${data.slice(34, 74)}`.toLowerCase()
      const buy = token === TAXED.toLowerCase() ? BUY_FEE_BPS : 0n
      return encodeAbiParameters(parseAbiParameters('uint256, uint256'), [buy, 0n])
    })
    // One pool, quotable from either end at 1 WETN = 1 TAX.
    rpc.state.calls.set(QUOTER.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      const amount = BigInt(`0x${data.slice(10 + 64 * 2, 10 + 64 * 3)}`)
      const fee = Number(BigInt(`0x${data.slice(10 + 64 * 3, 10 + 64 * 4)}`))
      if (fee !== 3000) throw new Error('no pool')
      if (sel === '0xc6a5026a' || sel === '0xbd21704a') return encodeAbiParameters(parseAbiParameters('uint256, uint160, uint32, uint256'), [amount, 0n, 0, 90_000n])
      throw new Error('no route')
    })
    const fetchImpl: typeof fetch = async (input) => {
      if (String(input).includes('tokenlist.json')) return new Response(JSON.stringify(LIST), { status: 200, headers: { 'content-type': 'application/json' } })
      return new Response('not found', { status: 404 })
    }
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    accountId = created.accounts[0]?.id ?? ''
    const words = created.mnemonic.split(' ')
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(ETN, rpc.url)
    rpc.state.balances.set((created.accounts[0]?.address ?? '').toLowerCase(), 500n * 10n ** 18n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('refuses to promise an exact amount of a token that charges when it moves, and names it', async () => {
    const q = await quote({ tokenIn: 'native', tokenOut: TAXED, amountOut: '10', tradeType: 'exactOut' })
    expect(q.ok).toBe(false)
    expect(q.taxBips).toBe(Number(BUY_FEE_BPS))
    const said = q.problems.join(' ')
    expect(said).toMatch(/TAX charges a fee every time it moves/)
    expect(said).toMatch(/Set the amount you pay instead/)
  })

  /*
    The same pair, the same tax, the other direction: still allowed. Exact-in
    has somewhere to put a transfer tax — it widens slippage and shrinks the
    reported "you receive" — so refusing it too would take a working swap away
    on the strength of a problem it does not have.
  */
  it('still swaps the same token when the user fixes what they pay', async () => {
    const q = await quote({ tokenIn: 'native', tokenOut: TAXED, amountIn: '10' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.taxBips).toBe(Number(BUY_FEE_BPS))
    // The tax is in the figure, not just in the slippage: what lands is 3 % less.
    expect(BigInt(q.receiveRaw)).toBeLessThan(BigInt(q.amountOutRaw))
  })
})
