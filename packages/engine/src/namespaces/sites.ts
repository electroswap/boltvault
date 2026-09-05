/**
 * Connected sites — per-origin sessions, owned by the engine, rendered by the
 * UI (Settings › Connected sites). `SiteRegistry` from provider-protocol is
 * the model; this wraps it over platform storage and exposes read/edit
 * operations for the UI. dApp-driven changes (connect, switch) arrive through
 * rpcFlow in M3 and use the same registry instance.
 */
import type { Platform } from '@boltvault/platform'
import { SiteRegistry, type ConnectedSite, type SitesStore } from '@boltvault/provider-protocol'
import { ALL_CHAINS } from '@boltvault/chains'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { SiteView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'

const SiteSchema = z.object({
  origin: z.string().min(1),
  chainId: z.number().int().positive(),
  accountId: z.string(),
  connected: z.boolean(),
  lastAccounts: z.array(z.string()).optional(),
})

const SITES_DOC: DocSpec<Record<string, ConnectedSite>> = {
  key: 'sites',
  version: 1,
  schema: z.record(z.string(), SiteSchema),
  defaultValue: () => ({}),
}

function toView(s: ConnectedSite): SiteView {
  return {
    origin: s.origin,
    chainId: s.chainId,
    accountId: s.accountId === 'unknown' ? null : s.accountId,
    connected: s.connected,
  }
}

export class SitesService {
  readonly registry: SiteRegistry

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
  ) {
    const store: SitesStore = {
      load: async () => (await readDoc(platform.storage.local, SITES_DOC, () => platform.now())).value,
      save: (sites) => writeDoc(platform.storage.local, SITES_DOC, sites),
    }
    this.registry = new SiteRegistry(store)
  }

  hydrate(): Promise<void> {
    return this.registry.hydrate()
  }

  list(): SiteView[] {
    return this.registry.connected().map(toView)
  }

  get(origin: string): SiteView | null {
    const row = this.registry.get(origin)
    return row ? toView(row) : null
  }

  async setChain(origin: string, chainId: number): Promise<SiteView> {
    if (!ALL_CHAINS.some((c) => c.chainId === chainId)) throw new EngineError('invalid_argument', `unknown chain ${chainId}`)
    if (!this.registry.get(origin)) throw new EngineError('not_found', 'that site is not connected')
    await this.registry.setChain(origin, chainId)
    this.emit()
    const row = this.registry.get(origin)
    if (!row) throw new EngineError('internal', 'site vanished')
    return toView(row)
  }

  async disconnect(origin: string): Promise<void> {
    await this.registry.disconnect(origin)
    this.emit()
  }

  emit(): void {
    this.bus.emit({ type: 'sites.changed', sites: this.list() })
  }
}

const OriginSchema = z.string().min(1).max(512)

export function sitesNamespace(sites: SitesService): NamespaceSpec {
  return {
    list: { handler: async () => sites.list() },
    get: {
      input: z.object({ origin: OriginSchema }),
      handler: async (arg) => sites.get((arg as { origin: string }).origin),
    },
    setChain: {
      input: z.object({ origin: OriginSchema, chainId: z.number().int().positive() }),
      handler: (arg) => {
        const { origin, chainId } = arg as { origin: string; chainId: number }
        return sites.setChain(origin, chainId)
      },
    },
    disconnect: {
      input: z.object({ origin: OriginSchema }),
      handler: (arg) => sites.disconnect((arg as { origin: string }).origin),
    },
  }
}
