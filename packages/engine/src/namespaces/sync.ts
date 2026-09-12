/**
 * Sync — device pairing and non-secret state sync (master plan §6).
 *
 * Pairing: device A shows an offer QR (its X25519 + Ed25519 public keys,
 * pairing id, relay URL); device B scans it, answers with its own keys, and
 * both derive the same channel key and 6-digit SAS. The user confirms the
 * SAS on both devices; only then is the peer stored.
 *
 * Records: the families §6 lists — address book, account labels, custom
 * tokens, hidden/pinned tokens, per-site chain preferences, settings, and
 * watch/hardware account metadata — never seeds or keys. Every record is
 * signed by its author, ordered by that author's per-device sequence number
 * (`recordWins`, never the wall clock), and a delete travels as a null value
 * so the peer can tell "gone" from "not mentioned". The relay only ever sees
 * ciphertext.
 *
 * Trust: a paired device is not trusted for security-relevant state. An
 * address-book entry or a custom token arrives *unconfirmed* and waits in
 * `incoming()` until the user vouches for it on this device (§6).
 */
import {
  createDeviceIdentity,
  createPairingKeys,
  createPairingOffer,
  deriveChannel,
  isTombstone,
  nextSeq,
  openRecord,
  parsePairingOffer,
  recordWins,
  sealRecord,
  toHex,
  type Channel,
  type DeviceIdentity,
  type PairingKeys,
  type RecordStamp,
  type SealedRecord,
  type SyncRecord,
} from '@boltvault/core'
import { sha256 } from '@noble/hashes/sha256'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { SealedMap } from '../sealed'
import { authHeaders } from '../apiAuth'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import { SettingsSchema, type PairedDevice, type SyncStatus } from '../schema'
import type { SettingsStore } from '../settingsStore'
import type { ContactsStore } from './contacts'
import type { SitesService } from './sites'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const enc = new TextEncoder()

export interface Relay {
  /** `PUT /api/wallet/sync/<pairingId>/<slot>` — one opaque blob per slot (§9.5). */
  put(pairingId: string, slot: string, sealed: SealedRecord): Promise<void>
  /** `GET /api/wallet/sync/<pairingId>?author=<author>&after=<afterSeq>`. */
  list(pairingId: string, author: string, afterSeq: number): Promise<SealedRecord[]>
}

/**
 * Both devices write into one pairing id with counters of their own, so the
 * old `/{pairingId}/{seq}` address put them in the same slot: whichever wrote
 * second either lost its record or replaced the peer's. The slot now leads
 * with a fingerprint of the author's signing key, which makes it unique per
 * author while leaving §9.5's route shape — and the relay's blindness —
 * alone: the segment is opaque to the relay, and the fingerprint is the
 * prefix of a public key the relay already carries in every blob.
 */
export function authorFingerprint(signingPublicKey: string): string {
  return signingPublicKey.trim().toLowerCase().slice(0, 16)
}

export function authorSlot(signingPublicKey: string, seq: number): string {
  return `${authorFingerprint(signingPublicKey)}-${seq}`
}

/** The wire shape of a stored blob — validated on the way in, like every other boundary. */
const SealedRecordSchema = z.object({
  pairingId: z.string(),
  seq: z.number().int().nonnegative(),
  nonce: z.string(),
  ct: z.string(),
  sig: z.string(),
  authorSigningPublicKey: z.string(),
})

/** In-memory relay for tests and the in-process mobile bridge. */
export class MemoryRelay implements Relay {
  private readonly rows = new Map<string, Map<string, SealedRecord>>()
  async put(pairingId: string, slot: string, sealed: SealedRecord): Promise<void> {
    const bySlot = this.rows.get(pairingId) ?? new Map<string, SealedRecord>()
    bySlot.set(slot, sealed)
    this.rows.set(pairingId, bySlot)
  }
  async list(pairingId: string, author: string, afterSeq: number): Promise<SealedRecord[]> {
    const prefix = `${author}-`
    const out: SealedRecord[] = []
    for (const [slot, sealed] of this.rows.get(pairingId) ?? []) {
      if (!slot.startsWith(prefix)) continue
      const seq = Number(slot.slice(prefix.length))
      if (Number.isFinite(seq) && seq > afterSeq) out.push(sealed)
    }
    return out.sort((a, b) => a.seq - b.seq)
  }
}

/** The blind relay of master plan §9.5. Blobs ≤ 64 KB, 7-day TTL, no auth beyond possession. */
export class HttpRelay implements Relay {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly clientKey?: string,
  ) {}
  /** The key never travels; each call carries a signature over its own method, path and body (§9.1). */
  private headers(method: string, url: string, body: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      ...(this.clientKey
        ? authHeaders({ key: this.clientKey, method, url, body, now: Date.now() })
        : {}),
    }
  }
  async put(pairingId: string, slot: string, sealed: SealedRecord): Promise<void> {
    const url = `${this.baseUrl}/${encodeURIComponent(pairingId)}/${encodeURIComponent(slot)}`
    const body = JSON.stringify(sealed)
    const res = await this.fetchFn(url, {
      method: 'PUT',
      headers: this.headers('PUT', url, body),
      body,
    })
    if (!res.ok) throw new EngineError('internal', `relay put failed: ${res.status}`)
  }
  async list(pairingId: string, author: string, afterSeq: number): Promise<SealedRecord[]> {
    const url = `${this.baseUrl}/${encodeURIComponent(pairingId)}?author=${encodeURIComponent(author)}&after=${afterSeq}`
    const res = await this.fetchFn(url, { headers: this.headers('GET', url, '') })
    if (!res.ok) throw new EngineError('internal', `relay list failed: ${res.status}`)
    const parsed = z.array(SealedRecordSchema).safeParse(await res.json())
    return parsed.success ? parsed.data : []
  }
}

