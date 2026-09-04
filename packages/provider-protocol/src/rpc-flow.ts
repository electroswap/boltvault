/**
 * rpcFlow — the request router every provider-protocol body shares (T3.5).
 *
 * Design §"rpcFlow (SW)": the decision funnel is pure and body-agnostic. Both
 * the browser extension's MAIN-world provider and (mobile) WalletConnect push
 * through this SAME router (design S9: "Implement packages/provider-protocol
 * once"). The extension supplies a `Context` backed by chrome.storage + viem;
 * a test (or the WC host) supplies a fake.
 *
 * The funnel, in order:
 *   1. method known?            -> else METHOD_NOT_FOUND (-32601)
 *   2. SAFE? (read-only / local)-> run, no UI
 *   3. needs connect?           -> not connected? NOT_CONNECTED (4100)
 *                                  (eth_requestAccounts opens the Connect UI)
 *   4. APPROVAL? (signing)      -> one-in-flight per origin, else ALREADY_PENDING
 *                                  -> approval callback -> run
 *   5. unsupported?             -> METHOD_UNSUPPORTED (4200)
 *   6. execute via the Context
 *
 * "SAFE" per the design's explicit list. `eth_call` is concurrent (not a
 * signing request). `eth_sign` is SUPPORTED-but-disabled-by-default (replayable)
 * -> the Context's `settings.ethSignEnabled` gates it -> 4200 when off.
 */
import { getChain, HOME_CHAIN_ID } from '@boltvault/chains'
import { RPC, RpcError, type RpcErrorPayload } from './errors'
import type { SiteRegistry } from './sessions'

/** Everything the funnel needs to execute a request (injected per body). */
export interface RpcContext {
  /** The per-origin session registry (chain + account per origin). */
  readonly sites: SiteRegistry
  /**
   * The connected account addresses for an origin (empty if not connected).
   * Driven by the vault unlock state in the extension.
   */
  accountsFor(origin: string): Promise<string[]>
  /**
   * Resolve a signing request's approval: show the Approval UI (extension) or
   * the WC approval (mobile). `resolve` = user approved; REJECT = they tapped
   * no (throws RpcError 4001).
   */
  approve(origin: string, method: string, params: readonly unknown[]): Promise<void>
  /**
   * A read-only / safe RPC passthrough (eth_call, eth_getBalance, eth_chainId
   * data, ...) executed against the right chain for this origin.
   */
  executeSafe(origin: string, method: string, params: readonly unknown[]): Promise<unknown>
  /** Execute a signed/approved action (eth_sendTransaction, sign*) locally. */
  executeAction(origin: string, method: string, params: readonly unknown[]): Promise<unknown>
  /** Current settings snapshot (eth_sign gate, etc.). */
  readonly settings: RpcSettings
  /** Emit a provider event (accountsChanged / chainChanged) to a matching origin. */
  emit(origin: string, event: ProviderEvent): void
  /** Is the vault unlocked (has a usable account)? */
  isUnlocked(): Promise<boolean>
}

export interface RpcSettings {
  /** eth_sign is replayable — off unless the user flips Settings. */
  readonly ethSignEnabled: boolean
}

export type ProviderEvent =
  | { event: 'accountsChanged'; accounts: string[] }
  | { event: 'chainChanged'; chainId: string }

/** The one-in-flight signing lock. */
export class SigningQueue {
  private readonly inFlight = new Set<string>()
  isPending(origin: string): boolean {
    return this.inFlight.has(origin)
  }
  /** Acquire the slot for an origin, throwing ALREADY_PENDING if one is held. */
  async enter(origin: string): Promise<void> {
    if (this.inFlight.has(origin)) {
      throw new RpcError(RPC.ALREADY_PENDING, 'A signing request is already in flight for this origin')
    }
    this.inFlight.add(origin)
  }
  exit(origin: string): void {
    this.inFlight.delete(origin)
  }
}

/** Methods that run with no approval and no UI (design SAFE list). */
const SAFE_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_getBalance',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'web3_clientVersion',
  'net_listening',
  'net_version',
  'eth_accounts',
])

/** Methods that require the connect account + chain. */
const CONNECT_METHODS = new Set(['eth_requestAccounts'])

/** Methods that need an approval UI (signing / state-changing). */
const APPROVAL_METHODS = new Set([
  'eth_sendTransaction',
  'personal_sign',
  'eth_signTypedData_v4',
  'eth_signTypedData_v3',
  'eth_sign',
  'wallet_watchAsset',
  'wallet_requestPermissions',
])

/** Explicitly unsupported in the extension (design method table). */
const UNSUPPORTED = new Set(['eth_signTransaction', 'eth_getEncryptionPublicKey', 'eth_decrypt'])

/**
 * The pure funnel. No `chrome.*`, no `window` — fully unit-testable.
 */
export class RpcFlow {
  private readonly queue = new SigningQueue()

  constructor(
    private readonly ctx: RpcContext,
  ) {}

