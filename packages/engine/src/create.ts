/**
 * createEngine — wire every namespace into a host and hand back both the
 * host (to serve over a channel) and an in-process WalletEngine (mobile,
 * tests). `ready` resolves once persisted state is hydrated.
 */
import { fromHex, type Argon2idParams } from '@boltvault/core'
import type { HidProvider, LedgerTransportProvider, TrezorConnectLike } from '@boltvault/hardware'
import type { WalletKitLike } from '@boltvault/connect'
import { ElectroSwapClient } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { z } from 'zod'
import { ActivityStore } from './activityStore'
import { createSealedStores } from './blobs'
import { migrateSealed } from './migrateSealed'
import { ApprovalStore } from './approvals'
import { CacheShards } from './cache'
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
import { BridgeService, bridgeNamespace } from './namespaces/bridge'
import { GeckoTerminalPrices } from './prices'
import { ProviderService } from './namespaces/provider'
import { SendService, sendNamespace } from './namespaces/send'
import { FlowStore } from './namespaces/flows'
import { HardwareService, hardwareNamespace } from './namespaces/hardware'
import { RemoteSignService, remoteNamespace } from './namespaces/remote'
import { DappsService, dappsNamespace } from './namespaces/dapps'
import { ConnectService, connectNamespace } from './namespaces/connect'
import { StaticsService, flagsNamespace } from './namespaces/statics'
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
import { aboutNamespace } from './namespaces/about'
import { DocCache } from './cache'
import { NotificationsService, notificationsNamespace } from './namespaces/notifications'
import { CustomCollectionsService, customCollectionsNamespace } from './namespaces/nftCustom'
import { PrefsService, prefsNamespace } from './namespaces/prefs'
import { SitesService, sitesNamespace } from './namespaces/sites'
import { HttpRelay, MemoryRelay, SyncService, syncNamespace, type Relay } from './namespaces/sync'
import { TokensService, tokensNamespace } from './namespaces/tokens'
import { accountsNamespace, KEY_DEK, VaultManager, vaultNamespace } from './namespaces/vault'
import { AccountIdSchema, ApprovalDecisionSchema, SettingsSchema, type ApprovalDecision, type ApprovalRequest, type Settings } from './schema'
import { SettingsStore } from './settingsStore'
import { createInProcessTransport } from './transport'

/** ElectroSwap's API. A development build overrides it (extension `WXT_BOLTVAULT_API`, mobile `EXPO_PUBLIC_BOLTVAULT_API`). */
export const DEFAULT_API_ORIGIN = 'https://electroswap.io'

export interface EngineDeps {
  readonly platform: Platform
  /**
   * Origin of the ElectroSwap API (default `DEFAULT_API_ORIGIN`). GraphQL (`/graphql`) and REST derive from it;
   * signed statics stay on static.electroswap.io. A dev build points this at a local services/api.
   */
  readonly apiOrigin?: string
  /** Optional surfaces. Limit orders are off unless a build turns them on. */
  readonly features?: { readonly limitOrders?: boolean }
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
  /** GeckoTerminal base URL override (tests); `null` disables display prices off Electroneum (§10.4). */
  readonly pricesUrl?: string | null
  /** WebHID (`navigator.hid`) in the extension worker; absent elsewhere (§2.7 S7). */
  readonly hid?: HidProvider | null
  /** A Ledger transport that is not WebHID (BLE on the phone). */
  readonly ledger?: LedgerTransportProvider | null
  /** Trezor Connect on the extension (the hosted popup); absent on the phone → watch-only + remote sign. */
  readonly trezor?: TrezorConnectLike | null
  /** Reown WalletKit on the phone (§5.3); absent elsewhere. */
  readonly walletKit?: WalletKitLike | null
  /** Which body this is, for the minimum-version flag. */
  readonly body?: 'extension' | 'mobile'
  /** Signed statics base URL override (tests); `null` never fetches. */
  readonly staticsUrl?: string | null
  readonly staticsPublicKey?: string
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
  readonly bridge: BridgeService
  readonly remote: RemoteSignService
  readonly dapps: DappsService
  readonly connect: ConnectService
  readonly statics: StaticsService
  /** The serve-stale document cache (tests and fixtures invalidate through it). */
  readonly cache: DocCache
  readonly notifications: NotificationsService
  readonly ready: Promise<void>
  dispose(): void
}

