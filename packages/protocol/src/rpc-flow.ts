/**
 * rpcFlow — the one request funnel every body shares (master plan §4.6):
 *
 *   known? → SAFE (no UI, rate-limited) → CONNECT (sheet) → CHAIN (session)
 *          → APPROVAL (one in flight per origin, sheet) → REJECTED (4200)
 *
 * Pure: the engine injects an `RpcContext`; the extension's content Ports,
 * the mobile WebView and WalletConnect all arrive here with an origin the
 * *transport* established.
 */
import { RPC, RpcError } from './errors'
import {
  APPROVAL_METHODS,
  classify,
  MAX_LOG_RANGE,
  SAFE_RATE_PER_SECOND,
  CONNECT_RATE_PER_SECOND,
  SESSION_METHODS,
} from './methods'
import type { SiteRegistry } from './sessions'

export type Hex = `0x${string}`

export type ProviderEvent =
  | { readonly event: 'accountsChanged'; readonly payload: readonly string[] }
  | { readonly event: 'chainChanged'; readonly payload: Hex }
  | { readonly event: 'connect'; readonly payload: { readonly chainId: Hex } }
  | {
      readonly event: 'disconnect'
      readonly payload: { readonly code: number; readonly message: string }
    }
  | {
      readonly event: 'message'
      readonly payload: { readonly type: string; readonly data: unknown }
    }

export interface TxParams {
  readonly from: Hex
  readonly to?: Hex
  readonly value?: Hex
  readonly data?: Hex
  readonly gas?: Hex
  readonly gasPrice?: Hex
  readonly maxFeePerGas?: Hex
  readonly maxPriorityFeePerGas?: Hex
  readonly nonce?: Hex
  readonly chainId?: Hex
  readonly authorizationList?: readonly unknown[]
}

/** What the engine must put in front of a human. The `clientRequestId` lets a re-sent request re-attach after a worker restart. */
export type ApprovalIntent =
  | {
      readonly kind: 'connect'
      readonly origin: string
      readonly chainId: number
      readonly clientRequestId: string
    }
  | {
      readonly kind: 'switch_chain'
      readonly origin: string
      readonly chainId: number
      readonly clientRequestId: string
    }
  | {
      readonly kind: 'add_chain'
      readonly origin: string
      readonly chainId: number
      readonly clientRequestId: string
    }
  | {
      readonly kind: 'sign_message'
      readonly origin: string
      readonly chainId: number
      readonly accountId: string
      readonly from: Hex
      readonly message: Hex
      readonly clientRequestId: string
    }
  | {
      readonly kind: 'eth_sign'
      readonly origin: string
      readonly chainId: number
      readonly accountId: string
      readonly from: Hex
      readonly hash: Hex
      readonly clientRequestId: string
    }
  | {
      readonly kind: 'sign_typed_data'
      readonly origin: string
      readonly chainId: number
      readonly accountId: string
      readonly from: Hex
      readonly typedData: unknown
      readonly version: 'v3' | 'v4'
      readonly clientRequestId: string
    }
  | {
      readonly kind: 'send_transaction'
      readonly origin: string
      readonly chainId: number
      readonly accountId: string
      readonly tx: TxParams
      readonly clientRequestId: string
      /** internal:swap only — the fee the encoder wrote, checked by the firewall (T10). */ readonly expectedFee?: {
        readonly sink: Hex
        readonly bips: number
      } | null
      /** internal:bridge only — whether the recipient is a contract here and on the destination (§8.7). */ readonly bridgeRecipient?: {
        readonly hasCodeOnOrigin: boolean
        readonly hasCodeOnDestination: boolean | null
      } | null
      /** device:* only — sign and return the raw transaction; the requesting device broadcasts and records (§6). */ readonly signOnly?: boolean
      /**
       * internal:activity only — this replaces a transaction already in the
       * pool at the same nonce (§8.12, ES-BV-025).
       *
       * Without it a replacement is indistinguishable from a transaction that
       * has lost its place: the pending count already reads `nonce + 1`
       * because the original is sitting there, so the "your place was taken"
       * guard fires on every speed-up and cancel and neither can ever
       * broadcast. The fees are the ones being replaced, so the bump can be
       * measured against them instead of against the chain.
       */ readonly replaces?: {
        readonly nonce: number
        readonly hash: string | null
        readonly maxFeePerGas?: string | null
        readonly maxPriorityFeePerGas?: string | null
        readonly gasPrice?: string | null
      } | null
    }
  | {
      readonly kind: 'watch_asset'
      readonly origin: string
      readonly chainId: number
      readonly type: string
      readonly options: unknown
      readonly clientRequestId: string
    }

