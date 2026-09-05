/**
 * createEngine — wire every M0 namespace into a host and hand back both the
 * host (to serve over a channel) and an in-process WalletEngine (mobile,
 * tests). `ready` resolves once persisted state is hydrated.
 */
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { ApprovalStore } from './approvals'
import { createEngineClient } from './client'
import type { WalletEngine } from './contract'
import { EngineHost } from './host'
import { chainsNamespace, ChainsService, rpcHeadSource, type HeadSource } from './namespaces/chains'
import { SitesService, sitesNamespace } from './namespaces/sites'
import { accountsNamespace, VaultManager, vaultNamespace } from './namespaces/vault'
import { ApprovalDecisionSchema, SettingsSchema, type ApprovalDecision, type Settings } from './schema'
import { SettingsStore } from './settingsStore'
import { createInProcessTransport } from './transport'

export interface EngineDeps {
  readonly platform: Platform
  readonly heads?: HeadSource
  readonly os?: { reducedMotion: boolean }
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
  readonly ready: Promise<void>
  dispose(): void
}

export function createEngine(deps: EngineDeps): Engine {
  const host = new EngineHost()
  const settings = new SettingsStore(deps.platform, host.events, deps.os)
  const vault = new VaultManager(deps.platform, host.events, settings)
  const approvals = new ApprovalStore(deps.platform, host.events)
  const sites = new SitesService(deps.platform, host.events)
  const chains = new ChainsService(deps.platform, host.events, deps.heads ?? rpcHeadSource)

  vault.init()
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

  const ready = Promise.all([approvals.hydrate(), sites.hydrate(), settings.get()]).then(() => undefined)
  const engine = createEngineClient(createInProcessTransport(host, 'internal'))

  return {
    host,
    engine,
    vault,
    approvals,
    sites,
    chains,
    settings,
    ready,
    dispose: () => vault.dispose(),
  }
}

export { z }
