import { defineBackground } from '#imports'
import { createChainClient } from '@boltvault/chains'
import { resolveChainList } from '@boltvault/token-catalog'
import {
  RpcFlow,
  RpcError,
  SiteRegistry,
  type RpcContext,
  type ProviderEvent,
} from '@boltvault/provider-protocol'
import { ExtensionRpcContext, localSitesStore } from '../src/provider-context'
import {
  VaultService,
  WrongPasswordError,
  type CreatedVault,
  type VaultStores,
} from '../src/vault-service'
import { DataEngine, noOpPrices, type RpcReader } from '../src/data-engine'
import { localStore, sessionStore } from '../src/storage'

/**
 * MV3 service worker (T3.1 skeleton + T3.3 vault + T3.5 rpcFlow).
 *
 * Two inbound surfaces, one funnel:
 *  - `browser.runtime.onMessage` (popup/extension-internal): bv:ping, bv:vault:*
 *  - `browser.runtime.onConnect`   (the page-provider Port): JSON-RPC → rpcFlow
 *
 * T3.5 wires the per-origin sessions + the pure RpcFlow (provider-protocol).
 * The origin is taken from the Port `sender` (the frame URL), never the payload
 * — a dApp can forge postMessage but not the Chrome sender (design §injection).
 */

// In the SW WXT exposes the chrome/browser API as `browser`.
export default defineBackground(() => {
  const stores: VaultStores = { secret: localStore, session: sessionStore }
  const vault = VaultService.connect(stores, '5min')
  const registry = new SiteRegistry(localSitesStore(localStore))
  void registry.hydrate()

  // E0b: the current account (address) the portfolio reads for. Set on
  // unlock/create/import; the popup queries `bv:accounts` to learn it.
  let currentAccounts: string[] = []

  // E0b data engine — the SW-side of the popup data layer (block head,
  // portfolio, prices). A viem-backed reader + no-op prices for v1 (display).
  // v1 is ETN-first, so the reader is bound to ELECTRONEUM (52014).
  const etn = createChainClient(52014)
  const reader: RpcReader = {
    blockNumber: () => etn.getBlockNumber(),
    nativeBalance: (address) => etn.getBalance({ address: address as any }),
    erc20Balances: async (account, tokens) => {
      const out: Record<string, bigint> = {}
      const CH = 50 // design: multicall3 with a batch cap
      for (let i = 0; i < tokens.length; i += CH) {
        const slice = tokens.slice(i, i + CH)
        const contracts = slice.map((t) => ({
          address: t.address as any,
          functionName: 'balanceOf' as const,
          args: [account as any],
        }))
        const results = await etn.multicall({ contracts: contracts as any, allowFailure: true })
        for (let j = 0; j < slice.length; j++) {
          const r = results[j] as any
          const res = slice[j]
          if (!res) continue
          out[res.address.toLowerCase()] = typeof r?.result === 'bigint' ? (r.result as bigint) : 0n
        }
      }
      return out
    },
  }
  const dataEngine = new DataEngine({
    reader,
    prices: noOpPrices,
    universe: async (chainId) => (await resolveChainList(chainId)).tokens,
  })



  // Live provider Ports, keyed by origin, so `emit` can push chainChanged /
  // accountsChanged to exactly the right tab (design: chainChanged only to
  // tabs whose origin matches).
  const livePorts = new Map<string, any>()
  const emit = (origin: string, event: ProviderEvent) => {
    for (const port of livePorts.values()) {
      if ((port as { origin?: string }).origin === origin) {
        port.postMessage({ jsonrpc: '2.0', event: event.event, data: event.event === 'chainChanged' ? { chainId: event.chainId } : { accounts: event.accounts } })
      }
    }
  }

  const ctx = new ExtensionRpcContext({
    vault,
    registry,
    emit,
    settings: { ethSignEnabled: false },
  })
  const flow = new RpcFlow(ctx)

  browser.runtime.onInstalled.addListener((details) => {
    console.log('[BoltVault] installed', details.reason)
  })

  // --- extension-internal messages (popup) -----------------------------------
  browser.runtime.onMessage.addListener(
    (message: any, _sender: any, sendResponse: (resp: unknown) => void) => {
      void (async () => {
        try {
          switch (message?.type) {
            case 'bv:ping':
              return { ok: true, pong: true, ts: Date.now() }
            case 'bv:vault:create': {
              const c = await vault.createVault(message.password, { bits: message.bits })
              ctx.setAccounts?.([])
              return c as unknown as object
            }
            case 'bv:vault:import': {
              const c = await vault.importVault(message.mnemonic, message.password)
              ctx.setAccounts?.([])
              return c as unknown as object
            }
            case 'bv:vault:unlock': {
              const accounts = await vault.unlock(message.password)
              currentAccounts = accounts.map((a) => a.address)
              ctx.setAccounts?.(accounts)
              return { accounts, current: currentAccounts }
            }
            case 'bv:vault:lock':
              await vault.lock()
              return { ok: true }
            case 'bv:vault:reveal':
              return { mnemonic: await vault.revealMnemonic(message.password) }
            case 'bv:vault:state':
              return { hasVault: await vault.hasVault(), unlocked: await vault.isUnlocked() }
            case 'bv:accounts':
              return { accounts: currentAccounts }
            case 'bv:block:head':
              return await dataEngine.blockHead(message.chainId)
            case 'bv:portfolio':
              return await dataEngine.portfolio(message.chainId, message.account)
            case 'bv:price':
              return await dataEngine.price(message.chainId, message.address)
            // G: open the full-tab theater ("full sky + coil + shelf").
            case 'bv:full-tab:open': {
              const w = await browser.windows.create({
                url: 'full-tab.html',
                type: 'popup',
                width: 1100,
                height: 760,
              })
              return { ok: true, window: w?.id ?? null }
            }
            // G: open the signing notification window (the same breaker, quiet).
            case 'bv:notify:open': {
              const w = await browser.windows.create({
                url: 'notification.html',
                type: 'popup',
                width: 412,
                height: 520,
              })
              return { ok: true, window: w?.id ?? null }
            }
            case 'bv:notify:get':
              // v1: no queued request yet (the popup drives it); return empty.
              return { request: null }
            default:
              return { ok: false, error: 'unknown method' }
          }
        } catch (e) {
          const isWrongPw = e instanceof WrongPasswordError
          return { ok: false, error: isWrongPw ? 'wrong-password' : (e as Error).message }
        }
      })().then(sendResponse)
      return true // async response
    },
  )

  // --- page-provider Port relay (T3.5 rpcFlow) ------------------------------
  browser.runtime.onConnect.addListener((port: any) => {
    if (port.name !== 'bolt-provider') return
    const sender = port as any
    // Origin = the frame URL (sender.url), per design. All frames of an origin
    // share the port namespace; we key on origin.
    const origin = originOf(sender)
    ;(port as { origin?: string }).origin = origin
    livePorts.set(origin + '#' + (port.id ?? Math.random().toString(36).slice(2)), port)

    port.onMessage.addListener(async (msg: any) => {
      const { jsonrpc, id, method, params } = msg ?? {}
      if (!method) return
      try {
        const result = await flow.request(origin, method, params ?? [])
        port.postMessage({ jsonrpc, id, result })
      } catch (e) {
        const code = e instanceof RpcError ? e.code : -32603
        port.postMessage({ jsonrpc, id, error: { code, message: (e as Error).message } })
      }
    })

    port.onDisconnect.addListener(() => {
      for (const [k, p] of livePorts) if (p === port) livePorts.delete(k)
    })
  })
})

/** The frame origin for a Port sender. Chrome sets sender.url to the frame. */
function originOf(sender: any): string {
  try {
    const url = sender?.url ?? sender?.tab?.url
    if (!url) return 'unknown'
    return new URL(url).origin
  } catch {
    return sender?.tab?.url ?? 'unknown'
  }
}

export type { CreatedVault }
