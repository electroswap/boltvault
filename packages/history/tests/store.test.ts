import { describe, expect, it } from 'vitest'
import { HistoryStore, type BlobStore, type Cipher } from '../src/index.js'
import type { HistoryEntry } from '@boltvault/core'

// A trivial "cipher" that XORs with a key — enough to prove encrypt-at-rest
// (raw blob ≠ plaintext) without pulling noble into the test.
function xorCipher(key: Uint8Array): Cipher {
  const xor = (buf: Uint8Array): Uint8Array => {
    const out = new Uint8Array(buf.length)
    for (let i = 0; i < buf.length; i++) out[i] = (buf[i] as number) ^ (key[i % key.length] as number)
    return out
  }
  const b64 = (u8: Uint8Array) => Buffer.from(u8).toString('base64')
  const unb64 = (s: string) => new Uint8Array(Buffer.from(s, 'base64'))
  return {
    seal: async (pt) => b64(xor(pt)),
    open: async (blob) => xor(unb64(blob)),
  }
}

function memStore(): { store: BlobStore; blob: () => string | null } {
  let data: string | null = null
  const store: BlobStore = {
    read: async () => data,
    write: async (b) => {
      data = b
    },
    clear: async () => {
      data = null
    },
  }
  return { store, blob: () => data }
}

const KEY = new Uint8Array(16).fill(7)

function entry(i: number, over: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    hash: `0x${(i + 1).toString(16).padStart(64, '0')}`,
    chainId: 52014,
    account: 'acct-0',
    to: '0x' + 'cd'.repeat(20),
    data: '0x',
    value: '0x0',
    nonce: i,
    submittedAt: Date.now(),
    category: 'SEND',
    status: 'pending',
    ...over,
  }
}

describe('HistoryStore (encrypted local log)', () => {
  it('round-trips entries across a fresh store (encrypt-at-rest)', async () => {
    const { store, blob } = memStore()
    const cipher = xorCipher(KEY)
    const h = new HistoryStore(store, cipher)

    await h.append(entry(0))
    await h.append(entry(1, { category: 'SWAP' }))

    // raw blob must NOT contain plaintext markers
    const raw = blob()
    expect(raw).not.toBeNull()
    expect(raw).not.toContain('"hash"')
    expect(raw).not.toContain('SWAP')

    // a NEW store instance over the same blob decrypts the same entries
    const h2 = new HistoryStore(store, xorCipher(KEY))
    const all = await h2.load()
    expect(all).toHaveLength(2)
    expect(all[0]?.nonce).toBe(0)
    expect(all[1]?.category).toBe('SWAP')
  })

  it('returns [] when the blob is from a different key (locked vault = no history)', async () => {
    const { store } = memStore()
    await new HistoryStore(store, xorCipher(KEY)).append(entry(0))
    const h2 = new HistoryStore(store, xorCipher(new Uint8Array(16).fill(9)))
    expect(await h2.load()).toEqual([])
  })

  it('confirms a pending entry at a block number', async () => {
    const { store } = memStore()
    const h = new HistoryStore(store, xorCipher(KEY))
    await h.append(entry(0))
    const after = await h.confirm(entry(0).hash, 12345)
    expect(after[0]?.status).toBe('confirmed')
    expect(after[0]?.blockNumber).toBe(12345)
  })

  it('marks a replaced entry and keeps the replacedBy hash', async () => {
    const { store } = memStore()
    const h = new HistoryStore(store, xorCipher(KEY))
    await h.append(entry(0))
    const after = await h.markReplaced(entry(0).hash, '0xrepl')
    expect(after[0]?.status).toBe('replaced')
    expect(after[0]?.replacedBy).toBe('0xrepl')
  })

  it('wipe clears the log', async () => {
    const { store, blob } = memStore()
    const h = new HistoryStore(store, xorCipher(KEY))
    await h.append(entry(0))
    await h.wipe()
    expect(blob()).toBeNull()
    expect(await new HistoryStore(store, xorCipher(KEY)).load()).toEqual([])
  })

  it('filter helpers partition by account / category / chain', async () => {
    const { store } = memStore()
    const h = new HistoryStore(store, xorCipher(KEY))
    await h.append(entry(0, { account: 'acct-0', category: 'SEND', chainId: 52014 }))
    await h.append(entry(1, { account: 'acct-1', category: 'SWAP', chainId: 1 }))
    const all = await h.load()
    expect(HistoryStore.byAccount(all, 'acct-0')).toHaveLength(1)
    expect(HistoryStore.byCategory(all, 'SWAP')).toHaveLength(1)
    expect(HistoryStore.byChain(all, 52014)).toHaveLength(1)
  })
})
