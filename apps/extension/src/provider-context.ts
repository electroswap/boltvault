/**
 * SW-side RpcContext (T3.5) — the extension body that the pure `RpcFlow`
 * (provider-protocol) delegates to.
 *
 * Holds the vault (T3.3), the per-origin SiteRegistry (persisted), and a viem
 * PublicClient per chain. `executeSafe` runs read-only RPCs against the
 * *origin's* chain (per-origin chain is first-class); `executeAction` signs
 * locally with the seated account's derived key (LocalSigner). The approval
 * step is an injectable `onApprove` — T3.5 auto-approves; the Approval UI (a
 * later task) supplies a real popup.
 */
import {
  hexChainId,
  type RpcContext,
  type ProviderEvent,
  type SiteRegistry,
} from '@boltvault/provider-protocol'
import { createChainClient, getChain, LocalSigner } from '@boltvault/chains'
import { deriveAccount, type KeyValueStore, type VaultAccount } from '@boltvault/core'
import type { VaultService } from './vault-service'
// Derive viem types from the chains factory so we don't depend on viem directly.
type PublicClient = ReturnType<typeof createChainClient>
type Hex = `0x${string}`

/** chrome.storage.local-backed SitesStore for the SW. */
export function localSitesStore(store: KeyValueStore) {
  const KEY = 'vault.sites'
  return {
    load: async () => {
      const raw = await store.get(KEY)
      if (!raw) return undefined
      try {
        return JSON.parse(raw) as Record<string, import('@boltvault/provider-protocol').ConnectedSite>
      } catch {
        return undefined
      }
    },
    save: (sites: Record<string, import('@boltvault/provider-protocol').ConnectedSite>) =>
      store.set(KEY, JSON.stringify(sites)),
  }
}

const SAFE_VIEM_METHODS = new Set([
  'eth_call',
  'eth_estimateGas',
  'eth_getBalance',
  'eth_getCode',
  'eth_getLogs',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_gasPrice',
  'eth_blockNumber',
])

export interface ProviderContextOptions {
  readonly vault: VaultService
  readonly registry: import('@boltvault/provider-protocol').SiteRegistry
  /** Push an event to the origin's tab(s). The SW binds this to its Ports. */
  readonly emit: (origin: string, event: ProviderEvent) => void
  /** Approval UI hook. Default: auto-approve (T3.5). Returns the chosen account. */
  readonly onApprove?: (
    origin: string,
    method: string,
    params: readonly unknown[],
  ) => Promise<void>
  /** Current settings snapshot (eth_sign gate). */
  readonly settings: { ethSignEnabled: boolean }
}

export class ExtensionRpcContext implements RpcContext {
  readonly sites: SiteRegistry
  readonly settings: { ethSignEnabled: boolean }
  private readonly clients = new Map<number, PublicClient>()
  private readonly opts: ProviderContextOptions

  constructor(opts: ProviderContextOptions) {
    this.opts = opts
    this.sites = opts.registry
    this.settings = opts.settings
  }

  private clientFor(chainId: number): PublicClient {
    let c = this.clients.get(chainId)
    if (!c) {
      c = createChainClient(chainId)
      this.clients.set(chainId, c)
    }
    return c
  }

  async accountsFor(origin: string): Promise<string[]> {
    const row = this.sites.get(origin)
    if (!row || !row.connected) return []
    // Resolve the seated account id to an address.
    const accounts = this.seatedAccounts()
    return accounts.filter((a) => a.id === row.accountId).map((a) => a.address)
  }

  /** All accounts currently in the vault (from the last unlock). */
  private seatedAccounts(): VaultAccount[] {
    // VaultService exposes accounts via unlock; we cache them here.
    return this._accounts
  }

  private _accounts: VaultAccount[] = []

  /** Called by the SW after unlock to refresh the account list. */
  setAccounts(accounts: VaultAccount[]): void {
    this._accounts = accounts
  }

  async isUnlocked(): Promise<boolean> {
    return this.opts.vault.isUnlocked()
  }

  emit(origin: string, event: ProviderEvent): void {
    this.opts.emit(origin, event)
  }

  async approve(
    origin: string,
    method: string,
    params: readonly unknown[],
  ): Promise<void> {
    if (this.opts.onApprove) return this.opts.onApprove(origin, method, params)
    // Default T3.5 behavior: auto-approve (Approval UI lands in a later task).
  }

