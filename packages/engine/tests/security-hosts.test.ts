/**
 * `chains.hosts()` — the rate governor, surfaced.
 *
 * The governor already recorded `refused` when a host answered 401 or 403, and
 * nothing read it: a wallet whose key the API no longer honours simply failed
 * every call, silently, for fifteen minutes at a time. Settings › Networks is
 * where a user can act on that, so the snapshot comes out through the chains
 * namespace it belongs to.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const STATICS = 'https://static.electroswap.io/wallet'

function engineWith(fetchImpl: typeof fetch, staticsUrl: string | null = STATICS): Engine {
  return createEngine({ platform: createMemoryPlatform(), kdf: { m: 8 * 1024, t: 1, p: 1 }, fetch: fetchImpl, staticsUrl, electroswapUrl: null, pricesUrl: null })
}

describe('chains.hosts — what the governor thinks of the outside world', () => {
  let engine: Engine | null = null

  afterEach(() => {
    engine?.dispose()
    engine = null
  })

  it('has nothing to say about a wallet that has asked nobody anything', async () => {
    engine = engineWith(async () => new Response('{}', { status: 200 }), null)
    await engine.ready
    expect(await engine.engine.chains.hosts()).toEqual([])
  })

  it('reports a host that refused this wallet’s credentials, and clears it when one gets through', async () => {
    let status = 403
    engine = engineWith(async () => new Response('forbidden', { status }))
    await engine.ready
    await engine.statics.refresh().catch(() => undefined)

    const refused = (await engine.engine.chains.hosts()).find((h) => h.host === 'static.electroswap.io')
    expect(refused).toBeDefined()
    expect(refused?.refused).toBe(true)
    // A refusal is a long cooldown, not a retry loop: the host is unavailable
    // for a good while and the wallet stops asking.
    expect(refused?.available).toBe(false)
    expect(refused?.coolingMs).toBeGreaterThan(0)
    // Plain data all the way out — the UI renders this straight.
    expect(JSON.parse(JSON.stringify(refused))).toEqual(refused)

    /*
      A call that gets through is proof the credentials are good again, so the
      flag has to come off — otherwise Settings would accuse an API that is
      answering perfectly well. The governor's cooldown is what stops the
      retry, so the state is reached directly rather than by waiting it out.
    */
    status = 200
    const governor = (engine.chains as unknown as { governor: { observe(host: string, status: number): void } }).governor
    governor.observe('static.electroswap.io', 200)
    const cleared = (await engine.engine.chains.hosts()).find((h) => h.host === 'static.electroswap.io')
    expect(cleared?.refused).toBe(false)
  })

  it('is a plain read: no argument, and a dApp gets nothing it could not already see', async () => {
    engine = engineWith(async () => new Response('{}', { status: 200 }))
    await engine.ready
    const res = await engine.host.dispatch({ v: 1, kind: 'request', id: 'h1', ns: 'chains', method: 'hosts' }, 'content')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.code).toBe('unauthorized')
  })
})
