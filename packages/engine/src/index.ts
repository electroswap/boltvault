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
export { SettingsStore } from './settingsStore'
export { ActivityStore } from './activityStore'
export { VaultManager, AUTOLOCK_ALARM, toView as accountToView } from './namespaces/vault'
export { SitesService } from './namespaces/sites'
export { ChainsService, rpcHeadSource, toChainView, type HeadSource } from './namespaces/chains'
export { SyncService, MemoryRelay, HttpRelay, type Relay, type SyncDeps } from './namespaces/sync'
export { createEngine, type Engine, type EngineDeps } from './create'
export * from './approvalPayloads'
export { ProviderService, normaliseTypedData, type ProviderDeps, type PortInfo } from './namespaces/provider'
