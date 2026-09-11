/**
 * The rules that had a code and no test: `NEW_CONTRACT` (both branches were
 * unreachable because the engine never filled in age or verification),
 * `SEAPORT_UNDERPRICED` (declared and emitted by nothing), `VALUE_EXCEEDS_BUDGET`
 * and the §3.6 clipboard check.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { describe, expect, it } from 'vitest'
import type { Hex } from 'viem'
import { assess, emptyContext, type AssessmentInput } from '../src/assess'
import { clipboardCheck, CLIPBOARD_WINDOW_MS } from '../src/clipboard'
import type { SignRequest } from '../src/types'

const A = ELECTRONEUM_ADDRESSES[52014]
const UNKNOWN = '0x2222222222222222222222222222222222222222' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex
const COLLECTION = '0x4444444444444444444444444444444444444444' as Hex
const COPIED = '0x7777777777777777777777777777777777777777' as Hex
const ORIGIN = 'https://app.example.com'
const ONE = 10n ** 18n

function run(request: SignRequest, ctx: Partial<Parameters<typeof emptyContext>[0]> = {}, origin = ORIGIN) {
  const input: AssessmentInput = { origin, chainId: 52014, account: ME, request, context: emptyContext(ctx) }
  return assess(input)
}

const tx = (to: Hex, data: Hex, value = 0n): SignRequest => ({ kind: 'transaction', tx: { from: ME, to, data, value, chainId: 52014 } })
const codes = (a: ReturnType<typeof assess>) => a.rules.map((r) => r.code)

describe('NEW_CONTRACT (§3.4)', () => {
  const call = tx(UNKNOWN, '0xdeadbeef')
  it('warns on code younger than a week, or with no verified source', () => {
    // hasCode alone says nothing — that was the whole bug: both branches were dead.
    expect(codes(run(call, { contracts: { [UNKNOWN]: { hasCode: true } } }))).not.toContain('NEW_CONTRACT')
    expect(codes(run(call, { contracts: { [UNKNOWN]: { hasCode: true, ageDays: 2, verified: true } } }))).toContain('NEW_CONTRACT')
    expect(codes(run(call, { contracts: { [UNKNOWN]: { hasCode: true, ageDays: 400, verified: false } } }))).toContain('NEW_CONTRACT')
    expect(codes(run(call, { contracts: { [UNKNOWN]: { hasCode: true, ageDays: 400, verified: true } } }))).not.toContain('NEW_CONTRACT')
  })
})

describe('SEAPORT_UNDERPRICED (§3.4)', () => {
  const wei = (n: bigint): string => (n * ONE).toString()
  /** A listing the way the marketplace builds it: one piece out, one price split seller / platform. */
  const listing = (totalEtn: bigint): SignRequest => ({
    kind: 'typed_data',
    from: ME,
    typedData: {
      types: {},
      primaryType: 'OrderComponents',
      domain: { chainId: 52014, verifyingContract: A.seaport15 },
      message: {
        offerer: ME,
        offer: [{ itemType: 2, token: COLLECTION, identifierOrCriteria: '12', startAmount: '1' }],
        consideration: [
          { itemType: 0, token: '0x0000000000000000000000000000000000000000', identifierOrCriteria: '0', startAmount: wei(totalEtn - totalEtn / 10n), recipient: ME },
          { itemType: 0, token: '0x0000000000000000000000000000000000000000', identifierOrCriteria: '0', startAmount: wei(totalEtn / 10n), recipient: UNKNOWN },
        ],
      },
    },
  })
  const nftFloors = { [COLLECTION.toLowerCase()]: 40n * ONE }

  it('is danger at a tenth of the floor or less, and silent on an ordinary discount', () => {
    const cheap = run(listing(2n), { nftFloors })
    expect(codes(cheap)).toContain('SEAPORT_UNDERPRICED')
    expect(cheap.severity).toBe('danger')
    expect(codes(run(listing(20n), { nftFloors }))).not.toContain('SEAPORT_UNDERPRICED')
  })

  it('says nothing when no floor is known — there is nothing to be cheap against', () => {
    expect(codes(run(listing(2n)))).not.toContain('SEAPORT_UNDERPRICED')
  })
})

describe('VALUE_EXCEEDS_BUDGET (§4.6)', () => {
  const spend = (value: bigint): SignRequest => tx(UNKNOWN, '0x', value)
  it('fires on what is left, not on the cap, and never without a budget', () => {
    expect(codes(run(spend(2n * ONE)))).not.toContain('VALUE_EXCEEDS_BUDGET')
    expect(codes(run(spend(2n * ONE), { originBudget: { limit: 3n * ONE, spent: 0n } }))).not.toContain('VALUE_EXCEEDS_BUDGET')
    const over = run(spend(2n * ONE), { originBudget: { limit: 3n * ONE, spent: 2n * ONE } })
    expect(codes(over)).toContain('VALUE_EXCEEDS_BUDGET')
    expect(over.severity).toBe('danger')
  })
})

describe('the clipboard check (§3.6)', () => {
  const send = (to: Hex): SignRequest => tx(to, '0x', 10n)
  const now = 1_700_000_000_000

  it('is danger when the recipient is not what the wallet copied a moment ago', () => {
    const a = run(send(UNKNOWN), { now, lastCopiedAddress: { address: COPIED, at: now - 5_000 } })
    expect(codes(a)).toContain('CLIPBOARD_MISMATCH')
    expect(a.severity).toBe('danger')
  })

  it('stays quiet for the copied address, a stale copy, no copy, or an address already used', () => {
    expect(codes(run(send(COPIED), { now, lastCopiedAddress: { address: COPIED, at: now - 5_000 } }))).not.toContain('CLIPBOARD_MISMATCH')
    expect(codes(run(send(UNKNOWN), { now, lastCopiedAddress: { address: COPIED, at: now - CLIPBOARD_WINDOW_MS - 1 } }))).not.toContain('CLIPBOARD_MISMATCH')
    expect(codes(run(send(UNKNOWN), { now }))).not.toContain('CLIPBOARD_MISMATCH')
    expect(codes(run(send(UNKNOWN), { now, sentTo: [UNKNOWN], lastCopiedAddress: { address: COPIED, at: now - 5_000 } }))).not.toContain('CLIPBOARD_MISMATCH')
  })

  it('the helper ignores a record from the future — that is a moved clock, not evidence', () => {
    expect(clipboardCheck(UNKNOWN, { address: COPIED, at: now + 10_000 }, now).mismatch).toBe(false)
    expect(clipboardCheck(UNKNOWN, null, now).copied).toBeNull()
    expect(clipboardCheck(COPIED.toUpperCase(), { address: COPIED, at: now }, now).mismatch).toBe(false)
  })
})