export const PairedDeviceRowSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
  signingPublicKey: z.string(),
  pairingId: z.string(),
  channelKey: z.string(),
  relayUrl: z.string(),
  pairedAt: z.number(),
  lastSeenAt: z.number().nullable(),
  /** The highest sequence number this device has written into this pairing. */
  seqOut: z.number().int().nonnegative(),
  /** The highest sequence number of the *peer's* that has been consumed here. */
  seqIn: z.number().int().nonnegative(),
})
export type PairedDeviceRow = z.infer<typeof PairedDeviceRowSchema>

/**
 * These two used to be written with `writeDoc` to `storage.secret`. On the
 * extension that area is `chrome.storage.local` under a different key prefix
 * with **no encryption** — the "ciphertext only" contract is a convention that
 * `writeDoc` does not enforce. So the device's ed25519 `signingPrivateKey` and
 * every paired device's `channelKey` sat on disk in the clear. The 2026-09
 * at-rest audit did not catch this only because that profile had never paired a
 * device, so no `sync.*` key existed in the dump. Both are now sealed under the
 * DEK. (Mobile was unaffected: its `secret` MMKV is encrypted under a
 * Keychain-held key.)
 */

const StampSchema = z.object({ seq: z.number().int().nonnegative(), authorDeviceId: z.string() })

/**
 * Something a paired device sent that this device has not vouched for yet
 * (§6). It is already in the local store, but marked untrusted: an unconfirmed
 * address-book entry is out of the lookalike reference set, an unconfirmed
 * custom token is out of the firewall's "known token" set, and an unconfirmed
 * watch or hardware account is hidden — off Receive, off the Send picker, off
 * the account list — until somebody at this device says it is theirs.
 */
/**
 * The settings a paired device may carry (§6).
 *
 * It used to be everything except `reducedMotion` and `autoLock`, which meant
 * a compromised phone could push `{ ethSignEnabled: true, sendWhitelist:
 * false, exactApprovals: false, slippageBips: 5000, txPreview: 'off' }` and
 * the desktop would adopt it on the next pull without a word. §6 says a paired
 * device is not trusted for security-relevant state, so the list is stated
 * rather than subtracted: what is here is taste and convenience, and anything
 * that decides what the firewall refuses or how much a signature may spend is
 * deliberately absent — including from the receiving end, which applies the
 * same list so an older peer's push cannot widen it.
 */
export const SYNCED_SETTINGS = [
  'displayCurrency',
  'enabledChains',
  'showTestnet',
  'haptics',
  'blockTick',
  'sound',
  'scene',
  'slippageBips',
] as const

function onlySyncedSettings(value: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const k of SYNCED_SETTINGS) if (k in value) out[k] = value[k]
  return out
}

export const SyncIncomingItemSchema = z.object({
  collection: z.enum(['contact', 'customToken', 'account']),
  key: z.string(),
  /** What to call it on screen — a contact's name, a token's symbol. */
  label: z.string(),
  /** The identity being claimed: the address, or `<symbol> on <chain>`. */
  detail: z.string(),
  fromDeviceId: z.string(),
  fromLabel: z.string(),
  /** The author's clock — provenance only ("from Pixel 8, 3 May"). */
  at: z.number().int().nonnegative(),
})
export type SyncIncomingItem = z.infer<typeof SyncIncomingItemSchema>
export type IncomingCollection = SyncIncomingItem['collection']

/**
 * Everything the merge needs to remember between runs.
 *
 * It is a document of sync's own because `SyncStatus` is the UI's view and
 * `syncMeta`'s flat `applied: Record<string, number>` was the wall-clock map
 * this replaces.
 */
const SyncStateSchema = z.object({
  /** This device's own sequence number (§6: per-device, no vector clocks). */
  seq: z.number().int().nonnegative(),
  /** The highest sequence number seen from anyone; the next write steps past it. */
  seen: z.number().int().nonnegative(),
  /** The winning `(seq, authorDeviceId)` per `<collection>:<key>`. */
  applied: z.record(z.string(), StampSchema),
  /** `<collection>:<key>` → digest of the value last pushed, so a push can diff. */
  pushed: z.record(z.string(), z.string()),
  incoming: z.array(SyncIncomingItemSchema),
})
export type SyncState = z.infer<typeof SyncStateSchema>

export const SYNC_STATE_ID = 'me'

/**
 * The merge state is sealed under the DEK like every other sync blob: its keys
 * name origins, addresses and token contracts, which is exactly what §3.2
 * promises a stolen `storage.local` will not reveal.
 */
export function createSyncStateStore(
  platform: Platform,
  dek: () => Promise<Uint8Array>,
): SealedMap<SyncState> {
  return new SealedMap<SyncState>(platform, dek, {
    key: 'sync.state.blob',
    info: 'bv/sync/state',
    aad: 'boltvault.sync.state.v1',
    schema: SyncStateSchema as unknown as z.ZodType<SyncState>,
  })
}

