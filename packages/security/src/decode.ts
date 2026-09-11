/**
 * Decode step of the firewall (master plan §3.4 step 1): calldata, typed
 * data and personal messages become typed shapes the rules and statements
 * reason about. Unknown selectors are reported as unknown — never silently
 * "contract interaction".
 */
import { decodeFunctionData, getAddress, hexToString, isAddress, isHex, maxUint256, size, type Hex } from 'viem'
import { DIVIDENDS_ABI, ERC1155_ABI, ERC20_ABI, ERC721_ABI, FARM_ABI, LAUNCHPAD_ABI, LIMIT_ORDERS_ABI, MINTER_ABI, MULTICALL3_ABI, PERMIT2_ABI, SEAPORT_ABI, WARP_ROUTER_ABI, WETH_ABI } from './abis'
import { knownContract } from './registry'
import { decodeUniversalRouter, type DecodedUniversalRouter } from './ur'

export const UNLIMITED_THRESHOLD = maxUint256 >> 1n
export const MAX_UINT160 = (1n << 160n) - 1n

export function isUnlimited(amount: bigint, bits: 160 | 256 = 256): boolean {
  return bits === 160 ? amount >= MAX_UINT160 >> 1n : amount >= UNLIMITED_THRESHOLD
}

export type DecodedCall =
  | { readonly kind: 'native_transfer'; readonly to: Hex; readonly value: bigint }
  | { readonly kind: 'deploy' }
  | { readonly kind: 'erc20_transfer'; readonly token: Hex; readonly to: Hex; readonly amount: bigint; readonly from?: Hex }
  | { readonly kind: 'erc20_approve'; readonly token: Hex; readonly spender: Hex; readonly amount: bigint; readonly unlimited: boolean }
  | { readonly kind: 'erc721_transfer'; readonly token: Hex; readonly from: Hex; readonly to: Hex; readonly tokenId: bigint }
  | { readonly kind: 'erc721_approve'; readonly token: Hex; readonly to: Hex; readonly tokenId: bigint }
  | { readonly kind: 'approval_for_all'; readonly token: Hex; readonly operator: Hex; readonly approved: boolean }
  | { readonly kind: 'erc1155_transfer'; readonly token: Hex; readonly from: Hex; readonly to: Hex; readonly ids: readonly bigint[]; readonly amounts: readonly bigint[] }
  | { readonly kind: 'permit2_approve'; readonly token: Hex; readonly spender: Hex; readonly amount: bigint; readonly expiration: number; readonly unlimited: boolean }
  | { readonly kind: 'permit2_lockdown'; readonly approvals: ReadonlyArray<{ token: Hex; spender: Hex }> }
  | { readonly kind: 'wrap'; readonly token: Hex; readonly amount: bigint }
  | { readonly kind: 'unwrap'; readonly token: Hex; readonly amount: bigint }
  | { readonly kind: 'universal_router'; readonly router: Hex; readonly decoded: DecodedUniversalRouter; readonly value: bigint }
  | { readonly kind: 'multicall'; readonly to: Hex; readonly calls: ReadonlyArray<{ target: Hex; data: Hex }> }
  | { readonly kind: 'limit_order'; readonly manager: Hex; readonly action: 'submit' | 'close'; readonly tokenIn: Hex | null; readonly tokenOut: Hex | null; readonly amountIn: bigint; readonly minOut: bigint; readonly recipient: Hex | null; readonly durationSeconds: bigint; readonly orderIds: readonly bigint[]; readonly withPermit: boolean }
  | { readonly kind: 'farm_deposit'; readonly farm: Hex; readonly farmId: bigint; readonly amount0: bigint; readonly amount1: bigint; readonly amountBolt: bigint; readonly value: bigint }
  | { readonly kind: 'farm_withdraw'; readonly farm: Hex; readonly farmId: bigint; readonly liquidity: bigint; readonly asNative: boolean }
  | { readonly kind: 'launchpad'; readonly pool: Hex; readonly action: 'contribute' | 'claim_tokens' | 'claim_refund' | 'claim_referral'; readonly value: bigint; readonly referrer: Hex | null; readonly recipient: Hex | null }
  | { readonly kind: 'seaport_fulfill'; readonly marketplace: Hex; readonly offerer: Hex; readonly offer: ReadonlyArray<{ token: Hex; itemType: number; identifier: bigint; amount: bigint }>; readonly consideration: ReadonlyArray<{ token: Hex; itemType: number; identifier: bigint; amount: bigint; recipient: Hex }>; readonly value: bigint }
  | { readonly kind: 'seaport_cancel'; readonly marketplace: Hex; readonly count: number }
  | { readonly kind: 'dividends'; readonly distributor: Hex; readonly action: 'register' | 'claim'; readonly tokenIds: readonly bigint[] }
  | { readonly kind: 'nft_mint'; readonly minter: Hex; readonly collection: Hex; readonly count: bigint; readonly value: bigint }
  | { readonly kind: 'bridge'; readonly router: Hex; readonly destinationDomain: number; readonly recipient: Hex; readonly amount: bigint; readonly value: bigint }
  | { readonly kind: 'contract_call'; readonly to: Hex; readonly selector: Hex; readonly functionName: string | null; readonly args: readonly unknown[] | null; readonly value: bigint }

