/**
 * Statements (master plan §3.4 step 4): what the user reads before the verb.
 * The same lines feed VoiceOver and the hardware "what your device shows"
 * panel. Plain language, the closed verb set, no jargon.
 */
import { formatUnits, type Hex } from 'viem'
import { decodeCalldata, decodeMessage, type DecodedCall, type ParsedTypedData } from './decode'
import { knownContract } from './registry'
import { UR_MSG_SENDER, UR_ROUTER_SELF, type UrCommand } from './ur'
import type { AssessmentContext, SignRequest, Simulation, Statement } from './types'

const DOMAIN_NAMES: Readonly<Record<number, string>> = { 52014: 'Electroneum', 1: 'Ethereum', 8453: 'Base', 43114: 'Avalanche' }

/*
  Text a site or a contract chose, rendered at a length and a character set a
  statement can carry.

  A `primaryType`, a domain name and a token symbol all arrive from the thing
  being signed. Unbounded, one of them fills the sheet and pushes the verb off
  screen; carrying U+202E it reorders the sentence around it, so "Send 1 ETN to
  <attacker>" can be made to read as something else entirely. Strip the
  characters that move text about, then cap the length.

  Confusable-but-printable homoglyphs (a Cyrillic "о" in "Uniswap") still
  render — defeating those needs a confusables table, which belongs with the
  spam signal, not here. What this removes is the layout and reordering
  attacks, which are the ones that change what the sentence says.
*/
const UNSAFE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu
export function untrusted(s: string, max = 32): string {
  const clean = s.normalize('NFKC').replace(UNSAFE, '')
  return clean.length > max ? `${clean.slice(0, max)}…` : clean
}