const emptyState = (): SyncState => ({ seq: 0, seen: 0, applied: {}, pushed: {}, incoming: [] })

const AnswerSchema = z.object({
  v: z.literal(1),
  kind: z.literal('boltvault-pair-answer'),
  pairingId: z.string(),
  deviceId: z.string(),
  label: z.string(),
  x25519PublicKey: z.string(),
  signingPublicKey: z.string(),
})
type Answer = z.infer<typeof AnswerSchema>

interface Pending {
  role: 'offer' | 'answer'
  pairingId: string
  keys: PairingKeys
  relayUrl: string
  peer: { deviceId: string; label: string; signingPublicKey: string } | null
  channel: Channel | null
}

/** One record before it is stamped and signed. */
type Draft = Omit<SyncRecord, 'seq' | 'authorDeviceId' | 'authorLabel' | 'at'>

const idOf = (collection: string, key: string): string => `${collection}:${key}`

/** Keys carry colons of their own (`52014:0x…`), so only the first one splits. */
function splitId(id: string): { collection: string; key: string } {
  const i = id.indexOf(':')
  return i < 0 ? { collection: id, key: '' } : { collection: id.slice(0, i), key: id.slice(i + 1) }
}

/** `<chainId>:<address>` — the key shape the token stores already use. */
function splitTokenKey(key: string): { chainId: number; address: string } | null {
  const i = key.indexOf(':')
  if (i < 0) return null
  const chainId = Number(key.slice(0, i))
  const address = key.slice(i + 1)
  return Number.isInteger(chainId) && chainId > 0 && address ? { chainId, address } : null
}

/**
 * A short digest of a record's value. A push sends only what changed since the
 * last one, which is also what makes the tombstone diff meaningful: the keys
 * left over are the ones that really went away.
 */
function digest(value: unknown): string {
  return toHex(sha256(enc.encode(JSON.stringify(value ?? null)))).slice(0, 16)
}

const AccountValueSchema = z.object({
  kind: z.enum(['watch', 'ledger', 'trezor', 'keystone', 'local']),
  label: z.string().max(64),
  address: z.string(),
  path: z.string().nullable(),
  deviceId: z.string().nullable(),
})
const ContactValueSchema = z.object({
  address: z.string(),
  label: z.string().max(64),
  chainId: z.number().int().positive().nullable(),
})
const CustomTokenValueSchema = z.object({
  chainId: z.number().int().positive(),
  address: z.string(),
  name: z.string().max(64),
  symbol: z.string().max(16),
  decimals: z.number().int().min(0).max(36),
})
const TokenPrefValueSchema = z.object({ pinned: z.boolean(), hidden: z.boolean() })

export interface SyncDeps {
  readonly settings: SettingsStore
  readonly sites: SitesService
  readonly vault: VaultManager
  readonly contacts: ContactsStore
  readonly tokens: TokensService
  readonly relayFor: (relayUrl: string) => Relay
  /** This device's sync identity (a private key) and its paired devices, sealed under the DEK. */
  readonly identity: SealedMap<DeviceIdentity>
  readonly devices: SealedMap<PairedDeviceRow[]>
  readonly meta: SealedMap<{ label: string | null; applied: Record<string, number> }>
  /** Ordering, the last-pushed digests, and what is waiting to be confirmed. */
  readonly state: SealedMap<SyncState>
}

export class SyncService {
  private pending: Pending | null = null
  private hook:
    ((rec: SyncRecord, from: { deviceId: string; label: string }) => Promise<boolean>) | null = null

