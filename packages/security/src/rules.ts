/**
 * Risk rules (master plan §3.4 step 3). Each is a pure function over the
 * decoded request and the context; each has a code, a severity and copy in
 * the §7.10 voice. Fixtures from real drainer payloads live in the tests.
 */
import { formatUnits, type Hex } from 'viem'
import { decodeCalldata, decodeMessage, parseTypedData, type DecodedCall, type ParsedTypedData } from './decode'
import { typosquat, hostOf, isScamOrigin } from './origin'
import { clipboardCheck } from './clipboard'
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

const isInternal = (origin: string): boolean =>
  origin.startsWith('internal:') || origin.startsWith('device:')

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

/**
 * A native amount in words, the same way explain.ts says it. Eighteen
 * decimals is not a guess: every chain in the registry uses them for its
 * native coin, and a chain that did not would be wrong in the statements too.
 */
function nativeText(chainId: number, amount: bigint): string {
  const symbol = chainId === 52014 || chainId === 5201420 ? 'ETN' : 'native'
  return `${formatUnits(amount, 18)} ${symbol}`
}

// ---- origin ----------------------------------------------------------------------------

export const originScam: Rule = ({ origin, context }) => {
  if (isInternal(origin)) return null
  if (!isScamOrigin(origin, context.scamOrigins)) return null
  return {
    code: 'ORIGIN_SCAM',
    severity: 'block',
    title: 'This site is on the scam list',
    detail:
      'BoltVault will not sign anything for it. If you believe this is a mistake, report it from Settings › About.',
  }
}

export const originTyposquat: Rule = ({ origin }) => {
  if (isInternal(origin)) return null
  const host = hostOf(origin)
  if (!host) return null
  const hit = typosquat(host)
  if (!hit) return null
  return {
    code: 'ORIGIN_TYPOSQUAT',
    severity: 'block',
    title: `This site imitates ${hit.protectedHost}`,
    detail: `${host} is not ${hit.protectedHost}. Close it and open the real site by typing the address yourself.`,
  }
}

export const originUnverified: Rule = ({ origin, context }) => {
  if (isInternal(origin) || context.originVerified) return null
  return {
    code: 'ORIGIN_UNVERIFIED',
    severity: 'warn',
    title: 'This app could not be verified',
    detail:
      'The connection came without a verified domain. Make sure you started it from the site you meant to use.',
  }
}

export const originFirstTime: Rule = ({ origin, context, request }) => {
  if (isInternal(origin) || !context.firstTimeOrigin) return null
  if (
    request.kind === 'message' ||
    request.kind === 'typed_data' ||
    request.kind === 'transaction'
  ) {
    return {
      code: 'ORIGIN_FIRST_TIME',
      severity: 'info',
      title: 'First signature for this site',
      detail: 'Take a moment to read what it asks for.',
    }
  }
  return null
}

// ---- messages ---------------------------------------------------------------------------

export const ethSignBlocked: Rule = ({ request, context }) => {
  if (request.kind !== 'eth_sign') return null
  if (context.ethSignEnabled)
    return {
      code: 'ETH_SIGN_BLOCKED',
      severity: 'danger',
      title: 'Raw hash signature',
      detail:
        'This signs an arbitrary hash that could be a transaction or an approval. Only continue if you know exactly what this site does.',
    }
  return {
    code: 'ETH_SIGN_BLOCKED',
    severity: 'block',
    title: 'Raw hash signatures are off',
    detail:
      'eth_sign can sign anything, including a transaction that drains the account. It stays off unless you enable it in Settings › Security.',
  }
}

export const personalSignLooksLikeTx: Rule = ({ request }) => {
  if (request.kind !== 'message') return null
  const d = decodeMessage(request.message)
  if (!d.looksLikeHashOrTx) return null
  return {
    code: 'PERSONAL_SIGN_LOOKS_LIKE_TX',
    severity: 'block',
    title: 'This "message" is a hash or a transaction',
    detail:
      'A real sign-in message is readable text. Binary data of this shape is how drainers get a signature they can replay.',
  }
}

