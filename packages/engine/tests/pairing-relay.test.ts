/**
 * Where a scanned pairing code is allowed to point (ES-BV-014).
 *
 * A pairing offer names the relay both devices will use, and it arrives from a
 * QR code — so the relay is a value an attacker can choose if the wallet lets
 * them. Every put and list afterwards carries this device's signed headers to
 * that host. Two rules: the relay must be encrypted, and it must be this
 * build's own, because a pairing QR is not a place to choose infrastructure
 * from.
 *
 * The host pin existed and never applied: `defaultRelayUrl` was whatever the
 * body passed, and neither body passed anything, so it was null in both and
 * any `https://` host named by a scanned offer was accepted.
 */
import { describe, expect, it } from 'vitest'
import { assertRelayAllowed } from '../src/namespaces/sync'

const MINE = 'https://electroswap.io/api/wallet/sync'

describe('a relay named by a scanned offer', () => {
  it('is refused when it is not encrypted', () => {
    expect(() => assertRelayAllowed('http://relay.example/api', MINE)).toThrow(/plain http/i)
    expect(() => assertRelayAllowed('ftp://relay.example', MINE)).toThrow()
    expect(() => assertRelayAllowed('not a url at all', MINE)).toThrow()
  })

  it('is refused when it is somebody else’s host', () => {
    // The whole finding: this used to pass, because nothing told the engine
    // which relay was its own.
    expect(() => assertRelayAllowed('https://relay.attacker.example/api', MINE)).toThrow(/relay\.attacker\.example/)
    expect(() => assertRelayAllowed('https://electroswap.io.attacker.example/api', MINE)).toThrow()
  })

  it('is allowed when it is this build’s', () => {
    expect(() => assertRelayAllowed(MINE, MINE)).not.toThrow()
    // Same host, different path: the pin is on the host, which is what the
    // signed headers actually reach.
    expect(() => assertRelayAllowed('https://electroswap.io/api/wallet/sync/v2', MINE)).not.toThrow()
  })

  it('lets a development build run a relay on the machine', () => {
    for (const url of ['http://localhost:3007/sync', 'http://127.0.0.1:3007/sync', 'http://[::1]:3007/sync']) {
      expect(() => assertRelayAllowed(url, MINE)).not.toThrow()
    }
  })

  it('lets the in-process relay through, because it touches no network', () => {
    expect(() => assertRelayAllowed('memory:relay', MINE)).not.toThrow()
  })

  it('still refuses plain http when no build relay is configured', () => {
    // An engine with no pin is a test or a development build; the encryption
    // rule is not the pin and does not depend on it.
    expect(() => assertRelayAllowed('http://relay.example/api', null)).toThrow(/plain http/i)
    expect(() => assertRelayAllowed('https://anywhere.example/api', null)).not.toThrow()
  })
})
