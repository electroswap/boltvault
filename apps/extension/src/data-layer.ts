/**
 * Data-layer barrel (E0a) — one import point for the popup data access layer.
 *
 * App.tsx + surfaces import from './data-layer' (or this path) rather than
 * reaching for the individual modules, so the E0b/E wiring has a stable home.
 */
export * from './sw-messages'
export * from './sw-client'
export * from './heartbeat'
export * from './hooks'