export interface DecodeCallInput {
  readonly chainId: number
  readonly to: Hex | null
  readonly data: Hex
  readonly value: bigint
}

function tryDecode(abi: typeof ERC20_ABI | typeof ERC721_ABI | typeof ERC1155_ABI | typeof PERMIT2_ABI | typeof WETH_ABI | typeof MULTICALL3_ABI | typeof LIMIT_ORDERS_ABI | typeof FARM_ABI | typeof LAUNCHPAD_ABI | typeof SEAPORT_ABI | typeof DIVIDENDS_ABI | typeof MINTER_ABI | typeof WARP_ROUTER_ABI, data: Hex): { functionName: string; args: readonly unknown[] } | null {
  try {
    const d = decodeFunctionData({ abi, data })
    return { functionName: d.functionName, args: (d.args ?? []) as readonly unknown[] }
  } catch {
    return null
  }
}

export function decodeCalldata(input: DecodeCallInput): DecodedCall {
  const { chainId, to, data, value } = input
  if (to === null) return { kind: 'deploy' }
  if (!data || data === '0x' || size(data) === 0) return { kind: 'native_transfer', to, value }
  if (size(data) < 4) return { kind: 'contract_call', to, selector: data, functionName: null, args: null, value }
  const selector = data.slice(0, 10) as Hex
  const known = knownContract(chainId, to)

  if (known?.role === 'router') {
    const ur = decodeUniversalRouter(data)
    if (ur) return { kind: 'universal_router', router: to, decoded: ur, value }
  }
  if (known?.role === 'permit2') {
    const p = tryDecode(PERMIT2_ABI, data)
    if (p?.functionName === 'approve') {
      const [token, spender, amount, expiration] = p.args as [Hex, Hex, bigint, number]
      return { kind: 'permit2_approve', token, spender, amount, expiration, unlimited: isUnlimited(amount, 160) }
    }
    if (p?.functionName === 'lockdown') {
      const [approvals] = p.args as [ReadonlyArray<{ token: Hex; spender: Hex }>]
      return { kind: 'permit2_lockdown', approvals: approvals.map((a) => ({ token: a.token, spender: a.spender })) }
    }
  }
  if (known?.role === 'wrapped_native') {
    const w = tryDecode(WETH_ABI, data)
    if (w?.functionName === 'deposit') return { kind: 'wrap', token: to, amount: value }
    if (w?.functionName === 'withdraw') return { kind: 'unwrap', token: to, amount: (w.args as [bigint])[0] }
  }
  if (known?.role === 'limit_orders') {
    const l = tryDecode(LIMIT_ORDERS_ABI, data)
    if (l?.functionName === 'submitOrder' || l?.functionName === 'submitOrderWithPermit') {
      const [tokenIn, tokenOut, , amountInExact, amountOutMin, recipient, duration] = l.args as [Hex, Hex, boolean, bigint, bigint, Hex, bigint]
      return { kind: 'limit_order', manager: to, action: 'submit', tokenIn, tokenOut, amountIn: amountInExact, minOut: amountOutMin, recipient, durationSeconds: duration, orderIds: [], withPermit: l.functionName === 'submitOrderWithPermit' }
    }
    if (l?.functionName === 'closeOrder') return { kind: 'limit_order', manager: to, action: 'close', tokenIn: null, tokenOut: null, amountIn: 0n, minOut: 0n, recipient: null, durationSeconds: 0n, orderIds: [(l.args as [bigint])[0]], withPermit: false }
    if (l?.functionName === 'closeOrders') return { kind: 'limit_order', manager: to, action: 'close', tokenIn: null, tokenOut: null, amountIn: 0n, minOut: 0n, recipient: null, durationSeconds: 0n, orderIds: [...(l.args as [readonly bigint[]])[0]], withPermit: false }
  }
  if (known?.role === 'farm') {
    const f = tryDecode(FARM_ABI, data)
    if (f?.functionName === 'deposit') {
      const [farmId, amount0, amount1, amountBolt] = f.args as [bigint, bigint, bigint, bigint]
      return { kind: 'farm_deposit', farm: to, farmId, amount0, amount1, amountBolt, value }
    }
    if (f?.functionName === 'withdraw') {
      const [farmId, liquidity, asNative] = f.args as [bigint, bigint, boolean]
      return { kind: 'farm_withdraw', farm: to, farmId, liquidity, asNative }
    }
  }
  if (known?.role === 'marketplace') {
    const s = tryDecode(SEAPORT_ABI, data)
    if (s?.functionName === 'fulfillOrder') {
      const [order] = s.args as [{ parameters: { offerer: Hex; offer: ReadonlyArray<{ itemType: number; token: Hex; identifierOrCriteria: bigint; startAmount: bigint }>; consideration: ReadonlyArray<{ itemType: number; token: Hex; identifierOrCriteria: bigint; startAmount: bigint; recipient: Hex }> } }]
      const p = order.parameters
      return { kind: 'seaport_fulfill', marketplace: to, offerer: p.offerer, offer: p.offer.map((o) => ({ token: o.token, itemType: Number(o.itemType), identifier: o.identifierOrCriteria, amount: o.startAmount })), consideration: p.consideration.map((c) => ({ token: c.token, itemType: Number(c.itemType), identifier: c.identifierOrCriteria, amount: c.startAmount, recipient: c.recipient })), value }
    }
    if (s?.functionName === 'cancel') {
      const [orders] = s.args as [readonly unknown[]]
      return { kind: 'seaport_cancel', marketplace: to, count: orders.length }
    }
  }
  if (known?.role === 'dividends') {
    const d = tryDecode(DIVIDENDS_ABI, data)
    if (d?.functionName === 'register' || d?.functionName === 'claimDividends') {
      const [ids] = d.args as [readonly bigint[]]
      return { kind: 'dividends', distributor: to, action: d.functionName === 'register' ? 'register' : 'claim', tokenIds: [...ids] }
    }
  }
  if (known?.role === 'warp_router') {
    const w = tryDecode(WARP_ROUTER_ABI, data)
    if (w?.functionName === 'transferRemote') {
      const [destination, recipient32, amount] = w.args as [number, Hex, bigint]
      return { kind: 'bridge', router: to, destinationDomain: Number(destination), recipient: getAddress(`0x${recipient32.slice(-40)}`), amount, value }
    }
  }
  if (known?.role === 'minter') {
    const m = tryDecode(MINTER_ABI, data)
    if (m?.functionName === 'mint') {
      const [collection, count] = m.args as [Hex, bigint]
      return { kind: 'nft_mint', minter: to, collection, count, value }
    }
  }
  // Launchpad pools are one contract per campaign: matched by selector, then by the manager the pool reports (engine side).
  const lp = tryDecode(LAUNCHPAD_ABI, data)
  if (lp?.functionName === 'contribute') return { kind: 'launchpad', pool: to, action: 'contribute', value, referrer: (lp.args as [Hex])[0], recipient: null }
  if (lp?.functionName === 'claimTokens') return { kind: 'launchpad', pool: to, action: 'claim_tokens', value, referrer: null, recipient: (lp.args as [Hex])[0] }
  if (lp?.functionName === 'claimRefund') return { kind: 'launchpad', pool: to, action: 'claim_refund', value, referrer: null, recipient: (lp.args as [Hex])[0] }
  if (lp?.functionName === 'claimReferralRewards' && known?.role === 'launchpad') return { kind: 'launchpad', pool: to, action: 'claim_referral', value, referrer: null, recipient: null }
  if (known?.role === 'multicall') {
    const m = tryDecode(MULTICALL3_ABI, data)
    if (m) {
      const [calls] = m.args as [ReadonlyArray<{ target: Hex; callData: Hex }>]
      return { kind: 'multicall', to, calls: calls.map((c) => ({ target: c.target, data: c.callData })) }
    }
  }

  // Standards are tried by selector on any address — a token is a token.
  const e20 = tryDecode(ERC20_ABI, data)
  if (e20) {
    if (e20.functionName === 'transfer') {
      const [dest, amount] = e20.args as [Hex, bigint]
      return { kind: 'erc20_transfer', token: to, to: dest, amount }
    }
    if (e20.functionName === 'approve') {
      const [spender, amount] = e20.args as [Hex, bigint]
      return { kind: 'erc20_approve', token: to, spender, amount, unlimited: isUnlimited(amount) }
    }
    if (e20.functionName === 'increaseAllowance') {
      const [spender, amount] = e20.args as [Hex, bigint]
      return { kind: 'erc20_approve', token: to, spender, amount, unlimited: isUnlimited(amount) }
    }
  }
  const e721 = tryDecode(ERC721_ABI, data)
  if (e721) {
    if (e721.functionName === 'setApprovalForAll') {
      const [operator, approved] = e721.args as [Hex, boolean]
      return { kind: 'approval_for_all', token: to, operator, approved }
    }
    if (e721.functionName === 'transferFrom' || e721.functionName === 'safeTransferFrom') {
      const [from, dest, tokenId] = e721.args as [Hex, Hex, bigint]
      // ERC-20 transferFrom shares the selector with ERC-721 transferFrom; both read the same way here.
      if (e721.functionName === 'transferFrom' && e20?.functionName === 'transferFrom') {
        return { kind: 'erc20_transfer', token: to, from, to: dest, amount: tokenId }
      }
      return { kind: 'erc721_transfer', token: to, from, to: dest, tokenId }
    }
    if (e721.functionName === 'approve') {
      const [dest, tokenId] = e721.args as [Hex, bigint]
      return { kind: 'erc721_approve', token: to, to: dest, tokenId }
    }
  }
  const e1155 = tryDecode(ERC1155_ABI, data)
  if (e1155) {
    if (e1155.functionName === 'safeTransferFrom') {
      const [from, dest, id, amount] = e1155.args as [Hex, Hex, bigint, bigint]
      return { kind: 'erc1155_transfer', token: to, from, to: dest, ids: [id], amounts: [amount] }
    }
    if (e1155.functionName === 'safeBatchTransferFrom') {
      const [from, dest, ids, amounts] = e1155.args as [Hex, Hex, readonly bigint[], readonly bigint[]]
      return { kind: 'erc1155_transfer', token: to, from, to: dest, ids, amounts }
    }
  }
  return { kind: 'contract_call', to, selector, functionName: null, args: null, value }
}

