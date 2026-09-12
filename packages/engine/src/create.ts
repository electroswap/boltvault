/**
 * createEngine — wire every namespace into a host and hand back both the
 * host (to serve over a channel) and an in-process WalletEngine (mobile,
 * tests). `ready` resolves once persisted state is hydrated.
 */
import { fromHex, type Argon2idParams } from '@boltvault/core'
import type { Hex } from 'viem'
import type { HidProvider, LedgerTransportProvider, TrezorConnectLike } from '@boltvault/hardware'
import type { WalletKitLike } from '@boltvault/connect'
import { ElectroSwapClient, fetchContractFacts } from '@boltvault/electroswap'
import { isElectroneumChainId } from '@boltvault/chains'
import type { Platform } from '@boltvault/platform'
import type { ApprovalIntent } from '@boltvault/protocol'
import { z } from 'zod'
import { ActivityStore } from './activityStore'
import type { ApprovalPayload } from './approvalPayloads'
import { createSealedStores } from './blobs'
import { clientFailuresFor, CLIENT_FAILURE_PATH } from './clientFailureApi'
import { FeeLadders } from './feeLadder'
import { migrateSealed } from './migrateSealed'
import { ApprovalStore } from './approvals'
import { CacheShards } from './cache'
import { createEngineClient } from './client'
import type { WalletEngine } from './contract'
import { EngineError } from './errors'
import { EngineHost } from './host'
import { ActivityScanner, activityScanNamespace } from './namespaces/activityScan'
import { ActivityFeedService } from './namespaces/activityFeed'
import { TxService, txNamespace } from './namespaces/tx'
import { AllowancesService, allowancesNamespace } from './namespaces/allowances'
import { chainsNamespace, ChainsService, type HeadSource } from './namespaces/chains'
import { ContactsStore, contactsNamespace } from './namespaces/contacts'
import { NamesService, namesNamespace } from './namespaces/names'
import { SecurityService, securityNamespace } from './namespaces/security'
import { PortfolioService, portfolioNamespace } from './namespaces/portfolio'
import { BridgeService, bridgeNamespace } from './namespaces/bridge'
import { Governor, governedFetch } from './governor'
import { authHeaders } from './apiAuth'
import { DynoWeight } from './dynoweight'
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
import { createSyncStateStore, HttpRelay, MemoryRelay, SyncService, syncNamespace, type Relay } from './namespaces/sync'
import { TokensService, tokensNamespace } from './namespaces/tokens'
import { accountsNamespace, KEY_DEK, VaultManager, vaultNamespace } from './namespaces/vault'
import {
  AccountIdSchema,
  ApprovalDecisionSchema,
  SettingsSchema,
  type ApprovalDecision,
  type ApprovalRequest,
  type NameLookup,
  type Settings,
} from './schema'
import { DEFAULT_QUOTER_PATH, Quoter } from './quoterApi'
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
  /**
   * ElectroSwap routing service override (§8.6); defaults to
   * `{apiOrigin}{DEFAULT_QUOTER_PATH}`. A local quoter serves it at
   * `http://localhost:3007/api/quote` instead, so a dev build points here.
   * `null` disables it and the wallet quotes on chain only.
   */
  readonly quoterUrl?: string | null
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
  readonly security: SecurityService
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
  /*
    One governed `fetch` for the whole engine.

    Everything that leaves this process — JSON-RPC on ten chains, the
    ElectroSwap indexer, GeckoTerminal, the signed statics, the public token
    lists — is built on this one function, so the budget below is the wallet's
    whole appetite rather than one service's opinion of it. Per host: a token
    bucket, and a cooldown on a refusal that makes RPC failover instant. See
    governor.ts.

    A bare `fetch` loses its Window receiver when called as a method ("illegal
    invocation" in browsers): always wrap.
  */
  const governor = new Governor(() => deps.platform.now())
  const realFetch: typeof fetch = (input, init) => fetch(input, init)
  /** Token lists, the indexer, the price APIs, the signed statics. */
  const fetchImpl: typeof fetch = governedFetch(deps.fetch ?? realFetch, governor)
  /*
    JSON-RPC keeps the real fetch even when a test stands one in: `deps.fetch`
    is the seam for "token lists and the ElectroSwap API", and the tests point
    the chains at a local mock server instead. Both share the one governor,
    which is the part that matters — the budget is the wallet's, not a
    service's.
  */
  const rpcFetch: typeof fetch = governedFetch(realFetch, governor)
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
  const notifications = new NotificationsService(
    deps.platform,
    host.events,
    sealed.notifications,
    async () => (await vault.active())?.id ?? null,
  )
  const prefs = new PrefsService(deps.platform, host.events)
  // Every OS notification the watcher sends is also an inbox entry (plan A6): the tag says what it was about.
  const notifyingPlatform: Platform = {
    ...deps.platform,
    notify: async (n) => {
      const [prefix, a, b] = (n.tag ?? '').split(':')
      const kind =
        prefix === 'live'
          ? 'live'
          : prefix === 'collect'
            ? 'collect'
            : prefix === 'dividends'
              ? 'dividends'
              : 'alert'
      const target =
        prefix === 'live'
          ? `campaign:${a ?? ''}`
          : prefix === 'above' || prefix === 'below'
            ? `${a ?? 'token'}:${b ?? ''}`
            : prefix === 'collect'
              ? 'positions'
              : prefix === 'dividends'
                ? 'legends'
                : null
      /*
        A standing condition keeps one row; an event gets its own.

        Both used to be stamped — events with the clock, conditions with the
        day — and a day stamp is what let "Dividends to claim" pile up: the id
        differed every midnight, so nothing deduped it and a week of not
        claiming meant seven identical rows. Conditions now carry the bare tag
        and renew in place, so the row is the current amount rather than a
        stack of yesterdays.
      */
      const standing = kind === 'collect' || kind === 'dividends'
      const id = standing ? (n.tag ?? n.title) : `${n.tag ?? n.title}:${deps.platform.now()}`
      await notifications
        .push({
          id,
          kind,
          title: n.title,
          body: n.body,
          target,
          ...(standing ? { renew: true } : {}),
        })
        .catch(() => undefined)
      await deps.platform.notify(n)
    },
  }
  const vault = new VaultManager(deps.platform, host.events, settings, {
    active: sealed.active,
    purgeAccount: async (id) => {
      await sealed.purgeAccount(id)
      await cache.forgetAccount(id)
    },
    ...(deps.kdf ? { kdf: deps.kdf } : {}),
  })
  const approvals = new ApprovalStore(deps.platform, host.events)
  const sites = new SitesService(deps.platform, host.events, sealed.sites)
  // The governor is handed over so Settings › Networks can say which host is
  // cooling and which has refused this wallet outright (`hosts()`).
  const chains = new ChainsService(deps.platform, host.events, deps.heads, rpcFetch, undefined, governor)
  const activity = new ActivityStore(deps.platform, host.events, dek)
  const contacts = new ContactsStore(deps.platform, host.events, dek)
  const relayFor =
    deps.relayFor ??
    ((url: string): Relay =>
      /^https?:\/\//.test(url) ? new HttpRelay(url, fetchImpl, deps.clientKey) : sharedMemoryRelay)
  staticsRef = new StaticsService({
    platform: deps.platform,
    bus: host.events,
    fetch: fetchImpl,
    clientVersion: deps.clientVersion ?? 'BoltVault/0.1.0',
    body: deps.body ?? 'extension',
    ...(deps.staticsUrl ? { baseUrl: deps.staticsUrl } : {}),
    ...(deps.staticsPublicKey ? { publicKeyHex: deps.staticsPublicKey } : {}),
  })
  const statics = staticsRef
  const hardware = new HardwareService({
    hid: deps.hid ?? null,
    ledger: deps.ledger ?? null,
    trezor: deps.trezor ?? null,
    vault,
    bus: host.events,
    platform: deps.platform,
  })
  // Declared before the provider, which needs it for the trace route (§9.2).
  const apiOrigin = (deps.apiOrigin ?? DEFAULT_API_ORIGIN).replace(/\/+$/, '')
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
    /*
      The API first for `NEW_CONTRACT`'s two facts (§3.4). It answers from a
      cache shared by every caller, so the same router is not looked up once per
      wallet, and it is the same answer the web interface gets.

      Which chains are worth asking about is the provider's decision, not this
      one's — it short-circuits to unknown before it ever calls this, so there
      is no second chain list here to drift out of step with that one.

      Null means "did not know", and the provider falls through to the explorer,
      which is also what happens in a build with no API at all. `electroswap` is
      built further down; the arrow only runs once a sheet is being assessed.
    */
    contractFacts: async (chainId, address) => {
      if (!electroswap) return null
      const facts = await fetchContractFacts(electroswap, chainId, address, deps.platform.now())
      return facts ? { deployedAt: facts.deployedAt, verified: facts.verified, newAfterDays: facts.newAfterDays } : null
    },
    /*
      Names for the addresses a sheet names (§8.1). `names` is built further
      down — it raises its own registration approvals through this service — so
      the arrow is the binding, and it only runs once a sheet is being assessed.
      Sanitised there, not here: `ctx.labels` is printed straight by rules.ts.
    */
    counterpartyNames: (chainId: number, addresses: readonly string[]): Promise<NameLookup[]> => names.lookup(chainId, addresses),
    /*
      One answer for "what does this account pay", read by both the site and
      the sheet (§8.6, §8.18).

      `holder` is built further down, like `electroswap` above; the arrow only
      runs once a first-party site asks or a sheet is being assessed. It is the
      same `tier()` the Swap screen quotes with, so the site cannot be handed a
      rung the wallet would not itself charge.

      A chain with no recipient, or a zero rung, is null rather than zero bips:
      `PAY_PORTION` reverts on zero, so "no fee" has to mean "encode no fee
      command at all", and a site handed `bips: 0` would build a swap that
      cannot execute.
    */
    walletFeePolicy: async (chainId, accountId) => {
      const tier = await holder.tier(accountId, chainId)
      if (!tier.sink || tier.bips <= 0) return null
      return { sink: tier.sink as Hex, bips: tier.bips, tier: tier.name }
    },
    tokenMetadata: (chainId, address) => tokens.metadata(chainId, address),
    watchAsset: (i) =>
      tokens.addCustom({
        chainId: i.chainId,
        address: i.address,
        source: 'dapp',
        origin: i.origin,
        ...(i.claimed ? { claimed: i.claimed } : {}),
      }),
    tokenInfo: async (chainId) => {
      const out: Record<string, { symbol: string; decimals: number; name?: string }> = {}
      /*
        §6: a token a paired device sent is untrusted "for 'known token'
        identity until confirmed on the receiving device". This map is what
        tells the firewall a contract *is* USDC, so a token still waiting in
        `sync.incoming()` is left out of it — it is visible in the wallet,
        with its provenance, but it is nobody's idea of a known token.
      */
      const unconfirmed = new Set(await sync.unconfirmedTokens().catch(() => [] as string[]))
      for (const t of await tokens.universe(chainId))
        if (t.address !== 'native' && !unconfirmed.has(`${chainId}:${t.address.toLowerCase()}`))
          out[t.address.toLowerCase()] = { symbol: t.symbol, decimals: t.decimals, name: t.name }
      return out
    },
    clientVersion: deps.clientVersion ?? 'BoltVault/0.1.0',
    statics: { scamOrigins: () => staticsRef?.scamOrigins() ?? [] },
    fetch: fetchImpl,
    apiOrigin,
    ...(deps.clientKey ? { clientKey: deps.clientKey } : {}),
    hardware,
    ...(deps.openApproval ? { openApproval: deps.openApproval } : {}),
    ...(deps.receiptPollMs !== undefined ? { receiptPollMs: deps.receiptPollMs } : {}),
  })
  const tokens = new TokensService(
    deps.platform,
    host.events,
    chains,
    fetchImpl,
    sealed.tokensCustom,
    sealed.tokenPrefs,
  )
  /*
    Sync reads six of the nine §6 families out of these stores, so it is built
    after them. Its merge state (sequence numbers, last-pushed digests, what is
    waiting to be confirmed) is a blob of its own: `syncMeta`'s flat
    `applied: Record<string, number>` was the wall-clock map it replaces.
  */
  const syncState = createSyncStateStore(deps.platform, dek)
  const sync = new SyncService(deps.platform, host.events, {
    settings,
    sites,
    vault,
    contacts,
    tokens,
    relayFor,
    identity: sealed.syncIdentity,
    devices: sealed.syncDevices,
    meta: sealed.syncMeta,
    state: syncState,
  })
  const features = { limitOrders: deps.features?.limitOrders ?? false }
  /*
    The GraphQL endpoint is behind the general auth gate rather than the wallet
    routes, and it verifies the signature over an EMPTY body (see the API's
    `walletSignatureAuthorized`) — so sign one here too, or every call would be
    rejected for a body hash the server never computes.
  */
  const graphqlAuth = deps.clientKey
    ? (method: string, url: string) =>
        authHeaders({ key: deps.clientKey as string, method, url, now: deps.platform.now() })
    : undefined
  const electroswap =
    deps.electroswapUrl === null
      ? null
      : new ElectroSwapClient({
          url: deps.electroswapUrl ?? `${apiOrigin}/graphql`,
          ...(graphqlAuth ? { authHeaders: graphqlAuth } : {}),
          fetchImpl,
        })
  /*
    Prefer our own proxy when this build has a wallet key (§9.4).

    It answers in GeckoTerminal's exact shape, so this is a base URL rather
    than a second client. What it buys: the upstream API keys stay server-side,
    the cache is shared across every install instead of per-device, and no
    third party ever sees a user's IP beside the tokens they hold. Without a
    key we talk to GeckoTerminal directly — the fallback the plan allows, and
    what every build did until now.
  */
  const pricesBase =
    deps.pricesUrl ?? (deps.clientKey ? `${apiOrigin}/api/wallet/prices` : undefined)
  const prices =
    deps.pricesUrl === null
      ? null
      : new GeckoTerminalPrices(fetchImpl, () => deps.platform.now(), pricesBase, deps.clientKey)
  const portfolio = new PortfolioService({
    platform: deps.platform,
    bus: host.events,
    chains,
    tokens,
    vault,
    electroswap,
    prices,
    snapshots: sealed.portfolio,
    looks: sealed.looks,
  })
  const names: NamesService = new NamesService({ platform: deps.platform, chains, vault, provider, cache })
  /*
    The pre-assessment reaches the firewall through the provider's own payload
    builder — the function that builds every sheet — rather than through a
    second copy of the pipeline. `payloadFor` is private to `ProviderService`
    because nothing outside the approval path had ever needed it; narrowing the
    service to that one call here keeps the preview and the sheet provably the
    same code, which is the property §3.4 cares about. Opening the method up
    properly is a one-line change in provider.ts.
  */
  const payloadFor = (provider as unknown as { payloadFor(intent: ApprovalIntent): Promise<ApprovalPayload> }).payloadFor.bind(provider)
  const security = new SecurityService({ vault, chains, settings, payloadFor })
  const allowances = new AllowancesService({
    platform: deps.platform,
    bus: host.events,
    chains,
    tokens,
    vault,
    provider,
    allowances: sealed.allowances,
  })
  const send = new SendService({ platform: deps.platform, chains, tokens, names, vault, provider })
  const scanner = new ActivityScanner({
    platform: deps.platform,
    chains,
    activity,
    tokens,
    vault,
    settings,
    cache,
    bus: host.events,
    scan: sealed.scan,
  })
  const weights = new DynoWeight({ platform: deps.platform, electroswap, cache })
  // The published fee ladder. Without a key the route answers 401, so there is
  // nothing to ask and the bundled ladder stands — which is a correct schedule.
  const ladders = deps.clientKey
    ? new FeeLadders({
        fetch: fetchImpl,
        url: `${apiOrigin}/api/wallet/fees`,
        key: deps.clientKey,
        now: () => deps.platform.now(),
      })
    : undefined
  const holder = new HolderService({
    platform: deps.platform,
    chains,
    vault,
    cache,
    weights,
    ...(ladders ? { ladders } : {}),
  })
  const flows = new FlowStore({ platform: deps.platform, bus: host.events, activity })
  /*
    Where a swap that did not work gets reported (§3.7, `clientFailureApi`).

    Two gates, and both of them are hard. Without a key there is nothing to ask:
    the route answers 401 without a per-request signature, exactly as the fee
    ladder does. And `enabled` is the user's diagnostics toggle, read fresh on
    every send — a report carries the account address and its balances, which is
    more personal than the stack trace the same toggle already covers, so it is
    off unless the user has said otherwise. A settings document that will not
    read is a no, not a maybe.
  */
  const failures = clientFailuresFor({
    fetch: fetchImpl,
    url: `${apiOrigin}${CLIENT_FAILURE_PATH}`,
    ...(deps.clientKey ? { key: deps.clientKey } : {}),
    now: () => deps.platform.now(),
    // The engine only ever runs in the extension's background worker or on the
    // phone; `extension-page` is the page context's own crash reporter.
    client: (deps.body ?? 'extension') === 'mobile' ? 'mobile' : 'extension-worker',
    // The engine's `clientVersion` is `BoltVault/1.2.3`; the endpoint wants the
    // version the way `/api/wallet/crash` sends it, which is bare.
    version: (deps.clientVersion ?? 'BoltVault/0.1.0').replace(/^BoltVault\//, ''),
    enabled: () => settings.get().then((s) => s.crashReports, () => false),
  })
  /*
    The routing service (§8.6), asked before the on-chain mini-router.

    Without a key there is nothing to ask: the service's origin check refuses an
    extension outright — a `chrome-extension://` origin is on no allow-list — and
    the key is the one thing that gets past it. A keyless build (and every test)
    therefore quotes on chain, which is what shipped before this and is a correct
    price, just a narrower search.
  */
  const quoter =
    deps.clientKey && deps.quoterUrl !== null
      ? new Quoter({
          fetch: fetchImpl,
          url: deps.quoterUrl ?? `${apiOrigin}${DEFAULT_QUOTER_PATH}`,
          key: deps.clientKey,
          now: () => deps.platform.now(),
        })
      : undefined
  const swap = new SwapService({
    statics,
    platform: deps.platform,
    chains,
    tokens,
    vault,
    provider,
    settings,
    holder,
    flows,
    ...(quoter ? { quoter } : {}),
    ...(failures ? { failures } : {}),
    // `explore` is built further down; the arrow only runs once a quote is asked for.
    safety: { level: (chainId, address) => explore.safetyLevel(chainId, address) },
  })
  const limit = new LimitService({
    platform: deps.platform,
    bus: host.events,
    chains,
    tokens,
    vault,
    provider,
    settings,
    flows,
    enabled: features.limitOrders,
    // Same gate as the swap path: a limit order is a swap with a delay, and a
    // second door into the same trade is not a gate.
    safety: { level: (chainId, address) => explore.safetyLevel(chainId, address) },
  })
  const watchlist = new WatchlistService({
    platform: notifyingPlatform,
    bus: host.events,
    vault,
    watchlist: sealed.watchlist,
  })
  const legends = new LegendsService({
    platform: deps.platform,
    chains,
    vault,
    provider,
    flows,
    legendsBest: sealed.legends,
  })
  const customCollections = new CustomCollectionsService({
    platform: deps.platform,
    chains,
    fetch: fetchImpl,
    collections: sealed.nftCustom,
    meta: sealed.nftMeta,
  })
  const explore = new ExploreService({
    platform: deps.platform,
    electroswap,
    tokens,
    vault,
    watchlist,
    cache,
    bus: host.events,
    custom: customCollections,
    legends,
  })
  const nft = new NftService({
    platform: deps.platform,
    chains,
    vault,
    provider,
    flows,
    electroswap,
    explore,
    legends,
    cache,
    notifications,
    custom: customCollections,
  })
  const farm = new FarmService({
    platform: deps.platform,
    chains,
    tokens,
    vault,
    provider,
    flows,
    settings,
    electroswap,
    cache,
  })
  const launchpad = new LaunchpadService({
    platform: deps.platform,
    chains,
    vault,
    provider,
    flows,
    electroswap,
    names,
    watchlist,
    cache,
    referrals: sealed.launchpadRef,
  })
  const positions = new PositionsService({
    platform: deps.platform,
    bus: host.events,
    farm,
    legends,
    limit,
    launchpad,
    tokens,
    positions: sealed.positions,
  })
  const remote = new RemoteSignService({
    platform: deps.platform,
    bus: host.events,
    sync,
    vault,
    provider,
    canSignHere: async (a) =>
      (await vault.privateKeyFor(a.id).catch(() => null)) !== null ||
      (a.kind !== 'hd' && a.kind !== 'imported' && hardware.canSign(a)),
    ...(deps.receiptPollMs !== undefined ? { pollMs: deps.receiptPollMs * 5 } : {}),
  })
  provider.setRemote(remote)
  sync.setRecordHook((rec, from) => remote.onRecord(rec, from))
  const dapps = new DappsService({
    provider,
    bus: host.events,
    now: () => deps.platform.now(),
    random: (n) => deps.platform.random(n),
  })
  const connect = new ConnectService({
    walletKit: deps.walletKit ?? null,
    dapps,
    chains,
    vault,
    sites,
    bus: host.events,
    scamOrigins: () => statics?.scamOrigins() ?? [],
    sessions: sealed.wcSessions,
  })
  connect.init()
  const bridge = new BridgeService({
    statics,
    platform: deps.platform,
    bus: host.events,
    chains,
    vault,
    provider,
    flows,
    settings,
    transfers: sealed.bridge,
    ...(deps.receiptPollMs !== undefined ? { receiptPollMs: deps.receiptPollMs } : {}),
  })
  watchlist.attach({
    tokens: (chainId) => explore.tokens(chainId),
    collections: (chainId) => explore.collections(chainId),
    campaigns: (chainId) => launchpad.list(chainId, undefined, ['ACTIVE', 'PENDING']),
    // The watch raises one notification, so it takes the first standing thing.
    accessory: async (accountId, chainId) =>
      (await positions.snapshot(accountId, chainId)).accessories[0] ?? null,
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
      syncState.forget()
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
        const decision = arg as ApprovalDecision
        /*
          A yes needs an unlocked vault, and not only because the signing keys
          are behind it: a request accepts exactly one final decision, so a yes
          taken while locked SPENDS the request on something that cannot be
          carried out — a locked vault lists no accounts, so even a connect
          fails 4100 — and leaves the site holding an error it can never
          resolve, however many times the person unlocks afterwards.

          A no is always allowed: closing the sign window is a rejection, and it
          has to keep working whatever state the vault is in. So is a yes with
          no vault at all — there is no unlock to wait for, and whatever the
          request needed a key for will fail on its own.
        */
        if (decision.approve) {
          const status = await vault.status()
          if (status.exists && !status.unlocked) {
            throw new EngineError('locked', 'Unlock BoltVault before approving this request.')
          }
          /*
            The record was written when the sheet went up, and a sheet may sit
            for minutes. Signing reads the chain and the account from that
            record rather than from the live request, so this is where the two
            are checked to still exist: a chain dropped from the registry or an
            account removed from the vault in the meantime must fail here,
            while the request can still be raised again, rather than at the
            signer with a spent approval.
          */
          const pending = approvals.get(decision.id)
          if (pending?.chainId != null && !chains.known(pending.chainId))
            throw new EngineError('invalid_argument', 'That network is no longer available. Ask the site again.')
          if (pending?.accountId != null && !(await vault.accounts()).some((a) => a.id === pending.accountId))
            throw new EngineError('invalid_argument', 'That account is no longer in this wallet. Ask the site again.')
        }
        const decided = await approvals.decide(decision)
        // A signing decision is activity: the idle timer restarts.
        void vault.touch().catch(() => undefined)
        return decided
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
  /*
    Activity is the local log plus what the chain saw. The local log is written
    before broadcast and knows only what this wallet did; a native ETN arrival
    emits no log at all, so it can only ever come from the feed (§8.12).
    Feed rows are merged at read time rather than appended, because "Clear =
    wipes local rows only" — clearing history must not pretend the chain forgot.
  */
  const activityFeed = new ActivityFeedService({
    platform: deps.platform,
    electroswap,
    activity,
    cache,
    addressOf: async (accountId) => (await vault.accounts()).find((a) => a.id === accountId)?.address ?? null,
    isEtn: isElectroneumChainId,
  })
  const tx = new TxService({ platform: deps.platform, chains, vault, provider, activity })
  host.register('activity', {
    list: {
      input: z
        .object({
          accountId: AccountIdSchema.optional(),
          chainId: z.number().int().positive().optional(),
          limit: z.number().int().positive().max(500).optional(),
        })
        .optional(),
      handler: (arg) =>
        activityFeed.list(
          (arg as { accountId?: string; chainId?: number; limit?: number } | undefined) ?? {},
        ),
    },
    detail: {
      input: z.object({ id: z.string().min(1).max(128) }),
      handler: (arg) => activityFeed.detail((arg as { id: string }).id),
    },
    clear: { handler: () => activity.clear() },
  })
  host.register('tx', txNamespace(tx))
  host.register('activityScan', activityScanNamespace(scanner))
  host.register('sync', syncNamespace(sync))
  host.register('tokens', tokensNamespace(tokens))
  host.register('portfolio', portfolioNamespace(portfolio))
  host.register('names', namesNamespace(names))
  host.register('security', securityNamespace(security))
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
  host.register(
    'about',
    aboutNamespace({ apiOrigin, apiIsDefault: apiOrigin === DEFAULT_API_ORIGIN, features }),
  )
  host.register('notifications', notificationsNamespace(notifications))
  host.register('prefs', prefsNamespace(prefs))

  const ready = Promise.all([
    approvals.hydrate(),
    sites.hydrate(),
    settings.get(),
    provider.init(),
    watchlist.hydrate(),
    statics.hydrate(),
  ]).then(() => {
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
    security,
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