export interface ConnectResult {
  readonly accountId: string
  readonly addresses: readonly string[]
  readonly chainId: number
}

export interface RpcContext {
  readonly sites: SiteRegistry
  now(): number
  /** The account and addresses a connected origin sees; null when not connected. */
  session(origin: string): Promise<{ accountId: string; addresses: readonly string[] } | null>
  knownChain(chainId: number): boolean
  /**
   * Must a connect for this origin raise a sheet even when the origin already
   * has a session? True for a WalletConnect pairing (§5.3): a proposal is a
   * new peer asking, whatever some other transport has already agreed.
   */
  alwaysPrompt?(origin: string): boolean
  /** Read-only passthrough on the origin's chain. */
  executeSafe(chainId: number, method: string, params: readonly unknown[]): Promise<unknown>
  /** Put the intent in front of the user and, if approved, execute it. Throws RpcError 4001 on reject. */
  approve(intent: ApprovalIntent): Promise<unknown>
  /**
   * Disconnect an origin through the engine's own path (ES-BV-018), so the
   * change listeners that reject its pending approvals and refresh Settings
   * actually fire. Absent in a bare harness, which then falls back to the raw
   * registry.
   */
  revoke?(origin: string): Promise<void>
  emit(origin: string, event: ProviderEvent): void
  readonly settings: { readonly ethSignEnabled: boolean }
  /** Fan a chain's heads out as `message` events to this origin; returns the unsubscribe. */
  subscribeHeads?(origin: string, chainId: number, subscriptionId: Hex): () => void
  /**
   * The wallet fee ElectroSwap's own site should encode for this origin's
   * account (master plan §8.6), or null for every other origin.
   *
   * The flow only asks; the host decides who counts as first-party and what
   * the tier is, because both answers live behind the engine. Absent in hosts
   * that have no fee to serve, which answers null the same way.
   */
  feePolicy?(
    origin: string,
    chainId: number,
  ): Promise<{ sink: Hex; bips: number; tier: string } | null>
  /** The client name reported by web3_clientVersion. */
  readonly clientVersion: string
}

export function hexChainId(chainId: number): Hex {
  return `0x${chainId.toString(16)}`
}

export function toDecChainId(v: unknown): number {
  if (typeof v === 'number' && Number.isInteger(v) && v > 0) return v
  if (typeof v === 'string') {
    const n = v.startsWith('0x') ? parseInt(v, 16) : Number(v)
    if (Number.isInteger(n) && n > 0) return n
  }
  throw new RpcError(RPC.INVALID_PARAMS, `Bad chainId: ${String(v)}`)
}

const ADDRESS = /^0x[0-9a-fA-F]{40}$/
/*
  Two grammars, because JSON-RPC has two (ES-BV-021).

  One regular expression stood in for both and admitted `0x` and odd-length
  values everywhere — so `value: '0x'` and `data: '0xabc'` reached a sheet,
  and `parseInt('0x', 16)` is `NaN` while half a byte of calldata is not
  calldata at all. A QUANTITY (EIP-1474) needs at least one digit and may be
  odd-length: `0x1` is one. DATA is whole bytes, and `0x` is a legitimate
  empty one — a plain send has no calldata.
*/
const HEX_QUANTITY = /^0x[0-9a-fA-F]+$/
const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/

function param(params: readonly unknown[], i: number): unknown {
  return params[i]
}

function requireAddress(v: unknown, what: string): Hex {
  if (typeof v === 'string' && ADDRESS.test(v)) return v as Hex
  throw new RpcError(RPC.INVALID_PARAMS, `${what} must be an address`)
}

function requireHash32(v: unknown, what: string): Hex {
  if (typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v)) return v as Hex
  throw new RpcError(RPC.INVALID_PARAMS, `${what} must be a 32-byte hash`)
}

function requireQuantity(v: unknown, what: string): Hex {
  if (typeof v === 'string' && HEX_QUANTITY.test(v)) return v as Hex
  throw new RpcError(RPC.INVALID_PARAMS, `${what} must be a hex quantity`)
}

function requireData(v: unknown, what: string): Hex {
  if (typeof v === 'string' && HEX_DATA.test(v)) return v as Hex
  throw new RpcError(RPC.INVALID_PARAMS, `${what} must be hex bytes`)
}

function optionalQuantity(v: unknown, what: string): Hex | undefined {
  return v === undefined || v === null ? undefined : requireQuantity(v, what)
}

function optionalData(v: unknown, what: string): Hex | undefined {
  return v === undefined || v === null ? undefined : requireData(v, what)
}

/** A leaky bucket per origin for SAFE traffic. */
/** How many live `newHeads` subscriptions one origin may hold (ES-BV-017). */
const MAX_SUBSCRIPTIONS_PER_ORIGIN = 8

