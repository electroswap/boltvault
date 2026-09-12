export * from './schema'
export * from './contract'
export * from './errors'
export * from './wire'
export { EngineHost, EventBus, type SenderClass, type MethodSpec, type NamespaceSpec, type Handler } from './host'
export {
  createInProcessTransport,
  createChannelClient,
  serveChannel,
  createChannelPair,
  type EngineTransport,
  type MessageChannelLike,
  type MemoryChannel,
  type ChannelClientOptions,
} from './transport'
export { createEngineClient } from './client'
export { ApprovalStore, APPROVAL_TTL_MS, type CreateApprovalInput } from './approvals'
export { readDoc, writeDoc, type DocSpec, type ReadDocResult } from './storage'
export { DocCache, cacheKey, cachedSchema, type Cached, type CacheSpec } from './cache'
export { NotificationsService } from './namespaces/notifications'
export { PrefsService, DEFAULT_PREFS } from './namespaces/prefs'
export { CustomCollectionsService, CustomCollectionSchema, NftMetadataSchema, parseMetadata, resolveMediaUrl, type CustomCollection, type NftMetadata } from './namespaces/nftCustom'
export { SettingsStore } from './settingsStore'
export { ActivityStore } from './activityStore'
export { VaultManager, AUTOLOCK_ALARM, toView as accountToView } from './namespaces/vault'
export { SitesService } from './namespaces/sites'
export { ChainsService, toChainView, type HeadSource } from './namespaces/chains'
export { Governor, RateLimited, governedFetch, type GovernorSnapshot, type HostBudget } from './governor'
export { authHeaders, walletAuthHeader, keyIdOf, pathOf, signingString, type AuthInput } from './apiAuth'
export {
  ClientFailures,
  clientFailuresFor,
  CLIENT_FAILURE_PATH,
  normalise as normaliseClientFailure,
  stripPermitSignatures,
  type ClientFailureDeps,
  type ClientFailureInput,
  type ClientFailureReport,
  type FailureKind,
  type FailureOperation,
  type FailureStage,
  type SwapFailureDetail,
} from './clientFailureApi'
// The polling cadence is a property of the chain, and the UI polls too: it is
// re-exported here so a screen does not need a dependency on the registry.
export { pollMs, type PollMode } from '@boltvault/chains'
// Screens need to tell "no fee here" from "swaps are off here"; the wallet does not depend on @boltvault/chains.
export { ELECTRONEUM_TESTNET_CHAIN_ID } from '@boltvault/chains'
export { SyncService, MemoryRelay, HttpRelay, type Relay, type SyncDeps } from './namespaces/sync'
export { createEngine, type Engine, type EngineDeps } from './create'
export * from './approvalPayloads'
export { ProviderService, normaliseTypedData, type ProviderDeps, type PortInfo } from './namespaces/provider'
export { TokensService, type TokenMetadata } from './namespaces/tokens'
export { PortfolioService } from './namespaces/portfolio'
export { NamesService, ETN_UNIVERSAL_RESOLVER } from './namespaces/names'
export { AllowancesService } from './namespaces/allowances'
export { ContactsStore } from './namespaces/contacts'
export { SendService, type SendInput } from './namespaces/send'
export { SwapService, swapFailureReport, type SwapInput, type SwapDeps, type SwapQuoteView, type SwapDiagnostics } from './namespaces/swap'
export { HolderService, type FeeAddresses } from './namespaces/holder'
export { DynoWeight, twap, type DynoWeightValue, type DynoWeightDeps } from './dynoweight'
export { LimitService, type LimitInput } from './namespaces/limit'
export { FlowStore, FlowReceiptError, type FlowStepRun, type FlowStepFailure } from './namespaces/flows'
export { HardwareService, type HardwareDeps, type LedgerStatusView, type LedgerDeviceView } from './namespaces/hardware'
export { ExploreService } from './namespaces/explore'
export { NftService, marketplaceConfig } from './namespaces/nft'
export { LegendsService } from './namespaces/legends'
export { FarmService } from './namespaces/farm'
export { LaunchpadService } from './namespaces/launchpad'
export { WatchlistService, WATCH_ALARM } from './namespaces/watchlist'
export { PositionsService } from './namespaces/positions'
export { BridgeService } from './namespaces/bridge'
export { RemoteSignService, assertSignedTheTransaction, assertSignedTheMessage, assertSignedTheTypedData } from './namespaces/remote'
export { DappsService } from './namespaces/dapps'
export { ConnectService } from './namespaces/connect'
export { StaticsService, STATICS_ALARM, STATICS_BASE } from './namespaces/statics'
export { hasRawBytes } from './wire'
export { GeckoTerminalPrices, type PriceSource } from './prices'
export { ActivityScanner, ACTIVITY_ALARM } from './namespaces/activityScan'
export { readMany, multicallAddress, resetMulticallCache, CANONICAL_MULTICALL3, type ReadCall, type ReadResult } from './multicall'
