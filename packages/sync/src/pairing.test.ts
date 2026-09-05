import { describe, expect, it } from 'vitest'
import {
  beginExport,
  completeImport,
  watchOnlyExport,
  type PairingChunk,
} from './pairing'

const secret = new TextEncoder().encode('pairing-secret-42')

const sampleVault = JSON.stringify({
  name: 'AirGapped Vault',
  seedHex: 'a3f9c01b2e4d5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8',
  accounts: [{ address: '0xabc', balance: '1000' }],
})

describe('beginExport / completeImport', () => {
  it('round-trips a sample plaintext (JSON string) exactly', () => {
    const chunks = beginExport(sampleVault, { secret, chunkSize: 16 })
    expect(chunks.length).toBeGreaterThan(1)
    for (const c of chunks) {
      expect(c.n).toBe(chunks.length)
      expect(typeof c.payload).toBe('string')
    }
    expect(completeImport(chunks, secret)).toBe(sampleVault)
  })

  it('round-trips with the default chunkSize', () => {
    const chunks = beginExport(sampleVault, { secret })
    expect(completeImport(chunks, secret)).toBe(sampleVault)
  })

  it('is deterministic for the same (plaintext, secret, chunkSize)', () => {
    const a = beginExport(sampleVault, { secret, chunkSize: 16 })
    const b = beginExport(sampleVault, { secret, chunkSize: 16 })
    expect(a).toEqual(b)
  })

  it('throws when a chunk is missing (tamper detection)', () => {
    const chunks = beginExport(sampleVault, { secret, chunkSize: 16 })
    const missing = chunks.filter((c) => c.i !== 1)
    expect(() => completeImport(missing, secret)).toThrow(/missing|expected/)
  })

  it('throws when a chunk is duplicated instead of present (tamper detection)', () => {
    const chunks = beginExport(sampleVault, { secret, chunkSize: 16 })
    const first = chunks[0]
    if (!first) throw new Error('expected chunks')
    // Replace the last chunk with a copy of chunk 0: index 0 appears twice,
    // the real last index is missing.
    const dup: PairingChunk[] = [...chunks.slice(0, -1), { ...first }]
    expect(() => completeImport(dup, secret)).toThrow(/tampered/)
  })

  it('throws when an index is out of range (tamper detection)', () => {
    const chunks = beginExport(sampleVault, { secret, chunkSize: 16 })
    const bad: PairingChunk[] = chunks.map((c, idx) =>
      idx === 0 ? { ...c, i: 99 } : c,
    )
    expect(() => completeImport(bad, secret)).toThrow(/out of range/)
  })

  it('wrong secret -> round-trip fails (garbled output, not the original)', () => {
    const chunks = beginExport(sampleVault, { secret, chunkSize: 16 })
    const wrong = new TextEncoder().encode('other-secret')
    // Either the UTF-8 decode throws or the result differs from the original.
    let result: string | undefined
    let threw = false
    try {
      result = completeImport(chunks, wrong)
    } catch {
      threw = true
    }
    expect(threw || result !== sampleVault).toBe(true)
  })

  it('returns "" for zero chunks', () => {
    expect(completeImport([], secret)).toBe('')
  })
})

describe('watchOnlyExport', () => {
  it('yields JSON with seedHex blanked; full export keeps it', () => {
    const full = completeImport(beginExport(sampleVault, { secret }), secret)
    expect((JSON.parse(full) as { seedHex: string }).seedHex).not.toBe('')

    const watchOnly = watchOnlyExport(sampleVault, secret)
    const restored = completeImport(watchOnly, secret)
    const parsed = JSON.parse(restored) as { seedHex: string; name: string }
    expect(parsed.seedHex).toBe('')
    expect(parsed.name).toBe('AirGapped Vault')
  })

  it('throws when plaintext has no seedHex field', () => {
    expect(() => watchOnlyExport(JSON.stringify({ foo: 1 }), secret)).toThrow(
      /seedHex/,
    )
  })

  it('throws when plaintext is not a JSON object', () => {
    expect(() => watchOnlyExport('["a","b"]', secret)).toThrow(/JSON object/)
  })
})
