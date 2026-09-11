import { describe, expect, it } from 'vitest'
import { sharedElementTag } from '../src/SharedElement.types'

const WETN = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'

describe('sharedElementTag', () => {
  it('is a legal CSS custom-ident: no colons, no leading digit', () => {
    const tag = sharedElementTag(`token:52014:${WETN}`)
    expect(tag).toMatch(/^[a-z][a-z0-9-]*$/)
    expect(tag).toBe(`bv-token-52014-${WETN.toLowerCase()}`)
  })

  it('agrees across the two screens however the address was spelled', () => {
    // The list hands the row a checksummed address and the route hands the
    // dossier whatever it was pushed with; a name that disagrees pairs with
    // nothing and the move silently does not happen.
    expect(sharedElementTag(`token:1:${WETN}`)).toBe(sharedElementTag(`token:1:${WETN.toLowerCase()}`))
  })

  it('keeps different things apart', () => {
    expect(sharedElementTag('nft:52014:0xabc:1')).not.toBe(sharedElementTag('nft:52014:0xabc:2'))
    expect(sharedElementTag('token:1:0xabc')).not.toBe(sharedElementTag('token:56:0xabc'))
  })

  it('never returns an empty or dangling name', () => {
    expect(sharedElementTag('')).toBe('bv-shared')
    expect(sharedElementTag(':::')).toBe('bv-shared')
    expect(sharedElementTag('token:1:')).toBe('bv-token-1')
  })
})
