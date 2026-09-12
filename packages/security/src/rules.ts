/**
 * Risk rules (master plan §3.4 step 3). Each is a pure function over the
 * decoded request and the context; each has a code, a severity and copy in
 * the §7.10 voice. Fixtures from real drainer payloads live in the tests.
 */
import { feeRecipient } from '@boltvault/chains'
import { formatUnits, type Hex } from 'viem'
import {
  decodeCalldata,
  decodeMessage,
  parseTypedData,
  type DecodedCall,
  type ParsedTypedData,
} from './decode'
import { typosquat, hostOf, isScamOrigin } from './origin'
import { clipboardCheck } from './clipboard'
import { inSet, poisonCheck, sameAddress } from './poison'
import { isKnownSpender, knownContract } from './registry'
import { UR_MSG_SENDER, UR_ROUTER_SELF, isUrSwap, urDeliveredAfter, urPathTokens } from './ur'
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
function nativeText(chainId: number, amount: bigint, ctx?: AssessmentContext): string {
  return `${formatUnits(amount, 18)} ${nativeSymbolOf(chainId, ctx)}`
}

/**
 * What this chain calls its own coin.
 *
 * The context carries it from the registry; the two Electroneum ids are the
 * fallback for a caller that has not threaded it through yet. "native" — the
 * old answer for every other chain — is not a currency and told the reader
 * nothing about what was leaving.
 */