/*
  What a page may hand the wallet (ES-BV-020).

  Only `method.length` was bounded, so `message`, `typedData`, `data` and the
  `wallet_watchAsset` options were unbounded all the way into an approval
  payload and from there into session storage — which has a quota, and a write
  that fails there takes the wallet's own approvals with it. These are far
  above anything an honest dApp sends: a SIWE message is a few hundred bytes,
  the largest real calldata is tens of kilobytes.
*/
const MAX_MESSAGE_BYTES = 64 * 1024
const MAX_CALLDATA_BYTES = 128 * 1024
const MAX_TYPED_DATA_BYTES = 128 * 1024

/** `JSON.stringify` that answers null on a cycle rather than throwing. */
function safeStringify(v: unknown): string | null {
  try {
    return JSON.stringify(v) ?? null
  } catch {
    return null
  }
}

function bounded(value: string, max: number, what: string): string {
  // Hex and JSON are both ASCII-ish; the character count is the byte count
  // within a factor nobody cares about at these sizes.
  if (value.length > max)
    throw new RpcError(RPC.INVALID_PARAMS, `${what} is too large (limit ${max} bytes).`)
  return value
}

class RateLimiter {
  private readonly buckets = new Map<string, { tokens: number; at: number }>()
  constructor(
    private readonly perSecond: number,
    private readonly now: () => number,
  ) {}
  take(origin: string): boolean {
    const now = this.now()
    const b = this.buckets.get(origin) ?? { tokens: this.perSecond, at: now }
    const refill = ((now - b.at) / 1000) * this.perSecond
    b.tokens = Math.min(this.perSecond, b.tokens + refill)
    b.at = now
    if (b.tokens < 1) {
      this.buckets.set(origin, b)
      return false
    }
    b.tokens -= 1
    this.buckets.set(origin, b)
    return true
  }
}

export class RpcFlow {
  /** One human-facing request per origin; a re-sent request (same client id) joins it instead of failing. */
  private readonly inFlight = new Map<
    string,
    { clientRequestId: string; promise: Promise<unknown> }
  >()
  private readonly limiter: RateLimiter
  /** A second, much lower bucket for connect and chain calls (ES-BV-016). */
  private readonly heavyLimiter: RateLimiter
  /** Subscription ids per origin, so a page cannot hold an unbounded number (ES-BV-017). */
  private readonly subsByOrigin = new Map<string, Set<string>>()
  /*
    An unconnected origin's chain preference, in memory only.

    A site may switch chain before it connects, and the connect sheet should
    open on the chain it asked for — that is a real and tested behaviour. What
    it must not do is create a persisted row: the CHAIN class runs before any
    connection check, so any page could plant one for itself, unbounded, and
    each write re-encrypts the whole sealed blob. Holding it here gives the
    preference the lifetime it deserves — this session, and no disk.
  */
  private readonly pendingChain = new Map<string, number>()
  /** `origin#chainId` the user has already agreed this session may move to. */
  private readonly allowedChains = new Set<string>()
  private readonly subscriptions = new Map<string, () => void>()
  private subCounter = 0

  constructor(private readonly ctx: RpcContext) {
    this.limiter = new RateLimiter(SAFE_RATE_PER_SECOND, () => ctx.now())
    this.heavyLimiter = new RateLimiter(CONNECT_RATE_PER_SECOND, () => ctx.now())
  }

  /** Whether an approval is open for this origin (the UI may show a badge). */
  isPending(origin: string): boolean {
    return this.inFlight.has(origin)
  }

  async request(
    origin: string,
    method: string,
    rawParams: unknown,
    clientRequestId: string,
  ): Promise<unknown> {
    const params: readonly unknown[] = Array.isArray(rawParams)
      ? rawParams
      : rawParams === undefined || rawParams === null
        ? []
        : [rawParams]
    const cls = classify(method)
    const chainId = this.pendingChain.get(origin) ?? this.ctx.sites.chainIdFor(origin)

    switch (cls) {
      case 'unknown':
        throw new RpcError(
          RPC.METHOD_NOT_FOUND,
          `The method ${method} does not exist / is not available.`,
        )
      case 'rejected':
        throw new RpcError(RPC.UNSUPPORTED_METHOD, `${method} is not supported by BoltVault.`)
      case 'safe':
        if (!this.limiter.take(origin))
          throw new RpcError(RPC.LIMIT_EXCEEDED, 'Too many requests. Slow down.')
        return this.safe(origin, chainId, method, params)
      case 'connect':
        /*
          Metered too (ES-BV-016). The leaky bucket used to apply to `safe`
          alone, so a connected page could call `eth_requestAccounts` — or
          switch between two chains it had already been allowed — as fast as it
          liked, and each call re-encrypted the whole sites blob.
        */
        if (!this.heavyLimiter.take(origin))
          throw new RpcError(RPC.LIMIT_EXCEEDED, 'Too many requests. Slow down.')
        return this.connect(origin, chainId, method, clientRequestId)
      case 'chain':
        if (!this.heavyLimiter.take(origin))
          throw new RpcError(RPC.LIMIT_EXCEEDED, 'Too many requests. Slow down.')
        return this.chain(origin, chainId, method, params, clientRequestId)
      case 'approval':
        return this.approval(origin, chainId, method, params, clientRequestId)
    }
  }