  /** Remote sign registers here for the `signRequest` / `signResponse` collections (§6). */
  setRecordHook(
    hook: (rec: SyncRecord, from: { deviceId: string; label: string }) => Promise<boolean>,
  ): void {
    this.hook = hook
  }

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly deps: SyncDeps,
  ) {}

  private async identity(): Promise<DeviceIdentity> {
    const stored = await this.deps.identity.get('me')
    if (stored) return stored
    const id = createDeviceIdentity((n) => this.platform.random(n))
    await this.deps.identity.set('me', id)
    return id
  }

  private async label(): Promise<string> {
    const { label } = (await this.deps.meta.get('me')) ?? { label: null, applied: {} }
    return (
      label ??
      (this.platform.kind === 'mobile'
        ? 'Phone'
        : this.platform.kind === 'extension'
          ? 'Browser'
          : 'Device')
    )
  }

  private async devices(): Promise<PairedDeviceRow[]> {
    return (await this.deps.devices.get('all')) ?? []
  }

  private async saveDevices(rows: PairedDeviceRow[]): Promise<void> {
    await this.deps.devices.set('all', rows)
  }

  private async state(): Promise<SyncState> {
    return (await this.deps.state.get(SYNC_STATE_ID)) ?? emptyState()
  }

  async status(): Promise<SyncStatus> {
    const [me, label, rows] = await Promise.all([this.identity(), this.label(), this.devices()])
    const devices: PairedDevice[] = rows.map((r) => ({
      deviceId: r.deviceId,
      label: r.label,
      pairedAt: r.pairedAt,
      lastSeenAt: r.lastSeenAt,
    }))
    const p = this.pending
    return {
      deviceId: me.deviceId,
      deviceLabel: label,
      devices,
      pending:
        p && p.channel && p.peer
          ? {
              pairingId: p.pairingId,
              sas: p.channel.sas,
              peerDeviceId: p.peer.deviceId,
              role: p.role,
            }
          : null,
    }
  }

  private async emit(): Promise<SyncStatus> {
    const s = await this.status()
    this.bus.emit({ type: 'sync.changed', status: s })
    return s
  }

  async setDeviceLabel(label: string): Promise<SyncStatus> {
    await this.deps.meta.set('me', {
      ...((await this.deps.meta.get('me')) ?? { label: null, applied: {} }),
      label,
    })
    return this.emit()
  }

  async createOffer(relayUrl: string): Promise<{ offer: string }> {
    const me = await this.identity()
    const keys = createPairingKeys((n) => this.platform.random(n))
    const offer = createPairingOffer(me, keys, relayUrl, 10 * 60_000, this.platform.now(), (n) =>
      this.platform.random(n),
    )
    this.pending = {
      role: 'offer',
      pairingId: offer.pairingId,
      keys,
      relayUrl,
      peer: null,
      channel: null,
    }
    return { offer: JSON.stringify({ ...offer, label: await this.label() }) }
  }

  async acceptOffer(offerJson: string): Promise<{ sas: string; answer: string }> {
    const offer = parsePairingOffer(offerJson)
    if (!offer) throw new EngineError('invalid_argument', 'that is not a BoltVault pairing code')
    if (offer.expiresAt < this.platform.now())
      throw new EngineError('expired', 'this pairing code has expired — make a new one')
    const me = await this.identity()
    if (offer.deviceId === me.deviceId)
      throw new EngineError('invalid_argument', 'that is this device')
    const keys = createPairingKeys((n) => this.platform.random(n))
    const channel = deriveChannel(offer.pairingId, keys.x25519PrivateKey, offer.x25519PublicKey)
    const offerLabel = (JSON.parse(offerJson) as { label?: unknown }).label
    this.pending = {
      role: 'answer',
      pairingId: offer.pairingId,
      keys,
      relayUrl: offer.relayUrl,
      peer: {
        deviceId: offer.deviceId,
        label: typeof offerLabel === 'string' ? offerLabel : 'Device',
        signingPublicKey: offer.signingPublicKey,
      },
      channel,
    }
    const answer: Answer = {
      v: 1,
      kind: 'boltvault-pair-answer',
      pairingId: offer.pairingId,
      deviceId: me.deviceId,
      label: await this.label(),
      x25519PublicKey: keys.x25519PublicKey,
      signingPublicKey: me.signingPublicKey,
    }
    await this.emit()
    return { sas: channel.sas, answer: JSON.stringify(answer) }
  }

  async completeOffer(answerJson: string): Promise<{ sas: string }> {
    const p = this.pending
    if (!p || p.role !== 'offer')
      throw new EngineError('invalid_argument', 'no pairing offer is open')
    let answer: Answer
    try {
      answer = AnswerSchema.parse(JSON.parse(answerJson))
    } catch {
      throw new EngineError('invalid_argument', 'that is not a BoltVault pairing answer')
    }
    if (answer.pairingId !== p.pairingId)
      throw new EngineError('invalid_argument', 'this answer is for a different pairing')
    p.channel = deriveChannel(p.pairingId, p.keys.x25519PrivateKey, answer.x25519PublicKey)
    p.peer = {
      deviceId: answer.deviceId,
      label: answer.label,
      signingPublicKey: answer.signingPublicKey,
    }
    await this.emit()
    return { sas: p.channel.sas }
  }

  async confirm(): Promise<SyncStatus> {
    const p = this.pending
    if (!p || !p.channel || !p.peer) throw new EngineError('invalid_argument', 'nothing to confirm')
    const rows = (await this.devices()).filter((r) => r.deviceId !== p.peer?.deviceId)
    rows.push({
      deviceId: p.peer.deviceId,
      label: p.peer.label,
      signingPublicKey: p.peer.signingPublicKey,
      pairingId: p.pairingId,
      channelKey: p.channel.key,
      relayUrl: p.relayUrl,
      pairedAt: this.platform.now(),
      lastSeenAt: null,
      seqOut: 0,
      seqIn: 0,
    })
    await this.saveDevices(rows)
    /*
      A push sends only what changed since the last one, and a device that has
      just been paired has seen none of it. Forgetting the digests makes the
      first push after a pairing a full one.
    */
    const state = await this.state()
    state.pushed = {}
    await this.deps.state.set(SYNC_STATE_ID, state)
    this.pending = null
    return this.emit()
  }

  async cancelPairing(): Promise<SyncStatus> {
    this.pending = null
    return this.emit()
  }

  async unpair(deviceId: string): Promise<SyncStatus> {
    await this.saveDevices((await this.devices()).filter((r) => r.deviceId !== deviceId))
    return this.emit()
  }

  // ---- records -------------------------------------------------------------------

  /**
   * The families of §6, each read from the store that actually owns it:
   * address book (`ContactsStore`), labels (the vault's accounts), custom
   * tokens and hidden/pinned tokens (`TokensService`), connected-site chain
   * preferences (`SitesService`), settings (`SettingsStore`), watch-only and
   * hardware accounts (the vault).
   *
   * History snapshots — the ninth, and the only one §6 marks optional — stay
   * out. A snapshot is derived state that each device rebuilds from its own
   * chain scan, so sending it changes nothing the other device would not
   * arrive at anyway; meanwhile it is the largest and most revealing thing the
   * wallet holds, and the relay's blob is capped at 64 KB (§9.5).
   */
  private async collect(): Promise<Draft[]> {
    const out: Draft[] = []

    // Only the settings on the allow-list travel; see `SYNCED_SETTINGS`.
    const settings = await this.deps.settings.get()
    out.push({
      collection: 'settings',
      key: 'settings',
      value: onlySyncedSettings({ ...settings }),
    })

    for (const s of this.deps.sites.list())
      out.push({ collection: 'siteChain', key: s.origin, value: s.chainId })

    /*
      Labels, watch-only accounts and hardware metadata are one collection
      keyed by address, not three. The same address is a seed account on one
      device and watch-only on another; two collections writing the same label
      under two different keys would fight over it forever.
    */
    for (const a of await this.deps.vault.accounts()) {
      const portable =
        a.kind === 'watch' || a.kind === 'ledger' || a.kind === 'trezor' || a.kind === 'keystone'
      out.push({
        collection: 'account',
        key: a.address.toLowerCase(),
        value: {
          // `local` means "a signing account that lives on that device": its
          // label travels, the account itself cannot (§6 — keys never sync).
          kind: portable ? a.kind : 'local',
          label: a.label,
          address: a.address,
          path: a.hardware?.path ?? null,
          deviceId: a.hardware?.deviceId ?? null,
        },
      })
    }

    for (const c of await this.deps.contacts.list())
      out.push({
        collection: 'contact',
        key: c.address.toLowerCase(),
        value: { address: c.address, label: c.label, chainId: c.chainId },
      })

    for (const t of await this.deps.tokens.customList())
      out.push({
        collection: 'customToken',
        key: `${t.chainId}:${t.address.toLowerCase()}`,
        value: {
          chainId: t.chainId,
          address: t.address,
          name: t.name,
          symbol: t.symbol,
          decimals: t.decimals,
        },
      })

    // Hidden tokens — and pins, which live in the same document and are the
    // same statement about what this user cares about.
    const prefs = await this.deps.tokens.prefs()
    const pinned = new Set(prefs.pinned)
    const hidden = new Set(prefs.hidden)
    for (const k of new Set([...prefs.pinned, ...prefs.hidden]))
      out.push({
        collection: 'tokenPref',
        key: k,
        value: { pinned: pinned.has(k), hidden: hidden.has(k) },
      })

    return out
  }

  async push(): Promise<{ pushed: number }> {
    /*
      Checked before anything is read: every family below lives in a DEK-sealed
      store, and a locked store reads as empty — which the diff would take for
      "the user deleted all of it" and turn into a tombstone per key. The list
      of paired devices reads empty too, so this cannot wait until after it.
    */
    if (!(await this.deps.vault.isUnlocked()))
      throw new EngineError('locked', 'unlock before sending changes to your other devices')
    const rows = await this.devices()
    if (rows.length === 0) return { pushed: 0 }
    const me = await this.identity()
    const label = await this.label()
    const state = await this.state()

    const drafts: Draft[] = []
    const pushed: Record<string, string> = {}
    for (const d of await this.collect()) {
      const id = idOf(d.collection, d.key)
      const sum = digest(d.value)
      pushed[id] = sum
      if (state.pushed[id] !== sum) drafts.push(d)
    }
    /*
      A delete has to be said out loud. `collect()` only ever enumerates live
      rows, so a deleted contact or account simply stops being mentioned — and
      the peer, which cannot tell that from "unchanged", keeps it forever.
      Anything this device pushed before and no longer has travels as a null
      value (§6: "deletes are tombstones").
    */
    for (const id of Object.keys(state.pushed))
      if (!(id in pushed)) drafts.push({ ...splitId(id), value: null })

    let count = 0
    for (const d of drafts) {
      state.seq = nextSeq(state.seq, state.seen)
      const rec: SyncRecord = {
        ...d,
        seq: state.seq,
        authorDeviceId: me.deviceId,
        authorLabel: label,
        at: this.platform.now(),
      }
      // Our own writes are stamped too, or an older record from the peer would
      // win against an edit made here since the last pull.
      state.applied[idOf(d.collection, d.key)] = { seq: rec.seq, authorDeviceId: me.deviceId }
      count += await this.seal(rows, me, rec)
    }
    state.pushed = pushed
    await this.saveDevices(rows)
    await this.deps.state.set(SYNC_STATE_ID, state)
    return { pushed: count }
  }

  /** Seal one record to every paired device now (sign requests and answers, §6). */
  async pushOne(record: Draft): Promise<{ pushed: number }> {
    const rows = await this.devices()
    if (rows.length === 0) return { pushed: 0 }
    const me = await this.identity()
    const label = await this.label()
    const state = await this.state()
    state.seq = nextSeq(state.seq, state.seen)
    const rec: SyncRecord = {
      ...record,
      seq: state.seq,
      authorDeviceId: me.deviceId,
      authorLabel: label,
      at: this.platform.now(),
    }
    state.applied[idOf(record.collection, record.key)] = {
      seq: rec.seq,
      authorDeviceId: me.deviceId,
    }
    const count = await this.seal(rows, me, rec)
    await this.saveDevices(rows)
    await this.deps.state.set(SYNC_STATE_ID, state)
    return { pushed: count }
  }

  private async seal(
    rows: PairedDeviceRow[],
    me: DeviceIdentity,
    rec: SyncRecord,
  ): Promise<number> {
    let n = 0
    for (const row of rows) {
      const relay = this.deps.relayFor(row.relayUrl)
      const channel: Channel = { pairingId: row.pairingId, key: row.channelKey, sas: '' }
      const sealed = sealRecord(channel, me, rec, (x) => this.platform.random(x))
      await relay.put(row.pairingId, authorSlot(me.signingPublicKey, rec.seq), sealed)
      row.seqOut = Math.max(row.seqOut, rec.seq)
      n += 1
    }
    return n
  }

  async pull(): Promise<{ applied: number }> {
    // Called from a timer while remote sign waits, so a locked vault is a
    // no-op rather than a throw: the stores it would write are sealed anyway.
    if (!(await this.deps.vault.isUnlocked())) return { applied: 0 }
    const rows = await this.devices()
    if (rows.length === 0) return { applied: 0 }
    const state = await this.state()
    let count = 0
    for (const row of rows) {
      const relay = this.deps.relayFor(row.relayUrl)
      const channel: Channel = { pairingId: row.pairingId, key: row.channelKey, sas: '' }
      /*
        Author-scoped, so this device's own records can no longer move the
        cursor. They used to: `list` returned everything in the pairing and the
        loop raised `seqIn` past its own echoes, so a device that had pushed
        more records than its peer permanently skipped the peer's
        lower-numbered ones.
      */
      const sealed = await relay.list(
        row.pairingId,
        authorFingerprint(row.signingPublicKey),
        row.seqIn,
      )
      for (const s of sealed) {
        if (s.authorSigningPublicKey !== row.signingPublicKey) continue
        const rec = openRecord(channel, row.signingPublicKey, s)
        // Only a record that verified moves the cursor: the sequence number on
        // a blob that failed to open is whatever the relay chose to write.
        if (!rec) continue
        row.seqIn = Math.max(row.seqIn, s.seq)
        state.seen = Math.max(state.seen, rec.seq)
        const id = idOf(rec.collection, rec.key)
        const stamp: RecordStamp = { seq: rec.seq, authorDeviceId: rec.authorDeviceId }
        if (!recordWins(stamp, state.applied[id] ?? null)) continue
        // The order is settled whether or not the record changes anything here,
        // so a later-arriving, lower-numbered record cannot win by being late.
        state.applied[id] = stamp
        if (await this.apply(rec, row, state)) count += 1
      }
      row.lastSeenAt = this.platform.now()
    }
    await this.saveDevices(rows)
    await this.deps.state.set(SYNC_STATE_ID, state)
    if (count > 0) await this.emit()
    return { applied: count }
  }

  private async apply(rec: SyncRecord, from: PairedDeviceRow, state: SyncState): Promise<boolean> {
    const gone = isTombstone(rec)
    switch (rec.collection) {
      case 'settings':
        return gone ? false : this.applySettings(rec)
      case 'siteChain':
        return this.applySiteChain(rec, gone)
      case 'account':
        return this.applyAccount(rec, from, gone, state)
      case 'contact':
        return this.applyContact(rec, from, gone, state)
      case 'customToken':
        return this.applyCustomToken(rec, from, gone, state)
      case 'tokenPref':
        return this.applyTokenPref(rec, gone)
      default:
        return this.hook ? this.hook(rec, { deviceId: from.deviceId, label: from.label }) : false
    }
  }

  private async applySettings(rec: SyncRecord): Promise<boolean> {
    // The same list on the way in, so a peer that predates it — or one that
    // has been told to lie — cannot reach a key this device does not sync.
    const patch = SettingsSchema.partial().safeParse(
      rec.value && typeof rec.value === 'object'
        ? onlySyncedSettings(rec.value as Record<string, unknown>)
        : rec.value,
    )
    if (!patch.success || Object.keys(patch.data).length === 0) return false
    const current: Record<string, unknown> = { ...(await this.deps.settings.get()) }
    // An echo of what this device already holds is not a change, and refusing
    // to count it keeps "Applied N records" honest.
    if (
      Object.entries(patch.data).every(([k, v]) => JSON.stringify(current[k]) === JSON.stringify(v))
    )
      return false
    await this.deps.settings.set(patch.data)
    return true
  }

  private async applySiteChain(rec: SyncRecord, gone: boolean): Promise<boolean> {
    const current = this.deps.sites.get(rec.key)
    if (!current) return false
    if (gone) {
      // The peer forgot the site. Following it drops this device's session too,
      // which fails closed: the dApp can always ask again.
      await this.deps.sites.disconnect(rec.key)
      return true
    }
    const chainId = z.number().int().positive().safeParse(rec.value)
    if (!chainId.success || current.chainId === chainId.data) return false
    await this.deps.sites.setChain(rec.key, chainId.data)
    return true
  }

  private async applyAccount(
    rec: SyncRecord,
    from: PairedDeviceRow,
    gone: boolean,
    state: SyncState,
  ): Promise<boolean> {
    const key = rec.key.toLowerCase()
    const accounts = await this.deps.vault.accounts()
    const existing = accounts.find((a) => a.address.toLowerCase() === key)
    if (gone) {
      /*
        Only an account with nothing secret in it. Removing an imported account
        destroys the one copy of its private key, and §6 does not trust a paired
        device with security-relevant state — least of all that.
      */
      if (!existing) return false
      const secretless =
        existing.kind === 'watch' ||
        existing.kind === 'ledger' ||
        existing.kind === 'trezor' ||
        existing.kind === 'keystone'
      if (!secretless) return false
      await this.deps.vault.remove(existing.id)
      forget(state, 'account', key)
      return true
    }
    const parsed = AccountValueSchema.safeParse(rec.value)
    if (!parsed.success) return false
    const v = parsed.data
    if (existing) {
      // A rename has to land. This used to bail out whenever the address was
      // already here, so a relabel could never arrive at all.
      if (existing.label === v.label) return false
      await this.deps.vault.rename(existing.id, v.label)
      return true
    }
    /*
      The label is stored as the peer wrote it. It used to arrive as
      "Cold · from Laptop", which the next push then sent back as the account's
      real name — provenance ate the label in one round trip. Provenance
      belongs beside the record, not inside it.
    */
    /*
      §6 again, and for the same reason contacts are quarantined: a compromised
      phone must not be able to seat an account here. A pushed row labelled
      "Ledger" carrying the attacker's address used to appear in the account
      list and on Receive with nothing to say where it came from, which is an
      invitation to fund it. It lands hidden and waits to be claimed.
    */
    const quarantine = async (id: string): Promise<true> => {
      await this.deps.vault.setHidden(id, true)
      this.waitOn(state, {
        collection: 'account',
        key,
        label: v.label,
        detail: v.address,
        fromDeviceId: from.deviceId,
        fromLabel: rec.authorLabel || from.label,
        at: rec.at,
      })
      return true
    }
    if (v.kind === 'watch') {
      const added = await this.deps.vault.addWatch({ address: v.address, label: v.label })
      return quarantine(added.id)
    }
    // A signing account's key cannot travel (§6), so there is nothing to create.
    if (v.kind === 'local' || !v.path) return false
    const added = await this.deps.vault.addHardware({
      kind: v.kind,
      address: v.address,
      path: v.path,
      ...(v.deviceId ? { deviceId: v.deviceId } : {}),
      label: v.label,
    })
    return quarantine(added.id)
  }

  private async applyContact(
    rec: SyncRecord,
    from: PairedDeviceRow,
    gone: boolean,
    state: SyncState,
  ): Promise<boolean> {
    const key = rec.key.toLowerCase()
    const existing = (await this.deps.contacts.list()).find((c) => c.address.toLowerCase() === key)
    if (gone) {
      if (!existing) return false
      await this.deps.contacts.remove(existing.id)
      forget(state, 'contact', key)
      return true
    }
    const v = ContactValueSchema.safeParse(rec.value)
    if (!v.success) return false
    // An unchanged echo must not un-confirm what the user already vouched for.
    if (existing && existing.label === v.data.label && existing.chainId === v.data.chainId)
      return false
    /*
      §6: "a compromised phone must not be able to plant 'Mum → attacker' in the
      desktop's address book". It lands, with its provenance, but unconfirmed —
      and `ContactsStore.referenceAddresses` (the lookalike reference set)
      counts only confirmed entries.
    */
    await this.deps.contacts.add({
      address: v.data.address,
      label: v.data.label,
      chainId: v.data.chainId,
      confirmed: false,
    })
    this.waitOn(state, {
      collection: 'contact',
      key,
      label: v.data.label,
      detail: v.data.address,
      fromDeviceId: from.deviceId,
      fromLabel: rec.authorLabel || from.label,
      at: rec.at,
    })
    return true
  }

  private async applyCustomToken(
    rec: SyncRecord,
    from: PairedDeviceRow,
    gone: boolean,
    state: SyncState,
  ): Promise<boolean> {
    const parts = splitTokenKey(rec.key)
    if (!parts) return false
    const existing = (await this.deps.tokens.customList()).find(
      (t) => t.chainId === parts.chainId && t.address.toLowerCase() === parts.address.toLowerCase(),
    )
    if (gone) {
      if (!existing) return false
      await this.deps.tokens.removeCustom(parts.chainId, parts.address)
      forget(state, 'customToken', rec.key)
      return true
    }
    const v = CustomTokenValueSchema.safeParse(rec.value)
    if (!v.success) return false
    if (
      existing &&
      existing.symbol === v.data.symbol &&
      existing.name === v.data.name &&
      existing.decimals === v.data.decimals
    )
      return false
    /*
      §6 again: a paired device must not be able to plant a fake "USDC". The
      token is added so the user can see what was claimed, but it is untrusted
      for "known token" identity until confirmed here — `unconfirmedTokens()`
      is what keeps it out of the firewall's token map.
    */
    await this.deps.tokens.addSynced(v.data)
    this.waitOn(state, {
      collection: 'customToken',
      key: rec.key,
      label: v.data.symbol,
      detail: v.data.address,
      fromDeviceId: from.deviceId,
      fromLabel: rec.authorLabel || from.label,
      at: rec.at,
    })
    return true
  }

  private async applyTokenPref(rec: SyncRecord, gone: boolean): Promise<boolean> {
    const parts = splitTokenKey(rec.key)
    if (!parts) return false
    const prefs = await this.deps.tokens.prefs()
    const here = { pinned: prefs.pinned.includes(rec.key), hidden: prefs.hidden.includes(rec.key) }
    // A tombstone means the token is neither pinned nor hidden there any more.
    const want = gone
      ? { pinned: false, hidden: false }
      : TokenPrefValueSchema.safeParse(rec.value).data
    if (!want) return false
    if (here.pinned === want.pinned && here.hidden === want.hidden) return false
    await this.deps.tokens.setPrefs(parts.chainId, parts.address, {
      pinned: want.pinned,
      hidden: want.hidden,
    })
    return true
  }

  /** Park an arrival in the "waiting to be confirmed" list, replacing any older claim on the same key. */
  private waitOn(state: SyncState, item: SyncIncomingItem): void {
    state.incoming = [
      ...state.incoming.filter((i) => !(i.collection === item.collection && i.key === item.key)),
      item,
    ]
  }

  // ---- untrusted until confirmed (§6) --------------------------------------------

  /** Address-book entries and custom tokens a peer sent that nobody has vouched for here. */
  async incoming(): Promise<SyncIncomingItem[]> {
    return [...(await this.state()).incoming].sort((a, b) => b.at - a.at)
  }

  /**
   * `<chainId>:<address>` for every synced custom token still unconfirmed. The
   * firewall's "known token" map is built from this — an unconfirmed token is
   * shown, but it is nobody's idea of USDC.
   */
  async unconfirmedTokens(): Promise<string[]> {
    return (await this.state()).incoming
      .filter((i) => i.collection === 'customToken')
      .map((i) => i.key.toLowerCase())
  }

  async confirmIncoming(input: {
    collection: IncomingCollection
    key: string
  }): Promise<SyncIncomingItem[]> {
    const state = await this.state()
    const item = state.incoming.find(
      (i) => i.collection === input.collection && i.key === input.key,
    )
    if (!item) throw new EngineError('not_found', 'nothing is waiting for that')
    if (item.collection === 'contact') {
      const c = (await this.deps.contacts.list()).find((x) => x.address.toLowerCase() === item.key)
      if (c) await this.deps.contacts.confirm(c.id)
    }
    if (item.collection === 'account') {
      const a = (await this.deps.vault.accounts()).find((x) => x.address.toLowerCase() === item.key)
      if (a) await this.deps.vault.setHidden(a.id, false)
    }
    forget(state, item.collection, item.key)
    await this.deps.state.set(SYNC_STATE_ID, state)
    await this.emit()
    return this.incoming()
  }

  /** Refuse one. It goes from this device, and the refusal does not travel back. */
  async rejectIncoming(input: {
    collection: IncomingCollection
    key: string
  }): Promise<SyncIncomingItem[]> {
    const state = await this.state()
    const item = state.incoming.find(
      (i) => i.collection === input.collection && i.key === input.key,
    )
    if (!item) throw new EngineError('not_found', 'nothing is waiting for that')
    if (item.collection === 'contact') {
      const c = (await this.deps.contacts.list()).find((x) => x.address.toLowerCase() === item.key)
      if (c) await this.deps.contacts.remove(c.id)
    } else if (item.collection === 'account') {
      const a = (await this.deps.vault.accounts()).find((x) => x.address.toLowerCase() === item.key)
      if (a) await this.deps.vault.remove(a.id)
    } else {
      const parts = splitTokenKey(item.key)
      if (parts) await this.deps.tokens.removeCustom(parts.chainId, parts.address)
    }
    /*
      Forgetting the digest keeps the next push from turning this refusal into
      a tombstone. The peer still wants the entry; "no thanks" here is a local
      answer, not a delete there.
    */
    delete state.pushed[idOf(item.collection, item.key)]
    forget(state, item.collection, item.key)
    await this.deps.state.set(SYNC_STATE_ID, state)
    await this.emit()
    return this.incoming()
  }
}

