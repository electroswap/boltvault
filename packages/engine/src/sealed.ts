/**
 * A DEK-sealed map: one encrypted blob holding many logical entries.
 *
 * The at-rest audit (2026-09-06) showed that sealing a *value* is not enough —
 * a key like `portfolio.acct_4ea7f813…` still discloses the account id and how
 * many accounts exist, and `cache.explore.history.<chain>.<token>.<duration>`
 * still proves which tokens were viewed. Holding the entries *inside* one blob
 * removes the identifier from the key space entirely, which is what master plan
 * §3.2 promises: "a stolen `chrome.storage.local` reveals nothing but
 * ciphertext and the vault id".
 *
 * Crypto is identical to `activityStore.ts` / `namespaces/contacts.ts`:
 * XChaCha20-Poly1305 under `HKDF(DEK, info)`, stored as `{nonce, ct}` hex with
 * the schema version *inside* the ciphertext.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { fromHex, toHex, zeroise } from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { z, type ZodType } from 'zod'
import { EngineError } from './errors'

/** What a write does when the vault is locked. */
export type LockedWrite =
  /** Throw `locked` — durable state the caller must not silently lose. */
  | 'throw'
  /** Drop the write and report false — correct for a cache, which can refetch. */
  | 'skip'

export interface SealedMapOptions<T> {
  /** Storage key inside `storage.local`, e.g. `portfolio.blob`. */
  readonly key: string
  /** HKDF info, e.g. `bv/portfolio`. Must be unique per blob. */
  readonly info: string
  /** AEAD associated data, e.g. `boltvault.portfolio.v1`. */
  readonly aad: string
  readonly schema: ZodType<T>
  /** Keep at most this many entries, evicting least-recently-written first. */
  readonly cap?: number
  /** Default `'throw'`. */
  readonly whenLocked?: LockedWrite
}

interface Item<T> {
  id: string
  value: T
}

/**
 * Entries are an ordered array, not an object: a plain object reorders
 * integer-like keys ("52014" — a chain id — is one), which would make `cap`
 * evict the wrong entry.
 */
function blobSchema<T>(inner: ZodType<T>): ZodType<{ v: 1; items: Item<T>[] }> {
  return z.object({
    v: z.literal(1),
    items: z.array(z.object({ id: z.string(), value: inner })),
  }) as unknown as ZodType<{ v: 1; items: Item<T>[] }>
}

export class SealedMap<T> {
  private items: Item<T>[] | null = null
  /** The stored blob would not open; writing would destroy it. See `load`. */
  private poisoned = false
  private readonly blob: ZodType<{ v: 1; items: Item<T>[] }>
  private readonly aadBytes: Uint8Array
  private readonly infoBytes: Uint8Array

  constructor(
    private readonly platform: Platform,
    /** Resolves the session DEK, or throws `locked`. */
    private readonly dek: () => Promise<Uint8Array>,
    private readonly opts: SealedMapOptions<T>,
    /** Called after every successful write. */
    private readonly onChange?: () => void,
  ) {
    this.blob = blobSchema(opts.schema)
    this.aadBytes = new TextEncoder().encode(opts.aad)
    this.infoBytes = new TextEncoder().encode(opts.info)
  }

  private async key(): Promise<Uint8Array> {
    const dek = await this.dek()
    const key = hkdf(sha256, dek, undefined, this.infoBytes, 32)
    // The accessor hands us a fresh copy; the session hex is the real home, so
    // this copy is ours to clear (§3.2).
    zeroise(dek)
    return key
  }

  /** `null` when locked, absent, or unreadable — never throws. */
  async get(id: string): Promise<T | null> {
    const items = await this.safeLoad()
    return items.find((i) => i.id === id)?.value ?? null
  }

  /** Every entry, `{}` when locked — never throws. */
  async entries(): Promise<Record<string, T>> {
    const out: Record<string, T> = {}
    for (const i of await this.safeLoad()) out[i.id] = i.value
    return out
  }

  async ids(): Promise<string[]> {
    return (await this.safeLoad()).map((i) => i.id)
  }

  /**
   * Write one entry. Returns false only when the vault is locked and this map
   * is configured `whenLocked: 'skip'`; otherwise a locked vault throws.
   */
  async set(id: string, value: T): Promise<boolean> {
    return this.mutate((items) => {
      const next = items.filter((i) => i.id !== id)
      next.push({ id, value })
      const cap = this.opts.cap
      return cap !== undefined && next.length > cap ? next.slice(next.length - cap) : next
    })
  }

  async delete(id: string): Promise<boolean> {
    return this.mutate((items) => items.filter((i) => i.id !== id))
  }