// ---- typed data -------------------------------------------------------------------

export interface TypedDataDomain {
  readonly name?: string
  readonly version?: string
  readonly chainId?: bigint
  readonly verifyingContract?: Hex
}

export interface TypedDataJson {
  readonly types: Record<string, ReadonlyArray<{ name: string; type: string }>>
  readonly primaryType: string
  readonly domain: Record<string, unknown>
  readonly message: Record<string, unknown>
}

export type DecodedTypedData =
  | { readonly kind: 'permit2_permit_single'; readonly spender: Hex; readonly token: Hex; readonly amount: bigint; readonly expiration: bigint; readonly sigDeadline: bigint; readonly unlimited: boolean }
  | { readonly kind: 'permit2_permit_batch'; readonly spender: Hex; readonly details: ReadonlyArray<{ token: Hex; amount: bigint; expiration: bigint; unlimited: boolean }> }
  | { readonly kind: 'permit2_transfer'; readonly spender: Hex; readonly transfers: ReadonlyArray<{ token: Hex; amount: bigint }>; readonly witness: boolean; readonly batch: boolean }
  | { readonly kind: 'erc2612_permit'; readonly owner: Hex; readonly spender: Hex; readonly value: bigint; readonly deadline: bigint; readonly unlimited: boolean }
  | { readonly kind: 'dai_permit'; readonly holder: Hex; readonly spender: Hex; readonly allowed: boolean; readonly expiry: bigint }
  | { readonly kind: 'seaport_order'; readonly offerer: Hex; readonly offer: ReadonlyArray<{ token: Hex; itemType: number; identifier: bigint; amount: bigint }>; readonly consideration: ReadonlyArray<{ token: Hex; itemType: number; identifier: bigint; amount: bigint; recipient: Hex }>; readonly zeroConsideration: boolean }
  | { readonly kind: 'unknown'; readonly primaryType: string }