  private async safe(
    origin: string,
    chainId: number,
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    // A SAFE method used to need no session at all — the connection gate lived
    // only in `approval()` — so any page could read chain state through the
    // wallet's RPC, and broadcast a signed transaction, without ever asking to
    // connect. Discovery methods stay open; everything that touches chain state
    // now needs the origin to be connected.
    if (SESSION_METHODS.has(method) && !(await this.ctx.session(origin))) {
      throw new RpcError(RPC.UNAUTHORIZED, 'Not connected. Call eth_requestAccounts first.')
    }
    switch (method) {
      case 'eth_chainId':
        return hexChainId(chainId)
      case 'net_version':
        return String(chainId)
      case 'net_listening':
        return true
      case 'web3_clientVersion':
        return this.ctx.clientVersion
      case 'eth_accounts': {
        const s = await this.ctx.session(origin)
        return s ? [...s.addresses] : []
      }
      case 'wallet_getPermissions': {
        const s = await this.ctx.session(origin)
        return s ? permissions(origin, s.addresses, this.ctx.now()) : []
      }
      case 'wallet_getCapabilities': {
        const s = await this.ctx.session(origin)
        if (!s) throw new RpcError(RPC.UNAUTHORIZED, 'Not connected.')
        return { [hexChainId(chainId)]: { atomic: { status: 'unsupported' } } }
      }
      /*
        What ElectroSwap's own site should charge for this account (§8.6).

        The site asks rather than computing it because it cannot compute it:
        the DYNO leg of the score is a measured seven-day weight, and the
        ladder can be lowered at runtime by a served override the wallet
        refuses if it would ever charge more. A site working from its own copy
        of the rungs would drift, and drift here either overcharges the user or
        mismatches the firewall on every swap.

        `null` is the honest answer for everyone else and for a chain with no
        recipient configured — not an error, because "there is no fee here" is
        a fact a caller is entitled to, and a throw would read as a failure to
        retry.
      */
      case 'boltvault_feePolicy':
        return (await this.ctx.feePolicy?.(origin, chainId)) ?? null
      case 'eth_subscribe': {
        const type = param(params, 0)
        if (type !== 'newHeads')
          throw new RpcError(
            RPC.UNSUPPORTED_METHOD,
            `Subscription type ${String(type)} is not supported.`,
          )
        if (!this.ctx.subscribeHeads)
          throw new RpcError(RPC.UNSUPPORTED_METHOD, 'Subscriptions are not supported here.')
        /*
          Bounded per origin (ES-BV-017). Subscriptions were keyed
          `origin:id` with no cap and removed only by `eth_unsubscribe` or a
          whole-flow dispose, and each one keeps a per-chain head poll alive —
          so a page in a loop could hold an unbounded number of them, and the
          polling outlived the tab that asked.
        */
        const live = this.subsByOrigin.get(origin) ?? new Set<string>()
        if (live.size >= MAX_SUBSCRIPTIONS_PER_ORIGIN)
          throw new RpcError(RPC.LIMIT_EXCEEDED, 'Too many open subscriptions for this site.')
        const id = `0x${(++this.subCounter).toString(16).padStart(32, '0')}` as Hex
        this.subscriptions.set(`${origin}:${id}`, this.ctx.subscribeHeads(origin, chainId, id))
        live.add(id)
        this.subsByOrigin.set(origin, live)
        return id
      }
      case 'eth_unsubscribe': {
        const id = String(param(params, 0))
        const off = this.subscriptions.get(`${origin}:${id}`)
        if (!off) return false
        off()
        this.subscriptions.delete(`${origin}:${id}`)
        this.subsByOrigin.get(origin)?.delete(id)
        return true
      }
      case 'eth_getLogs': {
        const f = param(params, 0)
        if (f && typeof f === 'object') {
          const { fromBlock, toBlock } = f as { fromBlock?: unknown; toBlock?: unknown }
          const from = blockNumber(fromBlock)
          const to = blockNumber(toBlock)
          const tooWide = `eth_getLogs needs a numeric toBlock within ${MAX_LOG_RANGE} blocks of fromBlock.`
          /*
            A lower bound that names a block — a number, or `earliest`, which is
            block zero — needs a numeric upper bound within the window. Anything
            open at the top is a full-history scan under another name: `earliest`
            alone, `earliest → latest`, `safe → finalized`, or a fixed block with
            no `toBlock` at all. At the wallet's sixty-a-second budget a
            connected page could loop those until the registry endpoints cooled
            down and took the wallet's own polling with them.
          */
          if (from !== null && from !== 'head') {
            if (typeof to !== 'number') throw new RpcError(RPC.LIMIT_EXCEEDED, tooWide)
            if (to - from > MAX_LOG_RANGE)
              throw new RpcError(
                RPC.LIMIT_EXCEEDED,
                `eth_getLogs range is limited to ${MAX_LOG_RANGE} blocks.`,
              )
          }
        }
        return this.passthrough(chainId, method, params)
      }
      default:
        return this.passthrough(chainId, method, params)
    }
  }