const sharedMemoryRelay = new MemoryRelay()

export function createEngine(deps: EngineDeps): Engine {
  const host = new EngineHost()
  // A bare `fetch` loses its Window receiver when called as a method ("illegal invocation" in browsers): always wrap.
  const fetchImpl: typeof fetch = deps.fetch ?? ((input, init) => fetch(input, init))
  let staticsRef: StaticsService | null = null
  const settings = new SettingsStore(deps.platform, host.events, deps.os)
  // The DEK accessor is needed by every sealed store below, so it is built
  // before them. `VaultManager.dek()` is the same lookup but private.
  const dek = async (): Promise<Uint8Array> => {
    const hex = await deps.platform.storage.session.get(KEY_DEK)
    if (hex === null) throw new EngineError('locked', 'the vault is locked')
    return fromHex(hex)
  }
  const cacheShards = new CacheShards(deps.platform, dek)
  const cache = new DocCache(cacheShards, host.events, () => deps.platform.now())
  // Everything account-scoped lives in a DEK-sealed blob rather than a plaintext
  // document per account (at-rest audit 2026-09-06; master plan §3.2).
  const sealed = createSealedStores(deps.platform, dek)
  // The active account is read at call time, not now: `vault` is constructed
  // below, and an inbox entry is only ever attributed when it is pushed or read.
  const notifications = new NotificationsService(deps.platform, host.events, sealed.notifications, async () => (await vault.active())?.id ?? null)
  const prefs = new PrefsService(deps.platform, host.events)
  // Every OS notification the watcher sends is also an inbox entry (plan A6): the tag says what it was about.
  const notifyingPlatform: Platform = {
    ...deps.platform,
    notify: async (n) => {
      const [prefix, a, b] = (n.tag ?? '').split(':')
      const kind = prefix === 'live' ? 'live' : prefix === 'collect' ? 'collect' : prefix === 'dividends' ? 'dividends' : 'alert'
      const target = prefix === 'live' ? `campaign:${a ?? ''}` : prefix === 'above' || prefix === 'below' ? `${a ?? 'token'}:${b ?? ''}` : prefix === 'collect' ? 'positions' : prefix === 'dividends' ? 'legends' : null
      const day = Math.floor(deps.platform.now() / 86_400_000)
      await notifications.push({ id: `${n.tag ?? n.title}:${kind === 'alert' || kind === 'live' ? deps.platform.now() : day}`, kind, title: n.title, body: n.body, target }).catch(() => undefined)
      await deps.platform.notify(n)
    },
  }
  const vault = new VaultManager(deps.platform, host.events, settings, { active: sealed.active, purgeAccount: async (id) => { await sealed.purgeAccount(id); await cache.forgetAccount(id) }, ...(deps.kdf ? { kdf: deps.kdf } : {}) })
  const approvals = new ApprovalStore(deps.platform, host.events)
  const sites = new SitesService(deps.platform, host.events, sealed.sites)
  const chains = new ChainsService(deps.platform, host.events, deps.heads)
  const activity = new ActivityStore(deps.platform, host.events, dek)
  const contacts = new ContactsStore(deps.platform, host.events, dek)
  const relayFor = deps.relayFor ?? ((url: string): Relay => (/^https?:\/\//.test(url) ? new HttpRelay(url, fetchImpl, deps.clientKey) : sharedMemoryRelay))
  const sync = new SyncService(deps.platform, host.events, { settings, sites, vault, relayFor, identity: sealed.syncIdentity, devices: sealed.syncDevices, meta: sealed.syncMeta })
  staticsRef = new StaticsService({ platform: deps.platform, bus: host.events, fetch: fetchImpl, clientVersion: deps.clientVersion ?? 'BoltVault/0.1.0', body: deps.body ?? 'extension', ...(deps.staticsUrl ? { baseUrl: deps.staticsUrl } : {}), ...(deps.staticsPublicKey ? { publicKeyHex: deps.staticsPublicKey } : {}) })
  const statics = staticsRef
  const hardware = new HardwareService({ hid: deps.hid ?? null, ledger: deps.ledger ?? null, trezor: deps.trezor ?? null, vault, bus: host.events, platform: deps.platform })
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
    tokenMetadata: (chainId, address) => tokens.metadata(chainId, address),
    watchAsset: (i) => tokens.addCustom({ chainId: i.chainId, address: i.address, source: 'dapp', origin: i.origin, ...(i.claimed ? { claimed: i.claimed } : {}) }),
    tokenInfo: async (chainId) => {
      const out: Record<string, { symbol: string; decimals: number; name?: string }> = {}
      for (const t of await tokens.universe(chainId)) if (t.address !== 'native') out[t.address.toLowerCase()] = { symbol: t.symbol, decimals: t.decimals, name: t.name }
      return out
    },
    clientVersion: deps.clientVersion ?? 'BoltVault/0.1.0',
    statics: { scamOrigins: () => staticsRef?.scamOrigins() ?? [] },
    fetch: fetchImpl,
    hardware,
    ...(deps.openApproval ? { openApproval: deps.openApproval } : {}),
    ...(deps.receiptPollMs !== undefined ? { receiptPollMs: deps.receiptPollMs } : {}),
  })
  const tokens = new TokensService(deps.platform, host.events, chains, fetchImpl, sealed.tokensCustom, sealed.tokenPrefs)
  const apiOrigin = (deps.apiOrigin ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '')
  const features = { limitOrders: deps.features?.limitOrders ?? false }
  const electroswap = deps.electroswapUrl === null ? null : new ElectroSwapClient({ url: deps.electroswapUrl ?? `${apiOrigin}/graphql`, ...(deps.clientKey ? { apiKey: deps.clientKey } : {}), fetchImpl })
  const prices = deps.pricesUrl === null ? null : new GeckoTerminalPrices(fetchImpl, () => deps.platform.now(), ...(deps.pricesUrl ? [deps.pricesUrl] : []))
  const portfolio = new PortfolioService({ platform: deps.platform, bus: host.events, chains, tokens, vault, electroswap, prices, snapshots: sealed.portfolio, looks: sealed.looks })
  const names = new NamesService(chains, () => deps.platform.now())
  const allowances = new AllowancesService({ platform: deps.platform, bus: host.events, chains, tokens, vault, provider, allowances: sealed.allowances })
  const send = new SendService({ platform: deps.platform, chains, tokens, names, vault, provider })
  const scanner = new ActivityScanner({ platform: deps.platform, chains, activity, tokens, vault, settings, cache, bus: host.events, scan: sealed.scan })
  const holder = new HolderService({ platform: deps.platform, chains, vault, cache })
  const flows = new FlowStore({ platform: deps.platform, bus: host.events, activity })
  const swap = new SwapService({ statics,  platform: deps.platform, chains, tokens, vault, provider, settings, holder, flows })
  const limit = new LimitService({ platform: deps.platform, bus: host.events, chains, tokens, vault, provider, settings, flows, enabled: features.limitOrders })
  const watchlist = new WatchlistService({ platform: notifyingPlatform, bus: host.events, vault, watchlist: sealed.watchlist })
  const legends = new LegendsService({ platform: deps.platform, chains, vault, provider, flows, legendsBest: sealed.legends })
  const customCollections = new CustomCollectionsService({ platform: deps.platform, chains, fetch: fetchImpl, collections: sealed.nftCustom, meta: sealed.nftMeta })
  const explore = new ExploreService({ platform: deps.platform, electroswap, tokens, vault, watchlist, cache, bus: host.events, custom: customCollections, legends })
  const nft = new NftService({ platform: deps.platform, chains, vault, provider, flows, electroswap, explore, legends, cache, notifications, custom: customCollections })
  const farm = new FarmService({ platform: deps.platform, chains, tokens, vault, provider, flows, settings, electroswap, cache })
  const launchpad = new LaunchpadService({ platform: deps.platform, chains, vault, provider, flows, electroswap, names, watchlist, cache, referrals: sealed.launchpadRef })
  const positions = new PositionsService({ platform: deps.platform, bus: host.events, farm, legends, limit, launchpad, tokens, positions: sealed.positions })
  const remote = new RemoteSignService({ platform: deps.platform, bus: host.events, sync, vault, provider, canSignHere: async (a) => (await vault.privateKeyFor(a.id).catch(() => null)) !== null || (a.kind !== 'hd' && a.kind !== 'imported' && hardware.canSign(a)), ...(deps.receiptPollMs !== undefined ? { pollMs: deps.receiptPollMs * 5 } : {}) })
  provider.setRemote(remote)
  sync.setRecordHook((rec, from) => remote.onRecord(rec, from))
  const dapps = new DappsService({ provider, bus: host.events, now: () => deps.platform.now(), random: (n) => deps.platform.random(n) })
  const connect = new ConnectService({ walletKit: deps.walletKit ?? null, dapps, chains, vault, sites, bus: host.events })
  connect.init()
  const bridge = new BridgeService({ statics, platform: deps.platform, bus: host.events, chains, vault, provider, flows, settings, transfers: sealed.bridge, ...(deps.receiptPollMs !== undefined ? { receiptPollMs: deps.receiptPollMs } : {}) })
  watchlist.attach({
    tokens: (chainId) => explore.tokens(chainId),
    collections: (chainId) => explore.collections(chainId),
    campaigns: (chainId) => launchpad.list(chainId, undefined, ['ACTIVE', 'PENDING']),
    accessory: async (accountId, chainId) => (await positions.snapshot(accountId, chainId)).accessory,
  })

  let migrating: Promise<unknown> | null = null
  const runMigration = (): Promise<unknown> => {
    migrating ??= migrateSealed(deps.platform, sealed).catch(() => undefined)
    return migrating
  }

  vault.init()
  scanner.attach()
  host.events.subscribe((e) => {
    if (e.type !== 'vault.status') return
    if (!e.status.unlocked) {
      activity.forget()
      contacts.forget()
      notifications.forget()
      bridge.forget()
      watchlist.forget()
      sealed.forget()
      cacheShards.forget()
    } else {
      // The DEK is what the blobs are sealed under, so the one-shot move of the
      // old plaintext documents happens here. Sites re-hydrates afterwards: it
      // was hydrated at boot from the public half alone.
      // Anything that hydrated while locked cached an empty result — it has to
      // re-read now that the DEK is available. The watchlist alarm (every 5 min)
      // picks the list up on its next tick; no eager pass here, which would fire
      // a burst of network the moment the user unlocks.
      notifications.forget()
      bridge.forget()
      watchlist.forget()
      void runMigration().then(() => sites.hydrate().catch(() => undefined))
      void provider.resumeWatchers()
      void bridge.resume()
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
        // A signing decision is activity: the idle timer restarts.
        void vault.touch().catch(() => undefined)
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
  host.register('nft', { ...nftNamespace(nft), ...customCollectionsNamespace(customCollections) })
  host.register('legends', legendsNamespace(legends))
  host.register('farm', farmNamespace(farm))
  host.register('launchpad', launchpadNamespace(launchpad))
  host.register('watchlist', watchlistNamespace(watchlist))
  host.register('positions', positionsNamespace(positions))
  host.register('bridge', bridgeNamespace(bridge))
  host.register('remote', remoteNamespace(remote))
  host.register('dapps', dappsNamespace(dapps))
  host.register('connect', connectNamespace(connect))
  host.register('flags', flagsNamespace(statics))
  host.register('about', aboutNamespace({ apiOrigin, apiIsDefault: apiOrigin === DEFAULT_API_ORIGIN, features }))
  host.register('notifications', notificationsNamespace(notifications))
  host.register('prefs', prefsNamespace(prefs))

  const ready = Promise.all([approvals.hydrate(), sites.hydrate(), settings.get(), provider.init(), watchlist.hydrate(), statics.hydrate()]).then(() => {
    // Signed flags refresh in the background; nothing waits on the network (§3.7).
    if (deps.staticsUrl !== null) void statics.refresh().catch(() => undefined)
  })
  const engine = createEngineClient(createInProcessTransport(host, 'internal'))

  return {
    host,
    engine,
    vault,
    approvals,
    sites,
    chains,
    cache,
    notifications,
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
    bridge,
    remote,
    dapps,
    connect,
    statics,
    ready,
    dispose: () => {
      vault.dispose()
      provider.dispose()
      bridge.dispose()
      remote.dispose()
      hardware.dispose()
      connect.dispose()
      dapps.dispose()
    },
  }
}
