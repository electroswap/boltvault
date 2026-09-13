/**
 * Pin and watch, each doing what its name says (ES-BV-081).
 *
 * A beta tester tried both and reported both as broken, which was fair on the
 * evidence: "The pin function isnt doing anything. It doesnt pin the token on
 * top of the list also" and, on starring a collection, "seems like it has no
 * function."
 *
 * They were doing *something*, just not the thing the word promised. Pin kept a
 * token visible at a zero balance and never touched the order. Star recorded an
 * item with `above: null, below: null`, so it could not fire until the user
 * found the Notifications screen and typed a number into it.
 *
 * The two are deliberately still two things — pin is about the list, watch is
 * about being told — and what these hold is that each now delivers what it is
 * called.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { afterEach, describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const ETN = 52014
const COLLECTION = `0x${'cd'.repeat(20)}`

describe('watchlist.star', () => {
  let engine: Engine | null = null
  afterEach(() => {
    engine?.dispose()
    engine = null
  })

  const fresh = async (): Promise<Engine> => {
    const e = createEngine({ platform: createMemoryPlatform(), kdf: KDF, electroswapUrl: null, pricesUrl: null })
    await e.ready
    engine = e
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    return e
  }

  it('records the watch even when no price can be read', async () => {
    // No ElectroSwap client here, so `valueNow` finds nothing. A band is a
    // convenience; failing to read one must never refuse the watch itself.
    const e = await fresh()
    const items = await e.engine.watchlist.star({ kind: 'collection', chainId: ETN, address: COLLECTION, label: 'Some Collection' })
    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'collection', chainId: ETN, above: null, below: null })
  })

  it('is idempotent — starring twice does not duplicate or reset the row', async () => {
    const e = await fresh()
    await e.engine.watchlist.star({ kind: 'collection', chainId: ETN, address: COLLECTION, label: 'Some Collection' })
    await e.engine.watchlist.setAlert({ kind: 'collection', chainId: ETN, address: COLLECTION, above: 99, below: 11, onLive: false })
    const again = await e.engine.watchlist.star({ kind: 'collection', chainId: ETN, address: COLLECTION, label: 'Some Collection' })
    expect(again).toHaveLength(1)
    // The tuned band survives: re-starring must not overwrite a deliberate choice.
    expect(again[0]).toMatchObject({ above: 99, below: 11 })
  })

  it('takes a token watch, which nothing in the product could previously create', async () => {
    /*
      The engine has always evaluated `kind: 'token'` in `check()`, and the
      Notifications screen has always drawn "Above $"/"Below $" for one — but no
      UI ever called this, so the path was unreachable. That is why a pinned
      token never appeared in the bell tab.
    */
    const e = await fresh()
    const items = await e.engine.watchlist.star({ kind: 'token', chainId: ETN, address: `0x${'ab'.repeat(20)}`, label: 'BOLT' })
    expect(items.some((i) => i.kind === 'token')).toBe(true)
  })

  it('unstars what it starred', async () => {
    const e = await fresh()
    await e.engine.watchlist.star({ kind: 'collection', chainId: ETN, address: COLLECTION, label: 'Some Collection' })
    const left = await e.engine.watchlist.unstar({ kind: 'collection', chainId: ETN, address: COLLECTION })
    expect(left).toHaveLength(0)
  })
})

describe('notifications.remove', () => {
  let engine: Engine | null = null
  afterEach(() => {
    engine?.dispose()
    engine = null
  })

  it('drops one note and leaves the rest', async () => {
    const e = createEngine({ platform: createMemoryPlatform(), kdf: KDF, electroswapUrl: null, pricesUrl: null })
    await e.ready
    engine = e
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })

    await e.notifications.push({ id: 'a', kind: 'alert', title: 'One', body: 'first', target: null })
    await e.notifications.push({ id: 'b', kind: 'alert', title: 'Two', body: 'second', target: null })
    const before = await e.engine.notifications.list()
    expect(before).toHaveLength(2)

    /*
      Remove by the id the list actually hands out. `push` namespaces ids by
      account (`acct_…:a`), which is what keeps one account's inbox out of
      another's — and it is the reason `remove` takes the stored id rather than
      the caller's, since the screen only ever has the former.
    */
    const first = before[0]?.id
    expect(first).toBeTruthy()
    await e.engine.notifications.remove({ id: first as string })
    const after = await e.engine.notifications.list()
    expect(after).toHaveLength(1)
    expect(after[0]?.id).not.toBe(first)
  })

  it('is quiet about an id that is not there', async () => {
    const e = createEngine({ platform: createMemoryPlatform(), kdf: KDF, electroswapUrl: null, pricesUrl: null })
    await e.ready
    engine = e
    await e.engine.vault.import({ mnemonic: PHRASE, password: PASSWORD, backedUp: true })
    await expect(e.engine.notifications.remove({ id: 'nothing' })).resolves.toBeUndefined()
  })
})
