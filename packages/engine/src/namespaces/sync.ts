/**
 * Sync — device pairing and non-secret state sync (master plan §6).
 *
 * Pairing: device A shows an offer QR (its X25519 + Ed25519 public keys,
 * pairing id, relay URL); device B scans it, answers with its own keys, and
 * both derive the same channel key and 6-digit SAS. The user confirms the
 * SAS on both devices; only then is the peer stored.
 *
 * Records: settings, per-site chain preferences, and watch/hardware account
 * metadata — never seeds or keys. Every record is signed by its author and
 * shown with provenance; synced accounts are labelled with the device they
 * came from. The relay only ever sees ciphertext.
 */
import {
  createDeviceIdentity,
  createPairingKeys,
  createPairingOffer,
  deriveChannel,
  openRecord,
  parsePairingOffer,
  sealRecord,
  type Channel,
  type DeviceIdentity,
  type PairingKeys,
  type SealedRecord,
  type SyncRecord,
} from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { PairedDevice, Settings, SyncStatus } from '../schema'
import type { SettingsStore } from '../settingsStore'
import { readDoc, writeDoc, type DocSpec } from '../storage'
import type { SitesService } from './sites'
import type { VaultManager } from './vault'

export interface Relay {
  put(pairingId: string, sealed: SealedRecord): Promise<void>
  list(pairingId: string, afterSeq: number): Promise<SealedRecord[]>
}

/** In-memory relay for tests and the in-process mobile bridge. */
export class MemoryRelay implements Relay {
  private readonly rows = new Map<string, SealedRecord[]>()
  async put(pairingId: string, sealed: SealedRecord): Promise<void> {
    const list = this.rows.get(pairingId) ?? []
    if (!list.some((r) => r.seq === sealed.seq && r.authorSigningPublicKey === sealed.authorSigningPublicKey)) list.push(sealed)
    this.rows.set(pairingId, list)
  }
  async list(pairingId: string, afterSeq: number): Promise<SealedRecord[]> {
    return (this.rows.get(pairingId) ?? []).filter((r) => r.seq > afterSeq).sort((a, b) => a.seq - b.seq)
  }
}

/** The blind relay of master plan §9.5. Blobs ≤ 64 KB, 7-day TTL, no auth beyond possession. */
export class HttpRelay implements Relay {
  constructor(
    private readonly baseUrl: string,
    private readonly fetchFn: typeof fetch = fetch,
    private readonly clientKey?: string,
  ) {}
  private headers(): Record<string, string> {
    return { 'content-type': 'application/json', ...(this.clientKey ? { 'X-BoltVault-Key': this.clientKey } : {}) }
  }
  async put(pairingId: string, sealed: SealedRecord): Promise<void> {
    const res = await this.fetchFn(`${this.baseUrl}/${pairingId}/${sealed.seq}`, { method: 'PUT', headers: this.headers(), body: JSON.stringify(sealed) })
    if (!res.ok) throw new EngineError('internal', `relay put failed: ${res.status}`)
  }
  async list(pairingId: string, afterSeq: number): Promise<SealedRecord[]> {
    const res = await this.fetchFn(`${this.baseUrl}/${pairingId}?after=${afterSeq}`, { headers: this.headers() })
    if (!res.ok) throw new EngineError('internal', `relay list failed: ${res.status}`)
    return (await res.json()) as SealedRecord[]
  }
}

const PairedDeviceRowSchema = z.object({
  deviceId: z.string(),
  label: z.string(),
  signingPublicKey: z.string(),
  pairingId: z.string(),
  channelKey: z.string(),
  relayUrl: z.string(),
  pairedAt: z.number(),
  lastSeenAt: z.number().nullable(),
  seqOut: z.number().int().nonnegative(),
  seqIn: z.number().int().nonnegative(),
})
type PairedDeviceRow = z.infer<typeof PairedDeviceRowSchema>

