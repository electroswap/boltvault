/**
 * The encrypted local activity log (master plan §8.12).
 *
 * Sealed under HKDF(DEK, 'bv/activity') so a locked vault has no readable
 * history and a stolen storage dump reveals nothing. Append is the
 * write-ahead contract: callers append *before* broadcasting a transaction.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { fromHex, toHex, zeroise } from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { EngineError } from './errors'
import type { EventBus } from './host'
import { ActivityEntrySchema, type ActivityEntry } from './schema'

const KEY_BLOB = 'activity.blob'
const AAD = new TextEncoder().encode('boltvault.activity.v1')
const BlobSchema = z.object({ v: z.literal(1), entries: z.array(ActivityEntrySchema) })

export class ActivityStore {
  private cache: ActivityEntry[] | null = null

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    /** Resolves the session DEK, or throws `locked`. */
    private readonly dek: () => Promise<Uint8Array>,
  ) {}

  private async key(): Promise<Uint8Array> {
    const dek = await this.dek()
    const key = hkdf(sha256, dek, undefined, new TextEncoder().encode('bv/activity'), 32)
    zeroise(dek)
    return key
  }

  /** Empty when locked (never throws for a read). */
  async list(filter: { accountId?: string; chainId?: number; limit?: number } = {}): Promise<ActivityEntry[]> {
    let entries: ActivityEntry[]
    try {
      entries = await this.load()
    } catch (err) {
      if (err instanceof EngineError && err.code === 'locked') return []
      throw err
    }
    let out = entries
    if (filter.accountId) out = out.filter((e) => e.accountId === filter.accountId)
    if (filter.chainId) out = out.filter((e) => e.chainId === filter.chainId)
    out = [...out].sort((a, b) => b.submittedAt - a.submittedAt)
    return filter.limit ? out.slice(0, filter.limit) : out
  }

  private async load(): Promise<ActivityEntry[]> {
    if (this.cache) return this.cache
    const key = await this.key()
    const raw = await this.platform.storage.local.get(KEY_BLOB)
    if (raw === null) {
      this.cache = []
      return this.cache
    }
    let parsed: { nonce: string; ct: string }
    try {
      parsed = JSON.parse(raw) as { nonce: string; ct: string }
    } catch {
      this.cache = []
      return this.cache
    }
    try {
      const pt = xchacha20poly1305(key, fromHex(parsed.nonce), AAD).decrypt(fromHex(parsed.ct))
      const blob = BlobSchema.safeParse(JSON.parse(new TextDecoder().decode(pt)))
      this.cache = blob.success ? blob.data.entries : []
    } catch {
      // wrong key (a different vault) or tamper → treat as empty, never overwrite silently
      this.cache = []
    }
    return this.cache
  }

  private async persist(entries: ActivityEntry[]): Promise<void> {
    const key = await this.key()
    const nonce = this.platform.random(24)
    const ct = xchacha20poly1305(key, nonce, AAD).encrypt(new TextEncoder().encode(JSON.stringify({ v: 1, entries })))
    await this.platform.storage.local.set(KEY_BLOB, JSON.stringify({ nonce: toHex(nonce), ct: toHex(ct) }))
    this.cache = entries
    this.bus.emit({ type: 'activity.changed', entries: [...entries].sort((a, b) => b.submittedAt - a.submittedAt) })
  }

  /** Write-ahead: append before broadcast. Requires the vault to be unlocked. */
  async append(entry: ActivityEntry): Promise<void> {
    const entries = await this.load()
    if (entries.some((e) => e.id === entry.id)) throw new EngineError('invalid_argument', `duplicate activity id ${entry.id}`)
    await this.persist([...entries, entry])
  }

  async update(id: string, patch: Partial<ActivityEntry>): Promise<ActivityEntry> {
    const entries = await this.load()
    const idx = entries.findIndex((e) => e.id === id)
    const current = entries[idx]
    if (!current) throw new EngineError('not_found', `no activity entry ${id}`)
    const next = ActivityEntrySchema.parse({ ...current, ...patch })
    const list = entries.slice()
    list[idx] = next
    await this.persist(list)
    return next
  }

  async clear(): Promise<void> {
    await this.persist([])
  }

  /** Forget the decrypted cache on lock. */
  forget(): void {
    this.cache = null
  }
}
