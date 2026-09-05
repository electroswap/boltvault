/**
 * The secret-never-in-UI assertion (master plan §3.3, §12): nothing shaped
 * like key material crosses the UI channel — a namespace that (wrongly)
 * returned bytes gets its response replaced with a refusal, and an event
 * carrying bytes is dropped.
 */
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { EngineHost } from '../src/host'
import { createChannelClient, createChannelPair, serveChannel } from '../src/transport'
import { hasRawBytes } from '../src/wire'

describe('hasRawBytes', () => {
  it('finds typed arrays and buffers anywhere, and nothing in plain data', () => {
    expect(hasRawBytes({ a: { b: [1, { c: new Uint8Array(32) }] } })).toBe(true)
    expect(hasRawBytes([new ArrayBuffer(8)])).toBe(true)
    expect(hasRawBytes({ mnemonic: 'abandon abandon ability', hex: `0x${'ab'.repeat(32)}`, n: 1, nil: null })).toBe(false)
    expect(hasRawBytes('0x00')).toBe(false)
  })
})

describe('the UI channel', () => {
  it('replaces a response carrying bytes with a refusal and lets plain data through', async () => {
    const host = new EngineHost()
    host.register('leaky', {
      bytes: { handler: async () => ({ dek: new Uint8Array(32).fill(7) }) },
      fine: { handler: async () => ({ address: '0x1234' }) },
    })
    const [a, b] = createChannelPair()
    serveChannel(host, a, 'ui')
    const client = createChannelClient(b, { timeoutMs: 2_000 })
    await expect(client.call('leaky', 'bytes', undefined)).rejects.toThrow(/refused to send raw bytes/)
    expect(await client.call('leaky', 'fine', undefined)).toEqual({ address: '0x1234' })
    // Input validation still applies to what comes in.
    host.register('strict', { echo: { input: z.object({ x: z.number() }), handler: async (arg) => arg } })
    expect(await client.call('strict', 'echo', { x: 1 })).toEqual({ x: 1 })
  })
})
