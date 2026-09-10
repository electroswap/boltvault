/**
 * The wallet's request credential, and the vector that keeps the two repos
 * honest.
 *
 * `services/api/src/http/auth/walletAuth.ts` implements the same algorithm and
 * carries the same vector. If either side drifts, both suites go red — which is
 * the point: a MAC mismatch discovered in production looks like every wallet
 * losing access at once.
 */
import { describe, expect, it } from 'vitest'
import { authHeaders, keyIdOf, pathOf, signingString, walletAuthHeader } from '../src/apiAuth'

const KEY = 'test-wallet-key'
const fixedRandom = (n: number): Uint8Array => new Uint8Array(n).fill(7)

describe('the wallet auth header', () => {
  it('matches the cross-repo vector', () => {
    // Change this and you must change services/api's copy in the same commit.
    const header = walletAuthHeader({ key: KEY, method: 'POST', url: 'https://api.test/api/wallet/trace', body: '{"chainId":52014}', now: 1_780_000_000_000, random: fixedRandom })
    expect(header).toBe('v1.9444053a.1780000000.BwcHBwcHBwcHBwcHBwcHBw.iMQyt8HRCQTxLboHpoNOdAWKsBPBsn3lQnj6y5Km9Ws')
  })

  it('is different on every call, for the same request', () => {
    const one = walletAuthHeader({ key: KEY, method: 'GET', url: '/api/wallet/fees', now: 1_780_000_000_000 })
    const two = walletAuthHeader({ key: KEY, method: 'GET', url: '/api/wallet/fees', now: 1_780_000_000_000 })
    expect(one).not.toBe(two)
    // Same key, same second: only the nonce and therefore the MAC moved.
    expect(one.split('.').slice(0, 3)).toEqual(two.split('.').slice(0, 3))
  })

  it('binds the credential to the body, so a captured header cannot be lifted onto another payload', () => {
    const a = signingString(1, 'n', 'POST', '/api/wallet/trace', '{"to":"0xaaa"}')
    const b = signingString(1, 'n', 'POST', '/api/wallet/trace', '{"to":"0xbbb"}')
    expect(a).not.toBe(b)
  })

  it('signs the query string, not just the path', () => {
    expect(signingString(1, 'n', 'GET', '/api/wallet/prices?tokens=a', '')).not.toBe(signingString(1, 'n', 'GET', '/api/wallet/prices?tokens=a,b,c', ''))
  })

  it('identifies the key without carrying it', () => {
    const header = walletAuthHeader({ key: KEY, method: 'GET', url: '/x', now: 0 })
    expect(header).toContain(keyIdOf(KEY))
    expect(header).not.toContain(KEY)
  })

  it('never sends the bearer header beside it', () => {
    expect(Object.keys(authHeaders({ key: KEY, method: 'GET', url: '/x', now: 0 }))).toEqual(['X-BoltVault-Auth'])
  })

  it('takes the path and query off an absolute URL, and passes a relative one through', () => {
    expect(pathOf('https://api.test/api/wallet/prices?chainId=1')).toBe('/api/wallet/prices?chainId=1')
    expect(pathOf('/api/wallet/fees?chainId=52014')).toBe('/api/wallet/fees?chainId=52014')
  })
})