// ---- typed data ---------------------------------------------------------------------------

export const typedDataDomainMismatch: Rule = ({ request, typed, chainId }) => {
  if (request.kind !== 'typed_data' || !typed) return null
  if (typed.domain.chainId !== undefined && typed.domain.chainId !== BigInt(chainId)) {
    return {
      code: 'TYPED_DATA_DOMAIN_MISMATCH',
      severity: 'danger',
      title: 'Signed for a different network',
      detail: `This message is for chain ${typed.domain.chainId.toString()}, but the site is connected to chain ${chainId}.`,
    }
  }
  return null
}

export const typedDataUnknown: Rule = ({ request, typed }) => {
  if (request.kind !== 'typed_data') return null
  if (typed && typed.decoded.kind !== 'unknown') return null
  return {
    code: 'TYPED_DATA_UNKNOWN',
    severity: 'warn',
    title: 'BoltVault cannot explain this message',
    detail: typed
      ? `The message type "${typed.primaryType}" is not one BoltVault understands. Read the raw fields below before you sign.`
      : 'The message is not valid typed data.',
  }
}

export const permit2Rules: Rule = ({ request, typed, chainId, context }) => {
  if (request.kind !== 'typed_data' || !typed) return null
  const d = typed.decoded
  if (d.kind === 'permit2_transfer') {
    if (isKnownSpender(chainId, d.spender)) return null
    const what = d.transfers.map((t) => amountText(context, t.token, t.amount)).join(', ')
    return {
      code: 'PERMIT2_SIGNATURE_TRANSFER',
      severity: 'block',
      title: 'This signature moves your tokens',
      detail: `It lets ${label(context, chainId, d.spender)} take ${what} with no further approval. "Sign to claim" messages of this shape are the most common drain.`,
    }
  }
  if (d.kind === 'permit2_permit_single' || d.kind === 'permit2_permit_batch') {
    const unlimited =
      d.kind === 'permit2_permit_single' ? d.unlimited : d.details.some((x) => x.unlimited)
    if (!isKnownSpender(chainId, d.spender)) {
      return {
        code: 'PERMIT2_UNKNOWN_SPENDER',
        severity: 'danger',
        title: 'Allowance for an unknown contract',
        detail: `This lets ${label(context, chainId, d.spender)} spend your tokens through Permit2. BoltVault does not recognise it.`,
      }
    }
    if (unlimited)
      return {
        code: 'PERMIT2_UNLIMITED',
        severity: 'warn',
        title: 'Unlimited allowance',
        detail:
          'The amount is unlimited. ElectroSwap only needs the amount of one swap; you can set exact approvals in Settings › Spending.',
      }
  }
  return null
}

export const erc2612Rules: Rule = ({ request, typed, chainId, context }) => {
  if (request.kind !== 'typed_data' || !typed) return null
  const d = typed.decoded
  if (d.kind === 'dai_permit') {
    if (d.allowed && !isKnownSpender(chainId, d.spender))
      return {
        code: 'DAI_PERMIT_ALLOWED',
        severity: 'danger',
        title: 'Unlimited DAI-style allowance',
        detail: `This signature allows ${label(context, chainId, d.spender)} to move all of this token until ${d.expiry === 0n ? 'forever' : 'it expires'}.`,
      }
    return null
  }
  if (d.kind === 'erc2612_permit') {
    const spenderInfo = context.contracts[d.spender.toLowerCase()]
    if (spenderInfo && spenderInfo.hasCode === false)
      return {
        code: 'PERMIT_TO_EOA',
        severity: 'block',
        title: 'Allowance for a personal address',
        detail:
          'The spender is not a contract. There is no honest reason for a person to hold a token allowance by signature.',
      }
    if (!isKnownSpender(chainId, d.spender))
      return {
        code: 'ERC2612_PERMIT_UNKNOWN_SPENDER',
        severity: 'danger',
        title: 'Allowance for an unknown contract',
        detail: `This lets ${label(context, chainId, d.spender)} spend ${d.unlimited ? 'an unlimited amount' : amountText(context, typed.domain.verifyingContract ?? '0x', d.value)} by signature.`,
      }
    if (d.unlimited)
      return {
        code: 'ERC2612_PERMIT_UNLIMITED',
        severity: 'warn',
        title: 'Unlimited allowance',
        detail: 'The amount is unlimited; a smaller one would do.',
      }
  }
  return null
}

