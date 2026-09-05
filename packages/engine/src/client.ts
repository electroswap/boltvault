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

const NAMESPACES: readonly NamespaceName[] = ['vault', 'accounts', 'sites', 'chains', 'approvals', 'settings', 'portfolio', 'activity', 'activityScan', 'tokens', 'names', 'allowances', 'contacts', 'send', 'sync', 'swap', 'holder', 'limit', 'hardware', 'explore', 'nft', 'legends', 'farm', 'launchpad', 'watchlist', 'positions']

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