  private async passthrough(
    chainId: number,
    method: string,
    params: readonly unknown[],
  ): Promise<unknown> {
    try {
      return await this.ctx.executeSafe(chainId, method, params)
    } catch (err) {
      throw RpcError.from(err)
    }
  }

  private async connect(
    origin: string,
    chainId: number,
    method: string,
    clientRequestId: string,
  ): Promise<unknown> {
    const existing = this.ctx.alwaysPrompt?.(origin) ? null : await this.ctx.session(origin)
    if (existing) {
      await this.ctx.sites.touch(origin, this.ctx.now())
      return method === 'wallet_requestPermissions'
        ? permissions(origin, existing.addresses, this.ctx.now())
        : [...existing.addresses]
    }
    return this.exclusive(origin, clientRequestId, async () => {
      const result = (await this.ctx.approve({
        kind: 'connect',
        origin,
        chainId,
        clientRequestId,
      })) as ConnectResult
      // The preference is spent the moment it becomes a real row.
      this.pendingChain.delete(origin)
      await this.ctx.sites.connect(origin, {
        accountId: result.accountId,
        chainId: result.chainId,
        accounts: [...result.addresses],
        now: this.ctx.now(),
      })
      this.ctx.emit(origin, { event: 'accountsChanged', payload: result.addresses })
      this.ctx.emit(origin, { event: 'connect', payload: { chainId: hexChainId(result.chainId) } })
      if (result.chainId !== chainId)
        this.ctx.emit(origin, { event: 'chainChanged', payload: hexChainId(result.chainId) })
      return method === 'wallet_requestPermissions'
        ? permissions(origin, result.addresses, this.ctx.now())
        : [...result.addresses]
    })
  }

  /** Bounded the same way as the pending-chain map. */
  private rememberAllowedChain(key: string): void {
    this.allowedChains.add(key)
    while (this.allowedChains.size > 256) {
      const oldest = this.allowedChains.values().next().value
      if (oldest === undefined) break
      this.allowedChains.delete(oldest)
    }
  }

  /** Bounded: oldest entry evicted, so the map cannot be grown without limit either. */
  private rememberPendingChain(origin: string, chainId: number): void {
    this.pendingChain.delete(origin)
    this.pendingChain.set(origin, chainId)
    while (this.pendingChain.size > 64) {
      const oldest = this.pendingChain.keys().next().value
      if (oldest === undefined) break
      this.pendingChain.delete(oldest)
    }
  }

