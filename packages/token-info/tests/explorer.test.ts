import { describe, expect, it } from 'vitest'
import { addressExplorerUrl, ETN_EXPLORER_BASE, tokenExplorerUrl, txExplorerUrl } from '../src/explorer'

describe('explorer urls', () => {
  it('base is the Electroneum explorer', () => {
    expect(ETN_EXPLORER_BASE).toBe('https://explorer.electroneum.com')
  })
  it('token url', () => {
    expect(tokenExplorerUrl('0xabc')).toBe('https://explorer.electroneum.com/token/0xabc')
  })
  it('address url', () => {
    expect(addressExplorerUrl('0xdef')).toBe('https://explorer.electroneum.com/address/0xdef')
  })
  it('tx url', () => {
    expect(txExplorerUrl('0x123')).toBe('https://explorer.electroneum.com/tx/0x123')
  })
})