export const seaportRules: Rule = ({ request, typed, context, chainId }) => {
  if (request.kind !== 'typed_data' || !typed || typed.decoded.kind !== 'seaport_order') return null
  const d = typed.decoded
  if (d.zeroConsideration)
    return {
      code: 'SEAPORT_ZERO_CONSIDERATION',
      severity: 'block',
      title: 'You would give these items away',
      detail: `This listing sends your ${d.offer.length} item${d.offer.length === 1 ? '' : 's'} to whoever fills it and pays you nothing. This is the "free mint" drain.`,
    }
  if (
    typed.domain.verifyingContract &&
    knownContract(chainId, typed.domain.verifyingContract)?.role !== 'marketplace'
  ) {
    return {
      code: 'TYPED_DATA_DOMAIN_MISMATCH',
      severity: 'danger',
      title: 'Order for an unknown marketplace',
      detail: `The order is for ${label(context, chainId, typed.domain.verifyingContract)}, not the ElectroSwap marketplace.`,
    }
  }
  return null
}

/** Seaport's `ItemType`: 0 native, 1 ERC-20, 2 ERC-721, 3 ERC-1155. */
const SEAPORT_NATIVE = 0
const SEAPORT_ERC721 = 2
const SEAPORT_ERC1155 = 3

/**
 * How far below the floor a listing has to be before this fires: a tenth.
 *
 * `SEAPORT_ZERO_CONSIDERATION` catches the give-away; this catches its quieter
 * sibling, where a signature the user believes is a log-in lists the piece for
 * dust the attacker is glad to pay. A seller who wants out fast discounts, and
 * pricing a piece is the owner's business — but nobody honestly asks a tenth
 * of what the cheapest piece in the collection is going for, so that is the
 * line. Above it the wallet says nothing.
 */
export const SEAPORT_UNDERPRICED_DIVISOR = 10n

/**
 * A listing priced far below the collection floor (§3.4 `SEAPORT_UNDERPRICED`).
 *
 * Separate from `seaportRules` rather than folded into it: that one returns on
 * the first finding, and an underpriced order on an unknown marketplace is two
 * facts, not one.
 */
export const seaportUnderpriced: Rule = ({ request, typed, context, chainId }) => {
  if (request.kind !== 'typed_data' || !typed || typed.decoded.kind !== 'seaport_order') return null
  const d = typed.decoded
  // The give-away has its own, blunter rule; saying both would be noise.
  if (d.zeroConsideration) return null
  // A listing: exactly one piece leaves, and only native coin comes back.
  if (d.offer.length !== 1) return null
  const item = d.offer[0]
  if (!item || (item.itemType !== SEAPORT_ERC721 && item.itemType !== SEAPORT_ERC1155)) return null
  if (!d.consideration.length || d.consideration.some((c) => c.itemType !== SEAPORT_NATIVE)) return null
  const floor = context.nftFloors[item.token.toLowerCase()]
  if (floor === undefined || floor <= 0n) return null
  // Every consideration item is a share of one price (seller + creator + platform).
  const total = d.consideration.reduce((sum, c) => sum + c.amount, 0n)
  if (total * SEAPORT_UNDERPRICED_DIVISOR >= floor) return null
  return {
    code: 'SEAPORT_UNDERPRICED',
    severity: 'danger',
    title: 'Far below what this collection sells for',
    detail: `This lists ${label(context, chainId, item.token)} #${item.identifier.toString()} for ${nativeText(chainId, total)} while the collection's floor is ${nativeText(chainId, floor)}. Whoever fills it keeps the difference.`,
  }
}

// ---- transactions ---------------------------------------------------------------------------

