/**
 * What a scanned code means to Send (master plan §8.4).
 *
 * The units are the part that has to be right: EIP-681 states `value` and
 * `uint256` in base units, so a request for one ETN arrives as
 * `1000000000000000000`. Putting that straight into an amount field would ask
 * the user to send a quintillion of something.
 */
import { describe, expect, it } from 'vitest'
import { readScannedCode } from '../src/state/scanned'

const ME = '0x1111111111111111111111111111111111111111'
const TOKEN = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'

describe('readScannedCode', () => {
  it('takes a bare address', () => {
    expect(readScannedCode(`  ${ME}  `)).toEqual({ kind: 'address', to: ME })
  })

  it('reads an EIP-681 native request, chain and amount included, in base units', () => {
    expect(readScannedCode(`ethereum:${ME}@52014?value=1000000000000000000`)).toEqual({
      kind: 'request',
      to: ME,
      chainId: 52014,
      token: null,
      amount: '1000000000000000000',
      baseUnits: true,
    })
  })

  it('reads an EIP-681 token request: the token is the target, the recipient is the argument', () => {
    const r = readScannedCode(`ethereum:${TOKEN}@52014/transfer?address=${ME}&uint256=1248000000`)
    expect(r).toEqual({ kind: 'request', to: ME, chainId: 52014, token: TOKEN, amount: '1248000000', baseUnits: true })
  })

  it('treats our own `pay` link amount as token units, because that is what was typed', () => {
    const r = readScannedCode(`boltvault://pay?to=${ME}&chainId=52014&amount=12.5`)
    expect(r).toEqual({ kind: 'request', to: ME, chainId: 52014, token: null, amount: '12.5', baseUnits: false })
  })

  it('carries a request with no amount without inventing one', () => {
    const r = readScannedCode(`ethereum:${ME}@52014`)
    expect(r).toEqual({ kind: 'request', to: ME, chainId: 52014, token: null, amount: null, baseUnits: false })
  })

  it('refuses anything that is neither', () => {
    expect(readScannedCode('https://example.com').kind).toBe('unreadable')
    expect(readScannedCode('0xnope').kind).toBe('unreadable')
    expect(readScannedCode('').kind).toBe('unreadable')
    // A pairing URI belongs to Connected sites, not to the To field.
    expect(readScannedCode(`wc:${'a'.repeat(64)}@2?symKey=${'b'.repeat(64)}`).kind).toBe('unreadable')
  })
})
