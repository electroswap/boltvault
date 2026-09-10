/**
 * What the wallet actually asks the world for, per minute.
 *
 * Not a pass/fail assertion — a measurement, printed. Sitting on Home with
 * "All chains" in scope is the heaviest thing the wallet does, and this is the
 * number that says whether the cadence work holds: which hosts are asked, how
 * often, and whether any of them refuse. Skipped with SKIP_LIVE=1; the address
 * is public and no key is involved.
 *
 * Run 2026-09-09 against a deliberately extreme wallet (159 held tokens across
 * four chains): 113 requests a minute over 14 hosts, the busiest single host at
 * 29/min, no RPC refusals.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { DEFAULT_PORTFOLIO_CHAIN_IDS, pollMs } from '@boltvault/chains'
import { describe, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const SKIP = process.env['SKIP_LIVE'] === '1'
const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const WATCH = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
const SECONDS = 90

describe.skipIf(SKIP)('what the wallet actually asks for, per minute (live)', () => {
  it('sits on Home with All chains in scope', async () => {
    const byHost = new Map<string, { n: number; bad: number }>()
    // Patch the global: JSON-RPC deliberately does not go through `deps.fetch`.
    const real = globalThis.fetch
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url)
      const host = new URL(url).host
      const e = byHost.get(host) ?? { n: 0, bad: 0 }
      e.n += 1
      byHost.set(host, e)
      const res = await real(input as RequestInfo, init)
      if (!res.ok) e.bad += 1
      return res
    }) as typeof fetch
    // The memory platform's clock is frozen unless advanced, which would make
    // every cache hit forever and every debounce hold. Real time, real cadence.
    const platform = { ...createMemoryPlatform(), now: () => Date.now() }
    const engine: Engine = createEngine({ platform, kdf: KDF, electroswapUrl: null })
    await engine.ready
    await engine.engine.vault.create({ password: PASSWORD })
    const watch = await engine.engine.accounts.addWatch({ address: WATCH, label: 'probe' })
    const scope = [...DEFAULT_PORTFOLIO_CHAIN_IDS]

    // Home, with All chains: the head poller for the home chain, and a
    // portfolio ask on every head — exactly what usePortfolio does.
    const home = 52014
    const timer = setInterval(() => {
      void engine.engine.chains.head({ chainId: home }).then(
        () => engine.engine.portfolio.snapshot({ accountId: watch.id, chainIds: scope }).catch(() => undefined),
        () => undefined,
      )
    }, pollMs(home, 'foreground'))

    await new Promise((r) => setTimeout(r, SECONDS * 1_000))
    clearInterval(timer)

    const rows = [...byHost].sort((a, b) => b[1].n - a[1].n)
    const total = rows.reduce((s, [, v]) => s + v.n, 0)
    const bad = rows.reduce((s, [, v]) => s + v.bad, 0)
    console.log(`\n=== ${SECONDS}s on Home, All chains (${scope.length} chains) ===`)
    for (const [host, v] of rows) console.log(`   ${host.padEnd(40)} ${String(v.n).padStart(4)} reqs  ${(v.n / (SECONDS / 60)).toFixed(1)}/min${v.bad ? `  BAD=${v.bad}` : ''}`)
    console.log(`   ${'TOTAL'.padEnd(40)} ${String(total).padStart(4)} reqs  ${(total / (SECONDS / 60)).toFixed(1)}/min  failures=${bad}`)
    engine.dispose()
    globalThis.fetch = real
  }, 240_000)
})