export interface ParsedTypedData {
  readonly domain: TypedDataDomain
  readonly primaryType: string
  readonly decoded: DecodedTypedData
  readonly raw: TypedDataJson
}

function big(v: unknown): bigint {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number') return BigInt(v)
  if (typeof v === 'string' && /^(0x[0-9a-fA-F]+|\d+)$/.test(v)) return BigInt(v)
  if (typeof v === 'boolean') return v ? 1n : 0n
  throw new Error('not a number')
}

function addr(v: unknown): Hex {
  if (typeof v === 'string' && isAddress(v)) return v as Hex
  throw new Error('not an address')
}

function obj(v: unknown): Record<string, unknown> {
  if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
  throw new Error('not an object')
}

function arr(v: unknown): readonly unknown[] {
  if (Array.isArray(v)) return v
  throw new Error('not an array')
}

/** Accepts the JSON string dApps send for eth_signTypedData_v4 or the parsed object. */
export function parseTypedData(input: unknown): ParsedTypedData | null {
  let raw: unknown = input
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input)
    } catch {
      return null
    }
  }
  if (!raw || typeof raw !== 'object') return null
  const t = raw as Partial<TypedDataJson>
  if (!t.types || typeof t.primaryType !== 'string' || !t.domain || !t.message) return null
  const typed: TypedDataJson = { types: t.types, primaryType: t.primaryType, domain: t.domain, message: t.message }
  const d = typed.domain
  /*
    Cap the free-text fields where they enter, not only where they render.
    `primaryType` and the domain's `name`/`version` are chosen by whoever asked
    for the signature and flow into statements, the sheet and the hardware
    panel; a decoder that hands on a five-thousand-character name has already
    lost the argument about what any one of those surfaces can do about it.
    The signed object is untouched — this is the description of it.
  */
  const domain: TypedDataDomain = {
    ...(typeof d['name'] === 'string' ? { name: d['name'].slice(0, 64) } : {}),
    ...(typeof d['version'] === 'string' ? { version: d['version'].slice(0, 32) } : {}),
    ...(d['chainId'] !== undefined ? { chainId: safeBig(d['chainId']) } : {}),
    ...(typeof d['verifyingContract'] === 'string' && isAddress(d['verifyingContract']) ? { verifyingContract: d['verifyingContract'] as Hex } : {}),
  }
  return { domain, primaryType: typed.primaryType.slice(0, 64), decoded: decodeTypedMessage(typed), raw: typed }
}