const DEVICES_DOC: DocSpec<PairedDeviceRow[]> = { key: 'sync.devices', version: 1, schema: z.array(PairedDeviceRowSchema), defaultValue: () => [] }
const IDENTITY_DOC: DocSpec<DeviceIdentity | null> = {
  key: 'sync.identity',
  version: 1,
  schema: z.object({ deviceId: z.string(), signingPrivateKey: z.string(), signingPublicKey: z.string() }).nullable(),
  defaultValue: () => null,
}
const LABEL_DOC: DocSpec<{ label: string | null }> = { key: 'sync.label', version: 1, schema: z.object({ label: z.string().nullable() }), defaultValue: () => ({ label: null }) }
const APPLIED_DOC: DocSpec<Record<string, number>> = { key: 'sync.applied', version: 1, schema: z.record(z.string(), z.number()), defaultValue: () => ({}) }

const AnswerSchema = z.object({ v: z.literal(1), kind: z.literal('boltvault-pair-answer'), pairingId: z.string(), deviceId: z.string(), label: z.string(), x25519PublicKey: z.string(), signingPublicKey: z.string() })
type Answer = z.infer<typeof AnswerSchema>

interface Pending {
  role: 'offer' | 'answer'
  pairingId: string
  keys: PairingKeys
  relayUrl: string
  peer: { deviceId: string; label: string; signingPublicKey: string } | null
  channel: Channel | null
}

export interface SyncDeps {
  readonly settings: SettingsStore
  readonly sites: SitesService
  readonly vault: VaultManager
  readonly relayFor: (relayUrl: string) => Relay
}

