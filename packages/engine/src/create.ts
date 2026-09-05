/**
 * createEngine — wire every namespace into a host and hand back both the
 * host (to serve over a channel) and an in-process WalletEngine (mobile,
 * tests). `ready` resolves once persisted state is hydrated.
 */
import type { Argon2idParams } from '@boltvault/core'
import type { HidProvider } from '@boltvault/hardware'
import { ElectroSwapClient } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { ActivityStore } from './activityStore'
import { ApprovalStore } from './approvals'
import { createEngineClient } from './client'
import type { WalletEngine } from './contract'
import { EngineError } from './errors'
import { EngineHost } from './host'
import { ActivityScanner, activityScanNamespace } from './namespaces/activityScan'
import { AllowancesService, allowancesNamespace } from './namespaces/allowances'
import { chainsNamespace, ChainsService, type HeadSource } from './namespaces/chains'
import { ContactsStore, contactsNamespace } from './namespaces/contacts'
import { NamesService, namesNamespace } from './namespaces/names'
import { PortfolioService, portfolioNamespace } from './namespaces/portfolio'
import { ProviderService } from './namespaces/provider'
import { SendService, sendNamespace } from './namespaces/send'
import { FlowStore } from './namespaces/flows'
import { HardwareService, hardwareNamespace } from './namespaces/hardware'
import { ExploreService, exploreNamespace } from './namespaces/explore'
import { NftService, nftNamespace } from './namespaces/nft'
import { LegendsService, legendsNamespace } from './namespaces/legends'
import { FarmService, farmNamespace } from './namespaces/farm'
import { LaunchpadService, launchpadNamespace } from './namespaces/launchpad'
import { WatchlistService, watchlistNamespace } from './namespaces/watchlist'
import { PositionsService, positionsNamespace } from './namespaces/positions'
import { HolderService, holderNamespace } from './namespaces/holder'
import { LimitService, limitNamespace } from './namespaces/limit'
import { SwapService, swapNamespace } from './namespaces/swap'
import { SitesService, sitesNamespace } from './namespaces/sites'
import { HttpRelay, MemoryRelay, SyncService, syncNamespace, type Relay } from './namespaces/sync'
import { TokensService, tokensNamespace } from './namespaces/tokens'
import { accountsNamespace, VaultManager, vaultNamespace } from './namespaces/vault'
import { AccountIdSchema, ApprovalDecisionSchema, SettingsSchema, type ApprovalDecision, type ApprovalRequest, type Settings } from './schema'
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
  /** Client identifier sent to the ElectroSwap relay and API (§9.1). */
  readonly clientKey?: string
  /** Put a dApp approval in front of the user (the extension opens sign.html). */
  readonly openApproval?: (request: ApprovalRequest) => void
  /** Reported as web3_clientVersion. */
  readonly clientVersion?: string
  /** Receipt polling cadence override (tests). */
  readonly receiptPollMs?: number
  /** Network access for token lists and the ElectroSwap API (tests inject). */
  readonly fetch?: typeof fetch
  /** ElectroSwap GraphQL endpoint override (tests). `null` disables display prices. */
  readonly electroswapUrl?: string | null
  /** WebHID (`navigator.hid`) in the extension worker; a BLE/USB shim on mobile; absent elsewhere (§2.7 S7). */
  readonly hid?: HidProvider | null
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
  readonly provider: ProviderService
  readonly tokens: TokensService
  readonly portfolio: PortfolioService
  readonly names: NamesService
  readonly allowances: AllowancesService
  readonly contacts: ContactsStore
  readonly send: SendService
  readonly holder: HolderService
  readonly swap: SwapService
  readonly limit: LimitService
  readonly hardware: HardwareService
  readonly explore: ExploreService
  readonly nft: NftService
  readonly legends: LegendsService
  readonly farm: FarmService
  readonly launchpad: LaunchpadService
  readonly watchlist: WatchlistService
  readonly positions: PositionsService
  readonly ready: Promise<void>
  dispose(): void
}

const sharedMemoryRelay = new MemoryRelay()