function safeBig(v: unknown): bigint | undefined {
  try {
    return big(v)
  } catch {
    return undefined
  }
}

function decodeTypedMessage(t: TypedDataJson): DecodedTypedData {
  const m = t.message
  const p = t.primaryType
  try {
    if (p === 'PermitSingle') {
      const details = obj(m['details'])
      const amount = big(details['amount'])
      return { kind: 'permit2_permit_single', spender: addr(m['spender']), token: addr(details['token']), amount, expiration: big(details['expiration']), sigDeadline: big(m['sigDeadline']), unlimited: isUnlimited(amount, 160) }
    }
    if (p === 'PermitBatch') {
      const details = arr(m['details']).map((d) => {
        const o = obj(d)
        const amount = big(o['amount'])
        return { token: addr(o['token']), amount, expiration: big(o['expiration']), unlimited: isUnlimited(amount, 160) }
      })
      return { kind: 'permit2_permit_batch', spender: addr(m['spender']), details }
    }
    if (p === 'PermitTransferFrom' || p === 'PermitWitnessTransferFrom') {
      const permitted = obj(m['permitted'])
      return { kind: 'permit2_transfer', spender: addr(m['spender']), transfers: [{ token: addr(permitted['token']), amount: big(permitted['amount']) }], witness: p === 'PermitWitnessTransferFrom', batch: false }
    }
    if (p === 'PermitBatchTransferFrom' || p === 'PermitBatchWitnessTransferFrom') {
      const transfers = arr(m['permitted']).map((x) => {
        const o = obj(x)
        return { token: addr(o['token']), amount: big(o['amount']) }
      })
      return { kind: 'permit2_transfer', spender: addr(m['spender']), transfers, witness: p === 'PermitBatchWitnessTransferFrom', batch: true }
    }
    if (p === 'Permit') {
      const fields = new Set((t.types['Permit'] ?? []).map((f) => f.name))
      if (fields.has('allowed') && fields.has('holder')) {
        return { kind: 'dai_permit', holder: addr(m['holder']), spender: addr(m['spender']), allowed: m['allowed'] === true || m['allowed'] === 'true' || m['allowed'] === 1, expiry: big(m['expiry']) }
      }
      const value = big(m['value'])
      return { kind: 'erc2612_permit', owner: addr(m['owner']), spender: addr(m['spender']), value, deadline: big(m['deadline']), unlimited: isUnlimited(value) }
    }
    if (p === 'OrderComponents' || p === 'BulkOrder') {
      const order = p === 'BulkOrder' ? obj(arr(m['tree'])[0]) : m
      const offer = arr(order['offer']).map((x) => {
        const o = obj(x)
        return { token: addr(o['token']), itemType: Number(big(o['itemType'])), identifier: big(o['identifierOrCriteria']), amount: big(o['startAmount']) }
      })
      const consideration = arr(order['consideration']).map((x) => {
        const o = obj(x)
        return { token: addr(o['token']), itemType: Number(big(o['itemType'])), identifier: big(o['identifierOrCriteria']), amount: big(o['startAmount']), recipient: addr(o['recipient']) }
      })
      const offerer = addr(order['offerer'])
      const toOfferer = consideration.filter((c) => c.recipient.toLowerCase() === offerer.toLowerCase()).reduce((s, c) => s + c.amount, 0n)
      return { kind: 'seaport_order', offerer, offer, consideration, zeroConsideration: offer.length > 0 && toOfferer === 0n }
    }
  } catch {
    return { kind: 'unknown', primaryType: p }
  }
  return { kind: 'unknown', primaryType: p }
}

