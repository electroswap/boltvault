/**
 * A second "USDC" is marked wherever it appears (ES-BV-037).
 *
 * Token lists are fetched over the network and are not signed, and the picker
 * searches by symbol — so an entry that borrows a major's symbol sits in the
 * results beside the real one with nothing to tell them apart. The check
 * existed but its reference set was four Electroneum tokens, which left USDT
 * unguarded, every other chain unguarded, and the `wallet_watchAsset` sheet —
 * the one a page drives — unguarded too.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { describe, expect, it } from 'vitest'
import { createEngine, type Engine } from '../src'

const TESTNET = 5201420
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const IMPOSTOR = '0x1111111111111111111111111111111111111111'

async function boot(): Promise<Engine> {
  const e = createEngine({ platform: createMemoryPlatform(), kdf: KDF, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
  await e.ready
  await e.engine.vault.create({ password: 'correct horse battery staple 42' })
  return e
}

describe('a token wearing a symbol that is already somebody else’s', () => {
  it('names the address the symbol really belongs to', async () => {
    const e = await boot()
    const real = ELECTRONEUM_ADDRESSES[TESTNET]
    expect(await e.engine.tokens.lookalikeOf({ chainId: TESTNET, address: IMPOSTOR, symbol: 'USDC' })).toBe(real.usdc.toLowerCase())
    // USDT was missing from the set entirely, which is the second most obvious
    // symbol on earth to borrow.
    expect(await e.engine.tokens.lookalikeOf({ chainId: TESTNET, address: IMPOSTOR, symbol: 'USDT' })).toBe(real.usdt.toLowerCase())
    e.dispose()
  })

  it('says nothing about the real one, or about a symbol nobody holds', async () => {
    const e = await boot()
    const real = ELECTRONEUM_ADDRESSES[TESTNET]
    expect(await e.engine.tokens.lookalikeOf({ chainId: TESTNET, address: real.usdc, symbol: 'USDC' })).toBeNull()
    expect(await e.engine.tokens.lookalikeOf({ chainId: TESTNET, address: IMPOSTOR, symbol: 'NOTATOKEN' })).toBeNull()
    e.dispose()
  })

  it('guards the native coin’s own symbol', async () => {
    const e = await boot()
    expect(await e.engine.tokens.lookalikeOf({ chainId: TESTNET, address: IMPOSTOR, symbol: 'ETN' })).toBe('native')
    e.dispose()
  })

  it('is not fooled by casing or by stray spacing', async () => {
    const e = await boot()
    const real = ELECTRONEUM_ADDRESSES[TESTNET]
    expect(await e.engine.tokens.lookalikeOf({ chainId: TESTNET, address: IMPOSTOR, symbol: '  usdc ' })).toBe(real.usdc.toLowerCase())
    expect(await e.engine.tokens.lookalikeOf({ chainId: TESTNET, address: IMPOSTOR.toUpperCase().replace('0X', '0x'), symbol: 'USDC' })).toBe(real.usdc.toLowerCase())
    e.dispose()
  })
})