export const authorizationList: Rule = ({ request }) => {
  if (request.kind !== 'transaction' || !request.tx.authorizationList?.length) return null
  return {
    code: 'AUTHORIZATION_LIST',
    severity: 'block',
    title: 'Account delegation is not supported',
    detail:
      'This transaction would let a contract act as your account (EIP-7702). BoltVault does not sign delegations yet.',
  }
}

export const approveRules: Rule = ({ request, decoded, chainId, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  if (decoded.kind === 'erc20_approve' || decoded.kind === 'permit2_approve') {
    const known = isKnownSpender(chainId, decoded.spender)
    if (!known)
      return {
        code: 'APPROVE_UNKNOWN_SPENDER',
        severity: 'danger',
        title: 'Allowance for an unknown contract',
        detail: `This lets ${label(context, chainId, decoded.spender)} spend ${decoded.unlimited ? 'an unlimited amount of' : amountText(context, decoded.token, decoded.amount) + ' of'} ${label(context, chainId, decoded.token)}. BoltVault does not recognise the spender.`,
      }
    if (decoded.unlimited)
      return {
        code: 'APPROVE_UNLIMITED',
        severity: 'warn',
        title: 'Unlimited allowance',
        detail: `${label(context, chainId, decoded.spender)} could move all of your ${label(context, chainId, decoded.token)}. You can make it exact.`,
      }
  }
  if (decoded.kind === 'approval_for_all' && decoded.approved) {
    const known = knownContract(chainId, decoded.operator)
    if (known?.role === 'conduit' || known?.role === 'marketplace')
      return {
        code: 'APPROVAL_FOR_ALL',
        severity: 'warn',
        title: 'The marketplace can move this whole collection',
        detail: `Listing requires it: ${known.name} can transfer any item in ${label(context, chainId, decoded.token)} that you list.`,
      }
    return {
      code: 'APPROVAL_FOR_ALL',
      severity: 'danger',
      title: 'Every item in this collection',
      detail: `${label(context, chainId, decoded.operator)} could transfer any item you own in ${label(context, chainId, decoded.token)}, now or later.`,
    }
  }
  if (decoded.kind === 'universal_router') {
    for (const c of decoded.decoded.commands) {
      if (
        (c.type === 'PERMIT2_PERMIT' || c.type === 'PERMIT2_PERMIT_BATCH') &&
        !isKnownSpender(chainId, c.spender)
      ) {
        return {
          code: 'PERMIT2_UNKNOWN_SPENDER',
          severity: 'danger',
          title: 'Allowance for an unknown contract',
          detail: `A permit inside this swap names ${label(context, chainId, c.spender)} as the spender.`,
        }
      }
    }
  }
  return null
}

/** T10: our own swap must pay exactly the pinned sink at the schedule's bips — never less, never elsewhere. */
export const feeSinkRules: Rule = ({ request, decoded, origin, context }) => {
  if (
    origin !== 'internal:swap' ||
    request.kind !== 'transaction' ||
    !decoded ||
    decoded.kind !== 'universal_router'
  )
    return null
  const expected = context.expectedFee
  if (!expected)
    return {
      code: 'FEE_SINK_MISMATCH',
      severity: 'block',
      title: 'The wallet fee could not be verified',
      detail:
        'In-wallet swaps are off on this network — no fee address is set for it in this build.',
    }
  const portions = decoded.decoded.commands.filter((c) => c.type === 'PAY_PORTION')
  if (expected.bips === 0) {
    return portions.length === 0
      ? null
      : {
          code: 'FEE_TIER_MISMATCH',
          severity: 'block',
          title: 'A fee was encoded for a zero-fee tier',
          detail: 'Your tier pays no wallet fee, but the transaction would pay one.',
        }
  }
  const p = portions[0]
  if (!p || p.type !== 'PAY_PORTION' || portions.length !== 1)
    return {
      code: 'FEE_SINK_MISMATCH',
      severity: 'block',
      title: 'The wallet fee is missing',
      detail:
        'This swap does not pay the wallet fee to the pinned recipient. BoltVault will not sign it.',
    }
  if (p.recipient.toLowerCase() !== expected.sink.toLowerCase())
    return {
      code: 'FEE_SINK_MISMATCH',
      severity: 'block',
      title: 'The fee would go to the wrong address',
      detail: `The fee recipient is not the address pinned in this build (${expected.sink.slice(0, 6)}…${expected.sink.slice(-4)}).`,
    }
  if (p.bips !== BigInt(expected.bips))
    return {
      code: 'FEE_TIER_MISMATCH',
      severity: 'block',
      title: 'The fee does not match your tier',
      detail: `Encoded ${(Number(p.bips) / 100).toFixed(2)}%, schedule says ${(expected.bips / 100).toFixed(2)}%. Re-quote and try again.`,
    }
  return null
}

/** A bridge recipient that is a contract here and empty there receives nothing (§3.4 RECIPIENT_NO_CODE_ON_DEST). */
export const bridgeRecipientRule: Rule = ({ request, decoded, context }) => {
  if (request.kind !== 'transaction' || !decoded || decoded.kind !== 'bridge') return null
  const b = context.bridgeRecipient
  if (!b || !b.hasCodeOnOrigin || b.hasCodeOnDestination !== false) return null
  return {
    code: 'RECIPIENT_NO_CODE_ON_DEST',
    severity: 'block',
    title: 'The recipient does not exist on the destination',
    detail:
      'That address is a contract on this chain but has no code on the destination chain. Tokens bridged there would be stuck.',
  }
}

export const dappTipsThirdParty: Rule = ({ request, decoded, origin, chainId, context }) => {
  if (
    request.kind !== 'transaction' ||
    !decoded ||
    decoded.kind !== 'universal_router' ||
    isInternal(origin)
  )
    return null
  const portions = decoded.decoded.commands.filter((c) => c.type === 'PAY_PORTION')
  if (portions.length === 0) return null
  const p = portions[0]
  if (!p || p.type !== 'PAY_PORTION') return null
  return {
    code: 'DAPP_TIPS_THIRD_PARTY',
    severity: 'warn',
    title: 'This swap pays a fee to a third party',
    detail: `${(Number(p.bips) / 100).toFixed(2)}% of the output goes to ${label(context, chainId, p.recipient)}. That is the site's fee, not BoltVault's.`,
  }
}

export const unknownFunction: Rule = ({ request, decoded, chainId, context }) => {
  if (
    request.kind !== 'transaction' ||
    !decoded ||
    decoded.kind !== 'contract_call' ||
    decoded.functionName
  )
    return null
  if (knownContract(chainId, decoded.to)) return null
  return {
    code: 'UNKNOWN_FUNCTION',
    severity: 'warn',
    title: 'Unknown function on an unknown contract',
    detail: `BoltVault cannot tell what ${label(context, chainId, decoded.to)} will do with this call (${decoded.selector}).`,
  }
}

export const newContract: Rule = ({ request, decoded, chainId, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  const target =
    'to' in decoded ? decoded.to : decoded.kind === 'universal_router' ? decoded.router : null
  if (!target || knownContract(chainId, target)) return null
  const info = context.contracts[target.toLowerCase()]
  if (!info || !info.hasCode) return null
  if (info.ageDays !== undefined && info.ageDays !== null && info.ageDays < 7)
    return {
      code: 'NEW_CONTRACT',
      severity: 'warn',
      title: 'A very new contract',
      detail: `${label(context, chainId, target)} was deployed ${info.ageDays < 1 ? 'today' : `${Math.floor(info.ageDays)} days ago`}.`,
    }
  if (info.verified === false)
    return {
      code: 'NEW_CONTRACT',
      severity: 'warn',
      title: 'Unverified contract',
      detail: `${label(context, chainId, target)} has no verified source on the explorer.`,
    }
  return null
}

function recipientOf(decoded: DecodedCall | null): Hex | null {
  if (!decoded) return null
  switch (decoded.kind) {
    // `ambiguous_transfer_from` is here too: whatever its third word means,
    // the second is still a recipient, so poisoning and first-time checks
    // apply exactly as they do to the rest.
    case 'native_transfer':
    case 'erc20_transfer':
    case 'erc721_transfer':
    case 'erc1155_transfer':
    case 'ambiguous_transfer_from':
      return decoded.to
    default:
      return null
  }
}

/**
 * T1: a batch carrying value, or an inner call the decoder cannot name.
 *
 * Multicall3 is a legitimate and common way to do several things at once, so
 * the batch itself is not suspicious. What is worth saying out loud is that
 * part of it could not be read, or that the batch moves native value — both
 * are things the summary line used to hide behind a call count.
 */
export const multicallOpaque: Rule = ({ decoded, chainId }) => {
  if (decoded?.kind !== 'multicall') return null
  if (decoded.value > 0n)
    return {
      code: 'MULTICALL_OPAQUE',
      severity: 'warn',
      title: 'This batch also sends funds',
      detail: 'A batched call that carries value is unusual. Read the list below before approving.',
    }
  const opaque = decoded.calls.some((c) => {
    const inner = decodeCalldata({ chainId, to: c.target, data: c.data, value: 0n })
    return inner.kind === 'contract_call' && inner.functionName === null
  })
  if (!opaque) return null
  return {
    code: 'MULTICALL_OPAQUE',
    severity: 'warn',
    title: 'Part of this batch could not be read',
    detail: 'At least one call inside this batch is a function BoltVault does not recognise, so what it does cannot be shown.',
  }
}

/** The router's two stand-ins for an address; neither is a third party. */
const UR_SENTINELS = new Set(['0x0000000000000000000000000000000000000001', '0x0000000000000000000000000000000000000002'])

/**
 * T1: a router call whose output lands anywhere but the user's own account.
 *
 * The commands inside `execute` can swap the user's balance into the router
 * and then sweep it elsewhere. That is a legitimate shape — it is how a swap
 * with a fee works — so the test is not "is there a sweep" but "does any
 * recipient belong to someone other than you". `PAY_PORTION` is excluded: the
 * fee sink has its own pinned rules (`feeSinkRules`, `dappTipsThirdParty`).
 */
export const urRecipientNotSelf: Rule = ({ decoded, context, chainId, account }) => {
  if (decoded?.kind !== 'universal_router') return null
  const recipients: Hex[] = []
  for (const c of decoded.decoded.commands) {
    switch (c.type) {
      case 'V2_SWAP_EXACT_IN':
      case 'V2_SWAP_EXACT_OUT':
      case 'V3_SWAP_EXACT_IN':
      case 'V3_SWAP_EXACT_OUT':
      case 'SWEEP':
      case 'TRANSFER':
      case 'PERMIT2_TRANSFER_FROM':
      case 'WRAP_ETH':
      case 'UNWRAP_WETH':
        recipients.push(c.recipient)
        break
      case 'PERMIT2_TRANSFER_FROM_BATCH':
        for (const tr of c.transfers) recipients.push(tr.to)
        break
      default:
        break
    }
  }
  const own = [account, ...context.own]
  const stranger = recipients.find(
    (r) => !UR_SENTINELS.has(r.toLowerCase()) && !own.some((o) => sameAddress(o, r)),
  )
  if (!stranger) return null
  const reference = [...context.sentTo, ...context.addressBook, ...context.own]
  const poison = poisonCheck(stranger, reference)
  if (poison.hit)
    return {
      code: 'RECIPIENT_LOOKALIKE',
      severity: 'block',
      title: 'This swap sends the output to an address that imitates one you use',
      detail: `It shares the first and last characters with ${poison.match ?? ''} but is a different address.`,
    }
  return {
    code: 'UR_RECIPIENT_NOT_SELF',
    severity: 'danger',
    title: 'This swap sends the output somewhere else',
    detail: `Part of this swap pays ${label(context, chainId, stranger)}, not you. A swap you asked for pays you.`,
  }
}

/**
 * T1: a minimum-out so far below the input that it is not a floor at all.
 *
 * Six orders of magnitude of slack, which is decimals-agnostic and therefore
 * safe as a heuristic: no honest pair is off by a million. It catches the
 * drainer shape of "accept literally one wei in return", which is otherwise
 * indistinguishable from a sane minimum once the amounts are raw integers.
 */
export const swapMinOutImplausible: Rule = ({ decoded }) => {
  if (decoded?.kind !== 'universal_router') return null
  for (const c of decoded.decoded.commands) {
    if (c.type !== 'V2_SWAP_EXACT_IN' && c.type !== 'V3_SWAP_EXACT_IN') continue
    if (c.amountIn > 0n && c.amountOut <= c.amountIn / 1_000_000n)
      return {
        code: 'SWAP_MIN_OUT_IMPLAUSIBLE',
        severity: 'danger',
        title: 'This swap accepts almost nothing in return',
        detail: 'The smallest amount this swap will accept is so far below what you are putting in that it offers no protection at all.',
      }
  }
  return null
}

export const recipientRules: Rule = ({ request, decoded, context, chainId, account }) => {
  if (request.kind !== 'transaction') return null
  const to = recipientOf(decoded)
  if (!to) return null
  if (sameAddress(to, account)) return null
  const reference = [...context.sentTo, ...context.addressBook, ...context.own]
  const poison = poisonCheck(to, reference)
  if (poison.hit)
    return {
      code: 'RECIPIENT_LOOKALIKE',
      severity: 'block',
      title: 'This address imitates one you use',
      detail: `It shares the first and last characters with ${poison.match ?? ''} but is a different address. Copy the full address from a source you trust.`,
    }
  if (inSet(to, context.inboundOnly))
    return {
      code: 'RECIPIENT_POISON_SOURCE',
      severity: 'danger',
      title: 'This address only ever sent you dust',
      detail:
        'It appeared in your history by sending you a tiny amount — a known way to plant a lookalike. Make sure it is really where you mean to send.',
    }
  const info = context.contracts[to.toLowerCase()]
  if (info?.hasCode && !knownContract(chainId, to) && decoded?.kind !== 'erc721_transfer')
    return {
      code: 'RECIPIENT_IS_CONTRACT',
      severity: 'warn',
      title: 'The recipient is a contract',
      detail: `${label(context, chainId, to)} is a contract, not a person. Funds sent to a contract that does not expect them are usually lost.`,
    }
  if (!inSet(to, reference))
    return {
      code: 'RECIPIENT_FIRST_TIME',
      severity: 'info',
      title: 'First time sending here',
      detail: 'Check the whole address, not just the ends.',
    }
  return null
}

export const largeSend: Rule = ({ request, decoded, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  if (decoded.kind === 'native_transfer') {
    const bal = context.balances['native']
    if (bal !== undefined && bal > 0n && decoded.value * 10n > bal)
      return {
        code: 'LARGE_SEND',
        severity: 'warn',
        title: 'More than a tenth of your balance',
        detail: 'Large sends ask for a second look. Confirm the recipient once more.',
      }
  }
  if (decoded.kind === 'erc20_transfer') {
    const bal = context.balances[decoded.token.toLowerCase()]
    if (bal !== undefined && bal > 0n && decoded.amount * 10n > bal)
      return {
        code: 'LARGE_SEND',
        severity: 'warn',
        title: 'More than a tenth of your balance',
        detail: 'Large sends ask for a second look. Confirm the recipient once more.',
      }
  }
  return null
}

/**
 * The per-origin spend budget (§4.6, §3.4 `VALUE_EXCEEDS_BUDGET`).
 *
 * Expressed in the chain's own units, never in fiat: prices are display-only
 * (§3.4 step 6), so a USD cap would let a price feed decide what the user is
 * allowed to sign. "Remaining" is the cap minus what this origin has already
 * moved, so a budget is a budget rather than a per-transaction limit.
 */
export const valueExceedsBudget: Rule = ({ request, context, chainId, origin }) => {
  if (request.kind !== 'transaction') return null
  const budget = context.originBudget
  if (!budget) return null
  const remaining = budget.limit > budget.spent ? budget.limit - budget.spent : 0n
  if (request.tx.value <= remaining) return null
  const who = hostOf(origin) ?? origin
  return {
    code: 'VALUE_EXCEEDS_BUDGET',
    severity: 'danger',
    title: 'Over the limit you set for this site',
    detail: `${who} has ${nativeText(chainId, remaining)} left of the ${nativeText(chainId, budget.limit)} you allowed it, and this asks for ${nativeText(chainId, request.tx.value)}. Raise the limit in Settings › Connected sites if you meant to.`,
  }
}

/**
 * The clipboard check (§3.6): the recipient is not the address the wallet put
 * on the clipboard a moment ago.
 *
 * Recipients already in the reference set are exempt — an address the user has
 * sent to, saved, or owns cannot be a swapped-in one, and without the
 * exemption "copy my receive address, then pay a saved contact" would be
 * second-guessed every time.
 */
export const clipboardHijack: Rule = ({ request, decoded, context }) => {
  if (request.kind !== 'transaction') return null
  const to = recipientOf(decoded)
  if (!to) return null
  if (inSet(to, [...context.sentTo, ...context.addressBook, ...context.own])) return null
  const check = clipboardCheck(to, context.lastCopiedAddress, context.now)
  if (!check.mismatch || !check.copied) return null
  return {
    code: 'CLIPBOARD_MISMATCH',
    severity: 'danger',
    title: 'The address you pasted is not the one you copied',
    detail: `BoltVault copied ${check.copied} a moment ago, and this sends to ${to}. Software that watches the clipboard swaps addresses exactly like this — copy it again and compare every character.`,
  }
}

export const simulationRules: Rule = ({ request, simulation, decoded }) => {
  if (request.kind !== 'transaction' || !simulation) return null
  if (!simulation.ok)
    return {
      code: 'SIM_FAILED',
      severity: 'danger',
      title: 'This transaction would fail',
      detail: simulation.revertReason
        ? `The network rejected a preview: ${simulation.revertReason}`
        : 'The network rejected a preview of this transaction. Sending it would only cost gas.',
    }
  if (
    simulation.mode === 'none' &&
    decoded &&
    decoded.kind !== 'native_transfer' &&
    decoded.kind !== 'erc20_transfer'
  ) {
    return {
      code: 'SIM_UNAVAILABLE',
      severity: 'warn',
      title: 'Preview unavailable',
      detail: "Electroneum's tracer didn't answer. Review the details below carefully.",
    }
  }
  if (
    simulation.mode === 'estimate' &&
    decoded &&
    decoded.kind !== 'native_transfer' &&
    decoded.kind !== 'erc20_transfer' &&
    decoded.kind !== 'erc20_approve'
  ) {
    /*
      Two different things, and they used to read as one.

      "This network cannot preview what moves" is true only where nothing can
      trace. Electroneum can — `etn-sc` carries the debug namespace and the
      wallet reaches it through our own API — so when that tracer was asked and
      said no, saying the network cannot do it blames the wrong thing and hides
      the reason. A `note` means a tracer answered with a problem; repeat it.
    */
    if (simulation.note)
      return {
        code: 'SIM_UNAVAILABLE',
        severity: 'warn',
        title: 'Preview could not be produced',
        detail: `${simulation.note} Review the details below carefully.`,
      }
    return {
      code: 'SIM_INCOMPLETE',
      severity: 'warn',
      title: 'Preview shows no balance changes',
      detail: 'This network cannot preview what moves. Only the revert check ran.',
    }
  }
  return null
}

export const chainMismatch: Rule = ({ request, chainId }) => {
  if (request.kind !== 'transaction') return null
  if (request.tx.chainId !== chainId)
    return {
      code: 'CHAIN_MISMATCH',
      severity: 'block',
      title: 'Wrong network',
      detail: `The transaction is for chain ${request.tx.chainId} but this site is connected to chain ${chainId}.`,
    }
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
  seaportUnderpriced,
  authorizationList,
  chainMismatch,
  approveRules,
  feeSinkRules,
  bridgeRecipientRule,
  dappTipsThirdParty,
  urRecipientNotSelf,
  swapMinOutImplausible,
  multicallOpaque,
  unknownFunction,
  newContract,
  recipientRules,
  clipboardHijack,
  largeSend,
  valueExceedsBudget,
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