  /** Drop every entry whose id satisfies `pred` — used to purge a removed account. */
  async deleteWhere(pred: (id: string) => boolean): Promise<boolean> {
    return this.mutate((items) => items.filter((i) => !pred(i.id)))
  }

  async clear(): Promise<boolean> {
    return this.mutate(() => [])
  }

  /**
   * Replace the whole map in one write (ES-BV-016).
   *
   * `set()` per entry means one encryption of the entire blob per entry, so a
   * caller holding N rows and saving them all paid N encryptions of N rows —
   * quadratic in the number of connected sites, on a path a page can trigger.
   * This is the same work as one `set`, whatever the size of the map.
   */
  async replaceAll(entries: Iterable<readonly [string, T]>): Promise<boolean> {
    const next: Item<T>[] = []
    for (const [id, value] of entries) next.push({ id, value })
    const cap = this.opts.cap
    return this.mutate(() => (cap !== undefined && next.length > cap ? next.slice(next.length - cap) : next))
  }

  /** Forget the decrypted entries on lock. */
  forget(): void {
    this.poisoned = false
    this.items = null
  }

  private async mutate(f: (items: Item<T>[]) => Item<T>[]): Promise<boolean> {
    try {
      const next = f(await this.load())
      await this.persist(next)
    } catch (err) {
      if (this.opts.whenLocked === 'skip' && err instanceof EngineError && err.code === 'locked') return false
      throw err
    }
    this.onChange?.()
    return true
  }

  private async safeLoad(): Promise<Item<T>[]> {
    try {
      return await this.load()
    } catch (err) {
      if (err instanceof EngineError && err.code === 'locked') return []
      throw err
    }
  }

  private async load(): Promise<Item<T>[]> {
    if (this.items) return this.items
    const key = await this.key()
    const raw = await this.platform.storage.local.get(this.opts.key)
    if (raw === null) {
      this.items = []
      return this.items
    }
    let parsed: { nonce?: unknown; ct?: unknown }
    try {
      parsed = JSON.parse(raw) as { nonce?: unknown; ct?: unknown }
    } catch {
      this.items = []
      return this.items
    }
    if (typeof parsed.nonce !== 'string' || typeof parsed.ct !== 'string') {
      this.items = []
      return this.items
    }
    try {
      const pt = xchacha20poly1305(key, fromHex(parsed.nonce), this.aadBytes).decrypt(fromHex(parsed.ct))
      const blob = this.blob.safeParse(JSON.parse(new TextDecoder().decode(pt)))
      this.items = blob.success ? blob.data.items : []
      zeroise(pt)
    } catch {
      /*
        A blob that will not open is not an empty blob.

        The comment here used to say "never overwrite silently" and the code
        did exactly that: `items = []`, and the next `set()` persisted the
        empty list straight over the ciphertext. One transient wrong key — an
        interrupted v1→v2 migration, a vault restored from an export beside an
        older `activity.blob` — and the write-ahead history the design leans on
        was gone, along with the address book and the sync state, with nothing
        said. The ciphertext is copied aside under its own key first, and the
        map refuses to write until somebody decides what to do about it.
      */
      await this.quarantine(raw)
      this.items = []
      this.poisoned = true
    } finally {
      zeroise(key)
    }
    return this.items
  }

  /**
   * Keep the bytes. `<key>.sealed-quarantine.<ts>` is deliberately outside the
   * at-rest allow-list's shape for live documents: it is ciphertext nobody can
   * read without the old DEK, and it is there so a support conversation can
   * begin with "your history is still on the disk" rather than with a
   * shrug.
   */
  private async quarantine(raw: string): Promise<void> {
    try {
      const at = this.platform.now()
      await this.platform.storage.local.set(`${this.opts.key}.sealed-quarantine.${at}`, raw)
    } catch {
      // Storage that will not take a copy is storage that will not take the
      // overwrite either; `poisoned` is what actually protects the bytes.
    }
  }

  private async persist(items: Item<T>[]): Promise<void> {
    /*
      Nothing is written over a blob this map could not read. The DEK changing
      — a password rotation, a different vault unlocking — clears the flag on
      the next load, because that load is a fresh attempt with a fresh key.
    */
    if (this.poisoned)
      throw new EngineError(
        'internal',
        `${this.opts.key} could not be decrypted and has been set aside; it will not be overwritten.`,
      )
    const key = await this.key()
    const nonce = this.platform.random(24)
    const pt = new TextEncoder().encode(JSON.stringify({ v: 1, items }))
    const ct = xchacha20poly1305(key, nonce, this.aadBytes).encrypt(pt)
    zeroise(key, pt)
    await this.platform.storage.local.set(this.opts.key, JSON.stringify({ nonce: toHex(nonce), ct: toHex(ct) }))
    this.items = items
  }
}