  private async chain(
    origin: string,
    chainId: number,
    method: string,
    params: readonly unknown[],
    clientRequestId: string,
  ): Promise<unknown> {
    if (method === 'wallet_revokePermissions') {
      const was = await this.ctx.session(origin)
      /*
        The same door the user's own revoke uses (ES-BV-018).

        This called the raw `SiteRegistry`, which writes the row and stops —
        so the engine's change listeners never fired: the origin's pending
        approvals stayed on screen and could still be approved after the site
        had disconnected itself, and Settings went on listing a site that was
        gone. `revoke` is `SitesService.disconnect`, which is what Settings
        calls, and it fans the change out.
      */
      if (this.ctx.revoke) await this.ctx.revoke(origin)
      else await this.ctx.sites.disconnect(origin)
      this.forgetOrigin(origin)
      if (was) {
        this.ctx.emit(origin, { event: 'accountsChanged', payload: [] })
        this.ctx.emit(origin, {
          event: 'disconnect',
          payload: { code: RPC.DISCONNECTED, message: 'This site revoked its own permissions.' },
        })
      }
      return null
    }
    const p = param(params, 0)
    const requested = toDecChainId((p as { chainId?: unknown } | undefined)?.chainId)
    if (!this.ctx.knownChain(requested)) {
      // A dApp's RPC/explorer URLs are never honoured (§4.6); an unknown chain is 4902 until the user adds it in Settings.
      throw new RpcError(
        RPC.UNRECOGNIZED_CHAIN,
        `Chain ${hexChainId(requested)} is not available. Add it in BoltVault › Settings › Networks first.`,
      )
    }
    if (requested === chainId) return null
    const session = await this.ctx.session(origin)
    /*
      A connected site asking to move the session to another network is asked
      about, once per network.

      `wallet_addEthereumChain` prompted and `wallet_switchEthereumChain` did
      not, so a site could silently move the session to a chain the user does
      not use and then ask for a transaction on it. The chain binding of the
      signature was sound and the sheet named the network correctly — but the
      user was never asked, and the site chose what the signature would bind
      to. The `switch_chain` payload and its sheet already existed and were
      simply unreachable from here.

      Once per network, not once per call: a site that flips between two chains
      it has already been allowed would otherwise generate a prompt the user
      learns to dismiss, which is worse than not asking. The record is
      in-memory, so a restart asks again.
    */
    if (session) {
      const key = `${origin}#${requested}`
      if (!this.allowedChains.has(key)) {
        await this.exclusive(origin, clientRequestId, () =>
          this.ctx.approve({
            kind: method === 'wallet_addEthereumChain' ? 'add_chain' : 'switch_chain',
            origin,
            chainId: requested,
            clientRequestId,
          }),
        )
        this.rememberAllowedChain(key)
      }
    }
    /*
      Only a site the wallet already has a row for gets that row written to.

      The CHAIN class runs before any connection check, so an origin that had
      never connected — and never prompted anyone — could call
      `wallet_switchEthereumChain` and cause a row to be created and persisted
      for itself. Nothing bounded the number of origins, and each write
      re-encrypts the whole sealed blob, so the cost of one call grew with the
      number of rows already planted. An unconnected page still gets its
      `chainChanged` event, and the preference simply is not remembered across
      a reload — which is the correct amount of memory to give a stranger.
    */
    if (this.ctx.sites.get(origin) ?? session) await this.ctx.sites.setChain(origin, requested)
    else this.rememberPendingChain(origin, requested)
    this.ctx.emit(origin, { event: 'chainChanged', payload: hexChainId(requested) })
    return null
  }

  private async approval(
    origin: string,
    chainId: number,
    method: string,
    params: readonly unknown[],
    clientRequestId: string,
  ): Promise<unknown> {
    if (!APPROVAL_METHODS.has(method)) throw new RpcError(RPC.METHOD_NOT_FOUND, method)
    if (method === 'eth_sign' && !this.ctx.settings.ethSignEnabled) {
      throw new RpcError(
        RPC.UNSUPPORTED_METHOD,
        'eth_sign is disabled. It can be enabled in BoltVault › Settings › Security.',
      )
    }
    const session = await this.ctx.session(origin)
    /*
      `wallet_watchAsset` used to be exempt from needing a session, so a page
      the user had never connected could put a focused approval window in front
      of them — repeatedly, from any number of origins. Suggesting a token is
      not a thing an unconnected site needs to do.
    */
    if (!session)
      throw new RpcError(RPC.UNAUTHORIZED, 'Not connected. Call eth_requestAccounts first.')
    const intent = this.intent(origin, chainId, method, params, session, clientRequestId)
    return this.exclusive(origin, clientRequestId, async () => {
      const result = await this.ctx.approve(intent)
      await this.ctx.sites.touch(origin, this.ctx.now())
      return result
    })
  }

