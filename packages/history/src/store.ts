import type { HistoryCategory, HistoryEntry } from '@boltvault/core'

/**
 * Encrypted local transaction log (T1.4).
 *
 * Contract (design §"Transaction history"): before `eth_sendRawTransaction`
 * returns to the UI, the caller appends a `HistoryEntry`. The whole log is
 * encrypted at rest — a locked vault means no history, because the store is
 * encrypted with the vault wrap key and last-good plaintext would leak.
 *
 * This store is platform-agnostic: it takes a `Cipher` (seal/open) and a
 * `BlobStore` (opaque read/write of the encrypted blob). The SW wires the
 * vault wrap key as the cipher and `chrome.storage.local` as the blob store;
 * mobile wires the keychain-backed key + MMKV.
 */

export interface Cipher {
  /** Seal plaintext bytes → opaque ciphertext string. */
  seal(plaintext: Uint8Array): Promise<string>
  /** Open a sealed blob → plaintext bytes, or null on bad key/tamper. */
  open(blob: string): Promise<Uint8Array | null>
}

export interface BlobStore {
  read(): Promise<string | null>
  write(blob: string): Promise<void>
  clear(): Promise<void>
}

/** A HistoryEntry tagged with which account sent it (the design's `account` field). */
export type LogEntry = HistoryEntry

interface OnDisk {
  version: 1
  /** Serialized entries in append order (oldest first). */
  entries: LogEntry[]
}

export class HistoryStore {
  private cached: OnDisk | null = null

  constructor(
    private readonly store: BlobStore,
    private readonly cipher: Cipher,
  ) {}

  /** Load + decrypt the log. Returns [] if no blob, bad key, or corrupt JSON. */
  async load(): Promise<LogEntry[]> {
    const raw = await this.store.read()
    if (raw === null) return []
    const pt = await this.cipher.open(raw)
    if (pt === null) return []
    let disk: OnDisk
    try {
      disk = JSON.parse(new TextDecoder().decode(pt)) as OnDisk
    } catch {
      return [] // wrong key or corrupt — treat as empty (locked vault)
    }
    if (disk.version !== 1) return []
    this.cached = disk
    return disk.entries
  }

  private async persist(disk: OnDisk): Promise<void> {
    this.cached = disk
    const sealed = await this.cipher.seal(new TextEncoder().encode(JSON.stringify(disk)))
    await this.store.write(sealed)
  }

  /** Append an entry (the write-before-return contract). */
  async append(entry: LogEntry): Promise<LogEntry[]> {
    const disk = (await this.ensure())
    disk.entries.push(entry)
    await this.persist(disk)
    return disk.entries
  }

  private async ensure(): Promise<OnDisk> {
    if (this.cached) return this.cached
    const entries = await this.load()
    const disk: OnDisk = { version: 1, entries }
    this.cached = disk
    return disk
  }

  /** Mark a submitted entry as confirmed at a block. */
  async confirm(hash: string, blockNumber: number): Promise<LogEntry[]> {
    const disk = await this.ensure()
    const e = disk.entries.find((x) => x.hash === hash)
    if (e) {
      disk.entries = disk.entries.map((x) =>
        x.hash === hash ? { ...x, status: 'confirmed', blockNumber } : x,
      )
    }
    await this.persist(disk)
    return disk.entries
  }

  /** Mark a pending entry replaced by a same-nonce replacement. */
  async markReplaced(hash: string, replacedBy: string): Promise<LogEntry[]> {
    const disk = await this.ensure()
    disk.entries = disk.entries.map((x) =>
      x.hash === hash ? { ...x, status: 'replaced', replacedBy } : x,
    )
    await this.persist(disk)
    return disk.entries
  }

  /** Wipe the local log (chain is forever; this does not unlock funds). */
  async wipe(): Promise<void> {
    await this.store.clear()
    this.cached = { version: 1, entries: [] }
  }

  /** Filter helpers for the Activity + per-token surfaces. */
  static byAccount(entries: readonly LogEntry[], account: string): LogEntry[] {
    return entries.filter((e) => e.account === account)
  }
  static byCategory(entries: readonly LogEntry[], category: HistoryCategory): LogEntry[] {
    return entries.filter((e) => e.category === category)
  }
  static byChain(entries: readonly LogEntry[], chainId: number): LogEntry[] {
    return entries.filter((e) => e.chainId === chainId)
  }
}
