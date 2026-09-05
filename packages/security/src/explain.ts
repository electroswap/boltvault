/**
 * Statements (master plan §3.4 step 4): what the user reads before the verb.
 * The same lines feed VoiceOver and the hardware "what your device shows"
 * panel. Plain language, the closed verb set, no jargon.
 */
import { formatUnits, type Hex } from 'viem'
import { decodeMessage, type DecodedCall, type ParsedTypedData } from './decode'
import { knownContract } from './registry'
import type { AssessmentContext, SignRequest, Simulation, Statement } from './types'

function who(ctx: AssessmentContext, chainId: number, address: string): string {
  const l = ctx.labels[address.toLowerCase()]
  if (l) return l
  const k = knownContract(chainId, address)
  if (k) return k.name
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function amount(ctx: AssessmentContext, token: 'native' | Hex, raw: bigint, chainId: number): string {
  const abs = raw < 0n ? -raw : raw
  if (token === 'native') {
    const symbol = chainId === 52014 || chainId === 5201420 ? 'ETN' : 'native'
    return `${trim(formatUnits(abs, 18))} ${symbol}`
  }
  const t = ctx.tokens[token.toLowerCase()]
  if (!t) return `${abs.toString()} of ${who(ctx, chainId, token)}`
  return `${trim(formatUnits(abs, t.decimals))} ${t.symbol}`
}

function trim(s: string): string {
  if (!s.includes('.')) return s
  const [i, f = ''] = s.split('.')
  const frac = f.slice(0, 6).replace(/0+$/, '')
  return frac ? `${i}.${frac}` : (i ?? s)
}

function siteName(origin: string): string {
  if (origin.startsWith('internal:')) return 'BoltVault'
  try {
    return new URL(origin).host
  } catch {
    return origin
  }
}

export function explainCall(decoded: DecodedCall, ctx: AssessmentContext, chainId: number, origin: string): Statement[] {
  const site = siteName(origin)
  switch (decoded.kind) {
    case 'native_transfer':
      return [{ text: `Send ${amount(ctx, 'native', decoded.value, chainId)} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' }]
    case 'deploy':
      return [{ text: 'Deploy a new contract', tone: 'neutral' }]
    case 'erc20_transfer':
      return [{ text: `Send ${amount(ctx, decoded.token, decoded.amount, chainId)} to ${who(ctx, chainId, decoded.to)}`, tone: 'out' }]
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
    case 'multicall':
      return [{ text: `Run ${decoded.calls.length} calls through Multicall3`, tone: 'neutral' }]
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
      const out: Statement[] = []
      for (const c of decoded.decoded.commands) {
        switch (c.type) {
          case 'V3_SWAP_EXACT_IN':
          case 'V2_SWAP_EXACT_IN':
            out.push({ text: `Swap ${c.amountIn.toString()} units for at least ${c.amountOut.toString()} units`, tone: 'neutral' })
            break
          case 'V3_SWAP_EXACT_OUT':
          case 'V2_SWAP_EXACT_OUT':
            out.push({ text: `Swap at most ${c.amountIn.toString()} units for ${c.amountOut.toString()} units`, tone: 'neutral' })
            break
          case 'PERMIT2_PERMIT':
            out.push({ text: `Allow ${who(ctx, chainId, c.spender)} to move ${amount(ctx, c.token, c.amount, chainId)} until the permit expires`, tone: 'neutral' })
            break
          case 'PAY_PORTION':
            out.push({ text: `${(Number(c.bips) / 100).toFixed(2)}% of the output goes to ${who(ctx, chainId, c.recipient)}`, tone: 'out' })
            break
          case 'WRAP_ETH':
            out.push({ text: `Wrap ${amount(ctx, 'native', c.amount, chainId)}`, tone: 'neutral' })
            break
          case 'UNWRAP_WETH':
            out.push({ text: 'Receive the output as ETN', tone: 'in' })
            break
          case 'PERMIT2_TRANSFER_FROM':
            out.push({ text: `Move ${amount(ctx, c.token, c.amount, chainId)} to ${who(ctx, chainId, c.recipient)}`, tone: 'out' })
            break
          case 'UNKNOWN':
            out.push({ text: `Unknown router command 0x${c.byte.toString(16)}`, tone: 'warn' })
            break
          default:
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
      return [{ text: `Sign a "${d.primaryType}" message${typed.domain.name ? ` for ${typed.domain.name}` : ''}`, tone: 'neutral' }]
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
