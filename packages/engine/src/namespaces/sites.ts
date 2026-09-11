/**
 * Connected sites — per-origin sessions, owned by the engine, rendered by the
 * UI (Settings › Connected sites). `SiteRegistry` from @boltvault/protocol is
 * the model; this wraps it over platform storage and exposes read/edit
 * operations for the UI. dApp-driven changes (connect, switch) arrive through
 * rpcFlow in M3 and use the same registry instance.
 */
import type { Platform } from '@boltvault/platform'
import { SiteRegistry, type ConnectedSite, type SitesStore } from '@boltvault/protocol'
import { ALL_CHAINS } from '@boltvault/chains'
import { z } from 'zod'
import { EngineError } from '../errors'
import type { EventBus, NamespaceSpec } from '../host'
import type { SealedMap } from '../sealed'
import type { SiteView } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'

export const SiteSchema = z.object({
  origin: z.string().min(1),
  chainId: z.number().int().positive(),
  accountId: z.string(),
  connected: z.boolean(),
  lastAccounts: z.array(z.string()).optional(),
  connectedAt: z.number().int().nonnegative().optional(),
  lastUsed: z.number().int().nonnegative().optional(),
  /** The origin's native spend cap (§4.6), base units as a decimal string. */
  budget: z.string().regex(/^\d+$/).max(40).optional(),
  title: z.string().max(200).optional(),
  icon: z.string().max(2048).optional(),
})

/**
 * The public half: origin → chain only.
 *
 * `chainIdFor(origin)` runs on *every* RPC request, including while the vault
 * is locked (`rpc-flow.ts`), and the registry hydrates on every service-worker
 * start (`create.ts`), so this much cannot be sealed without answering
 * `eth_chainId` wrongly for a connected dApp until the user unlocks.
 *
 * Everything that identifies the user — `accountId`, the `lastAccounts`
 * addresses handed to the dApp, the title and icon — moved into `sites.blob`
 * under the DEK (at-rest audit 2026-09-06, F3; the dump showed
 * `lastAccounts: ["0xD6Cf…"]` beside each origin in the clear).
 *
 * Residual, stated plainly: the *list of origins* stays readable at rest. It is
 * kept in the clear deliberately rather than hashed — dApp origins are a small,
 * well-known space, so hashing them would be defeated by running the same hash
 * over a list of known dApps, while putting crypto in the synchronous RPC
 * dispatch path. The address, which is the part a dump actually monetises, is
 * sealed.
 */
const SITES_PUBLIC_DOC: DocSpec<Record<string, { chainId: number }>> = {
  key: 'sites.chains',
  version: 1,
  schema: z.record(z.string(), z.object({ chainId: z.number().int().positive() })),
  defaultValue: () => ({}),
}

function toView(s: ConnectedSite): SiteView {
  return {
    origin: s.origin,
    chainId: s.chainId,
    accountId: s.accountId === 'unknown' || s.accountId === '' ? null : s.accountId,
    connected: s.connected,
    connectedAt: s.connectedAt ?? null,
    lastUsed: s.lastUsed ?? null,
    budget: s.budget ?? null,
    title: s.title ?? null,
    icon: s.icon ?? null,
  }
}

export type SiteChange = { origin: string; kind: 'disconnected' } | { origin: string; kind: 'chain'; chainId: number }

export class SitesService {
  readonly registry: SiteRegistry
  private readonly changeListeners = new Set<(change: SiteChange) => void>()
  /**
   * The last address the wallet itself put on the clipboard (§3.6).
   *
   * In memory and never persisted: it is a sixty-second fact, and the only
   * thing that can catch clipboard-hijack malware is the wallet's own memory
   * of what it copied — the clipboard by then is already lying. It lives here
   * beside the per-origin sessions because §3.6's other identity state does,
   * and because the firewall reads the site registry anyway.
   */
  private copied: { address: string; at: number } | null = null