  /**
   * Run one JSON-RPC request for `origin`. Returns a result, or throws an
   * RpcError with a MetaMask code. The caller (SW/bridge) converts the throw
   * to a JSON-RPC error payload.
   */
  async request(origin: string, method: string, params: readonly unknown[] = []): Promise<unknown> {
    // 1. Known method?
    if (!this.isKnown(method)) {
      throw new RpcError(RPC.METHOD_NOT_FOUND, `Method not found: ${method}`)
    }

    // 2. SAFE / read-only -> no UI.
    if (SAFE_METHODS.has(method)) {
      // eth_accounts is "safe" only if already connected (design). If a
      // provider asks before connect it's fine to return what we know.
      return this.ctx.executeSafe(origin, method, params)
    }

    // 3. Connect.
    if (CONNECT_METHODS.has(method)) {
      const accounts = await this.ctx.accountsFor(origin)
      if (accounts.length === 0) {
        // Nothing to connect to (vault locked or no accounts) -> 4100.
        throw new RpcError(RPC.NOT_CONNECTED, 'Not connected')
      }
      await this.ctx.sites.connect(origin, {
        accountId: accounts[0] ?? '',
        accounts,
        chainId: this.ctx.sites.chainIdFor(origin),
      })
      this.ctx.emit(origin, { event: 'accountsChanged', accounts })
      return accounts
    }

    // 4. Chain management (origin-scoped).
    if (method === 'wallet_switchEthereumChain') {
      const p = params[0] as { chainId?: string | number } | undefined
      const chainId = toDecChainId(p?.chainId)
      const known = getChain(chainId)
      if (!known) throw new RpcError(RPC.UNRECOGNIZED_CHAIN, `Unrecognized chainId ${chainId}`)
      const prev = this.ctx.sites.chainIdFor(origin)
      await this.ctx.sites.setChain(origin, chainId)
      if (prev !== chainId) {
        this.ctx.emit(origin, { event: 'chainChanged', chainId: hexChainId(chainId) })
      }
      return null
    }
    if (method === 'wallet_addEthereumChain') {
      const p = params[0] as { chainId?: string | number } | undefined
      const chainId = toDecChainId(p?.chainId)
      if (!getChain(chainId)) {
        // Only add if it is one of the 10; else reject 4902 unless user adds custom.
        throw new RpcError(RPC.UNRECOGNIZED_CHAIN, `Unrecognized chainId ${chainId}`)
      }
      await this.ctx.sites.setChain(origin, chainId)
      this.ctx.emit(origin, { event: 'chainChanged', chainId: hexChainId(chainId) })
      return null
    }

    // 5. EIP-2255 permissions subset (eth_accounts).
    if (method === 'wallet_getPermissions') {
      const accounts = await this.ctx.accountsFor(origin)
      return [
        {
          parentCapability: 'eth_accounts',
          requested: true,
          granted: this.ctx.sites.isConnected(origin),
          invoker: origin,
          limits: accounts,
          id: 'b7d65528-de4e-4e69-bd86-7a58e6c0f9f1',
          origin: origin,
        },
      ]
    }
    if (method === 'wallet_revokePermissions') {
      await this.ctx.sites.disconnect(origin)
      this.ctx.emit(origin, { event: 'accountsChanged', accounts: [] })
      return []
    }
    if (method === 'wallet_requestPermissions') {
      const accounts = await this.ctx.accountsFor(origin)
      return [
        {
          parentCapability: 'eth_accounts',
          requested: true,
          granted: true,
          invoker: origin,
          limits: accounts,
          id: 'b7d65528-de4e-4e69-bd86-7a58e6c0f9f1',
          origin: origin,
        },
      ]
    }

    // 6. APPROVAL (signing) — one in flight per origin.
    if (APPROVAL_METHODS.has(method)) {
      // eth_sign is supported-but-disabled by default (replayable).
      if (method === 'eth_sign' && !this.ctx.settings.ethSignEnabled) {
        throw new RpcError(RPC.METHOD_UNSUPPORTED, 'eth_sign is disabled (replayable) — enable in Settings')
      }
      await this.queue.enter(origin)
      try {
        await this.ctx.approve(origin, method, params)
        return await this.ctx.executeAction(origin, method, params)
      } finally {
        this.queue.exit(origin)
      }
    }

    // 7. Explicitly unsupported.
    if (UNSUPPORTED.has(method)) {
      throw new RpcError(RPC.METHOD_UNSUPPORTED, `Method unsupported: ${method}`)
    }

    // 8. Anything else known -> delegate to the context (default: action).
    return this.ctx.executeAction(origin, method, params)
  }

  /** Whether the method is recognized by this provider at all. */
  isKnown(method: string): boolean {
    return (
      SAFE_METHODS.has(method) ||
      CONNECT_METHODS.has(method) ||
      APPROVAL_METHODS.has(method) ||
      UNSUPPORTED.has(method) ||
      method === 'wallet_switchEthereumChain' ||
      method === 'wallet_addEthereumChain' ||
      method === 'wallet_getPermissions' ||
      method === 'wallet_revokePermissions' ||
      method === 'wallet_requestPermissions'
    )
  }

  /** The per-origin signing lock (exposed so the SW can query pending state). */
  get signing(): SigningQueue {
    return this.queue
  }
}

// ---- helpers ----------------------------------------------------------------

/** Convert a chainId (0x hex string or decimal number) to a decimal number. */
export function toDecChainId(v: string | number | undefined): number {
  if (typeof v === 'number') return v
  if (typeof v === 'string') {
    if (v.startsWith('0x')) return parseInt(v, 16)
    const n = Number(v)
    if (!Number.isNaN(n)) return n
  }
  throw new RpcError(RPC.INVALID_PARAMS, `Bad chainId: ${String(v)}`)
}

/** Format a decimal chainId as a 0x hex string (EIP provider convention). */
export function hexChainId(chainId: number): string {
  return '0x' + chainId.toString(16)
}

/** Default chainId the page provider reports before a site session overrides it. */
export const DEFAULT_HEX_CHAIN_ID = hexChainId(HOME_CHAIN_ID)

export type { RpcErrorPayload }