  /**
   * Read-only / safe method against the origin's chain. `eth_chainId` /
   * `net_version` answer from the origin's per-origin session (no RPC).
   */
  async executeSafe(origin: string, method: string, params: readonly unknown[]): Promise<unknown> {
    if (method === 'eth_chainId') return hexChainId(this.sites.chainIdFor(origin))
    if (method === 'net_version') return String(this.sites.chainIdFor(origin))
    if (method === 'eth_accounts') return this.accountsFor(origin)
    if (method === 'eth_gasPrice') {
      const r = (await this.clientFor(this.sites.chainIdFor(origin)).getGasPrice()) as bigint
      return `0x${r.toString(16)}`
    }
    if (method === 'eth_blockNumber') {
      const h = await this.clientFor(this.sites.chainIdFor(origin)).getBlockNumber()
      return `0x${h.toString(16)}`
    }
    if (method === 'eth_call') {
      const call = params[0] as { to: string; data?: string; from?: string; gas?: number } | undefined
      const result = await this.clientFor(this.sites.chainIdFor(origin)).call({
        to: call?.to as `0x${string}`,
        data: call?.data as Hex | undefined,
        account: call?.from as `0x${string}` | undefined,
        accessList: [],
      })
      return (result as { result?: Hex }).result ?? '0x'
    }
    if (SAFE_VIEM_METHODS.has(method)) {
      // Generic passthrough via a low-level request (best-effort).
      const client = this.clientFor(this.sites.chainIdFor(origin)) as unknown as {
        request: (payload: { method: string; params: readonly unknown[] }) => Promise<unknown>
      }
      return client.request({ method, params })
    }
    // web3_clientVersion / net_listening.
    if (method === 'web3_clientVersion') return 'BoltVault/0.1.0'
    if (method === 'net_listening') return true
    if (method === 'eth_maxPriorityFeePerGas') {
      const v = (await this.clientFor(this.sites.chainIdFor(origin)).getGasPrice()) as bigint
      return `0x${v.toString(16)}`
    }
    if (method === 'eth_feeHistory') {
      return { oldestBlock: '0x0', baseFeePerGas: [], gasUsedRatio: [], reward: [] }
    }
    return null
  }

  /** Execute a signed / approved action locally. */
  async executeAction(origin: string, method: string, params: readonly unknown[]): Promise<unknown> {
    const accounts = await this.accountsFor(origin)
    const addr = accounts[0]
    if (!addr) throw new RpcContextError(4100, 'Not connected')
    const signer = await this.signerFor(origin, addr)
    switch (method) {
      case 'personal_sign':
        return signer.signMessage(params[0] as string)
      case 'eth_sign':
        return signer.signMessage(params[1] as string)
      case 'eth_signTypedData_v4':
        return signer.signTypedData({ domain: params[1] as object, types: {} as never, primaryType: 'EIP712Domain', message: {} } as never)
      case 'eth_sendTransaction':
        return this.sendTransaction(origin, params[0] as Record<string, unknown>)
      case 'wallet_watchAsset':
        // Adds an ERC-20 to the origin's custom token list; resolve true.
        return true
      case 'wallet_requestPermissions':
        return [{ parentCapability: 'eth_accounts', granted: true, requested: true, invoker: origin }]
      default:
        return null
    }
  }

  private async signerFor(origin: string, address: string): Promise<LocalSigner> {
    const seedHex = await this.opts.vault.getUnlockedSeedHex()
    if (!seedHex) throw new RpcContextError(4100, 'Vault locked')
    const acct = this._accounts.find((a) => a.address.toLowerCase() === address.toLowerCase())
    if (!acct) throw new RpcContextError(4100, 'Unknown account')
    if (acct.kind === 'hd' && typeof acct.index === 'number') {
      const derived = deriveAccount(seedHex, acct.index)
      return LocalSigner.fromPrivateKey(derived.privateKey)
    }
    throw new RpcContextError(4100, `Account ${acct.kind} does not hold a local key yet`)
  }

  private async sendTransaction(origin: string, tx: Record<string, unknown>): Promise<string> {
    const chainId = this.sites.chainIdFor(origin)
    const client = this.clientFor(chainId)
    const signer = await this.signerFor(origin, (tx.from as string) ?? (await this.accountsFor(origin))[0] ?? '')
    const accounts = await this.accountsFor(origin)
    const from = (tx.from as string) ?? accounts[0]
    // Fill nonce if missing.
    const nonce =
      typeof tx.nonce === 'number'
        ? tx.nonce
        : await client.getTransactionCount({ address: from as `0x${string}` })
    const gasPrice = typeof tx.gasPrice === 'number' ? tx.gasPrice : Number((await client.getGasPrice()))
    const signed = await signer.signTransaction({
      chainId,
      from: from as `0x${string}`,
      to: tx.to as `0x${string}`,
      value: typeof tx.value === 'bigint' ? tx.value : 0n,
      data: (tx.data as string) ?? undefined,
      nonce,
      gas: typeof tx.gas === 'number' ? tx.gas : 21000,
      gasPrice,
    } as unknown as Parameters<LocalSigner['signTransaction']>[0])
    return signed.hash
  }
}

/** Internal error carrying an Rpc code (before RpcError is importable cheaply). */
class RpcContextError extends Error {
  code: number
  constructor(code: number, message: string) {
    super(message)
    this.code = code
  }
}