  /** Provider-side listeners: a site the user disconnected or re-chained from Settings must hear it. */
  onChange(listener: (change: SiteChange) => void): () => void {
    this.changeListeners.add(listener)
    return () => {
      this.changeListeners.delete(listener)
    }
  }

  constructor(
    private readonly platform: Platform,
    private readonly bus: EventBus,
    /** The sealed half of each row, keyed by origin. */
    private readonly sealed: SealedMap<ConnectedSite>,
  ) {
    const store: SitesStore = {
      load: async () => {
        const publicRows = (await readDoc(platform.storage.local, SITES_PUBLIC_DOC, () => platform.now())).value
        // `{}` while locked — the public half alone still answers chainIdFor.
        const sealedRows = await sealed.entries()
        const out: Record<string, ConnectedSite> = {}
        for (const [origin, row] of Object.entries(publicRows)) {
          out[origin] = { origin, chainId: row.chainId, accountId: '', connected: false }
        }
        for (const [origin, row] of Object.entries(sealedRows)) {
          out[origin] = { ...row, chainId: publicRows[origin]?.chainId ?? row.chainId }
        }
        return out
      },
      save: async (sites) => {
        const publicRows: Record<string, { chainId: number }> = {}
        for (const [origin, row] of Object.entries(sites)) publicRows[origin] = { chainId: row.chainId }
        await writeDoc(platform.storage.local, SITES_PUBLIC_DOC, publicRows)
        // Sealed writes are skipped while locked (`whenLocked: 'skip'`): nothing
        // that lives in this half can change without an unlocked vault, and a
        // chain switch from a connected dApp must not fail because of it.
        for (const origin of await sealed.ids()) {
          if (!sites[origin]) await sealed.delete(origin)
        }
        for (const [origin, row] of Object.entries(sites)) await sealed.set(origin, row)
      },
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
    for (const l of this.changeListeners) l({ origin, kind: 'chain', chainId })
    const row = this.registry.get(origin)
    if (!row) throw new EngineError('internal', 'site vanished')
    return toView(row)
  }

  /**
   * Set or clear an origin's native spend cap (§4.6). Base units as a decimal
   * string; `null` removes the cap.
   */
  async setBudget(origin: string, budget: string | null): Promise<SiteView> {
    if (budget !== null && !/^\d+$/.test(budget))
      throw new EngineError('invalid_argument', 'A budget is an amount in the chain’s own units, as a whole number.')
    await this.registry.setBudget(origin, budget)
    this.emit()
    const row = this.registry.get(origin)
    if (!row) throw new EngineError('internal', 'site vanished')
    return toView(row)
  }

  /**
   * The UI calls this the moment it copies an address to the clipboard, so the
   * firewall can tell a paste apart from a swap (§3.6).
   */
  noteAddressCopied(address: string): void {
    this.copied = { address, at: this.platform.now() }
  }

  lastCopiedAddress(): { address: string; at: number } | null {
    return this.copied
  }

  async disconnect(origin: string): Promise<void> {
    await this.registry.disconnect(origin)
    this.emit()
    for (const l of this.changeListeners) l({ origin, kind: 'disconnected' })
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
    setBudget: {
      input: z.object({ origin: OriginSchema, budget: z.string().regex(/^\d+$/).max(40).nullable() }),
      handler: (arg) => {
        const { origin, budget } = arg as { origin: string; budget: string | null }
        return sites.setBudget(origin, budget)
      },
    },
    /** §3.6: the UI records every address it copies, so a paste can be checked against it. */
    noteAddressCopied: {
      input: z.object({ address: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }),
      handler: async (arg) => {
        sites.noteAddressCopied((arg as { address: string }).address)
        return null
      },
    },
    disconnect: {
      input: z.object({ origin: OriginSchema }),
      handler: (arg) => sites.disconnect((arg as { origin: string }).origin),
    },
  }
}