// ---- personal_sign ------------------------------------------------------------------

export interface DecodedMessage {
  /** UTF-8 text when the bytes are printable text; null for binary. */
  readonly text: string | null
  readonly bytes: number
  /** 32 bytes exactly, or RLP that starts like a transaction — the "sign this hash" drain. */
  readonly looksLikeHashOrTx: boolean
}

export function decodeMessage(message: Hex | string): DecodedMessage {
  if (!isHex(message)) return { text: message, bytes: new TextEncoder().encode(message).length, looksLikeHashOrTx: false }
  const bytes = size(message)
  let text: string | null = null
  try {
    const s = hexToString(message)
    // Printable: no control characters other than whitespace, and no replacement chars.
    text = isPrintable(s) ? s : null
  } catch {
    text = null
  }
  const first = parseInt(message.slice(2, 4), 16)
  const rlpTx = bytes > 40 && (first === 0x02 || first === 0x01 || first === 0x04 || (first >= 0xc0 && first <= 0xff))
  return { text, bytes, looksLikeHashOrTx: text === null && (bytes === 32 || rlpTx) }
}

function isPrintable(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i)
    if (c === 0xfffd) return false
    if (c < 0x20 && c !== 0x09 && c !== 0x0a && c !== 0x0d) return false
    if (c === 0x7f) return false
  }
  return true
}
