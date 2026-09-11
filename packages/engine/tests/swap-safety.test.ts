/**
 * The safety level used to be decoration. ElectroSwap marks a token
 * `BLOCKED`, the Explore row drew a warning icon, and the swap path never
 * looked — so the token swapped exactly like any other. The gate belongs in
 * the engine, not the screen, because the screen is not the only way in.
 *
 * Each case uses its own token, because the detail lookup is cached by
 * (chainId, address) and a shared address would answer from the first case.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const TESTNET = 5201420
const WETN = '0x154c9fD7F006b92b6afa746098d8081A831DC1FC' as Hex
const PERMIT2 = '0xDD07Fe6922d1Aab4fe98C6533fa19037159500E7' as Hex
const DYNO = '0x162D5a58096b63D89D83e0C66b4731A6CC8b10aF' as Hex
const GRAPHQL = 'https://api.test/graphql'

/** symbol -> [address, what the API says about it]. */
const TOKENS = [
  { address: '0x1111111111111111111111111111111111111111' as Hex, symbol: 'BAD', safety: 'BLOCKED' },
  { address: '0x2222222222222222222222222222222222222222' as Hex, symbol: 'GOOD', safety: 'VERIFIED' },
  { address: '0x3333333333333333333333333333333333333333' as Hex, symbol: 'MEH', safety: 'MEDIUM_WARNING' },
  { address: '0x4444444444444444444444444444444444444444' as Hex, symbol: 'NEW', safety: null },
]

const LIST = { name: 'fixture', tokens: TOKENS.map((t) => ({ chainId: TESTNET, address: t.address, name: `${t.symbol} Token`, symbol: t.symbol, decimals: 6 })) }
const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

describe('the token safety level is a gate, not a label', () => {
  let rpc: MockRpc
  let engine: Engine
  let accountId = ''

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: TESTNET })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    for (const a of [WETN, PERMIT2, DYNO, ...TOKENS.map((t) => t.address)]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    for (const t of TOKENS) {
      rpc.state.calls.set(t.address.toLowerCase(), ({ data }) => {
        const sel = data.slice(0, 10)
        if (sel === '0x06fdde03') return str(`${t.symbol} Token`)
        if (sel === '0x95d89b41') return str(t.symbol)
        if (sel === '0x313ce567') return u(6n)
        if (sel === '0x70a08231') return u(12_500_000n)
        if (sel === '0xdd62ed3e') return u(0n)
        return '0x'
      })
    }
    rpc.state.calls.set(WETN.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str('Wrapped ETN')
      if (sel === '0x95d89b41') return str('WETN')
      if (sel === '0x313ce567') return u(18n)
      return u(0n)
    })
    rpc.state.calls.set(DYNO.toLowerCase(), () => u(0n))
    rpc.state.calls.set(PERMIT2.toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint160, uint48, uint48'), [0n, 0, 0]))

    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('tokenlist.json')) return new Response(JSON.stringify(LIST), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url === GRAPHQL) {
        const body = String((init as { body?: unknown } | undefined)?.body ?? '')
        const hit = TOKENS.find((t) => body.toLowerCase().includes(t.address.toLowerCase()))
        if (!body.includes('TokenDetail') || !hit) return new Response(JSON.stringify({ data: {} }), { status: 200, headers: { 'content-type': 'application/json' } })
        const token = { address: hit.address, symbol: hit.symbol, name: `${hit.symbol} Token`, decimals: 6, project: { safetyLevel: hit.safety } }
        return new Response(JSON.stringify({ data: { token } }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }

    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: GRAPHQL, pricesUrl: null, staticsUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    accountId = created.accounts[0]?.id ?? ''
    const words = created.mnemonic.split(' ')
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(TESTNET, rpc.url)
    rpc.state.balances.set((created.accounts[0]?.address ?? '').toLowerCase(), 5n * 10n ** 18n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  const quoteFor = (tokenIn: Hex) => engine.engine.swap.quote({ accountId, chainId: TESTNET, tokenIn, tokenOut: 'native', amountIn: '1' })
  const said = (problems: readonly string[]): string => problems.join(' ').toLowerCase()

  it('refuses to quote a blocked token, and says why in the user’s words', async () => {
    const q = await quoteFor(TOKENS[0]!.address)
    expect(q.ok).toBe(false)
    expect(q.problems.join(' ')).toContain('BAD')
    expect(said(q.problems)).toContain('unsafe')
  })

  it('refuses to execute it too, so the screen is not the only thing in the way', async () => {
    await expect(engine.engine.swap.execute({ accountId, chainId: TESTNET, tokenIn: TOKENS[0]!.address, tokenOut: 'native', amountIn: '1' })).rejects.toThrow()
  })

  it('lets every other rating through, including no rating at all', async () => {
    for (const t of TOKENS.slice(1)) {
      const q = await quoteFor(t.address)
      // Silence is not a refusal: an unrated token is not a blocked one, and an
      // API that cannot answer must not turn every token into a refusal.
      expect(said(q.problems), `${t.symbol} (${String(t.safety)})`).not.toContain('unsafe')
    }
  })
})
