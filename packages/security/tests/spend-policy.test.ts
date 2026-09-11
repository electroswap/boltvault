/**
 * The spend policy of master plan §3.4 point 6: a large-send threshold the
 * user sets, expressed in token units, and a send allow-list the firewall
 * actually consults.
 *
 * Both were named in Settings › Spending and performed by nothing: the
 * threshold was a tenth of the balance written into the rule with no setting
 * behind it, and `sendWhitelist` was a stored boolean that a repo-wide search
 * found only at its own declaration sites.
 */
import { encodeFunctionData, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { ERC20_ABI, ERC721_ABI } from '../src/abis'
import { assess, emptyContext, type AssessmentInput } from '../src/assess'
import type { SignRequest, SpendPolicy } from '../src/types'

const ME = '0x3333333333333333333333333333333333333333' as Hex
const FRIEND = '0x4444444444444444444444444444444444444444' as Hex
const STRANGER = '0x5555555555555555555555555555555555555555' as Hex
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const ORIGIN = 'https://app.example.com'

function run(request: SignRequest, ctx: Partial<Parameters<typeof emptyContext>[0]> = {}) {
  const input: AssessmentInput = { origin: ORIGIN, chainId: 52014, account: ME, request, context: emptyContext(ctx) }
  return assess(input)
}
const codes = (a: ReturnType<typeof assess>): string[] => a.rules.map((r) => r.code)
const send = (to: Hex, value: bigint): SignRequest => ({ kind: 'transaction', tx: { from: ME, to, data: '0x', value, chainId: 52014 } })
const sendToken = (to: Hex, amount: bigint): SignRequest => ({ kind: 'transaction', tx: { from: ME, to: TOKEN, data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [to, amount] }), value: 0n, chainId: 52014 } })
const policy = (over: Partial<SpendPolicy> = {}): SpendPolicy => ({ largeSendPercent: 10, allowList: [], allowListOnly: false, ...over })

describe('the large-send threshold', () => {
  it('is a tenth of the balance when nothing has been set', () => {
    // The default has to stay what §3.4's own example says, so a wallet that
    // has never opened Spending behaves exactly as it did before.
    expect(codes(run(send(FRIEND, 11n), { balances: { native: 100n }, sentTo: [FRIEND] }))).toContain('LARGE_SEND')
    expect(codes(run(send(FRIEND, 9n), { balances: { native: 100n }, sentTo: [FRIEND] }))).not.toContain('LARGE_SEND')
  })

  it('follows the setting, up and down', () => {
    const half = { balances: { native: 100n }, sentTo: [FRIEND], spendPolicy: policy({ largeSendPercent: 50 }) }
    expect(codes(run(send(FRIEND, 40n), half))).not.toContain('LARGE_SEND')
    expect(codes(run(send(FRIEND, 60n), half))).toContain('LARGE_SEND')

    const strict = { balances: { native: 100n }, sentTo: [FRIEND], spendPolicy: policy({ largeSendPercent: 5 }) }
    expect(codes(run(send(FRIEND, 6n), strict))).toContain('LARGE_SEND')
  })

  it('says which share it is, so the sheet is not lying about the rule that fired', () => {
    const a = run(send(FRIEND, 30n), { balances: { native: 100n }, sentTo: [FRIEND], spendPolicy: policy({ largeSendPercent: 25 }) })
    expect(a.rules.find((r) => r.code === 'LARGE_SEND')?.title).toContain('25%')
  })

  it('measures a token send against that token, not against the coin', () => {
    const ctx = { balances: { native: 10n ** 18n, [TOKEN.toLowerCase()]: 1_000n }, sentTo: [FRIEND], tokens: { [TOKEN.toLowerCase()]: { symbol: 'BOLT', decimals: 18 } }, spendPolicy: policy({ largeSendPercent: 25 }) }
    expect(codes(run(sendToken(FRIEND, 300n), ctx))).toContain('LARGE_SEND')
    expect(codes(run(sendToken(FRIEND, 200n), ctx))).not.toContain('LARGE_SEND')
  })

  it('never asks a price: an unknown balance cannot be a large send', () => {
    expect(codes(run(sendToken(FRIEND, 10n ** 30n), { sentTo: [FRIEND] }))).not.toContain('LARGE_SEND')
  })
})

describe('the send allow-list', () => {
  const on = (allowList: readonly Hex[]) => ({ sentTo: [FRIEND, STRANGER], spendPolicy: policy({ allowList, allowListOnly: true }) })

  it('does nothing while it is off', () => {
    expect(codes(run(send(STRANGER, 1n), { sentTo: [STRANGER], spendPolicy: policy({ allowList: [FRIEND] }) }))).not.toContain('RECIPIENT_NOT_ALLOWED')
  })

  it('blocks a transfer to an address that is not on it', () => {
    const a = run(send(STRANGER, 1n), on([FRIEND]))
    expect(codes(a)).toContain('RECIPIENT_NOT_ALLOWED')
    expect(a.severity).toBe('block')
    expect(a.presentation.blocked).toBe(true)
  })

  it('lets a listed address through', () => {
    expect(codes(run(send(FRIEND, 1n), on([FRIEND])))).not.toContain('RECIPIENT_NOT_ALLOWED')
  })

  it('always allows your own accounts, so the list cannot strand you', () => {
    const mine = '0x6666666666666666666666666666666666666666' as Hex
    expect(codes(run(send(mine, 1n), { ...on([FRIEND]), own: [mine] }))).not.toContain('RECIPIENT_NOT_ALLOWED')
  })

  it('covers tokens and collectibles, not only the coin', () => {
    expect(codes(run(sendToken(STRANGER, 1n), on([FRIEND])))).toContain('RECIPIENT_NOT_ALLOWED')
    const nft: SignRequest = { kind: 'transaction', tx: { from: ME, to: TOKEN, data: encodeFunctionData({ abi: ERC721_ABI, functionName: 'safeTransferFrom', args: [ME, STRANGER, 7n] }), value: 0n, chainId: 52014 } }
    expect(codes(run(nft, on([FRIEND])))).toContain('RECIPIENT_NOT_ALLOWED')
  })

  it('leaves contract calls to the rest of the firewall', () => {
    // A list of people you pay says nothing about a contract, and refusing
    // every dApp interaction would make the setting one nobody leaves on.
    const call: SignRequest = { kind: 'transaction', tx: { from: ME, to: STRANGER, data: '0xdeadbeef', value: 0n, chainId: 52014 } }
    expect(codes(run(call, on([FRIEND])))).not.toContain('RECIPIENT_NOT_ALLOWED')
  })
})
