/**
 * Signed statics in the engine (master plan §3.6, §3.7, §9.4): `flags.json`
 * (kill-switches, minimum version, a notice) and `scam-origins.json`, each
 * with a detached `.sig`, fetched at boot and every six hours, verified
 * against the baked-in key, refused when unsigned or older than what is
 * held, and kept as last-good across restarts. Flags only ever disable.
 */
import { DEFAULT_FLAGS, FlagsSchema, ScamOriginsSchema, semverAtLeast, verifyStatic, type Flags } from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import type { EventBus, NamespaceSpec } from '../host'
import type { FlagsView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'

export const STATICS_ALARM = 'bv.statics'
const REFRESH_MS = 6 * 60 * 60_000
export const STATICS_BASE = 'https://static.electroswap.io/wallet'

export interface StaticsDeps {
  readonly platform: Platform
  readonly bus: EventBus
  readonly fetch: typeof fetch
  /** `BoltVault/0.1.0` (web3_clientVersion); the number after the slash is compared with `minVersion`. */
  readonly clientVersion: string
  readonly body: 'extension' | 'mobile'
  readonly baseUrl?: string
  /** Tests: a different public key. */
  readonly publicKeyHex?: string
}

// Stored flags are always the parsed shape; validating with a predicate keeps the doc's input and output types the same.
const FLAGS_DOC: DocSpec<{ flags: Flags; fetchedAt: number | null }> = { key: 'statics.flags', version: 1, schema: z.object({ flags: z.custom<Flags>((v) => FlagsSchema.safeParse(v).success), fetchedAt: z.number().nullable() }), defaultValue: () => ({ flags: DEFAULT_FLAGS, fetchedAt: null }) }
const SCAM_DOC: DocSpec<{ issuedAt: number; origins: string[] }> = { key: 'statics.scam', version: 1, schema: z.object({ issuedAt: z.number(), origins: z.array(z.string()) }), defaultValue: () => ({ issuedAt: 0, origins: [] }) }

export class StaticsService {
  private flagsState: { flags: Flags; fetchedAt: number | null } = { flags: DEFAULT_FLAGS, fetchedAt: null }
  private scam: { issuedAt: number; origins: string[] } = { issuedAt: 0, origins: [] }
  private hydrated = false
  private problem: string | null = null

  constructor(private readonly deps: StaticsDeps) {
    deps.platform.alarms.onFire((name) => {
      if (name === STATICS_ALARM) void this.refresh().finally(() => this.schedule())
    })
  }

  private schedule(): void {
    void this.deps.platform.alarms.schedule(STATICS_ALARM, this.deps.platform.now() + REFRESH_MS).catch(() => undefined)
  }

  async hydrate(): Promise<void> {
    if (this.hydrated) return
    this.hydrated = true
    const now = () => this.deps.platform.now()
    this.flagsState = (await readDoc(this.deps.platform.storage.local, FLAGS_DOC, now)).value
    this.scam = (await readDoc(this.deps.platform.storage.local, SCAM_DOC, now)).value
    this.schedule()
  }

  /** Fetch a document and its detached signature; null unless the signature verifies. */
  private async fetchSigned(name: string): Promise<{ bytes: Uint8Array; json: unknown } | null> {
    const base = this.deps.baseUrl ?? STATICS_BASE
    const [doc, sig] = await Promise.all([this.deps.fetch(`${base}/${name}`, { cache: 'no-store' }), this.deps.fetch(`${base}/${name}.sig`, { cache: 'no-store' })])
    if (!doc.ok) throw new Error(`${name}: ${doc.status}`)
    const bytes = new Uint8Array(await doc.arrayBuffer())
    // No signature, or one that does not verify: refused (§3.7), never taken on trust.
    if (!sig.ok) return null
    const signature = (await sig.text()).trim()
    if (!verifyStatic(bytes, signature, this.deps.publicKeyHex)) return null
    return { bytes, json: JSON.parse(new TextDecoder().decode(bytes)) as unknown }
  }

  /** Refresh both files; a bad signature or an older file changes nothing. */
  async refresh(): Promise<{ flags: 'updated' | 'kept' | 'refused'; scam: 'updated' | 'kept' | 'refused' }> {
    await this.hydrate()
    const out = { flags: 'kept' as 'updated' | 'kept' | 'refused', scam: 'kept' as 'updated' | 'kept' | 'refused' }
    this.problem = null
    try {
      const f = await this.fetchSigned('flags.json')
      const parsed = f ? FlagsSchema.safeParse(f.json) : null
      if (!f || !parsed?.success) out.flags = 'refused'
      else if (parsed.data.issuedAt < this.flagsState.flags.issuedAt) out.flags = 'refused'
      else {
        this.flagsState = { flags: parsed.data, fetchedAt: this.deps.platform.now() }
        await writeDoc(this.deps.platform.storage.local, FLAGS_DOC, this.flagsState)
        out.flags = 'updated'
      }
    } catch (err) {
      this.problem = err instanceof Error ? err.message : String(err)
    }
    try {
      const s = await this.fetchSigned('scam-origins.json')
      const parsed = s ? ScamOriginsSchema.safeParse(s.json) : null
      if (!s || !parsed?.success) out.scam = 'refused'
      else if (parsed.data.issuedAt < this.scam.issuedAt) out.scam = 'refused'
      else {
        this.scam = { issuedAt: parsed.data.issuedAt, origins: parsed.data.origins }
        await writeDoc(this.deps.platform.storage.local, SCAM_DOC, this.scam)
        out.scam = 'updated'
      }
    } catch (err) {
      this.problem = this.problem ?? (err instanceof Error ? err.message : String(err))
    }
    this.deps.bus.emit({ type: 'flags.changed', flags: this.view() })
    return out
  }

  private version(): string {
    return this.deps.clientVersion.split('/')[1] ?? '0.0.0'
  }

  view(): FlagsView {
    const f = this.flagsState.flags
    const min = this.deps.body === 'extension' ? f.minVersion.extension : f.minVersion.mobile
    return { flags: f, fetchedAt: this.flagsState.fetchedAt, updateRequired: !!min && !semverAtLeast(this.version(), min), minVersion: min ?? null, problem: this.problem, scamOriginsCount: this.scam.origins.length }
  }

  scamOrigins(): readonly string[] {
    return this.scam.origins
  }

  isDisabled(feature: 'swap' | 'limit' | 'bridge' | 'launchpad' | 'nft' | 'farms'): boolean {
    return this.flagsState.flags.disabled[feature] === true
  }

  corridorDisabled(fromChainId: number, toChainId: number, symbol: string): boolean {
    const d = this.flagsState.flags.disabled
    if (d.bridge) return true
    return (d.bridgeCorridors ?? []).includes(`${fromChainId}:${toChainId}:${symbol}`)
  }
}

export function flagsNamespace(statics: StaticsService): NamespaceSpec {
  return {
    get: { handler: async () => statics.view() },
    refresh: { handler: () => statics.refresh() },
    /*
      The signed scam list, so the UI can check a link before opening it
      (ES-BV-035). The firewall already consults it for origins that raise
      sheets; the same list belongs in front of the links the Token and
      Campaign screens offer, which come from the same remote index.
    */
    scamOrigins: { handler: async () => [...statics.scamOrigins()] },
  }
}
