/**
 * createEngineClient — a typed WalletEngine over any transport.
 *
 * `engine.vault.unlock({ password })` becomes `transport.call('vault', 'unlock',
 * { password })`. The proxy is the only place the static contract meets the
 * dynamic wire; the host validates inputs with zod and rejects unknown methods,
 * so a stale client cannot reach anything the host does not expose.
 */
import type { EngineNamespaces, NamespaceName, WalletEngine } from './contract'
import type { EngineTransport } from './transport'

// Exhaustive by construction: a namespace added to the contract but missing here is a compile error,
// not a popup whose `engine.<ns>` is undefined.
const NAMESPACE_TABLE: Record<NamespaceName, true> = { vault: true, accounts: true, sites: true, chains: true, approvals: true, settings: true, portfolio: true, activity: true, activityScan: true, tx: true, tokens: true, names: true, allowances: true, contacts: true, send: true, sync: true, swap: true, holder: true, limit: true, hardware: true, explore: true, nft: true, legends: true, farm: true, launchpad: true, watchlist: true, positions: true, bridge: true, remote: true, dapps: true, connect: true, flags: true, about: true, notifications: true, prefs: true }
const NAMESPACES = Object.keys(NAMESPACE_TABLE) as readonly NamespaceName[]

type AnyMethod = (arg?: unknown) => Promise<unknown>

function namespaceProxy(transport: EngineTransport, ns: string): Record<string, AnyMethod> {
  const cache = new Map<string, AnyMethod>()
  return new Proxy<Record<string, AnyMethod>>(
    {},
    {
      get(_target, prop) {
        if (typeof prop !== 'string') return undefined
        // `then` probing by await/Promise.resolve must not look like a method.
        if (prop === 'then' || prop === 'toJSON') return undefined
        let fn = cache.get(prop)
        if (!fn) {
          fn = (arg?: unknown) => transport.call(ns, prop, arg)
          cache.set(prop, fn)
        }
        return fn
      },
      has(_target, prop) {
        return typeof prop === 'string' && prop !== 'then'
      },
    },
  )
}

export function createEngineClient(transport: EngineTransport): WalletEngine {
  const namespaces: Partial<Record<NamespaceName, Record<string, AnyMethod>>> = {}
  for (const ns of NAMESPACES) namespaces[ns] = namespaceProxy(transport, ns)
  // The proxies satisfy the namespace interfaces structurally at runtime; the
  // compile-time contract is enforced on the host side via MethodSpec schemas.
  const callable = namespaces as unknown as EngineNamespaces
  return {
    ...callable,
    events: { subscribe: (listener) => transport.subscribe(listener) },
  }
}
