import type { Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { TOPICS } from '../src/abis'
import { hostOf, isScamOrigin, levenshtein, normaliseHomoglyphs, registrableOrigin, typosquat } from '../src/origin'
import { poisonCheck } from '../src/poison'
import { deltasFromTrace, mergeDeltas, simulationFromTrace } from '../src/simulate'

describe('origin', () => {
  it('keys sessions by scheme://host[:port] and rejects non-http', () => {
    expect(registrableOrigin('https://app.electroswap.io/swap?x=1')).toBe('https://app.electroswap.io')
    expect(registrableOrigin('http://127.0.0.1:4173/')).toBe('http://127.0.0.1:4173')
    expect(registrableOrigin('file:///tmp/x.html')).toBeNull()
    expect(registrableOrigin('about:blank')).toBeNull()
  })
  it('hostOf strips scheme, path and port', () => {
    expect(hostOf('https://Foo.Example.com:8443/path')).toBe('foo.example.com')
  })
  it('matches the scam list by host and subdomain', () => {
    expect(isScamOrigin('https://claim.evil.io', ['evil.io'])).toBe(true)
    expect(isScamOrigin('https://evil.io.safe.com', ['evil.io'])).toBe(false)
  })
  it('scores typosquats', () => {
    expect(typosquat('electroswop.io')?.reason).toBe('edit_distance')
    expect(typosquat('electrosvvap.io')?.reason).toBe('homoglyph')
    expect(typosquat('electroswap.io.claim-airdrop.net')?.reason).toBe('embedded')
    expect(typosquat('app.electroswap.io')).toBeNull()
    expect(typosquat('electroswap.io')).toBeNull()
    expect(typosquat('example.com')).toBeNull()
  })
  it('levenshtein and homoglyphs', () => {
    expect(levenshtein('kitten', 'sitting')).toBe(3)
    expect(normaliseHomoglyphs('rnetarnask.io')).toBe('metamask.io')
  })
})

describe('poison', () => {
  it('4+4 with differing nibbles reported', () => {
    const r = poisonCheck('0x1234bbbb56789012345678901234567890123456', ['0x1234aaaa56789012345678901234567890123456'])
    expect(r.hit).toBe(true)
    expect(r.differing).toEqual([4, 5, 6, 7])
  })
})

describe('simulation', () => {
  const ME = '0x3333333333333333333333333333333333333333' as Hex
  const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
  const OTHER = '0x2222222222222222222222222222222222222222' as Hex
  const pad = (a: Hex): Hex => `0x${a.slice(2).padStart(64, '0')}` as Hex
  it('folds Transfer logs and internal value into deltas', () => {
    const sim = simulationFromTrace(
      {
        type: 'CALL',
        from: ME,
        to: OTHER,
        value: '0x5',
        logs: [
          { address: TOKEN, topics: [TOPICS.transfer, pad(ME), pad(OTHER)], data: pad('0x64') },
          { address: TOKEN, topics: [TOPICS.transfer, pad(OTHER), pad(ME)], data: pad('0x0a') },
          { address: TOKEN, topics: [TOPICS.approval, pad(ME), pad(OTHER)], data: pad('0xff') },
        ],
        calls: [{ type: 'CALL', from: OTHER, to: ME, value: '0x2' }],
      },
      ME,
    )
    expect(sim.ok).toBe(true)
    expect(sim.deltas).toEqual(expect.arrayContaining([expect.objectContaining({ asset: 'native', amount: -3n }), expect.objectContaining({ asset: TOKEN, amount: -90n })]))
    expect(sim.approvals).toEqual([{ token: TOKEN, spender: OTHER, amount: 255n, standard: 'erc20' }])
  })
  it('a reverted trace is a failed simulation', () => {
    expect(simulationFromTrace({ error: 'execution reverted', revertReason: 'slippage' }, ME)).toMatchObject({ ok: false, revertReason: 'slippage' })
  })
  it('keeps NFTs one row per id', () => {
    const { deltas } = deltasFromTrace({ logs: [{ address: TOKEN, topics: [TOPICS.transfer, pad(OTHER), pad(ME), pad('0x7')], data: '0x' }] }, ME)
    expect(mergeDeltas(deltas)).toEqual([{ asset: TOKEN, standard: 'erc721', amount: 1n, tokenId: 7n, counterparty: OTHER }])
  })
})