export function createEngine(deps: EngineDeps): Engine {
  const host = new EngineHost()
  const fetchImpl = deps.fetch ?? fetch
  const settings = new SettingsStore(deps.platform, host.events, deps.os)
  const vault = new VaultManager(deps.platform, host.events, settings, deps.kdf ? { kdf: deps.kdf } : {})
  const approvals = new ApprovalStore(deps.platform, host.events)
  const sites = new SitesService(deps.platform, host.events)
  const chains = new ChainsService(deps.platform, host.events, deps.heads)
  const dek = async (): Promise<Uint8Array> => {
    const hex = await deps.platform.storage.session.get('vault.dek')
    if (hex === null) throw new EngineError('locked', 'the vault is locked')
    return Uint8Array.from(hex.match(/.{2}/g)?.map((b) => parseInt(b, 16)) ?? [])
  }
  const activity = new ActivityStore(deps.platform, host.events, dek)
  const contacts = new ContactsStore(deps.platform, host.events, dek)
  const relayFor = deps.relayFor ?? ((url: string): Relay => (/^https?:\/\//.test(url) ? new HttpRelay(url, fetchImpl, deps.clientKey) : sharedMemoryRelay))
  const sync = new SyncService(deps.platform, host.events, { settings, sites, vault, relayFor })
  const hardware = new HardwareService({ hid: deps.hid ?? null, vault })
  const provider = new ProviderService({
    platform: deps.platform,
    bus: host.events,
    vault,
    sites,
    chains,
    approvals,
    settings,
    activity,
    addressBook: () => contacts.referenceAddresses(),
    tokenInfo: async (chainId) => {
      const out: Record<string, { symbol: string; decimals: number; name?: string }> = {}
      for (const t of await tokens.universe(chainId)) if (t.address !== 'native') out[t.address.toLowerCase()] = { symbol: t.symbol, decimals: t.decimals, name: t.name }
      return out
    },
    clientVersion: deps.clientVersion ?? 'BoltVault/0.1.0',
    fetch: fetchImpl,
    hardware,
    ...(deps.openApproval ? { openApproval: deps.openApproval } : {}),
    ...(deps.receiptPollMs !== undefined ? { receiptPollMs: deps.receiptPollMs } : {}),
  })
  const tokens = new TokensService(deps.platform, host.events, chains, fetchImpl)
  const electroswap = deps.electroswapUrl === null ? null : new ElectroSwapClient({ ...(deps.electroswapUrl ? { url: deps.electroswapUrl } : {}), ...(deps.clientKey ? { apiKey: deps.clientKey } : {}), fetchImpl })
  const portfolio = new PortfolioService({ platform: deps.platform, bus: host.events, chains, tokens, vault, electroswap })
  const names = new NamesService(chains, () => deps.platform.now())
  const allowances = new AllowancesService({ platform: deps.platform, bus: host.events, chains, tokens, vault, provider })
  const send = new SendService({ platform: deps.platform, chains, tokens, names, vault, provider })
  const scanner = new ActivityScanner({ platform: deps.platform, chains, activity, tokens, vault })
  const holder = new HolderService({ platform: deps.platform, chains, vault })
  const flows = new FlowStore({ platform: deps.platform, bus: host.events, activity })
  const swap = new SwapService({ platform: deps.platform, chains, tokens, vault, provider, settings, holder, flows })
  const limit = new LimitService({ platform: deps.platform, bus: host.events, chains, tokens, vault, provider, settings, flows })
  const watchlist = new WatchlistService({ platform: deps.platform, bus: host.events, vault })
  const explore = new ExploreService({ platform: deps.platform, electroswap, tokens, vault, watchlist })
  const legends = new LegendsService({ platform: deps.platform, chains, vault, provider, flows })
  const nft = new NftService({ platform: deps.platform, chains, vault, provider, flows, electroswap, explore, legends })
  const farm = new FarmService({ platform: deps.platform, chains, tokens, vault, provider, flows, settings, electroswap })
  const launchpad = new LaunchpadService({ platform: deps.platform, chains, vault, provider, flows, electroswap, names, watchlist })
  const positions = new PositionsService({ platform: deps.platform, bus: host.events, farm, legends, limit, launchpad, tokens })
  watchlist.attach({
    tokens: (chainId) => explore.tokens(chainId),
    collections: (chainId) => explore.collections(chainId),
    campaigns: (chainId) => launchpad.list(chainId, undefined, ['ACTIVE', 'PENDING']),
    accessory: async (accountId, chainId) => (await positions.snapshot(accountId, chainId)).accessory,
  })

  vault.init()
  host.events.subscribe((e) => {
    if (e.type !== 'vault.status') return
    if (!e.status.unlocked) {
      activity.forget()
      contacts.forget()
    } else {
      void provider.resumeWatchers()
    }
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
  host.register('activityScan', activityScanNamespace(scanner))
  host.register('sync', syncNamespace(sync))
  host.register('tokens', tokensNamespace(tokens))
  host.register('portfolio', portfolioNamespace(portfolio))
  host.register('names', namesNamespace(names))
  host.register('allowances', allowancesNamespace(allowances))
  host.register('contacts', contactsNamespace(contacts))
  host.register('send', sendNamespace(send))
  host.register('swap', swapNamespace(swap))
  host.register('holder', holderNamespace(holder))
  host.register('limit', limitNamespace(limit))
  host.register('hardware', hardwareNamespace(hardware, vault))
  host.register('explore', exploreNamespace(explore))
  host.register('nft', nftNamespace(nft))
  host.register('legends', legendsNamespace(legends))
  host.register('farm', farmNamespace(farm))
  host.register('launchpad', launchpadNamespace(launchpad))
  host.register('watchlist', watchlistNamespace(watchlist))
  host.register('positions', positionsNamespace(positions))

  const ready = Promise.all([approvals.hydrate(), sites.hydrate(), settings.get(), provider.init(), watchlist.hydrate()]).then(() => undefined)
  const engine = createEngineClient(createInProcessTransport(host, 'internal'))

  return {
    host,
    engine,
    vault,
    approvals,
    sites,
    chains,
    settings,
    activity,
    sync,
    provider,
    tokens,
    portfolio,
    names,
    allowances,
    contacts,
    send,
    holder,
    swap,
    limit,
    hardware,
    explore,
    nft,
    legends,
    farm,
    launchpad,
    watchlist,
    positions,
    ready,
    dispose: () => {
      vault.dispose()
      provider.dispose()
    },
  }
}