function who(ctx: AssessmentContext, chainId: number, address: string): string {
  // Labels and token metadata reach here from the caller, which read them off
  // a contract: untrusted, same as the typed-data names above.
  const l = ctx.labels[address.toLowerCase()]
  if (l) return untrusted(l)
  const k = knownContract(chainId, address)
  if (k) return k.name
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/**
 * A Universal Router recipient, in the user's terms.
 *
 * The router uses two sentinels in place of an address, and rendering either
 * as a hex string tells the reader nothing. An address that is one of the
 * user's own accounts is "you" — so anything that is *not* "you" stands out,
 * which is the whole point of printing it.
 */
function urWho(ctx: AssessmentContext, chainId: number, recipient: Hex): string {
  const r = recipient.toLowerCase()
  if (r === UR_MSG_SENDER.toLowerCase()) return 'you'
  if (r === UR_ROUTER_SELF.toLowerCase()) return 'the router, to be swept below'
  if (ctx.own.some((a) => a.toLowerCase() === r)) return 'you'
  return who(ctx, chainId, recipient)
}

/**
 * The tokens at each end of a router path, so amounts can be shown with their
 * symbol and decimals instead of as raw integers labelled "units".
 * V2 carries an address array; V3 packs `token | fee | token | …` into bytes.
 */
function pathTokens(c: Extract<UrCommand, { type: `V${'2' | '3'}_SWAP_EXACT_${'IN' | 'OUT'}` }>): ['native' | Hex, 'native' | Hex] {
  if (Array.isArray(c.path)) {
    const p = c.path as readonly Hex[]
    const first = p[0]
    const last = p[p.length - 1]
    return [first ?? 'native', last ?? 'native']
  }
  const hex = (c.path as Hex).slice(2)
  if (hex.length < 40) return ['native', 'native']
  const tin = `0x${hex.slice(0, 40)}` as Hex
  const tout = `0x${hex.slice(-40)}` as Hex
  // An exact-out path is encoded backwards: the output token comes first.
  return c.type === 'V3_SWAP_EXACT_OUT' ? [tout, tin] : [tin, tout]
}

function amount(ctx: AssessmentContext, token: 'native' | Hex, raw: bigint, chainId: number): string {
  const abs = raw < 0n ? -raw : raw
  if (token === 'native') {
    const symbol = chainId === 52014 || chainId === 5201420 ? 'ETN' : 'native'
    return `${trim(formatUnits(abs, 18))} ${symbol}`
  }
  const t = ctx.tokens[token.toLowerCase()]
  if (t) return `${trim(formatUnits(abs, t.decimals))} ${untrusted(t.symbol, 12)}`
  // Wrapped ETN is known by role even when the universe has not loaded (offers are priced in it).
  if (knownContract(chainId, token)?.role === 'wrapped_native') return `${trim(formatUnits(abs, 18))} WETN`
  return `${abs.toString()} of ${who(ctx, chainId, token)}`
}

function trim(s: string): string {
  if (!s.includes('.')) return s
  const [i, f = ''] = s.split('.')
  const frac = f.slice(0, 6).replace(/0+$/, '')
  return frac ? `${i}.${frac}` : (i ?? s)
}

function siteName(origin: string): string {
  if (origin.startsWith('internal:')) return 'BoltVault'
  if (origin.startsWith('device:')) return `your ${origin.slice(7)} (paired device)`
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

/**
 * @param depth How many Multicall3 layers deep we already are. One level of
 *   expansion is enough to see an approval hidden in a batch; expanding
 *   further lets a batch of batches fill the sheet.
 */
export function explainCall(decoded: DecodedCall, ctx: AssessmentContext, chainId: number, origin: string, depth = 0): Statement[] {
  const site = siteName(origin)
  switch (decoded.kind) {
    case 'native_transfer':
      return [{ text: `Send ${amount(ctx, 'native', decoded.value, chainId)} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' }]
    case 'deploy':
      return [{ text: 'Deploy a new contract', tone: 'neutral' }]
    case 'erc20_transfer': {
      // `transferFrom` moves someone else's balance; say whose, rather than
      // describing it as a plain send from the signer.
      const src = decoded.from
      const thirdParty = src !== undefined && !ctx.own.some((a) => a.toLowerCase() === src.toLowerCase())
      return [
        thirdParty && src !== undefined
          ? { text: `Move ${amount(ctx, decoded.token, decoded.amount, chainId)} from ${who(ctx, chainId, src)} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' }
          : { text: `Send ${amount(ctx, decoded.token, decoded.amount, chainId)} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' },
      ]
    }
    case 'ambiguous_transfer_from':
      return [
        {
          text: `Move ${decoded.value.toString()} from ${who(ctx, chainId, decoded.from)} to ${who(ctx, chainId, decoded.to)} using ${who(ctx, chainId, decoded.token)}`,
          tone: 'out',
        },
        {
          text: 'BoltVault cannot tell whether that number is a token amount or an item id — this contract is not one it knows.',
          tone: 'warn',
        },
      ]
    case 'erc20_approve':
      if (decoded.amount === 0n) return [{ text: `Revoke ${who(ctx, chainId, decoded.spender)}'s allowance for ${who(ctx, chainId, decoded.token)}`, tone: 'in' }]
      return [{ text: decoded.unlimited ? `Allow ${who(ctx, chainId, decoded.spender)} to move an unlimited amount of ${who(ctx, chainId, decoded.token)}` : `Allow ${who(ctx, chainId, decoded.spender)} to move up to ${amount(ctx, decoded.token, decoded.amount, chainId)}`, tone: decoded.unlimited ? 'warn' : 'neutral' }]
    case 'erc721_transfer':
      return [{ text: `Send ${who(ctx, chainId, decoded.token)} #${decoded.tokenId.toString()} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' }]
    case 'erc721_approve':
      return [{ text: `Allow ${who(ctx, chainId, decoded.to)} to move ${who(ctx, chainId, decoded.token)} #${decoded.tokenId.toString()}`, tone: 'neutral' }]
    case 'approval_for_all':
      return [{ text: decoded.approved ? `Allow ${who(ctx, chainId, decoded.operator)} to move any item in ${who(ctx, chainId, decoded.token)}` : `Revoke ${who(ctx, chainId, decoded.operator)}'s access to ${who(ctx, chainId, decoded.token)}`, tone: decoded.approved ? 'warn' : 'in' }]
    case 'erc1155_transfer':
      return [{ text: `Send ${decoded.ids.length} item${decoded.ids.length === 1 ? '' : 's'} from ${who(ctx, chainId, decoded.token)} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' }]
    case 'permit2_approve':
      return [{ text: decoded.amount === 0n ? `Revoke ${who(ctx, chainId, decoded.spender)}'s Permit2 allowance for ${who(ctx, chainId, decoded.token)}` : decoded.unlimited ? `Allow ${who(ctx, chainId, decoded.spender)} to move an unlimited amount of ${who(ctx, chainId, decoded.token)} through Permit2` : `Allow ${who(ctx, chainId, decoded.spender)} to move up to ${amount(ctx, decoded.token, decoded.amount, chainId)} through Permit2`, tone: decoded.amount === 0n ? 'in' : decoded.unlimited ? 'warn' : 'neutral' }]
    case 'permit2_lockdown':
      return [{ text: `Revoke ${decoded.approvals.length} Permit2 allowance${decoded.approvals.length === 1 ? '' : 's'}`, tone: 'in' }]
    case 'wrap':
      return [{ text: `Wrap ${amount(ctx, 'native', decoded.amount, chainId)}`, tone: 'neutral' }]
    case 'unwrap':
      return [{ text: `Unwrap ${amount(ctx, decoded.token, decoded.amount, chainId)}`, tone: 'neutral' }]
    case 'multicall': {
      /*
        Say what the batch does, not how many things it does.

        "Run 3 calls through Multicall3" is the same sentence whether the batch
        checks three balances or grants three unlimited approvals, and the
        inner calldata was decoded and then thrown away. Each entry is decoded
        and explained here, one level deep — deep enough for the shape that
        matters, shallow enough that a batch of batches cannot be used to
        exhaust the sheet.
      */
      const out: Statement[] = []
      if (decoded.value > 0n) out.push({ text: `Send ${amount(ctx, 'native', decoded.value, chainId)} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' })
      if (depth >= 1) {
        out.push({ text: `Run ${decoded.calls.length} more calls through Multicall3 — not expanded here`, tone: 'warn' })
        return out
      }
      const shown = decoded.calls.slice(0, 10)
      shown.forEach((c, i) => {
        const inner = decodeCalldata({ chainId, to: c.target, data: c.data, value: 0n })
        for (const s of explainCall(inner, ctx, chainId, origin, depth + 1)) out.push({ ...s, text: `${i + 1}. ${s.text}` })
      })
      if (decoded.calls.length > shown.length) out.push({ text: `+${decoded.calls.length - shown.length} more calls in this batch`, tone: 'warn' })
      if (out.length === 0) out.push({ text: `Run ${decoded.calls.length} calls through Multicall3`, tone: 'neutral' })
      return out
    }
    case 'farm_deposit': {
      const parts = [`Deposit into farm #${decoded.farmId.toString()}`]
      if (decoded.value > 0n) parts.push(`with ${amount(ctx, 'native', decoded.value, chainId)}`)
      if (decoded.amountBolt > 0n) parts.push(`and ${amount(ctx, ctx.boltToken ?? 'native', decoded.amountBolt, chainId)} as boost`)
      return [{ text: parts.join(' '), tone: 'out' }, { text: 'Unused amounts come back; a second deposit re-weights your duration multiplier.', tone: 'neutral' }]
    }
    case 'farm_withdraw':
      return decoded.liquidity === 0n
        ? [{ text: `Collect rewards and fees from farm #${decoded.farmId.toString()}`, tone: 'in' }]
        : [{ text: `Withdraw ${decoded.liquidity.toString()} liquidity units from farm #${decoded.farmId.toString()}${decoded.asNative ? ' as ETN' : ''}`, tone: 'in' }, { text: 'Rewards and fees are collected with it; withdrawing everything returns your BOLT boost.', tone: 'neutral' }]
    case 'launchpad':
      switch (decoded.action) {
        case 'contribute':
          return [{ text: `Contribute ${amount(ctx, 'native', decoded.value, chainId)} to the campaign at ${who(ctx, chainId, decoded.pool)}`, tone: 'out' }]
        case 'claim_tokens':
          return [{ text: `Claim your tokens from the campaign at ${who(ctx, chainId, decoded.pool)}`, tone: 'in' }]
        case 'claim_refund':
          return [{ text: `Claim your refund from the campaign at ${who(ctx, chainId, decoded.pool)}`, tone: 'in' }]
        case 'claim_referral':
          return [{ text: 'Claim your referral rewards', tone: 'in' }]
      }
      return []
    case 'seaport_fulfill': {
      const piece = decoded.offer.find((o) => o.itemType === 2 || o.itemType === 3) ?? decoded.consideration.find((c) => c.itemType === 2 || c.itemType === 3)
      const label = piece ? `${who(ctx, chainId, piece.token)} #${piece.identifier.toString()}` : 'the item'
      const buying = decoded.offer.some((o) => o.itemType === 2 || o.itemType === 3)
      if (buying) {
        const total = decoded.consideration.reduce((s, c) => s + c.amount, 0n)
        const token = decoded.consideration[0]?.itemType === 0 ? 'native' : (decoded.consideration[0]?.token ?? 'native')
        return [{ text: `Buy ${label} for ${amount(ctx, token, total, chainId)}`, tone: 'out' }, { text: 'Includes the 3% marketplace fee and any creator royalty in the price.', tone: 'neutral' }]
      }
      const paid = decoded.offer[0]
      const yours = decoded.consideration.filter((c) => c.itemType !== 2 && c.itemType !== 3 && c.recipient.toLowerCase() !== decoded.offerer.toLowerCase())
      const gross = paid ? paid.amount : 0n
      const net = yours.length ? yours.reduce((s, c) => s + c.amount, 0n) - (decoded.consideration.filter((c) => c.itemType !== 2 && c.itemType !== 3).reduce((s, c) => s + c.amount, 0n) - (yours[0]?.amount ?? 0n)) : gross
      return [{ text: `Sell ${label} for ${paid ? amount(ctx, paid.token, gross, chainId) : 'the offer'}`, tone: 'in' }, { text: `You receive ${paid ? amount(ctx, paid.token, yours[0]?.amount ?? net, chainId) : 'the amount'} after the 3% marketplace fee and any creator royalty.`, tone: 'neutral' }]
    }
    case 'seaport_cancel':
      return [{ text: decoded.count === 1 ? 'Cancel your marketplace order' : `Cancel ${decoded.count} marketplace orders`, tone: 'in' }]
    case 'dividends':
      return decoded.action === 'register'
        ? [{ text: `Activate dividends for ${decoded.tokenIds.length} Electric Legend${decoded.tokenIds.length === 1 ? '' : 's'}`, tone: 'neutral' }]
        : [{ text: `Claim marketplace dividends for ${decoded.tokenIds.length} Electric Legend${decoded.tokenIds.length === 1 ? '' : 's'}`, tone: 'in' }]
    case 'bridge': {
      const known = knownContract(chainId, decoded.router)
      const symbol = known?.name.includes('USDT') ? 'USDT' : 'USDC'
      const dest = DOMAIN_NAMES[decoded.destinationDomain] ?? `chain ${decoded.destinationDomain}`
      return [
        { text: `Bridge ${trim(formatUnits(decoded.amount, 6))} ${symbol} to ${dest} for ${who(ctx, chainId, decoded.recipient)}`, tone: 'out' },
        { text: `Pays ${amount(ctx, 'native', decoded.value, chainId)} of interchain gas to Hyperlane`, tone: 'neutral' },
      ]
    }
    case 'nft_mint':
      return [{ text: `Mint ${decoded.count.toString()} from ${who(ctx, chainId, decoded.collection)} for ${amount(ctx, 'native', decoded.value, chainId)}`, tone: 'out' }]
    case 'limit_order': {
      if (decoded.action === 'close') return [{ text: decoded.orderIds.length === 1 ? `Cancel order #${decoded.orderIds[0]?.toString() ?? '?'} and take back what is left` : `Cancel ${decoded.orderIds.length} orders and take back what is left`, tone: 'in' }]
      const days = Number(decoded.durationSeconds) / 86_400
      const open = days >= 1 ? `${Math.round(days)} day${Math.round(days) === 1 ? '' : 's'}` : `${Math.max(1, Math.round(Number(decoded.durationSeconds) / 3600))} hours`
      return [
        { text: `Place an order: ${amount(ctx, decoded.tokenIn ?? 'native', decoded.amountIn, chainId)} for at least ${amount(ctx, decoded.tokenOut ?? 'native', decoded.minOut, chainId)}, open for ${open}`, tone: 'out' },
        { text: 'Platform fee 0.1% on fill · no wallet fee', tone: 'neutral' },
      ]
    }
    case 'universal_router': {
      /*
        Every command that moves value says where it goes.

        This switch used to end in `default: break`, so `SWEEP`, `TRANSFER`,
        the batch permit-transfers and a Seaport sub-call produced no statement
        at all — and the swap arms held `recipient` in scope and never read it.
        A call could therefore swap the user's balance into the router and
        sweep it to someone else, and the sheet's only line was "Swap N units
        for at least 1 units". Silence reads as "nothing happens here", which
        is the opposite of what was about to happen.
      */
      const out: Statement[] = []
      for (const c of decoded.decoded.commands) {
        switch (c.type) {
          case 'V3_SWAP_EXACT_IN':
          case 'V2_SWAP_EXACT_IN': {
            const [tin, tout] = pathTokens(c)
            out.push({ text: `Swap ${amount(ctx, tin, c.amountIn, chainId)} for at least ${amount(ctx, tout, c.amountOut, chainId)}, sent to ${urWho(ctx, chainId, c.recipient)}`, tone: 'neutral' })
            break
          }
          case 'V3_SWAP_EXACT_OUT':
          case 'V2_SWAP_EXACT_OUT': {
            const [tin, tout] = pathTokens(c)
            out.push({ text: `Swap at most ${amount(ctx, tin, c.amountIn, chainId)} for ${amount(ctx, tout, c.amountOut, chainId)}, sent to ${urWho(ctx, chainId, c.recipient)}`, tone: 'neutral' })
            break
          }
          case 'PERMIT2_PERMIT':
            out.push({ text: `Allow ${who(ctx, chainId, c.spender)} to move ${amount(ctx, c.token, c.amount, chainId)} until the permit expires`, tone: 'neutral' })
            break
          case 'PERMIT2_PERMIT_BATCH':
            for (const d of c.details)
              out.push({ text: `Allow ${who(ctx, chainId, c.spender)} to move ${amount(ctx, d.token, d.amount, chainId)} until the permit expires`, tone: 'neutral' })
            break
          case 'PAY_PORTION':
            out.push({ text: `${(Number(c.bips) / 100).toFixed(2)}% of the output goes to ${who(ctx, chainId, c.recipient)}`, tone: 'out' })
            break
          case 'WRAP_ETH':
            out.push({ text: `Wrap ${amount(ctx, 'native', c.amount, chainId)}`, tone: 'neutral' })
            break
          case 'UNWRAP_WETH':
            out.push({ text: `Unwrap to ETN, sent to ${urWho(ctx, chainId, c.recipient)}`, tone: 'in' })
            break
          case 'PERMIT2_TRANSFER_FROM':
            out.push({ text: `Move ${amount(ctx, c.token, c.amount, chainId)} to ${urWho(ctx, chainId, c.recipient)}`, tone: 'out' })
            break
          case 'PERMIT2_TRANSFER_FROM_BATCH':
            for (const tr of c.transfers)
              out.push({ text: `Move ${amount(ctx, tr.token, tr.amount, chainId)} to ${urWho(ctx, chainId, tr.to)}`, tone: 'out' })
            break
          case 'SWEEP':
            out.push({ text: `Send everything left of ${who(ctx, chainId, c.token)} to ${urWho(ctx, chainId, c.recipient)}`, tone: 'out' })
            break
          case 'TRANSFER':
            out.push({ text: `Send ${amount(ctx, c.token, c.amount, chainId)} to ${urWho(ctx, chainId, c.recipient)}`, tone: 'out' })
            break
          case 'BALANCE_CHECK_ERC20':
            out.push({ text: `Check the balance of ${who(ctx, chainId, c.token)} — nothing moves`, tone: 'neutral' })
            break
          case 'SEAPORT_V1_5':
            out.push({ text: `Fulfil a marketplace order through the router for ${amount(ctx, 'native', c.value, chainId)}`, tone: 'out' })
            out.push({ text: 'The order inside this call was not decoded — what you receive for it cannot be shown here', tone: 'warn' })
            break
          case 'UNKNOWN':
            out.push({ text: `Unknown router command 0x${c.byte.toString(16)}`, tone: 'warn' })
            break
        }
      }
      if (out.length === 0) out.push({ text: `Call ${who(ctx, chainId, decoded.router)}`, tone: 'neutral' })
      return out
    }
    case 'contract_call':
      return [{ text: decoded.functionName ? `Call ${decoded.functionName} on ${who(ctx, chainId, decoded.to)}` : `Call an unknown function (${decoded.selector}) on ${who(ctx, chainId, decoded.to)}${decoded.value > 0n ? ` with ${amount(ctx, 'native', decoded.value, chainId)}` : ''}`, tone: decoded.functionName ? 'neutral' : 'warn' }, ...(site !== 'BoltVault' ? [] : [])]
  }
}

export function explainTypedData(typed: ParsedTypedData | null, ctx: AssessmentContext, chainId: number): Statement[] {
  if (!typed) return [{ text: 'Sign a message BoltVault could not read', tone: 'warn' }]
  const d = typed.decoded
  switch (d.kind) {
    case 'permit2_permit_single':
      return [{ text: `Allow ${who(ctx, chainId, d.spender)} to move ${d.unlimited ? 'an unlimited amount of ' + who(ctx, chainId, d.token) : amount(ctx, d.token, d.amount, chainId)} through Permit2 until ${expiry(d.expiration)}`, tone: d.unlimited ? 'warn' : 'neutral' }]
    case 'permit2_permit_batch':
      return d.details.map((x) => ({ text: `Allow ${who(ctx, chainId, d.spender)} to move ${x.unlimited ? 'an unlimited amount of ' + who(ctx, chainId, x.token) : amount(ctx, x.token, x.amount, chainId)} through Permit2`, tone: x.unlimited ? 'warn' : 'neutral' }) as Statement)
    case 'permit2_transfer':
      return d.transfers.map((t) => ({ text: `Let ${who(ctx, chainId, d.spender)} take ${amount(ctx, t.token, t.amount, chainId)} from you`, tone: 'warn' }) as Statement)
    case 'erc2612_permit':
      return [{ text: `Allow ${who(ctx, chainId, d.spender)} to move ${d.unlimited ? 'an unlimited amount' : amount(ctx, typed.domain.verifyingContract ?? '0x', d.value, chainId)} until ${expiry(d.deadline)}`, tone: d.unlimited ? 'warn' : 'neutral' }]
    case 'dai_permit':
      return [{ text: d.allowed ? `Allow ${who(ctx, chainId, d.spender)} to move all of this token` : `Revoke ${who(ctx, chainId, d.spender)}'s allowance`, tone: d.allowed ? 'warn' : 'in' }]
    case 'seaport_order': {
      const give = d.offer.map((o) => (o.itemType >= 2 ? `${who(ctx, chainId, o.token)} #${o.identifier.toString()}` : amount(ctx, o.token, o.amount, chainId))).join(', ')
      const get = d.consideration.filter((c) => c.recipient.toLowerCase() === d.offerer.toLowerCase()).map((c) => (c.itemType >= 2 ? `${who(ctx, chainId, c.token)} #${c.identifier.toString()}` : amount(ctx, c.itemType === 0 ? 'native' : c.token, c.amount, chainId))).join(' + ')
      return [{ text: `List ${give}`, tone: 'out' }, { text: get ? `You receive ${get}` : 'You receive nothing', tone: get ? 'in' : 'warn' }]
    }
    case 'unknown':
      return [{ text: `Sign a "${untrusted(d.primaryType)}" message${typed.domain.name ? ` for ${untrusted(typed.domain.name)}` : ''}`, tone: 'neutral' }]
  }
}

function expiry(v: bigint): string {
  if (v === 0n) return 'revoked'
  if (v > 1_000_000_000_000n) return 'forever'
  const d = new Date(Number(v) * 1000)
  return d.toISOString().slice(0, 10)
}

export function explainMessage(message: Hex | string): Statement[] {
  const d = decodeMessage(message)
  if (d.text !== null) return [{ text: d.text.length > 400 ? `${d.text.slice(0, 400)}…` : d.text, tone: 'neutral' }]
  return [{ text: `Sign ${d.bytes} bytes of binary data`, tone: 'warn' }]
}

export function explainSimulation(sim: Simulation | null, ctx: AssessmentContext, chainId: number): Statement[] {
  if (!sim || sim.mode !== 'trace' || !sim.ok) return []
  const out: Statement[] = []
  for (const d of sim.deltas) {
    const sign = d.amount < 0n ? '−' : '+'
    const text = d.standard === 'erc721' ? `${sign} ${who(ctx, chainId, d.asset as string)} #${(d.tokenId ?? 0n).toString()}` : `${sign} ${amount(ctx, d.asset, d.amount, chainId)}`
    out.push({ text, tone: d.amount < 0n ? 'out' : 'in' })
  }
  for (const a of sim.approvals) {
    out.push({ text: a.amount === 'all' ? `${who(ctx, chainId, a.spender)} can move any ${who(ctx, chainId, a.token)}` : `${who(ctx, chainId, a.spender)} can move up to ${amount(ctx, a.token, a.amount, chainId)}`, tone: 'warn' })
  }
  return out
}

export function explain(request: SignRequest, decoded: DecodedCall | null, typed: ParsedTypedData | null, ctx: AssessmentContext, chainId: number, origin: string): Statement[] {
  switch (request.kind) {
    case 'transaction':
      return decoded ? explainCall(decoded, ctx, chainId, origin) : []
    case 'message':
      return explainMessage(request.message)
    case 'typed_data':
      return explainTypedData(typed, ctx, chainId)
    case 'eth_sign':
      return [{ text: `Sign the raw hash ${request.hash.slice(0, 10)}…`, tone: 'warn' }]
  }
}
