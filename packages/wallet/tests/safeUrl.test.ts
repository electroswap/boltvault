/**
 * The gate every outward link passes (ES-BV-035).
 *
 * `host.openUrl` reaches `Linking.openURL` on mobile, which launches whatever
 * app claims the scheme — and several of the links the wallet offers come from
 * the API, typed as plain strings and opened as received.
 */
import { describe, expect, it } from 'vitest'
import { safeExternalUrl } from '../src/safeUrl'

describe('safeExternalUrl', () => {
  it('opens ordinary https links', () => {
    expect(safeExternalUrl('https://electroswap.io/token')).toBe('https://electroswap.io/token')
    expect(safeExternalUrl('  https://x.com/electroswap  ')).toBe('https://x.com/electroswap')
  })

  it('opens nothing that is not https', () => {
    for (const bad of [
      'intent://scan/#Intent;scheme=zxing;end',
      'javascript:alert(1)',
      'data:text/html,<script>1</script>',
      'file:///etc/passwd',
      'boltvault://wc?uri=wc:abc',
      'ethereum:0x1111111111111111111111111111111111111111@52014',
      'http://electroswap.io',
      'not a url',
      '',
      null,
      undefined,
    ])
      expect(safeExternalUrl(bad), String(bad)).toBe(null)
  })

  it('refuses credentials in the authority, which hide the real host', () => {
    expect(safeExternalUrl('https://electroswap.io@evil.example/')).toBe(null)
    expect(safeExternalUrl('https://user:pass@evil.example/')).toBe(null)
  })

  it('refuses a host the signed scam list names, and its subdomains', () => {
    const list = ['evil.example']
    expect(safeExternalUrl('https://evil.example/drain', list)).toBe(null)
    expect(safeExternalUrl('https://claim.evil.example/drain', list)).toBe(null)
    expect(safeExternalUrl('https://electroswap.io', list)).toBe('https://electroswap.io/')
  })
})