export class SyncService {
  private pending: Pending | null = null

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    private readonly deps: SyncDeps,
  ) {}

  private async identity(): Promise<DeviceIdentity> {
    const stored = (await readDoc(this.platform.storage.secret, IDENTITY_DOC, () => this.platform.now())).value
    if (stored) return stored
    const id = createDeviceIdentity((n) => this.platform.random(n))
    await writeDoc(this.platform.storage.secret, IDENTITY_DOC, id)
    return id
  }

  private async label(): Promise<string> {
    const { label } = (await readDoc(this.platform.storage.local, LABEL_DOC, () => this.platform.now())).value
    return label ?? (this.platform.kind === 'mobile' ? 'Phone' : this.platform.kind === 'extension' ? 'Browser' : 'Device')
  }

  private async devices(): Promise<PairedDeviceRow[]> {
    return (await readDoc(this.platform.storage.secret, DEVICES_DOC, () => this.platform.now())).value
  }

  private async saveDevices(rows: PairedDeviceRow[]): Promise<void> {
    await writeDoc(this.platform.storage.secret, DEVICES_DOC, rows)
  }

  async status(): Promise<SyncStatus> {
    const [me, label, rows] = await Promise.all([this.identity(), this.label(), this.devices()])
    const devices: PairedDevice[] = rows.map((r) => ({ deviceId: r.deviceId, label: r.label, pairedAt: r.pairedAt, lastSeenAt: r.lastSeenAt }))
    const p = this.pending
    return {
      deviceId: me.deviceId,
      deviceLabel: label,
      devices,
      pending: p && p.channel && p.peer ? { pairingId: p.pairingId, sas: p.channel.sas, peerDeviceId: p.peer.deviceId, role: p.role } : null,
    }
  }

  private async emit(): Promise<SyncStatus> {
    const s = await this.status()
    this.bus.emit({ type: 'sync.changed', status: s })
    return s
  }

  async setDeviceLabel(label: string): Promise<SyncStatus> {
    await writeDoc(this.platform.storage.local, LABEL_DOC, { label })
    return this.emit()
  }

  async createOffer(relayUrl: string): Promise<{ offer: string }> {
    const me = await this.identity()
    const keys = createPairingKeys((n) => this.platform.random(n))
    const offer = createPairingOffer(me, keys, relayUrl, 10 * 60_000, this.platform.now(), (n) => this.platform.random(n))
    this.pending = { role: 'offer', pairingId: offer.pairingId, keys, relayUrl, peer: null, channel: null }
    return { offer: JSON.stringify({ ...offer, label: await this.label() }) }
  }

  async acceptOffer(offerJson: string): Promise<{ sas: string; answer: string }> {
    const offer = parsePairingOffer(offerJson)
    if (!offer) throw new EngineError('invalid_argument', 'that is not a BoltVault pairing code')
    if (offer.expiresAt < this.platform.now()) throw new EngineError('expired', 'this pairing code has expired — make a new one')
    const me = await this.identity()
    if (offer.deviceId === me.deviceId) throw new EngineError('invalid_argument', 'that is this device')
    const keys = createPairingKeys((n) => this.platform.random(n))
    const channel = deriveChannel(offer.pairingId, keys.x25519PrivateKey, offer.x25519PublicKey)
    const offerLabel = (JSON.parse(offerJson) as { label?: unknown }).label
    this.pending = {
      role: 'answer',
      pairingId: offer.pairingId,
      keys,
      relayUrl: offer.relayUrl,
      peer: { deviceId: offer.deviceId, label: typeof offerLabel === 'string' ? offerLabel : 'Device', signingPublicKey: offer.signingPublicKey },
      channel,
    }
    const answer: Answer = { v: 1, kind: 'boltvault-pair-answer', pairingId: offer.pairingId, deviceId: me.deviceId, label: await this.label(), x25519PublicKey: keys.x25519PublicKey, signingPublicKey: me.signingPublicKey }
    await this.emit()
    return { sas: channel.sas, answer: JSON.stringify(answer) }
  }

  async completeOffer(answerJson: string): Promise<{ sas: string }> {
    const p = this.pending
    if (!p || p.role !== 'offer') throw new EngineError('invalid_argument', 'no pairing offer is open')
    let answer: Answer
    try {
      answer = AnswerSchema.parse(JSON.parse(answerJson))
    } catch {
      throw new EngineError('invalid_argument', 'that is not a BoltVault pairing answer')
    }
    if (answer.pairingId !== p.pairingId) throw new EngineError('invalid_argument', 'this answer is for a different pairing')
    p.channel = deriveChannel(p.pairingId, p.keys.x25519PrivateKey, answer.x25519PublicKey)
    p.peer = { deviceId: answer.deviceId, label: answer.label, signingPublicKey: answer.signingPublicKey }
    await this.emit()
    return { sas: p.channel.sas }
  }

  async confirm(): Promise<SyncStatus> {
    const p = this.pending
    if (!p || !p.channel || !p.peer) throw new EngineError('invalid_argument', 'nothing to confirm')
    const rows = (await this.devices()).filter((r) => r.deviceId !== p.peer?.deviceId)
    rows.push({ deviceId: p.peer.deviceId, label: p.peer.label, signingPublicKey: p.peer.signingPublicKey, pairingId: p.pairingId, channelKey: p.channel.key, relayUrl: p.relayUrl, pairedAt: this.platform.now(), lastSeenAt: null, seqOut: 0, seqIn: 0 })
    await this.saveDevices(rows)
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

  private async collect(): Promise<Array<Omit<SyncRecord, 'seq' | 'authorDeviceId' | 'authorLabel' | 'at'>>> {
    const out: Array<Omit<SyncRecord, 'seq' | 'authorDeviceId' | 'authorLabel' | 'at'>> = []
    const settings = await this.deps.settings.get()
    const { reducedMotion: _os, autoLock: _local, ...shared } = settings
    out.push({ collection: 'settings', key: 'settings', value: shared })
    for (const s of this.deps.sites.list()) out.push({ collection: 'siteChain', key: s.origin, value: s.chainId })
    for (const a of await this.deps.vault.accounts()) {
      if (a.kind === 'watch' || a.kind === 'ledger' || a.kind === 'trezor' || a.kind === 'keystone') {
        out.push({ collection: 'account', key: a.address.toLowerCase(), value: { kind: a.kind, label: a.label, address: a.address, path: a.hardware?.path ?? null, deviceId: a.hardware?.deviceId ?? null } })
      }
    }
    return out
  }

  async push(): Promise<{ pushed: number }> {
    const me = await this.identity()
    const label = await this.label()
    const rows = await this.devices()
    const records = await this.collect()
    let pushed = 0
    for (const row of rows) {
      const relay = this.deps.relayFor(row.relayUrl)
      const channel: Channel = { pairingId: row.pairingId, key: row.channelKey, sas: '' }
      for (const r of records) {
        row.seqOut += 1
        const rec: SyncRecord = { ...r, seq: row.seqOut, authorDeviceId: me.deviceId, authorLabel: label, at: this.platform.now() }
        await relay.put(row.pairingId, sealRecord(channel, me, rec, (n) => this.platform.random(n)))
        pushed += 1
      }
    }
    await this.saveDevices(rows)
    return { pushed }
  }

  async pull(): Promise<{ applied: number }> {
    const me = await this.identity()
    const rows = await this.devices()
    const applied = (await readDoc(this.platform.storage.local, APPLIED_DOC, () => this.platform.now())).value
    let count = 0
    for (const row of rows) {
      const relay = this.deps.relayFor(row.relayUrl)
      const channel: Channel = { pairingId: row.pairingId, key: row.channelKey, sas: '' }
      const sealed = await relay.list(row.pairingId, row.seqIn)
      for (const s of sealed) {
        if (s.authorSigningPublicKey === me.signingPublicKey) {
          row.seqIn = Math.max(row.seqIn, s.seq)
          continue // our own records echoing back
        }
        const rec = openRecord(channel, row.signingPublicKey, s)
        row.seqIn = Math.max(row.seqIn, s.seq)
        if (!rec) continue
        const k = `${rec.collection}:${rec.key}`
        if ((applied[k] ?? 0) >= rec.at) continue // last-writer-wins by author timestamp
        if (await this.apply(rec, row)) {
          applied[k] = rec.at
          count += 1
        }
      }
      row.lastSeenAt = this.platform.now()
    }
    await this.saveDevices(rows)
    await writeDoc(this.platform.storage.local, APPLIED_DOC, applied)
    if (count > 0) await this.emit()
    return { applied: count }
  }

  private async apply(rec: SyncRecord, from: PairedDeviceRow): Promise<boolean> {
    switch (rec.collection) {
      case 'settings': {
        const patch = rec.value as Partial<Settings>
        await this.deps.settings.set(patch)
        return true
      }
      case 'siteChain': {
        const chainId = typeof rec.value === 'number' ? rec.value : null
        if (chainId === null) return false
        if (!this.deps.sites.get(rec.key)) return false
        await this.deps.sites.setChain(rec.key, chainId)
        return true
      }
      case 'account': {
        if (rec.value === null) return false
        const v = rec.value as { kind: string; label: string; address: string; path: string | null; deviceId: string | null }
        const existing = await this.deps.vault.accounts()
        if (existing.some((a) => a.address.toLowerCase() === v.address.toLowerCase())) return false
        const label = `${v.label} · from ${from.label}`
        if (v.kind === 'watch') await this.deps.vault.addWatch({ address: v.address, label })
        else if ((v.kind === 'ledger' || v.kind === 'trezor' || v.kind === 'keystone') && v.path) await this.deps.vault.addHardware({ kind: v.kind, address: v.address, path: v.path, ...(v.deviceId ? { deviceId: v.deviceId } : {}), label })
        else return false
        return true
      }
      default:
        return false
    }
  }
}

export function syncNamespace(sync: SyncService): NamespaceSpec {
  return {
    status: { handler: () => sync.status() },
    setDeviceLabel: { input: z.object({ label: z.string().trim().min(1).max(32) }), handler: (arg) => sync.setDeviceLabel((arg as { label: string }).label) },
    createOffer: { input: z.object({ relayUrl: z.string().min(1) }), handler: (arg) => sync.createOffer((arg as { relayUrl: string }).relayUrl) },
    acceptOffer: { input: z.object({ offer: z.string().min(1) }), handler: (arg) => sync.acceptOffer((arg as { offer: string }).offer) },
    completeOffer: { input: z.object({ answer: z.string().min(1) }), handler: (arg) => sync.completeOffer((arg as { answer: string }).answer) },
    confirm: { handler: () => sync.confirm() },
    cancelPairing: { handler: () => sync.cancelPairing() },
    unpair: { input: z.object({ deviceId: z.string() }), handler: (arg) => sync.unpair((arg as { deviceId: string }).deviceId) },
    push: { handler: () => sync.push() },
    pull: { handler: () => sync.pull() },
  }
}