  private intent(
    origin: string,
    chainId: number,
    method: string,
    params: readonly unknown[],
    session: { accountId: string; addresses: readonly string[] } | null,
    clientRequestId: string,
  ): ApprovalIntent {
    const owns = (from: Hex): void => {
      if (!session || !session.addresses.some((a) => a.toLowerCase() === from.toLowerCase()))
        throw new RpcError(RPC.UNAUTHORIZED, 'That address is not connected to this site.')
    }
    switch (method) {
      case 'personal_sign': {
        // MetaMask accepts [message, address] and, historically, [address, message].
        const a = param(params, 0)
        const b = param(params, 1)
        const [message, from] =
          typeof a === 'string' && ADDRESS.test(a) && typeof b === 'string' && !ADDRESS.test(b)
            ? [b, a]
            : [a, b]
        const fromHex = requireAddress(from, 'address')
        owns(fromHex)
        /*
          A hex message is whole bytes and is not empty (ES-BV-021). Anything
          else is read as the text it is, which is what a page that sent a
          half-byte actually meant.
        */
        const msg =
          typeof message === 'string' && message.length > 2 && HEX_DATA.test(message)
            ? (bounded(message, MAX_MESSAGE_BYTES * 2, 'message') as Hex)
            : (`0x${utf8Hex(bounded(String(message), MAX_MESSAGE_BYTES, 'message'))}` as Hex)
        return {
          kind: 'sign_message',
          origin,
          chainId,
          accountId: session?.accountId ?? '',
          from: fromHex,
          message: msg,
          clientRequestId,
        }
      }
      case 'eth_sign': {
        const from = requireAddress(param(params, 0), 'address')
        owns(from)
        return {
          kind: 'eth_sign',
          origin,
          chainId,
          accountId: session?.accountId ?? '',
          from,
          /*
            Thirty-two bytes, because that is what will be signed (ES-BV-021).

            `eth_sign` signs the value as a hash with no prefix and no
            structure. Anything of another length cannot be one, so raising a
            sheet for it puts the most dangerous request in the wallet in front
            of the user for something that can never be signed.
          */
          hash: requireHash32(param(params, 1), 'data'),
          clientRequestId,
        }
      }
      case 'eth_signTypedData_v3':
      case 'eth_signTypedData_v4': {
        const from = requireAddress(param(params, 0), 'address')
        owns(from)
        const typed = param(params, 1)
        if (typed === undefined || typed === null)
          throw new RpcError(RPC.INVALID_PARAMS, 'typed data is required')
        bounded(
          typeof typed === 'string' ? typed : (safeStringify(typed) ?? ''),
          MAX_TYPED_DATA_BYTES,
          'typed data',
        )
        return {
          kind: 'sign_typed_data',
          origin,
          chainId,
          accountId: session?.accountId ?? '',
          from,
          typedData: typed,
          version: method === 'eth_signTypedData_v3' ? 'v3' : 'v4',
          clientRequestId,
        }
      }
      case 'eth_sendTransaction': {
        const raw = param(params, 0)
        if (!raw || typeof raw !== 'object')
          throw new RpcError(RPC.INVALID_PARAMS, 'transaction object is required')
        const t = raw as Record<string, unknown>
        const from = requireAddress(t['from'], 'from')
        owns(from)
        if (t['chainId'] !== undefined && toDecChainId(t['chainId']) !== chainId)
          throw new RpcError(
            RPC.INVALID_PARAMS,
            `Transaction chainId does not match the connected chain ${hexChainId(chainId)}.`,
          )
        const tx: TxParams = {
          from,
          ...(t['to'] !== undefined && t['to'] !== null
            ? { to: requireAddress(t['to'], 'to') }
            : {}),
          ...(optionalQuantity(t['value'], 'value') !== undefined
            ? { value: optionalQuantity(t['value'], 'value') }
            : {}),
          ...(optionalData(t['data'] ?? t['input'], 'data') !== undefined
            ? {
                data: bounded(
                  optionalData(t['data'] ?? t['input'], 'data') as string,
                  MAX_CALLDATA_BYTES * 2,
                  'calldata',
                ) as Hex,
              }
            : {}),
          ...(optionalQuantity(t['gas'], 'gas') !== undefined
            ? { gas: optionalQuantity(t['gas'], 'gas') }
            : {}),
          ...(optionalQuantity(t['gasPrice'], 'gasPrice') !== undefined
            ? { gasPrice: optionalQuantity(t['gasPrice'], 'gasPrice') }
            : {}),
          ...(optionalQuantity(t['maxFeePerGas'], 'maxFeePerGas') !== undefined
            ? { maxFeePerGas: optionalQuantity(t['maxFeePerGas'], 'maxFeePerGas') }
            : {}),
          ...(optionalQuantity(t['maxPriorityFeePerGas'], 'maxPriorityFeePerGas') !== undefined
            ? {
                maxPriorityFeePerGas: optionalQuantity(
                  t['maxPriorityFeePerGas'],
                  'maxPriorityFeePerGas',
                ),
              }
            : {}),
          ...(optionalQuantity(t['nonce'], 'nonce') !== undefined
            ? { nonce: optionalQuantity(t['nonce'], 'nonce') }
            : {}),
          ...(Array.isArray(t['authorizationList'])
            ? { authorizationList: t['authorizationList'] }
            : {}),
        }
        return {
          kind: 'send_transaction',
          origin,
          chainId,
          accountId: session?.accountId ?? '',
          tx,
          clientRequestId,
        }
      }
      case 'wallet_watchAsset': {
        const p = param(params, 0) as { type?: unknown; options?: unknown } | undefined
        if (!p || typeof p.type !== 'string')
          throw new RpcError(RPC.INVALID_PARAMS, 'type is required')
        return {
          kind: 'watch_asset',
          origin,
          chainId,
          type: p.type,
          options: p.options,
          clientRequestId,
        }
      }
      default:
        throw new RpcError(RPC.METHOD_NOT_FOUND, method)
    }
  }

