/**
 * createEngine — wire every namespace into a host and hand back both the
 * host (to serve over a channel) and an in-process WalletEngine (mobile,
 * tests). `ready` resolves once persisted state is hydrated.
 */
import type { Argon2idParams } from '@boltvault/core'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { ActivityStore } from './activityStore'
import { ApprovalStore } from './approvals'
import { createEngineClient } from './client'
import type { WalletEngine } from './contract'
import { EngineHost } from './host'
import { chainsNamespace, ChainsService, rpcHeadSource, type HeadSource } from './namespaces/chains'
import { SitesService, sitesNamespace } from './namespaces/sites'
import { HttpRelay, MemoryRelay, SyncService, syncNamespace, type Relay } from './namespaces/sync'
import { accountsNamespace, VaultManager, vaultNamespace } from './namespaces/vault'
import { AccountIdSchema, ApprovalDecisionSchema, SettingsSchema, type ApprovalDecision, type Settings } from './schema'
import { SettingsStore } from './settingsStore'
import { createInProcessTransport } from './transport'

export interface EngineDeps {
  readonly platform: Platform
  readonly heads?: HeadSource
  readonly os?: { reducedMotion: boolean }
  /** Test override for the vault KDF (production calibrates per device). */
  readonly kdf?: Argon2idParams
  /** Relay factory; defaults to HTTP for `http(s)://` URLs and one shared memory relay otherwise. */
  readonly relayFor?: (relayUrl: string) => Relay
  /** Client identifier sent to the ElectroSwap relay (§9.1). */
  readonly clientKey?: string
}

export interface Engine {
  readonly host: EngineHost
  /** In-process client (mobile UI, tests). The extension serves `host` instead. */
  readonly engine: WalletEngine
  readonly vault: VaultManager
  readonly approvals: ApprovalStore
  readonly sites: SitesService
  readonly chains: ChainsService
  readonly settings: SettingsStore
  readonly activity: ActivityStore
  readonly sync: SyncService
  readonly ready: Promise<void>
  dispose(): void
}

const sharedMemoryRelay = new MemoryRelay()

export function createEngine(deps: EngineDeps): Engine {
  const host = new EngineHost()
  const settings = new SettingsStore(deps.platform, host.events, deps.os)
  const vault = new VaultManager(deps.platform, host.events, settings, deps.kdf ? { kdf: deps.kdf } : {})
  const approvals = new ApprovalStore(deps.platform, host.events)
  const sites = new SitesService(deps.platform, host.events)
  const chains = new ChainsService(deps.platform, host.events, deps.heads ?? rpcHeadSource)
  const activity = new ActivityStore(deps.platform, host.events, async () => {
    const hex = await deps.platform.storage.session.get('vault.dek')
    if (hex === null) throw new (await import('./errors')).EngineError('locked', 'the vault is locked')
    return Uint8Array.from(hex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [])
  })
  const relayFor = deps.relayFor ?? ((url: string): Relay => (/^https?:\/\//.test(url) ? new HttpRelay(url, fetch, deps.clientKey) : sharedMemoryRelay))
  const sync = new SyncService(deps.platform, host.events, { settings, sites, vault, relayFor })

  vault.init()
  host.events.subscribe((e) => {
    if (e.type === 'vault.status' && !e.status.unlocked) activity.forget()
  })

  host.register('vault', vaultNamespace(vault, settings))
  host.register('accounts', accountsNamespace(vault))
  host.register('sites', sitesNamespace(sites))
  host.register('chains', chainsNamespace(chains))
  host.register('approvals', {
    list: { handler: async () => approvals.list() },
    decide: {
      input: ApprovalDecisionSchema,
      handler: async (arg) => {
        await approvals.decide(arg as ApprovalDecision)
      },
    },
  })
  host.register('settings', {
    get: { handler: () => settings.get() },
    set: {
      input: SettingsSchema.partial(),
      handler: async (arg) => {
        const next = await settings.set(arg as Partial<Settings>)
        await vault.applyAutoLock()
        return next
      },
    },
  })
  host.register('activity', {
    list: {
      input: z.object({ accountId: AccountIdSchema.optional(), chainId: z.number().int().positive().optional(), limit: z.number().int().positive().max(500).optional() }).optional(),
      handler: (arg) => activity.list((arg as { accountId?: string; chainId?: number; limit?: number } | undefined) ?? {}),
    },
    clear: { handler: () => activity.clear() },
  })
  host.register('sync', syncNamespace(sync))

  const ready = Promise.all([approvals.hydrate(), sites.hydrate(), settings.get()]).then(() => undefined)
  const engine = createEngineClient(createInProcessTransport(host, 'internal'))

  return { host, engine, vault, approvals, sites, chains, settings, activity, sync, ready, dispose: () => vault.dispose() }
}
