/**
 * Links (master plan §5.3): the app scheme, the universal host, `wc:` and
 * EIP-681 parse into navigation actions; anything else is nothing.
 */
import { describe, expect, it } from 'vitest'
import { parseLink } from '../src/links'

const POOL = '0x9999999999999999999999999999999999999999'
const REF = '0x1111111111111111111111111111111111111111'

describe('parseLink', () => {
  it('pairs WalletConnect from the raw uri, the app scheme and the universal host', () => {
    const topic = 'a'.repeat(64)
    const key = 'b'.repeat(64)
    const uri = `wc:${topic}@2?relay-protocol=irn&symKey=${key}`
    expect(parseLink(uri)).toEqual({ kind: 'wc', uri })
    expect(parseLink(`boltvault://wc?uri=${encodeURIComponent(uri)}`)).toEqual({ kind: 'wc', uri })
    expect(parseLink(`https://wallet.electroswap.io/wc?uri=${encodeURIComponent(uri)}`)).toEqual({ kind: 'wc', uri })
  })

  /*
    Anything beginning `wc:` used to be forwarded to the relay SDK untouched.
    A pairing URI has a shape; something that does not have it is not a
    pairing and has no business reaching the network.
  */
  it('refuses anything wearing the wc: prefix that is not a pairing uri', () => {
    const topic = 'a'.repeat(64)
    const key = 'b'.repeat(64)
    expect(parseLink('wc:abc@2?symKey=00')).toBeNull() // topic and key too short
    expect(parseLink(`wc:${topic}@1?symKey=${key}`)).toBeNull() // v1 is dead
    expect(parseLink(`wc:${topic}@2`)).toBeNull() // no symKey
    expect(parseLink(`wc:${'z'.repeat(64)}@2?symKey=${key}`)).toBeNull() // not hex
    expect(parseLink('boltvault://wc?uri=wc%3Anonsense')).toBeNull()
    expect(parseLink('boltvault://wc?uri=https%3A%2F%2Fevil')).toBeNull()
  })

  it('opens a campaign with its referrer, in both link shapes', () => {
    expect(parseLink(`boltvault://launchpad/${POOL}?ref=${REF}`)).toEqual({ kind: 'launchpad', pool: POOL, referrer: REF, url: `boltvault://launchpad/${POOL}?ref=${REF}` })
    expect(parseLink(`https://wallet.electroswap.io/launchpad/${POOL}?refId=${REF}`)).toMatchObject({ kind: 'launchpad', pool: POOL, referrer: REF })
    expect(parseLink(`https://wallet.electroswap.io/launchpad/${POOL}`)).toMatchObject({ kind: 'launchpad', referrer: null })
    expect(parseLink('boltvault://launchpad/nope')).toBeNull()
  })

  it('prefills Send from pay links and EIP-681', () => {
    expect(parseLink(`boltvault://pay?to=${REF}&amount=1.5&chainId=52014`)).toEqual({ kind: 'pay', to: REF, chainId: 52014, token: null, amount: '1.5' })
    expect(parseLink(`ethereum:${REF}@52014?value=1000000000000000000`)).toEqual({ kind: 'pay', to: REF, chainId: 52014, token: null, amount: '1000000000000000000' })
    expect(parseLink(`ethereum:${POOL}@52014/transfer?address=${REF}&uint256=5`)).toEqual({ kind: 'pay', to: REF, chainId: 52014, token: POOL, amount: '5' })
    expect(parseLink(`ethereum:${POOL}@52014/approve?address=${REF}`)).toBeNull()
    expect(parseLink('ethereum:0x1234')).toBeNull()
  })

  it('navigates to screens and the browser, and ignores anything else', () => {
    expect(parseLink('boltvault://swap')).toEqual({ kind: 'screen', screen: 'swap' })
    expect(parseLink('https://wallet.electroswap.io/bridge')).toEqual({ kind: 'screen', screen: 'bridge' })
    expect(parseLink('boltvault://open?url=https%3A%2F%2Fapp.electroswap.io')).toEqual({ kind: 'screen', screen: 'browser', url: 'https://app.electroswap.io' })
    expect(parseLink('boltvault://open?url=javascript%3Aalert(1)')).toBeNull()
    expect(parseLink('boltvault://')).toEqual({ kind: 'screen', screen: 'home' })
    expect(parseLink('https://evil.example/wc?uri=wc%3Aabc')).toBeNull()
    expect(parseLink('not a link')).toBeNull()
  })
})
