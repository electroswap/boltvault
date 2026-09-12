/**
 * The address book (master plan §3.2 "sealed"): labels for addresses the
 * user chose to keep. Sealed under HKDF(DEK, 'bv/contacts') like Activity;
 * entries count as the lookalike reference set (§3.6). Synced entries from
 * another device are untrusted until confirmed here (§6) — they carry
 * `confirmed: false` and are excluded from the reference set until then.
 */
import { xchacha20poly1305 } from '@noble/ciphers/chacha'
import { hkdf } from '@noble/hashes/hkdf'
import { sha256 } from '@noble/hashes/sha256'
import { fromHex, toHex, zeroise } from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { getAddress, isAddress } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { ContactViewSchema, type ContactView } from '../schema'

const KEY_BLOB = 'contacts.blob'
const AAD = new TextEncoder().encode('boltvault.contacts.v1')
const BlobSchema = z.object({ v: z.literal(1), entries: z.array(ContactViewSchema) })

export class ContactsStore {
  private cache: ContactView[] | null = null
  /** The stored blob would not open under this key; refuse to write over it. */
  /**
   * What the last read of the blob found (ES-BV-062). `'kept'` means the
   * ciphertext could not be read but a copy is safely aside, so a fresh blob
   * may be started; `'unsafe'` means even the copy failed, and then nothing is
   * written over the bytes.
   */
  private poisoned: 'no' | 'kept' | 'unsafe' = 'no'

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly dek: () => Promise<Uint8Array>,
  ) {}

  private async key(): Promise<Uint8Array> {
    const dek = await this.dek()
    const key = hkdf(sha256, dek, undefined, new TextEncoder().encode('bv/contacts'), 32)
    zeroise(dek)
    return key
  }

  async list(): Promise<ContactView[]> {
    try {
      return [...(await this.load())].sort((a, b) => a.label.localeCompare(b.label))
    } catch (err) {
      if (err instanceof EngineError && err.code === 'locked') return []
      throw err
    }
  }

  /** Addresses that count as "known" for the poison rule: confirmed on this device. */
  async referenceAddresses(): Promise<string[]> {
    return (await this.list()).filter((c) => c.confirmed).map((c) => c.address)
  }

  private async load(): Promise<ContactView[]> {
    if (this.cache) return this.cache
    const key = await this.key()
    const raw = await this.platform.storage.local.get(KEY_BLOB)
    if (raw === null) {
      this.cache = []
      return this.cache
    }
    try {
      const parsed = JSON.parse(raw) as { nonce: string; ct: string }
      const pt = xchacha20poly1305(key, fromHex(parsed.nonce), AAD).decrypt(fromHex(parsed.ct))
      const blob = BlobSchema.safeParse(JSON.parse(new TextDecoder().decode(pt)))
      this.cache = blob.success ? blob.data.entries : []
    } catch {
      /*
        A blob that will not open is not an empty address book (ES-BV-012).

        `cache = []` and the next `add` wrote the empty list straight over the
        ciphertext, so one transient wrong key took every saved name with it —
        and the address book is what the firewall's lookalike check reads as
        its reference set, so losing it quietly weakens the wallet as well as
        the user's own records. The bytes are copied aside and this store
        refuses to write until somebody decides what to do about them.
      */
      const kept = await this.quarantine(raw)
      this.cache = []
      this.poisoned = kept ? 'kept' : 'unsafe'
    }
    return this.cache
  }

  /** Keep the bytes under their own key; only the old DEK can read them. */
  private async quarantine(raw: string): Promise<boolean> {
    try {
      await this.platform.storage.local.set(`${KEY_BLOB}.sealed-quarantine.${this.platform.now()}`, raw)
      return true
    } catch {
      // Storage that will not take a copy will not take the overwrite either.
      return false
    }
  }

  private async persist(entries: ContactView[]): Promise<void> {
    // Nothing is written over an address book this store could not read: it is
    // the firewall's lookalike reference set as well as the user's records.
    if (this.poisoned !== 'no')
      throw new EngineError(
        'internal',
        this.poisoned === 'kept'
          ? 'The address book could not be read and has been set aside; it will not be overwritten.'
          : 'The address book could not be read and no copy of it could be made; it will not be overwritten.',
      )
    const key = await this.key()
    const nonce = this.platform.random(24)
    const ct = xchacha20poly1305(key, nonce, AAD).encrypt(new TextEncoder().encode(JSON.stringify({ v: 1, entries })))
    await this.platform.storage.local.set(KEY_BLOB, JSON.stringify({ nonce: toHex(nonce), ct: toHex(ct) }))
    this.cache = entries
    this.bus.emit({ type: 'contacts.changed', contacts: await this.list() })
  }

  async add(input: { address: string; label: string; chainId?: number | null; confirmed?: boolean }): Promise<ContactView> {
    if (!isAddress(input.address)) throw new EngineError('invalid_argument', 'not an address')
    const address = getAddress(input.address)
    const entries = await this.load()
    const existing = entries.find((c) => c.address.toLowerCase() === address.toLowerCase())
    const entry: ContactView = {
      id: existing?.id ?? toHex(this.platform.random(8)),
      address,
      label: input.label.trim().slice(0, 64) || address.slice(0, 10),
      chainId: input.chainId ?? null,
      confirmed: input.confirmed ?? true,
      createdAt: existing?.createdAt ?? this.platform.now(),
    }
    await this.persist([...entries.filter((c) => c.id !== entry.id), entry])
    return entry
  }

  async remove(id: string): Promise<void> {
    await this.persist((await this.load()).filter((c) => c.id !== id))
  }

  async confirm(id: string): Promise<void> {
    await this.persist((await this.load()).map((c) => (c.id === id ? { ...c, confirmed: true } : c)))
  }

  forget(): void {
    this.cache = null
    this.poisoned = 'no'
  }
}

export function contactsNamespace(contacts: ContactsStore): NamespaceSpec {
  return {
    list: { handler: () => contacts.list() },
    add: {
      input: z.object({ address: z.string(), label: z.string().min(1).max(64), chainId: z.number().int().positive().nullable().optional() }),
      handler: (arg) => contacts.add(arg as { address: string; label: string; chainId?: number | null }),
    },
    remove: { input: z.object({ id: z.string() }), handler: (arg) => contacts.remove((arg as { id: string }).id) },
    confirm: { input: z.object({ id: z.string() }), handler: (arg) => contacts.confirm((arg as { id: string }).id) },
  }
}