function forget(state: SyncState, collection: IncomingCollection, key: string): void {
  state.incoming = state.incoming.filter((i) => !(i.collection === collection && i.key === key))
}

const IncomingRef = z.object({
  collection: z.enum(['contact', 'customToken', 'account']),
  key: z.string().min(1).max(256),
})

export function syncNamespace(sync: SyncService): NamespaceSpec {
  return {
    status: { handler: () => sync.status() },
    setDeviceLabel: {
      input: z.object({ label: z.string().trim().min(1).max(32) }),
      handler: (arg) => sync.setDeviceLabel((arg as { label: string }).label),
    },
    createOffer: {
      input: z.object({ relayUrl: z.string().min(1) }),
      handler: (arg) => sync.createOffer((arg as { relayUrl: string }).relayUrl),
    },
    acceptOffer: {
      input: z.object({ offer: z.string().min(1) }),
      handler: (arg) => sync.acceptOffer((arg as { offer: string }).offer),
    },
    completeOffer: {
      input: z.object({ answer: z.string().min(1) }),
      handler: (arg) => sync.completeOffer((arg as { answer: string }).answer),
    },
    confirm: { handler: () => sync.confirm() },
    cancelPairing: { handler: () => sync.cancelPairing() },
    unpair: {
      input: z.object({ deviceId: z.string() }),
      handler: (arg) => sync.unpair((arg as { deviceId: string }).deviceId),
    },
    push: { handler: () => sync.push() },
    pull: { handler: () => sync.pull() },
    incoming: { handler: () => sync.incoming() },
    confirmIncoming: {
      input: IncomingRef,
      handler: (arg) =>
        sync.confirmIncoming(arg as { collection: IncomingCollection; key: string }),
    },
    rejectIncoming: {
      input: IncomingRef,
      handler: (arg) => sync.rejectIncoming(arg as { collection: IncomingCollection; key: string }),
    },
  }
}
