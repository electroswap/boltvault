import { describe, expect, it } from 'vitest'
import { coexistPolicy } from './policy'
import {
  RDNS,
  buildAnnouncement,
  isStableUuid,
  ICON_DATA_URI,
} from './announce'

const bolt = { isBolt: true, request: async () => 42 }
const existing = { isExisting: true }

describe('coexistPolicy', () => {
  it('does NOT clobber window.ethereum when not the default wallet', () => {
    const policy = coexistPolicy({
      existingEthereum: existing,
      boltProvider: bolt,
      isDefaultWallet: false,
      metaMaskCompat: false,
      stableUuid: '00000000-0000-4000-8000-000000000000',
    })
    expect(policy.setsEthereum).toBe(false)
  })

  it('DOES set window.ethereum when isDefaultWallet', () => {
    const policy = coexistPolicy({
      existingEthereum: existing,
      boltProvider: bolt,
      isDefaultWallet: true,
      metaMaskCompat: false,
      stableUuid: '00000000-0000-4000-8000-000000000000',
    })
    expect(policy.setsEthereum).toBe(true)
  })

  it('always includes the bolt provider AND preserves an existing one (in order)', () => {
    const policy = coexistPolicy({
      existingEthereum: existing,
      boltProvider: bolt,
      isDefaultWallet: false,
      metaMaskCompat: false,
      stableUuid: 'x',
    })
    expect(policy.providers).toContain(bolt)
    expect(policy.providers).toContain(existing)
    expect(policy.providers[policy.providers.length - 1]).toBe(bolt)
  })

  it('still announces the bolt provider when there is no existing ethereum', () => {
    const policy = coexistPolicy({
      existingEthereum: undefined,
      boltProvider: bolt,
      isDefaultWallet: true,
      metaMaskCompat: false,
      stableUuid: 'x',
    })
    expect(policy.providers).toEqual([bolt])
  })

  it('metaMaskCompat toggles isMetaMask; rdns is always the BoltVault rdns', () => {
    const base = {
      existingEthereum: existing,
      boltProvider: bolt,
      isDefaultWallet: false,
      stableUuid: 'x',
    }
    const on = coexistPolicy({ ...base, metaMaskCompat: true })
    const off = coexistPolicy({ ...base, metaMaskCompat: false })
    expect(on.isMetaMask).toBe(true)
    expect(off.isMetaMask).toBe(false)
    expect(on.rdns).toBe(RDNS)
    expect(off.rdns).toBe(RDNS)
    expect(on.isBoltVault).toBe(true)
    expect(off.isBoltVault).toBe(true)
  })
})

describe('buildAnnouncement / isStableUuid', () => {
  it('builds the EIP-6963 shape with a data-URI icon', () => {
    const detail = buildAnnouncement(
      '00000000-0000-4000-8000-000000000000',
      bolt,
    )
    expect(detail.info.uuid).toBe(
      '00000000-0000-4000-8000-000000000000',
    )
    expect(detail.info.rdns).toBe(RDNS)
    expect(typeof detail.info.name).toBe('string')
    expect(detail.info.name.length).toBeGreaterThan(0)
    expect(detail.info.icon).toBe(ICON_DATA_URI)
    expect(detail.info.icon.startsWith('data:image/svg+xml;base64,')).toBe(true)
    expect(detail.provider).toBe(bolt)
  })

  it('accepts a valid stable UUID and rejects non-UUID strings', () => {
    expect(
      isStableUuid('00000000-0000-4000-8000-000000000000'),
    ).toBe(true)
    expect(
      isStableUuid('123e4567-e89b-42d3-a456-426614174000'),
    ).toBe(true)
    expect(isStableUuid('not-a-uuid')).toBe(false)
    expect(isStableUuid('')).toBe(false)
    expect(isStableUuid('123e4567-e89b-42d3-a456')).toBe(false)
  })
})
