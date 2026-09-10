/**
 * Prices through ElectroSwap's own proxy (§9.4), against a running API.
 *
 * The proxy answers `/api/wallet/prices/networks/:network/tokens/multi/:addrs`
 * in GeckoTerminal's exact shape on purpose, so adopting it is a base URL and
 * a header rather than a second client. This asserts the two things that could
 * silently go wrong: that every price request carries the wallet key (without
 * it the API answers 401 and the wallet quietly falls back), and that none of
 * them reach the public feed once a key is configured.
 *
 * Opt in with a running API and a key — neither is in this repo:
 *   BV_API=http://localhost:3005 BV_KEY=… pnpm --filter @boltvault/engine test
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { describe, it, expect } from 'vitest'
import { createEngine, type Engine } from '../src'

const KDF = { m: 8 * 1024, t: 1, p: 1 }
const WATCH = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const API = process.env['BV_API'] ?? ''
const KEY = process.env['BV_KEY'] ?? ''

describe.skipIf(!API || !KEY)('prices through the ElectroSwap proxy (live, local API)', () => {
  it('routes the price client at our own API and prices real rows', async () => {
    const seen: string[] = []
    const real = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url)
      if (url.includes('/prices/') || url.includes('geckoterminal')) {
        const hdrs = new Headers(init?.headers as HeadersInit)
        seen.push(`${new URL(url).host}${hdrs.has('x-boltvault-key') ? ' +key' : ' NO-KEY'}`)
      }
      return real(input as RequestInfo, init)
    }) as typeof fetch

    const platform = { ...createMemoryPlatform(), now: () => Date.now() }
    const engine: Engine = createEngine({ platform, kdf: KDF, electroswapUrl: null, apiOrigin: API, clientKey: KEY })
    await engine.ready
    await engine.engine.vault.create({ password: 'correct horse battery staple 42' })
    const watch = await engine.engine.accounts.addWatch({ address: WATCH, label: 'probe' })
    const snap = await engine.engine.portfolio.refresh({ accountId: watch.id, chainIds: [1] })
    console.log(`\nprice requests: ${JSON.stringify(seen)}`)
    console.log(`chain 1: total=${snap.total} unpriced=${snap.unpricedCount} of ${snap.rows.length} rows`)
    for (const r of snap.rows.slice(0, 4)) console.log(`   ${r.symbol.padEnd(8)} fiat=${String(r.fiat).slice(0, 10).padEnd(10)} logo=${(r.logoUri ?? '-').slice(0, 52)}`)
    // The native row has no list entry and so no logo of its own: if it has one
    // here, the proxy's `image_url` made it all the way through.
    const native = snap.rows.find((r) => r.address === 'native')
    console.log(`native logo via proxy: ${native?.logoUri ?? 'none'}`)
    engine.dispose()
    globalThis.fetch = real
    expect(seen.every((s) => s.includes('+key'))).toBe(true)
    expect(seen.some((s) => s.includes('geckoterminal'))).toBe(false)
    expect(native?.logoUri ?? '').toMatch(/^https?:\/\//)
  }, 120_000)
})