export function nativeSymbolOf(chainId: number, ctx?: AssessmentContext): string {
  return ctx?.nativeSymbol ?? (chainId === 52014 || chainId === 5201420 ? 'ETN' : 'native')
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

/**
 * Verify said the peer's domain does not match the app it claims to be (§5.3).
 *
 * Reown's Verify answers VALID, INVALID or UNKNOWN, and only the first was
 * read: everything else became "unverified", which is `warn` and a
 * second-and-a-half of waiting. UNKNOWN deserves exactly that — Verify is
 * best-effort and is often simply unreachable. INVALID is a different
 * sentence: something checked, and disagreed.
 */
export const originVerifyMismatch: Rule = ({ origin, context }) => {
  if (isInternal(origin) || context.originVerify !== 'invalid') return null
  return {
    code: 'ORIGIN_VERIFY_MISMATCH',
    severity: 'danger',
    title: 'This app is not where it says it is',
    detail:
      'WalletConnect checked the domain this app claims and found it does not match. That is the shape of a page pretending to be one you know.',
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

/**
 * A page served in the clear (ES-BV-022).
 *
 * `http://` gives no identity at all: anyone between the user and the site can
 * serve the page, so a sheet raised from `http://dapp.example` is
 * indistinguishable from one raised by the real site — same origin string,
 * same favicon, same everything the user reads. The wallet already refuses
 * cleartext for its own RPC and for the first-party fee policy; nothing said
 * it about the pages it signs for.
 *
 * A read is worth a note; a signature is worth a stronger one, because a
 * signature is what the attacker in the middle is there to collect.
 */
export const originCleartext: Rule = ({ origin, request }) => {
  if (!origin.startsWith('http://')) return null
  const signing =
    request.kind === 'message' ||
    request.kind === 'typed_data' ||
    request.kind === 'transaction' ||
    request.kind === 'eth_sign'
  return {
    code: 'ORIGIN_CLEARTEXT',
    severity: signing ? 'danger' : 'warn',
    title: 'This site is not encrypted',
    detail: signing
      ? `${origin} is served over plain http, so anyone on the network between you and it can change what it asks you to sign, and can read what you send back. Nothing here proves you are talking to the real site.`
      : `${origin} is served over plain http. Anyone on the network can see and change this page.`,
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
    /*
      The statement above already says the amount is unlimited, in the same
      sheet, a few lines up. Repeating it here made the card look like a second
      finding rather than advice about the first, which is how a reader learns
      to skip cards. What the statement cannot say is what to do about it.
    */
    if (unlimited)
      return {
        code: 'PERMIT2_UNLIMITED',
        severity: 'warn',
        title: 'Unlimited allowance',
        detail:
          'ElectroSwap only needs the amount of one swap. You can make approvals exact in Settings › Spending.',
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
  /*
    Every leaf, not just the first: a `BulkOrder` is one signature over a tree
    of orders and the filler picks the leaf. A fair listing at `tree[0]` beside
    a give-away at `tree[1]` is the whole attack, so the message is judged by
    its worst leaf.
  */
  const giving = d.orders.filter((o) => o.zeroConsideration)
  if (giving.length) {
    const items = giving.reduce((n, o) => n + o.offer.length, 0)
    return {
      code: 'SEAPORT_ZERO_CONSIDERATION',
      severity: 'block',
      title: 'You would give these items away',
      detail:
        d.orders.length > 1
          ? `${giving.length} of the ${d.orders.length} orders in this one signature send your ${items} item${items === 1 ? '' : 's'} to whoever fills them and pay you nothing. This is the "free mint" drain.`
          : `This listing sends your ${items} item${items === 1 ? '' : 's'} to whoever fills it and pays you nothing. This is the "free mint" drain.`,
    }
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
  // Every leaf of a bulk tree, for the reason given in `seaportRules`.
  for (const d of typed.decoded.orders) {
    // The give-away has its own, blunter rule; saying both would be noise.
    if (d.zeroConsideration) continue
    // A listing: exactly one piece leaves, and only native coin comes back.
    if (d.offer.length !== 1) continue
    const item = d.offer[0]
    if (!item || (item.itemType !== SEAPORT_ERC721 && item.itemType !== SEAPORT_ERC1155)) continue
    if (!d.consideration.length || d.consideration.some((c) => c.itemType !== SEAPORT_NATIVE))
      continue
    const floor = context.nftFloors[item.token.toLowerCase()]
    if (floor === undefined || floor <= 0n) continue
    // Every consideration item is a share of one price (seller + creator + platform).
    const total = d.consideration.reduce((sum, c) => sum + c.amount, 0n)
    if (total * SEAPORT_UNDERPRICED_DIVISOR >= floor) continue
    return {
      code: 'SEAPORT_UNDERPRICED',
      severity: 'danger',
      title: 'Far below what this collection sells for',
      detail: `This lists ${label(context, chainId, item.token)} #${item.identifier.toString()} for ${nativeText(chainId, total, context)} while the collection's floor is ${nativeText(chainId, floor, context)}. Whoever fills it keeps the difference.`,
    }
  }
  return null
}

/**
 * A leaf whose `offerer` is not the signing account (§3.4).
 *
 * Seaport takes the offerer's signature, so an order that names somebody else
 * is either useless or the signature is being collected for a tree the user
 * did not build. Either way the sheet should say so before the words "List …"
 * appear, and a bulk tree is where a stranger's leaf hides best.
 */
export const seaportOffererMismatch: Rule = ({ request, typed, account, context, chainId }) => {
  if (request.kind !== 'typed_data' || !typed || typed.decoded.kind !== 'seaport_order') return null
  const strangers = typed.decoded.orders.filter((o) => !sameAddress(o.offerer, account))
  const first = strangers[0]
  if (!first) return null
  return {
    code: 'SEAPORT_OFFERER_MISMATCH',
    severity: 'danger',
    title: 'An order here is not yours to sign',
    detail: `${strangers.length === 1 ? 'One order in this signature names' : `${strangers.length} orders in this signature name`} ${label(context, chainId, first.offerer)} as the seller, not this account.`,
  }
}

/**
 * A fulfilment whose proceeds pay somebody other than the signer (ES-BV-001).
 *
 * Seaport bids name the seller's recipient at bid time and stay valid after
 * the piece changes hands, so the new owner's inbox can hold a perfectly valid
 * bid that transfers the piece to the bidder and the money to the person who
 * sold it to them. Fulfilling that costs the whole piece. The order is only
 * safe to fill when the largest fungible consideration item — the proceeds,
 * with the creator royalty and the marketplace cut necessarily smaller — names
 * the signing account.
 *
 * Only for the sell side: when the signer is buying, the offer carries the
 * piece and the consideration is the price they are paying out, which is meant
 * to reach somebody else.
 */
export const seaportProceedsNotSelf: Rule = ({ request, decoded, account, context, chainId }) => {
  if (request.kind !== 'transaction' || !decoded || decoded.kind !== 'seaport_fulfill') return null
  // Buying: the item comes out of the offer, so the consideration is the price.
  if (decoded.offer.some((o) => o.itemType === SEAPORT_ERC721 || o.itemType === SEAPORT_ERC1155))
    return null
  // Selling: the piece being given up is a consideration item.
  if (
    !decoded.consideration.some(
      (c) => c.itemType === SEAPORT_ERC721 || c.itemType === SEAPORT_ERC1155,
    )
  )
    return null
  const fungible = decoded.consideration.filter(
    (c) => c.itemType !== SEAPORT_ERC721 && c.itemType !== SEAPORT_ERC1155 && c.amount > 0n,
  )
  const proceeds = fungible.reduce<(typeof fungible)[number] | null>(
    (best, c) => (!best || c.amount > best.amount ? c : best),
    null,
  )
  if (!proceeds)
    return {
      code: 'SEAPORT_PROCEEDS_NOT_SELF',
      severity: 'block',
      title: 'This order pays you nothing',
      detail: 'It takes the piece and sends no payment to any address.',
    }
  if (sameAddress(proceeds.recipient, account)) return null
  return {
    code: 'SEAPORT_PROCEEDS_NOT_SELF',
    severity: 'block',
    title: 'The money goes to someone else',
    detail: `This order gives up the piece and pays ${label(context, chainId, proceeds.recipient)} (${proceeds.recipient}), not this account. A bid made before the piece changed hands still names the previous owner.`,
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
    /*
      A revoke is not a grant (ES-BV-029).

      `approve(spender, 0)` takes an allowance *away*, and the Allowances
      screen's own Revoke button sends exactly that — to a spender the wallet
      does not recognise, which is usually why the user is revoking it. The
      sheet said "Allowance for an unknown contract" at `danger` and asked them
      to type the site's name to continue, for the safest transaction in the
      wallet. Teaching people to type the danger word to do the right thing is
      how the danger word stops working.
    */
    if (decoded.amount === 0n && !decoded.unlimited) return null
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
  /*
    The fee on the input side: one transfer to the sink before anything is
    swapped, and no portion of the output at all.

    The assertion is the same one — exactly the pinned recipient, exactly the
    amount the schedule says — moved to the token the user is spending. What it
    must also refuse is a transaction carrying both: a portion of the output as
    well, which would charge the user twice.
  */
  const onInput = expected.onInput
  if (onInput) {
    if (portions.length !== 0)
      return {
        code: 'FEE_TIER_MISMATCH',
        severity: 'block',
        title: 'This swap would pay the fee twice',
        detail:
          'The fee is being taken from what you are spending and from what you receive. BoltVault will not sign it.',
      }
    const paid = decoded.decoded.commands.filter(
      (c) =>
        (c.type === 'PERMIT2_TRANSFER_FROM' || c.type === 'TRANSFER') &&
        sameAddress(c.token, onInput.token) &&
        sameAddress(c.recipient, expected.sink),
    )
    const one = paid[0]
    if (paid.length !== 1 || one === undefined)
      return {
        code: 'FEE_SINK_MISMATCH',
        severity: 'block',
        title: 'The wallet fee is missing',
        detail:
          'This swap does not pay the wallet fee to the pinned recipient. BoltVault will not sign it.',
      }
    const amount = one.type === 'PERMIT2_TRANSFER_FROM' || one.type === 'TRANSFER' ? one.amount : 0n
    if (amount !== onInput.amount)
      return {
        code: 'FEE_TIER_MISMATCH',
        severity: 'block',
        title: 'The fee does not match your tier',
        detail:
          'The amount this swap would pay the wallet is not the amount your tier says. Re-quote and try again.',
      }
    return null
  }
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

/**
 * Every `PAY_PORTION` in a decoded Universal Router call.
 *
 * This used to answer with the first one only, which is exactly one portion
 * short of the attack: a token 1-bip portion to our own pinned sink made the
 * fee rules read "that is our fee, nothing to say", and the 90 % portion to a
 * stranger that followed it raised nothing at all. A command list may carry as
 * many portions as it likes and every one of them is output leaving the user.
 */
function portions(decoded: DecodedCall | null): Array<{ recipient: Hex; bips: bigint }> {
  if (!decoded || decoded.kind !== 'universal_router') return []
  const out: Array<{ recipient: Hex; bips: bigint }> = []
  for (const c of decoded.decoded.commands) {
    if (c.type === 'PAY_PORTION') out.push({ recipient: c.recipient, bips: c.bips })
  }
  return out
}

/**
 * Above this a portion stops being a tip and becomes the swap (§3.4).
 *
 * A site's own fee is a percent or two; a hundred bips is one percent, which
 * is already generous. Beyond it `PAY_PORTION(stranger, 9000)` is a `SWEEP`
 * to a stranger wearing a fee's clothes, and the severity that drives the
 * delay and the typed word should say so.
 */
export const DAPP_PORTION_TIP_MAX_BIPS = 100n

export const dappTipsThirdParty: Rule = ({ request, decoded, origin, chainId, context }) => {
  if (request.kind !== 'transaction' || isInternal(origin)) return null
  /*
    Our own sink is not a third party, whoever built the calldata.

    ElectroSwap's site encodes this fee itself when BoltVault is the connected
    wallet (§8.6), so the bytes that used to mean "some site is tipping a
    stranger" are now the ordinary shape of a swap made on our own web UI.
    Saying "that is the site's fee, not BoltVault's" over our own sink would be
    a plain untruth on the sheet, and §7.10 does not allow one.

    Compared against the chain's pinned recipient rather than against
    `context.walletFee`, so it is right even when the tier could not be read,
    and so a swap from some *other* site that pays our sink is not slandered
    either — it is still our fee, arriving by an unusual road.
  */
  const ours = feeRecipient(chainId)
  // Every portion that is not ours, worst first — the size is what decides
  // whether this is a fee or the swap itself going somewhere else.
  const strangers = portions(decoded)
    .filter((p) => !(ours && sameAddress(p.recipient, ours)))
    .sort((a, b) => (b.bips > a.bips ? 1 : b.bips < a.bips ? -1 : 0))
  const worst = strangers[0]
  if (!worst) return null
  const total = strangers.reduce((sum, p) => sum + p.bips, 0n)
  const big = total > DAPP_PORTION_TIP_MAX_BIPS
  const many = strangers.length > 1
  return {
    code: 'DAPP_TIPS_THIRD_PARTY',
    severity: big ? 'danger' : 'warn',
    title: big
      ? 'This swap pays most of its output to a third party'
      : 'This swap pays a fee to a third party',
    detail: many
      ? `${strangers.length} portions totalling ${(Number(total) / 100).toFixed(2)}% of the output go elsewhere, the largest ${(Number(worst.bips) / 100).toFixed(2)}% to ${label(context, chainId, worst.recipient)}. That is not BoltVault's fee.`
      : `${(Number(worst.bips) / 100).toFixed(2)}% of the output goes to ${label(context, chainId, worst.recipient)}. That is the site's fee, not BoltVault's.`,
  }
}

/**
 * A site charging our fee at more than this account's rung (§8.6, §8.18).
 *
 * The mirror of T10. Our own Swap screen is held to the schedule exactly, and
 * a site that encodes our sink is claiming to do the same — so a portion above
 * what the rung allows is either a stale build, a fork, or someone who has
 * worked out that the sink address is worth over-paying into. All three take
 * the difference out of the user's output, which is the firewall's business.
 *
 * `danger` rather than `block`: the user's own funds, their own decision, and
 * a typed confirmation is enough to make it deliberate. Under-charging raises
 * nothing at all — that costs us revenue, not the user, and a wallet that
 * nagged about paying *less* would be reading as a shakedown.
 */
export const walletFeeOvercharge: Rule = ({ request, decoded, origin, context }) => {
  if (request.kind !== 'transaction' || isInternal(origin)) return null
  const expected = context.walletFee
  if (!expected) return null
  // Summed, not first: two portions of the rung to the same sink charge twice.
  const ours = portions(decoded).filter((p) => sameAddress(p.recipient, expected.sink))
  if (!ours.length) return null
  const bips = ours.reduce((sum, p) => sum + p.bips, 0n)
  if (bips <= BigInt(expected.bips)) return null
  return {
    code: 'WALLET_FEE_OVERCHARGE',
    severity: 'danger',
    title: 'This site is charging more than your fee tier',
    detail: `The swap pays ${(Number(bips) / 100).toFixed(2)}% to the BoltVault fee sink${ours.length > 1 ? `, across ${ours.length} portions` : ''}. Your ${expected.tier} tier is ${(expected.bips / 100).toFixed(2)}%. Swapping in the wallet charges the tier.`,
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

/**
 * What §3.4 fixes "code age < 7 days" at, and what ships in the bundle.
 *
 * It is also the floor a served value is clamped to. A threshold that came from
 * somewhere else may make the wallet more careful, never less: a zero served by
 * a compromised or misconfigured source would switch the warning off entirely,
 * which is the one outcome a user cannot notice.
 */
export const NEW_CONTRACT_DEFAULT_DAYS = 7
/** A year. Past this the warning stops being about newness and starts being noise. */
export const NEW_CONTRACT_MAX_DAYS = 365

/** Keep a served threshold inside the range where it can only help. */
export function clampNewContractDays(served: number | null | undefined): number {
  if (typeof served !== 'number' || !Number.isFinite(served)) return NEW_CONTRACT_DEFAULT_DAYS
  return Math.min(NEW_CONTRACT_MAX_DAYS, Math.max(NEW_CONTRACT_DEFAULT_DAYS, Math.floor(served)))
}

/**
 * The contract a decoded call is actually about.
 *
 * `'to' in decoded` covers the plain shapes, and the Universal Router names
 * its own `router` — but the decoder gives the richer kinds a field of their
 * own (`pool`, `manager`, `farm`, `marketplace`, `distributor`, `minter`), and
 * those are what the transaction talks to. Reading only `to` meant the age and
 * verification check could not fire for a launchpad pool, a bridge router, a
 * limit-order manager, a farm, a marketplace order, dividends or a mint —
 * precisely the kinds whose target comes from an index rather than from the
 * user, and so precisely the ones worth age-checking.
 */
function targetOf(decoded: DecodedCall): Hex | null {
  if ('to' in decoded) return decoded.to
  switch (decoded.kind) {
    case 'universal_router':
      return decoded.router
    case 'launchpad':
      return decoded.pool
    case 'limit_order':
      return decoded.manager
    case 'farm_deposit':
    case 'farm_withdraw':
      return decoded.farm
    case 'seaport_fulfill':
      return decoded.marketplace
    case 'dividends':
      return decoded.distributor
    case 'nft_mint':
      return decoded.minter
    case 'bridge':
      return decoded.router
    default:
      return null
  }
}

export const newContract: Rule = ({ request, decoded, chainId, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  const target = targetOf(decoded)
  if (!target || knownContract(chainId, target)) return null
  const info = context.contracts[target.toLowerCase()]
  if (!info || !info.hasCode) return null
  if (
    info.ageDays !== undefined &&
    info.ageDays !== null &&
    info.ageDays < context.newContractAfterDays
  )
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
    /*
      A bridge destination is a recipient (ES-BV-027).

      Returning null here took the bridge out of every recipient rule at once:
      the lookalike check, the address-poisoning source check, the clipboard
      comparison, the first-time plate and the send allow-list. A bridged send
      is the least reversible transfer the wallet makes — the money lands on
      another chain, at an address that may not exist there — so it is the last
      thing that should be exempt from them.
    */
    case 'bridge':
      return decoded.recipient
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
    detail:
      'At least one call inside this batch is a function BoltVault does not recognise, so what it does cannot be shown.',
  }
}

/** The router's two stand-ins for an address; neither is a third party. */
const UR_SENTINELS = new Set([
  '0x0000000000000000000000000000000000000001',
  '0x0000000000000000000000000000000000000002',
])

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
  /*
    The wallet's own fee is not a stranger, whichever command carries it.

    `PAY_PORTION` was exempt because `feeSinkRules` pins it exactly — the right
    reasoning, applied to only one of the two shapes the fee can take. When the
    output token cannot safely pass through the router's custody the fee is paid
    out of the input instead, by a `PERMIT2_TRANSFER_FROM` or a `TRANSFER` to
    that same pinned sink, and this rule read it as the swap paying somebody
    else — raising a typed confirmation the user had to type out to make their
    own swap. The exemption is the same one, and it is narrow: only the address
    `expectedFee` names, and only when it named one.
  */
  const feeSink = context.expectedFee?.onInput ? context.expectedFee.sink : null
  /*
    A `PAY_PORTION` used to be skipped outright, on the grounds that the fee
    rules pin it. They pin the fee; they say nothing about a portion paid to
    somebody else, which is a `SWEEP` to a stranger by another name. Only the
    chain's own pinned sink is exempt now.
  */
  const pinnedSink = feeRecipient(chainId)
  const recipients: Hex[] = []
  for (const c of decoded.decoded.commands) {
    if (
      feeSink &&
      (c.type === 'PERMIT2_TRANSFER_FROM' || c.type === 'TRANSFER') &&
      sameAddress(c.recipient, feeSink)
    )
      continue
    if (c.type === 'PAY_PORTION') {
      if (!(pinnedSink && sameAddress(c.recipient, pinnedSink))) recipients.push(c.recipient)
      continue
    }
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
 * T1: a router call that swaps into the router's own custody and stops there.
 *
 * `ADDRESS_THIS` is a legitimate recipient — it is how a swap with a fee or an
 * unwrap is built, because the portion and the sweep both come out of what the
 * router is holding. What makes it a shape and not a swap is the delivery that
 * follows. Nothing required one: a `V3_SWAP_EXACT_IN` into the router with no
 * `SWEEP` after it read `info`, and the statement said the output would "be
 * swept below" about a command that did not exist. Whatever the router holds
 * at the end of `execute` belongs to whoever sweeps it next, which on a public
 * chain is a searcher in the same block.
 */
export const urOutputStranded: Rule = ({ decoded, context, chainId, account }) => {
  if (decoded?.kind !== 'universal_router') return null
  const cmds = decoded.decoded.commands
  const own = [account, ...context.own]
  const mine = (a: Hex): boolean =>
    a.toLowerCase() === UR_MSG_SENDER.toLowerCase() || own.some((o) => sameAddress(o, a))
  const stranded = (): string | null => {
    for (let i = 0; i < cmds.length; i++) {
      const c = cmds[i]
      if (!c || !isUrSwap(c)) continue
      if (c.recipient.toLowerCase() !== UR_ROUTER_SELF.toLowerCase()) continue
      const [, tout] = urPathTokens(c)
      if (!urDeliveredAfter(cmds, i, tout, mine))
        return tout === 'native' ? 'the output' : label(context, chainId, tout)
    }
    /*
      The other half of the same hole: an exact-out swap paid for with wrapped
      native takes less than was wrapped, and the change sits in the router
      unless an `UNWRAP_WETH` refunds it.
    */
    const wrapped = cmds.findIndex((c) => c.type === 'WRAP_ETH')
    if (
      wrapped >= 0 &&
      cmds.some((c) => c.type === 'V2_SWAP_EXACT_OUT' || c.type === 'V3_SWAP_EXACT_OUT') &&
      !cmds.some((c, i) => i > wrapped && c.type === 'UNWRAP_WETH' && mine(c.recipient))
    )
      return 'the change from what was wrapped'
    return null
  }
  const what = stranded()
  if (!what) return null
  return {
    code: 'UR_OUTPUT_STRANDED',
    severity: 'danger',
    title: 'This swap leaves its output in the router',
    detail: `${what === 'the output' ? 'The output' : what} is swapped into the router and nothing in this call sends it on to you. Whoever sweeps the router next keeps it.`,
  }
}

/** The Universal Router's "spend whatever you are holding" sentinel (`Constants.CONTRACT_BALANCE`, 1 << 255). */
const UR_CONTRACT_BALANCE = 1n << 255n

/**
 * T1: a minimum-out so far below the input that it is not a floor at all.
 *
 * Six orders of magnitude of slack, which is decimals-agnostic and therefore
 * safe as a heuristic: no honest pair is off by a million. It catches the
 * drainer shape of "accept literally one wei in return", which is otherwise
 * indistinguishable from a sane minimum once the amounts are raw integers.
 *
 * The two numbers come from opposite ends of the route, because a mixed route
 * is encoded as one command per protocol run and neither end alone carries
 * both. The amount actually being spent is on the FIRST swap; every section
 * after it is paid `CONTRACT_BALANCE`, which is 1 << 255 and would make the
 * threshold astronomically large — every honest swap would read as implausible.
 * The only real floor is on the LAST swap; the sections before it carry a
 * minimum of zero, because their output is an intermediate token in an amount
 * nobody knows until the pools answer, and reading those as floors flagged
 * every honest V2→V3 trade. Chaining through the router is what makes the pair
 * meaningful: the last section's minimum bounds the whole route, and the first
 * section's input is what the user is putting in. A single-command swap is the
 * case where both are the same command, which is how this rule began.
 */
export const swapMinOutImplausible: Rule = ({ decoded, context, account, chainId }) => {
  if (decoded?.kind !== 'universal_router') return null
  const swaps = decoded.decoded.commands.filter(
    (c) => c.type === 'V2_SWAP_EXACT_IN' || c.type === 'V3_SWAP_EXACT_IN',
  )
  const first = swaps[0]
  const last = swaps[swaps.length - 1]
  if (first?.type !== 'V2_SWAP_EXACT_IN' && first?.type !== 'V3_SWAP_EXACT_IN') return null
  if (last?.type !== 'V2_SWAP_EXACT_IN' && last?.type !== 'V3_SWAP_EXACT_IN') return null
  // A first section paid from the router's balance names no size, so there is nothing to compare against.
  if (first.amountIn === UR_CONTRACT_BALANCE || first.amountIn <= 0n) return null
  /*
    Whole tokens, not base units.

    The comparison used to be `amountOut <= amountIn / 1_000_000`, on two raw
    integers. That is only decimals-agnostic when both sides carry the same
    decimals: one ETN in is 10^18 and a correct minimum of 2 932 USDC out is
    2.9 × 10^9, so every honest ETN → USDC swap — the wallet's own included —
    came out `danger` with a typed word to copy. Users who are asked to type a
    danger word on every ordinary swap learn to type it, which is how the gate
    that ATT-BV-004 and ATT-BV-005 lean on gets worn away. The same
    arithmetic reversed misses the real case: a floor of 10^6 wei against one
    USDC in is 10^-12 of a coin, and passed.

    Decimals the wallet does not know are a reason to say nothing, never a
    reason to fall back to raw units — that is the false positive again.
  */
  const [tin] = urPathTokens(first)
  const [, tout] = urPathTokens(last)
  const dec = (t: 'native' | Hex): number | null => {
    if (t === 'native') return 18
    const known = context.tokens[t.toLowerCase()]
    if (known) return known.decimals
    // Wrapped native is eighteen by definition on every chain in the registry.
    return knownContract(chainId, t)?.role === 'wrapped_native' ? 18 : null
  }
  const dIn = dec(tin)
  const dOut = dec(tout)
  if (dIn === null || dOut === null) return null
  /*
    A floor only protects what comes back to you. When the last section pays a
    stranger there is nothing to bound, and `UR_RECIPIENT_NOT_SELF` /
    `UR_OUTPUT_STRANDED` are the findings that fit.
  */
  const own = [account, ...context.own]
  const r = last.recipient.toLowerCase()
  const deliverable =
    r === UR_MSG_SENDER.toLowerCase() ||
    r === UR_ROUTER_SELF.toLowerCase() ||
    own.some((o) => sameAddress(o, last.recipient))
  if (!deliverable) return null
  // minOut / 10^dOut <= (amountIn / 10^dIn) × 10^-6, in integers.
  if (last.amountOut * 10n ** BigInt(dIn) * 1_000_000n <= first.amountIn * 10n ** BigInt(dOut))
    return {
      code: 'SWAP_MIN_OUT_IMPLAUSIBLE',
      severity: 'danger',
      title: 'This swap accepts almost nothing in return',
      detail:
        'The smallest amount this swap will accept is so far below what you are putting in that it offers no protection at all. This is a rule of thumb, not a price check.',
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

/** The threshold a wallet with no stored spend policy uses (§3.4 point 6's own example). */
export const DEFAULT_LARGE_SEND_PERCENT = 10

/**
 * The large-send step-up (§3.4 point 6, Settings › Spending).
 *
 * The threshold was a tenth of the balance written into the comparison, with
 * no setting behind it — §8.14 lists "large-send step-up threshold (in token
 * units)" as a Spending row, and there was nothing to turn. It is a share of
 * the balance of the token being moved, so `amount * 100 > percent * balance`
 * is arithmetic in that token's own base units: integers throughout, no
 * division, and no price anywhere near the decision. A fiat threshold would
 * hand a display-only feed (§2.8) the power to decide when this wallet asks
 * for a second factor.
 *
 * `needsStepUp` in the wallet keys off the CODE, so the sheet keeps asking the
 * vault to open again whatever the threshold is set to.
 */
export const largeSend: Rule = ({ request, decoded, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  const percent = BigInt(context.spendPolicy?.largeSendPercent ?? DEFAULT_LARGE_SEND_PERCENT)
  const over = (amount: bigint, balance: bigint | undefined): boolean =>
    balance !== undefined && balance > 0n && amount * 100n > percent * balance
  const moved =
    decoded.kind === 'native_transfer'
      ? { amount: decoded.value, balance: context.balances['native'] }
      : decoded.kind === 'erc20_transfer'
        ? { amount: decoded.amount, balance: context.balances[decoded.token.toLowerCase()] }
        : null
  if (!moved || !over(moved.amount, moved.balance)) return null
  return {
    code: 'LARGE_SEND',
    severity: 'warn',
    title: `More than ${percent}% of your balance`,
    detail: 'Large sends ask for a second look. Confirm the recipient once more.',
  }
}

/**
 * The send allow-list (§3.4 point 6, Settings › Spending).
 *
 * Only transfers the decoder can read as transfers. A contract call has no
 * recipient in the sense a person means by the word, and refusing every dApp
 * interaction because a *send* list is on would make the setting something
 * nobody leaves on — which is worse than not offering it.
 *
 * The user's own accounts are always allowed: a list you cannot move your own
 * money across is a list that gets switched off the first time you try.
 */
export const sendAllowList: Rule = ({ request, decoded, context }) => {
  if (request.kind !== 'transaction' || !decoded) return null
  const policy = context.spendPolicy
  if (!policy?.allowListOnly) return null
  if (
    decoded.kind !== 'native_transfer' &&
    decoded.kind !== 'erc20_transfer' &&
    decoded.kind !== 'erc721_transfer' &&
    decoded.kind !== 'erc1155_transfer'
  )
    return null
  const to = recipientOf(decoded)
  if (!to) return null
  if (inSet(to, [...policy.allowList, ...context.own])) return null
  return {
    code: 'RECIPIENT_NOT_ALLOWED',
    severity: 'block',
    title: 'This address is not on your send list',
    detail:
      'You asked BoltVault to send only to addresses you have listed. Add this one in Settings › Spending if you meant it, or turn the list off there.',
  }
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
    detail: `${who} has ${nativeText(chainId, remaining)} left of the ${nativeText(chainId, budget.limit)} you allowed it, and this asks for ${nativeText(chainId, request.tx.value, context)}. Raise the limit in Settings › Connected sites if you meant to.`,
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
    /*
      Said as a fact about the preview, not about the transaction.

      "Preview shows no balance changes" sat directly under statements listing
      what the transaction moves, and read as a flat contradiction of them — as
      though the wallet had looked and found nothing. It had not looked: the
      statements are read out of the calldata, and the simulation that would have
      confirmed them independently is the part that did not run.
    */
    return {
      code: 'SIM_INCOMPLETE',
      severity: 'warn',
      title: 'Balance changes could not be simulated',
      detail:
        'This network could not preview the result, so only the revert check ran. What is listed above is read from the transaction itself.',
    }
  }
  return null
}

/**
 * How far above the node's own price a dApp-supplied fee goes before it is
 * worth a sentence, and before it is worth a typed word.
 *
 * The gas editor's band is 50–400 % of what the transaction carries, so a dApp
 * that sets fifty times the going rate does not move the band up — it moves
 * the whole band, and the editor cannot bring the price back down to anything
 * sane. Double is already outside honest variance; ten times is a decimal
 * point somebody put in the wrong place, or meant to.
 */
export const FEE_WARN_MULTIPLE = 2n
export const FEE_DANGER_MULTIPLE = 10n

/**
 * A price per unit of gas the site chose, well above the one the node
 * suggested (§3.4).
 *
 * `prepare()` honours `gasPrice`/`maxFeePerGas` when a request carries them,
 * and the fee editor then anchors its band on that number rather than on the
 * node's — so a site could make the cheapest signable fee twenty-five times
 * the going rate and the sheet said nothing at all. It still signs; it is the
 * user's own coin and their own decision. It just no longer does so quietly.
 */
export const feeExcessive: Rule = ({ request, context, chainId }) => {
  if (request.kind !== 'transaction') return null
  const f = context.supplied?.perGas
  if (!f || f.node <= 0n || f.theirs <= f.node * FEE_WARN_MULTIPLE) return null
  const total = f.theirs * f.gasLimit
  // "More than what it moves" only means anything when something is moving.
  const overValue = request.tx.value > 0n && total > request.tx.value
  const wild = f.theirs > f.node * FEE_DANGER_MULTIPLE
  const times = Number((f.theirs * 10n) / f.node) / 10
  return {
    code: 'FEE_EXCESSIVE',
    severity: wild || overValue ? 'danger' : 'warn',
    title: 'This site set the fee, and set it high',
    detail: `It asks to pay ${nativeText(chainId, total, context)} in network fees — ${times}× what this network is currently charging${overValue ? `, more than the ${nativeText(chainId, request.tx.value, context)} being sent` : ''}. The fee editor cannot go below half of what the site chose.`,
  }
}

/**
 * A nonce the site chose that is not this account's next one (§3.4).
 *
 * A nonce above the pending count does not fail — it sits in the pool as a
 * gap, and executes whenever later sends happen to fill it in, which may be
 * weeks later and at a price nobody is watching. One below has already been
 * used. Either way the transaction the user approved is not the transaction
 * that is about to happen, and the number belongs on the sheet rather than
 * inside the collapsed details.
 */
export const nonceNotNext: Rule = ({ request, context }) => {
  if (request.kind !== 'transaction') return null
  const n = context.supplied?.nonce
  if (!n || n.theirs === n.next) return null
  return {
    code: 'NONCE_NOT_NEXT',
    severity: 'warn',
    title:
      n.theirs > n.next
        ? 'This transaction would wait its turn'
        : 'This transaction uses a used number',
    detail:
      n.theirs > n.next
        ? `The site asked for position ${n.theirs} in this account's queue; the next free one is ${n.next}. It will not execute until ${n.theirs - n.next} more transaction${n.theirs - n.next === 1 ? '' : 's'} from this account have gone out — which could be a long time from now, at a price nobody is watching.`
        : `The site asked for position ${n.theirs} in this account's queue, which has already been used. The next free one is ${n.next}.`,
  }
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
  originVerifyMismatch,
  originFirstTime,
  originCleartext,
  ethSignBlocked,
  personalSignLooksLikeTx,
  typedDataDomainMismatch,
  typedDataUnknown,
  permit2Rules,
  erc2612Rules,
  seaportRules,
  seaportUnderpriced,
  seaportOffererMismatch,
  seaportProceedsNotSelf,
  authorizationList,
  chainMismatch,
  approveRules,
  feeSinkRules,
  bridgeRecipientRule,
  dappTipsThirdParty,
  walletFeeOvercharge,
  urRecipientNotSelf,
  urOutputStranded,
  swapMinOutImplausible,
  feeExcessive,
  nonceNotNext,
  multicallOpaque,
  unknownFunction,
  newContract,
  recipientRules,
  clipboardHijack,
  sendAllowList,
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
