/**
 * Risk rules (master plan §3.4 step 3). Each is a pure function over the
 * decoded request and the context; each has a code, a severity and copy in
 * the §7.10 voice. Fixtures from real drainer payloads live in the tests.
 */
import { formatUnits, type Hex } from 'viem'
import { decodeMessage, parseTypedData, type DecodedCall, type ParsedTypedData } from './decode'
import { typosquat, hostOf, isScamOrigin } from './origin'
import { inSet, poisonCheck, sameAddress } from './poison'
import { isKnownSpender, knownContract } from './registry'
import type { AssessmentContext, RiskRule, SignRequest, Simulation } from './types'

export interface RuleInput {
  readonly origin: string
  readonly chainId: number
  readonly account: Hex
  readonly request: SignRequest
  readonly decoded: DecodedCall | null
  readonly typed: ParsedTypedData | null
  readonly context: AssessmentContext
  readonly simulation: Simulation | null
}

export type Rule = (input: RuleInput) => RiskRule | null

const isInternal = (origin: string): boolean => origin.startsWith('internal:')

function label(ctx: AssessmentContext, chainId: number, address: string): string {
  const l = ctx.labels[address.toLowerCase()]
  if (l) return l
  const k = knownContract(chainId, address)
  if (k) return k.name
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

function amountText(ctx: AssessmentContext, token: string, amount: bigint): string {
  const t = ctx.tokens[token.toLowerCase()]
  if (!t) return `${amount.toString()} units`
  return `${formatUnits(amount, t.decimals)} ${t.symbol}`
}

// ---- origin ----------------------------------------------------------------------------

export const originScam: Rule = ({ origin, context }) => {
  if (isInternal(origin)) return null
  if (!isScamOrigin(origin, context.scamOrigins)) return null
  return { code: 'ORIGIN_SCAM', severity: 'block', title: 'This site is on the scam list', detail: 'BoltVault will not sign anything for it. If you believe this is a mistake, report it from Settings › About.' }
}

export const originTyposquat: Rule = ({ origin }) => {
  if (isInternal(origin)) return null
  const host = hostOf(origin)
  if (!host) return null
  const hit = typosquat(host)
  if (!hit) return null
  return { code: 'ORIGIN_TYPOSQUAT', severity: 'block', title: `This site imitates ${hit.protectedHost}`, detail: `${host} is not ${hit.protectedHost}. Close it and open the real site by typing the address yourself.` }
}

export const originUnverified: Rule = ({ origin, context }) => {
  if (isInternal(origin) || context.originVerified) return null
  return { code: 'ORIGIN_UNVERIFIED', severity: 'warn', title: 'This app could not be verified', detail: 'The connection came without a verified domain. Make sure you started it from the site you meant to use.' }
}

export const originFirstTime: Rule = ({ origin, context, request }) => {
  if (isInternal(origin) || !context.firstTimeOrigin) return null
  if (request.kind === 'message' || request.kind === 'typed_data' || request.kind === 'transaction') {
    return { code: 'ORIGIN_FIRST_TIME', severity: 'info', title: 'First signature for this site', detail: 'Take a moment to read what it asks for.' }
  }
  return null
}

// ---- messages ---------------------------------------------------------------------------

export const ethSignBlocked: Rule = ({ request, context }) => {
  if (request.kind !== 'eth_sign') return null
  if (context.ethSignEnabled) return { code: 'ETH_SIGN_BLOCKED', severity: 'danger', title: 'Raw hash signature', detail: 'This signs an arbitrary hash that could be a transaction or an approval. Only continue if you know exactly what this site does.' }
  return { code: 'ETH_SIGN_BLOCKED', severity: 'block', title: 'Raw hash signatures are off', detail: 'eth_sign can sign anything, including a transaction that drains the account. It stays off unless you enable it in Settings › Security.' }
}

export const personalSignLooksLikeTx: Rule = ({ request }) => {
  if (request.kind !== 'message') return null
  const d = decodeMessage(request.message)
  if (!d.looksLikeHashOrTx) return null
  return { code: 'PERSONAL_SIGN_LOOKS_LIKE_TX', severity: 'block', title: 'This "message" is a hash or a transaction', detail: 'A real sign-in message is readable text. Binary data of this shape is how drainers get a signature they can replay.' }
}

// ---- typed data ---------------------------------------------------------------------------

export const typedDataDomainMismatch: Rule = ({ request, typed, chainId }) => {
  if (request.kind !== 'typed_data' || !typed) return null
  if (typed.domain.chainId !== undefined && typed.domain.chainId !== BigInt(chainId)) {
    return { code: 'TYPED_DATA_DOMAIN_MISMATCH', severity: 'danger', title: 'Signed for a different network', detail: `This message is for chain ${typed.domain.chainId.toString()}, but the site is connected to chain ${chainId}.` }
  }
  return null
}

export const typedDataUnknown: Rule = ({ request, typed }) => {
  if (request.kind !== 'typed_data') return null
  if (typed && typed.decoded.kind !== 'unknown') return null
  return { code: 'TYPED_DATA_UNKNOWN', severity: 'warn', title: 'BoltVault cannot explain this message', detail: typed ? `The message type "${typed.primaryType}" is not one BoltVault understands. Read the raw fields below before you sign.` : 'The message is not valid typed data.' }
}

export const permit2Rules: Rule = ({ request, typed, chainId, context }) => {
  if (request.kind !== 'typed_data' || !typed) return null
  const d = typed.decoded
  if (d.kind === 'permit2_transfer') {
    if (isKnownSpender(chainId, d.spender)) return null
    const what = d.transfers.map((t) => amountText(context, t.token, t.amount)).join(', ')
    return { code: 'PERMIT2_SIGNATURE_TRANSFER', severity: 'block', title: 'This signature moves your tokens', detail: `It lets ${label(context, chainId, d.spender)} take ${what} with no further approval. "Sign to claim" messages of this shape are the most common drain.` }
  }
  if (d.kind === 'permit2_permit_single' || d.kind === 'permit2_permit_batch') {
    const unlimited = d.kind === 'permit2_permit_single' ? d.unlimited : d.details.some((x) => x.unlimited)
    if (!isKnownSpender(chainId, d.spender)) {
      return { code: 'PERMIT2_UNKNOWN_SPENDER', severity: 'danger', title: 'Allowance for an unknown contract', detail: `This lets ${label(context, chainId, d.spender)} spend your tokens through Permit2. BoltVault does not recognise it.` }
    }
    if (unlimited) return { code: 'PERMIT2_UNLIMITED', severity: 'warn', title: 'Unlimited allowance', detail: 'The amount is unlimited. ElectroSwap only needs the amount of one swap; you can set exact approvals in Settings › Spending.' }
  }
  return null
}

export const erc2612Rules: Rule = ({ request, typed, chainId, context }) => {
  if (request.kind !== 'typed_data' || !typed) return null
  const d = typed.decoded
  if (d.kind === 'dai_permit') {
    if (d.allowed && !isKnownSpender(chainId, d.spender)) return { code: 'DAI_PERMIT_ALLOWED', severity: 'danger', title: 'Unlimited DAI-style allowance', detail: `This signature allows ${label(context, chainId, d.spender)} to move all of this token until ${d.expiry === 0n ? 'forever' : 'it expires'}.` }
    return null
  }
  if (d.kind === 'erc2612_permit') {
    const spenderInfo = context.contracts[d.spender.toLowerCase()]
    if (spenderInfo && spenderInfo.hasCode === false) return { code: 'PERMIT_TO_EOA', severity: 'block', title: 'Allowance for a personal address', detail: 'The spender is not a contract. There is no honest reason for a person to hold a token allowance by signature.' }
    if (!isKnownSpender(chainId, d.spender)) return { code: 'ERC2612_PERMIT_UNKNOWN_SPENDER', severity: 'danger', title: 'Allowance for an unknown contract', detail: `This lets ${label(context, chainId, d.spender)} spend ${d.unlimited ? 'an unlimited amount' : amountText(context, typed.domain.verifyingContract ?? '0x', d.value)} by signature.` }
    if (d.unlimited) return { code: 'ERC2612_PERMIT_UNLIMITED', severity: 'warn', title: 'Unlimited allowance', detail: 'The amount is unlimited; a smaller one would do.' }
  }
  return null
}

export const seaportRules: Rule = ({ request, typed, context, chainId }) => {
  if (request.kind !== 'typed_data' || !typed || typed.decoded.kind !== 'seaport_order') return null
  const d = typed.decoded
  if (d.zeroConsideration) return { code: 'SEAPORT_ZERO_CONSIDERATION', severity: 'block', title: 'You would give these items away', detail: `This listing sends your ${d.offer.length} item${d.offer.length === 1 ? '' : 's'} to whoever fills it and pays you nothing. This is the "free mint" drain.` }
  if (typed.domain.verifyingContract && knownContract(chainId, typed.domain.verifyingContract)?.role !== 'marketplace') {
    return { code: 'TYPED_DATA_DOMAIN_MISMATCH', severity: 'danger', title: 'Order for an unknown marketplace', detail: `The order is for ${label(context, chainId, typed.domain.verifyingContract)}, not the ElectroSwap marketplace.` }
  }
  return null
}

// ---- transactions ---------------------------------------------------------------------------

export const authorizationList: Rule = ({ request }) => {
  if (request.kind !== 'transaction' || !request.tx.authorizationList?.length) return null
  return { code: 'AUTHORIZATION_LIST', severity: 'block', title: 'Account delegation is not supported', detail: 'This transaction would let a contract act as your account (EIP-7702). BoltVault does not sign delegations yet.' }
}

export const approveRules: Rule = ({ request, decoded, chainId, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  if (decoded.kind === 'erc20_approve' || decoded.kind === 'permit2_approve') {
    const known = isKnownSpender(chainId, decoded.spender)
    if (!known) return { code: 'APPROVE_UNKNOWN_SPENDER', severity: 'danger', title: 'Allowance for an unknown contract', detail: `This lets ${label(context, chainId, decoded.spender)} spend ${decoded.unlimited ? 'an unlimited amount of' : amountText(context, decoded.token, decoded.amount) + ' of'} ${label(context, chainId, decoded.token)}. BoltVault does not recognise the spender.` }
    if (decoded.unlimited) return { code: 'APPROVE_UNLIMITED', severity: 'warn', title: 'Unlimited allowance', detail: `${label(context, chainId, decoded.spender)} could move all of your ${label(context, chainId, decoded.token)}. You can make it exact.` }
  }
  if (decoded.kind === 'approval_for_all' && decoded.approved) {
    const known = knownContract(chainId, decoded.operator)
    if (known?.role === 'conduit' || known?.role === 'marketplace') return { code: 'APPROVAL_FOR_ALL', severity: 'warn', title: 'The marketplace can move this whole collection', detail: `Listing requires it: ${known.name} can transfer any item in ${label(context, chainId, decoded.token)} that you list.` }
    return { code: 'APPROVAL_FOR_ALL', severity: 'danger', title: 'Every item in this collection', detail: `${label(context, chainId, decoded.operator)} could transfer any item you own in ${label(context, chainId, decoded.token)}, now or later.` }
  }
  if (decoded.kind === 'universal_router') {
    for (const c of decoded.decoded.commands) {
      if ((c.type === 'PERMIT2_PERMIT' || c.type === 'PERMIT2_PERMIT_BATCH') && !isKnownSpender(chainId, c.spender)) {
        return { code: 'PERMIT2_UNKNOWN_SPENDER', severity: 'danger', title: 'Allowance for an unknown contract', detail: `A permit inside this swap names ${label(context, chainId, c.spender)} as the spender.` }
      }
    }
  }
  return null
}

/** T10: our own swap must pay exactly the pinned sink at the schedule's bips — never less, never elsewhere. */
export const feeSinkRules: Rule = ({ request, decoded, origin, context }) => {
  if (origin !== 'internal:swap' || request.kind !== 'transaction' || !decoded || decoded.kind !== 'universal_router') return null
  const expected = context.expectedFee
  if (!expected) return { code: 'FEE_SINK_MISMATCH', severity: 'block', title: 'The wallet fee could not be verified', detail: 'The fee sink for this network is not configured. In-wallet swaps stay off until it is.' }
  const portions = decoded.decoded.commands.filter((c) => c.type === 'PAY_PORTION')
  if (expected.bips === 0) {
    return portions.length === 0 ? null : { code: 'FEE_TIER_MISMATCH', severity: 'block', title: 'A fee was encoded for a zero-fee tier', detail: 'Your tier pays no wallet fee, but the transaction would pay one.' }
  }
  const p = portions[0]
  if (!p || p.type !== 'PAY_PORTION' || portions.length !== 1) return { code: 'FEE_SINK_MISMATCH', severity: 'block', title: 'The wallet fee is missing', detail: 'This swap does not pay the wallet fee to the fee sink. BoltVault will not sign it.' }
  if (p.recipient.toLowerCase() !== expected.sink.toLowerCase()) return { code: 'FEE_SINK_MISMATCH', severity: 'block', title: 'The fee would go to the wrong address', detail: `The fee recipient is not the pinned fee sink (${expected.sink.slice(0, 6)}…${expected.sink.slice(-4)}).` }
  if (p.bips !== BigInt(expected.bips)) return { code: 'FEE_TIER_MISMATCH', severity: 'block', title: 'The fee does not match your tier', detail: `Encoded ${(Number(p.bips) / 100).toFixed(2)}%, schedule says ${(expected.bips / 100).toFixed(2)}%. Re-quote and try again.` }
  return null
}

/** A bridge recipient that is a contract here and empty there receives nothing (§3.4 RECIPIENT_NO_CODE_ON_DEST). */
export const bridgeRecipientRule: Rule = ({ request, decoded, context }) => {
  if (request.kind !== 'transaction' || !decoded || decoded.kind !== 'bridge') return null
  const b = context.bridgeRecipient
  if (!b || !b.hasCodeOnOrigin || b.hasCodeOnDestination !== false) return null
  return { code: 'RECIPIENT_NO_CODE_ON_DEST', severity: 'block', title: 'The recipient does not exist on the destination', detail: 'That address is a contract on this chain but has no code on the destination chain. Tokens bridged there would be stuck.' }
}

export const dappTipsThirdParty: Rule = ({ request, decoded, origin, chainId, context }) => {
  if (request.kind !== 'transaction' || !decoded || decoded.kind !== 'universal_router' || isInternal(origin)) return null
  const portions = decoded.decoded.commands.filter((c) => c.type === 'PAY_PORTION')
  if (portions.length === 0) return null
  const p = portions[0]
  if (!p || p.type !== 'PAY_PORTION') return null
  return { code: 'DAPP_TIPS_THIRD_PARTY', severity: 'warn', title: 'This swap pays a fee to a third party', detail: `${(Number(p.bips) / 100).toFixed(2)}% of the output goes to ${label(context, chainId, p.recipient)}. That is the site's fee, not BoltVault's.` }
}

export const unknownFunction: Rule = ({ request, decoded, chainId, context }) => {
  if (request.kind !== 'transaction' || !decoded || decoded.kind !== 'contract_call' || decoded.functionName) return null
  if (knownContract(chainId, decoded.to)) return null
  return { code: 'UNKNOWN_FUNCTION', severity: 'warn', title: 'Unknown function on an unknown contract', detail: `BoltVault cannot tell what ${label(context, chainId, decoded.to)} will do with this call (${decoded.selector}).` }
}

export const newContract: Rule = ({ request, decoded, chainId, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  const target = 'to' in decoded ? decoded.to : decoded.kind === 'universal_router' ? decoded.router : null
  if (!target || knownContract(chainId, target)) return null
  const info = context.contracts[target.toLowerCase()]
  if (!info || !info.hasCode) return null
  if (info.ageDays !== undefined && info.ageDays !== null && info.ageDays < 7) return { code: 'NEW_CONTRACT', severity: 'warn', title: 'A very new contract', detail: `${label(context, chainId, target)} was deployed ${info.ageDays < 1 ? 'today' : `${Math.floor(info.ageDays)} days ago`}.` }
  if (info.verified === false) return { code: 'NEW_CONTRACT', severity: 'warn', title: 'Unverified contract', detail: `${label(context, chainId, target)} has no verified source on the explorer.` }
  return null
}

function recipientOf(decoded: DecodedCall | null): Hex | null {
  if (!decoded) return null
  switch (decoded.kind) {
    case 'native_transfer':
    case 'erc20_transfer':
    case 'erc721_transfer':
    case 'erc1155_transfer':
      return decoded.to
    default:
      return null
  }
}

export const recipientRules: Rule = ({ request, decoded, context, chainId, account }) => {
  if (request.kind !== 'transaction') return null
  const to = recipientOf(decoded)
  if (!to) return null
  if (sameAddress(to, account)) return null
  const reference = [...context.sentTo, ...context.addressBook, ...context.own]
  const poison = poisonCheck(to, reference)
  if (poison.hit) return { code: 'RECIPIENT_LOOKALIKE', severity: 'block', title: 'This address imitates one you use', detail: `It shares the first and last characters with ${poison.match ?? ''} but is a different address. Copy the full address from a source you trust.` }
  if (inSet(to, context.inboundOnly)) return { code: 'RECIPIENT_POISON_SOURCE', severity: 'danger', title: 'This address only ever sent you dust', detail: 'It appeared in your history by sending you a tiny amount — a known way to plant a lookalike. Make sure it is really where you mean to send.' }
  const info = context.contracts[to.toLowerCase()]
  if (info?.hasCode && !knownContract(chainId, to) && decoded?.kind !== 'erc721_transfer') return { code: 'RECIPIENT_IS_CONTRACT', severity: 'warn', title: 'The recipient is a contract', detail: `${label(context, chainId, to)} is a contract, not a person. Funds sent to a contract that does not expect them are usually lost.` }
  if (!inSet(to, reference)) return { code: 'RECIPIENT_FIRST_TIME', severity: 'info', title: 'First time sending here', detail: 'Check the whole address, not just the ends.' }
  return null
}

export const largeSend: Rule = ({ request, decoded, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  if (decoded.kind === 'native_transfer') {
    const bal = context.balances['native']
    if (bal !== undefined && bal > 0n && decoded.value * 10n > bal) return { code: 'LARGE_SEND', severity: 'warn', title: 'More than a tenth of your balance', detail: 'Large sends ask for a second look. Confirm the recipient once more.' }
  }
  if (decoded.kind === 'erc20_transfer') {
    const bal = context.balances[decoded.token.toLowerCase()]
    if (bal !== undefined && bal > 0n && decoded.amount * 10n > bal) return { code: 'LARGE_SEND', severity: 'warn', title: 'More than a tenth of your balance', detail: 'Large sends ask for a second look. Confirm the recipient once more.' }
  }
  return null
}

export const simulationRules: Rule = ({ request, simulation, decoded }) => {
  if (request.kind !== 'transaction' || !simulation) return null
  if (!simulation.ok) return { code: 'SIM_FAILED', severity: 'danger', title: 'This transaction would fail', detail: simulation.revertReason ? `The network rejected a preview: ${simulation.revertReason}` : 'The network rejected a preview of this transaction. Sending it would only cost gas.' }
  if (simulation.mode === 'none' && decoded && decoded.kind !== 'native_transfer' && decoded.kind !== 'erc20_transfer') {
    return { code: 'SIM_UNAVAILABLE', severity: 'warn', title: 'Preview unavailable', detail: "Electroneum's tracer didn't answer. Review the details below carefully." }
  }
  if (simulation.mode === 'estimate' && decoded && decoded.kind !== 'native_transfer' && decoded.kind !== 'erc20_transfer' && decoded.kind !== 'erc20_approve') {
    return { code: 'SIM_INCOMPLETE', severity: 'warn', title: 'Preview shows no balance changes', detail: 'This network cannot preview what moves. Only the revert check ran.' }
  }
  return null
}

export const chainMismatch: Rule = ({ request, chainId }) => {
  if (request.kind !== 'transaction') return null
  if (request.tx.chainId !== chainId) return { code: 'CHAIN_MISMATCH', severity: 'block', title: 'Wrong network', detail: `The transaction is for chain ${request.tx.chainId} but this site is connected to chain ${chainId}.` }
  return null
}

export const ALL_RULES: readonly Rule[] = [
  originScam,
  originTyposquat,
  originUnverified,
  originFirstTime,
  ethSignBlocked,
  personalSignLooksLikeTx,
  typedDataDomainMismatch,
  typedDataUnknown,
  permit2Rules,
  erc2612Rules,
  seaportRules,
  authorizationList,
  chainMismatch,
  approveRules,
  feeSinkRules,
  bridgeRecipientRule,
  dappTipsThirdParty,
  unknownFunction,
  newContract,
  recipientRules,
  largeSend,
  simulationRules,
]

export function runRules(input: RuleInput, rules: readonly Rule[] = ALL_RULES): RiskRule[] {
  const out: RiskRule[] = []
  for (const rule of rules) {
    const r = rule(input)
    if (r) out.push(r)
  }
  return out
}

export { parseTypedData }