  /** Run one human-facing request per origin. The same client id re-sent (worker restart) shares the open promise. */
  private exclusive(
    origin: string,
    clientRequestId: string,
    run: () => Promise<unknown>,
  ): Promise<unknown> {
    const open = this.inFlight.get(origin)
    if (open) {
      if (open.clientRequestId === clientRequestId) return open.promise
      return Promise.reject(
        new RpcError(
          RPC.RESOURCE_UNAVAILABLE,
          'A request is already open for this site. Finish it first.',
        ),
      )
    }
    const promise = run().finally(() => {
      if (this.inFlight.get(origin)?.promise === promise) this.inFlight.delete(origin)
    })
    this.inFlight.set(origin, { clientRequestId, promise })
    // A rejection must not surface as unhandled when nobody joined it.
    promise.catch(() => undefined)
    return promise
  }

  /** Called by the engine when the user disconnects a site from Settings. */
  async disconnected(origin: string): Promise<void> {
    this.ctx.emit(origin, { event: 'accountsChanged', payload: [] })
    // An empty accounts array alone leaves `isConnected()` true and every dApp that
    // listens for `disconnect` hears nothing (§4.3). Emit the EIP-1193 event too.
    this.ctx.emit(origin, {
      event: 'disconnect',
      payload: { code: RPC.DISCONNECTED, message: 'BoltVault disconnected this site.' },
    })
  }

  /** Called by the engine when the user changes a site's chain from Settings. */
  chainChanged(origin: string, chainId: number): void {
    this.ctx.emit(origin, { event: 'chainChanged', payload: hexChainId(chainId) })
  }

  /**
   * Called by the engine when the user moves a site to another account from
   * Settings › Connected sites.
   *
   * EIP-1193 requires the site to be told, and §4.6 requires it to be told
   * alone: `emit` is per-origin, so the addresses reach the ports of this
   * origin and no other surface's session learns anything. An empty array is a
   * legitimate payload — it is what a site sees when the account it was on has
   * gone — and reads to the page exactly as a disconnect does.
   */
  accountsChanged(origin: string, addresses: readonly string[]): void {
    this.ctx.emit(origin, { event: 'accountsChanged', payload: [...addresses] })
  }

  /**
   * Drop everything this flow was holding for one origin (ES-BV-017).
   *
   * Subscriptions kept a per-chain head poll alive for as long as the flow
   * lived, whatever became of the tab that asked — and `pendingChain` and
   * `allowedChains` grew an entry per origin that was never removed. Called
   * when an origin's last port goes away, and when a site revokes itself.
   */
  forgetOrigin(origin: string): void {
    for (const id of this.subsByOrigin.get(origin) ?? []) {
      const key = `${origin}:${id}`
      this.subscriptions.get(key)?.()
      this.subscriptions.delete(key)
    }
    this.subsByOrigin.delete(origin)
    this.pendingChain.delete(origin)
    // Allowed chains are keyed `<origin>#<chainId>`; an origin that has gone
    // away should have to ask again for every chain it was allowed.
    for (const key of [...this.allowedChains])
      if (key.startsWith(`${origin}#`)) this.allowedChains.delete(key)
  }

  dispose(): void {
    for (const off of this.subscriptions.values()) off()
    this.subscriptions.clear()
    this.subsByOrigin.clear()
  }
}

function permissions(origin: string, addresses: readonly string[], now: number): unknown[] {
  return [
    {
      id: `${origin}:eth_accounts`,
      parentCapability: 'eth_accounts',
      invoker: origin,
      caveats: [{ type: 'restrictReturnedAccounts', value: [...addresses] }],
      date: now,
    },
  ]
}

/**
 * A block tag as a number, or `'head'` for the ones that mean "now", or null
 * for anything unreadable.
 *
 * `earliest` used to answer null along with the rest, which made it invisible
 * to the range guard — `{ fromBlock: 'earliest' }` is genesis to now, the
 * largest query a node can be asked for, and it went straight through. It is
 * block zero and says so.
 */
function blockNumber(v: unknown): number | 'head' | null {
  if (typeof v !== 'string') return null
  if (v === 'earliest') return 0
  if (v === 'latest' || v === 'pending' || v === 'safe' || v === 'finalized') return 'head'
  if (/^0x[0-9a-fA-F]+$/.test(v)) return parseInt(v, 16)
  if (/^\d+$/.test(v)) return Number(v)
  return null
}

function utf8Hex(s: string): string {
  return Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('')
}
