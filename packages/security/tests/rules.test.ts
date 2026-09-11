import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { encodeAbiParameters, encodeFunctionData, maxUint256, parseAbiParameters, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { ERC20_ABI, ERC721_ABI, MULTICALL3_ABI, UNIVERSAL_ROUTER_ABI } from '../src/abis'
import { assess, emptyContext, type AssessmentInput } from '../src/assess'
import { UR_COMMAND } from '../src/ur'
import type { SignRequest } from '../src/types'

const A = ELECTRONEUM_ADDRESSES[52014]
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const UNKNOWN = '0x2222222222222222222222222222222222222222' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex
const ORIGIN = 'https://app.example.com'

function run(request: SignRequest, ctx: Partial<Parameters<typeof emptyContext>[0]> = {}, origin = ORIGIN) {
  const input: AssessmentInput = { origin, chainId: 52014, account: ME, request, context: emptyContext(ctx) }
  return assess(input)
}

const tx = (to: Hex, data: Hex, value = 0n): SignRequest => ({ kind: 'transaction', tx: { from: ME, to, data, value, chainId: 52014 } })
const codes = (a: ReturnType<typeof assess>) => a.rules.map((r) => r.code)

describe('approvals', () => {
  it('unlimited approve to an unknown spender is danger with a typed confirmation', () => {
    const a = run(tx(TOKEN, encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [UNKNOWN, maxUint256] })))
    expect(codes(a)).toContain('APPROVE_UNKNOWN_SPENDER')
    expect(a.severity).toBe('danger')
    expect(a.presentation.typedConfirmation).toBe('app.example.com')
  })
  it('exact approve to Permit2 is clean; unlimited is a warning with a delay', () => {
    const exact = run(tx(TOKEN, encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [A.permit2 as Hex, 1000n] })))
    expect(exact.severity).toBe('info')
    const unlimited = run(tx(TOKEN, encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [A.permit2 as Hex, maxUint256] })))
    expect(codes(unlimited)).toEqual(['APPROVE_UNLIMITED'])
    expect(unlimited.presentation.delayMs).toBe(1500)
  })
  it('setApprovalForAll to an unknown operator is danger; to the marketplace conduit a warning', () => {
    const bad = run(tx(TOKEN, encodeFunctionData({ abi: ERC721_ABI, functionName: 'setApprovalForAll', args: [UNKNOWN, true] })))
    expect(bad.severity).toBe('danger')
    const ok = run(tx(TOKEN, encodeFunctionData({ abi: ERC721_ABI, functionName: 'setApprovalForAll', args: ['0x2941Cba4DD14B2C67b0802107f23144c70ED680F', true] })))
    expect(ok.severity).toBe('warn')
  })
})

describe('permit family', () => {
  const typed = (primaryType: string, message: Record<string, unknown>, types: Record<string, Array<{ name: string; type: string }>> = {}, domain: Record<string, unknown> = { chainId: 52014 }): SignRequest => ({
    kind: 'typed_data',
    from: ME,
    typedData: { types, primaryType, domain, message },
  })
  it('PermitTransferFrom to an unknown spender is blocked', () => {
    const a = run(typed('PermitTransferFrom', { permitted: { token: TOKEN, amount: '1' }, spender: UNKNOWN, nonce: 1, deadline: 1 }))
    expect(codes(a)).toContain('PERMIT2_SIGNATURE_TRANSFER')
    expect(a.presentation.blocked).toBe(true)
  })
  it('PermitSingle to the Universal Router is only warned when unlimited', () => {
    const ok = run(typed('PermitSingle', { details: { token: TOKEN, amount: '1000', expiration: 1, nonce: 0 }, spender: A.universalRouter, sigDeadline: 1 }))
    expect(ok.severity).toBe('info')
    const unlimited = run(typed('PermitSingle', { details: { token: TOKEN, amount: ((1n << 160n) - 1n).toString(), expiration: 1, nonce: 0 }, spender: A.universalRouter, sigDeadline: 1 }))
    expect(codes(unlimited)).toContain('PERMIT2_UNLIMITED')
  })
  it('an ERC-2612 permit to a personal address is blocked', () => {
    const a = run(typed('Permit', { owner: ME, spender: UNKNOWN, value: '5', nonce: 0, deadline: 1 }, { Permit: [{ name: 'owner', type: 'address' }] }), { contracts: { [UNKNOWN]: { hasCode: false } } })
    expect(codes(a)).toContain('PERMIT_TO_EOA')
  })
  it('a DAI permit with allowed=true to an unknown spender is danger', () => {
    const a = run(typed('Permit', { holder: ME, spender: UNKNOWN, nonce: 0, expiry: 0, allowed: true }, { Permit: [{ name: 'holder', type: 'address' }, { name: 'allowed', type: 'bool' }] }))
    expect(codes(a)).toContain('DAI_PERMIT_ALLOWED')
  })
  it('unknown typed data is never info', () => {
    const a = run(typed('Ping', { note: 'hi' }))
    expect(codes(a)).toContain('TYPED_DATA_UNKNOWN')
    expect(a.severity).toBe('warn')
  })
  it('a domain for another chain is danger', () => {
    const a = run(typed('Ping', { note: 'hi' }, {}, { chainId: 1 }))
    expect(codes(a)).toContain('TYPED_DATA_DOMAIN_MISMATCH')
  })
  it('a Seaport order with zero consideration is blocked', () => {
    const a = run(
      typed('OrderComponents', { offerer: ME, offer: [{ itemType: 2, token: TOKEN, identifierOrCriteria: '1', startAmount: '1' }], consideration: [] }, {}, { chainId: 52014, verifyingContract: A.seaport15 }),
    )
    expect(codes(a)).toContain('SEAPORT_ZERO_CONSIDERATION')
    expect(a.presentation.blocked).toBe(true)
  })
})

describe('messages', () => {
  it('eth_sign is blocked unless enabled, then danger', () => {
    const req: SignRequest = { kind: 'eth_sign', from: ME, hash: `0x${'aa'.repeat(32)}` }
    expect(run(req).severity).toBe('block')
    expect(run(req, { ethSignEnabled: true }).severity).toBe('danger')
  })
  it('personal_sign of a hash is blocked; text is fine', () => {
    expect(run({ kind: 'message', from: ME, message: `0x${'aa'.repeat(32)}` }).severity).toBe('block')
    const text = run({ kind: 'message', from: ME, message: `0x${Buffer.from('hello').toString('hex')}` })
    expect(text.severity).toBe('info')
    expect(text.statements[0]?.text).toBe('hello')
  })
})

describe('recipients', () => {
  const send = (to: Hex): SignRequest => tx(to, '0x', 10n)
  it('a lookalike of an address you sent to is blocked', () => {
    const known = '0x1234aaaa56789012345678901234567890123456' as Hex
    const a = run(send('0x1234bbbb56789012345678901234567890123456'), { sentTo: [known] })
    expect(codes(a)).toContain('RECIPIENT_LOOKALIKE')
    expect(a.presentation.blocked).toBe(true)
  })
  it('an inbound-only dust sender is danger, not a reference', () => {
    const duster = '0x9999aaaa56789012345678901234567890129999' as Hex
    const a = run(send(duster), { inboundOnly: [duster] })
    expect(codes(a)).toContain('RECIPIENT_POISON_SOURCE')
    // Pasting the legitimate address must not be blocked because a duster imitated it.
    const legit = '0x9999cccc56789012345678901234567890129999' as Hex
    expect(codes(run(send(legit), { inboundOnly: [duster] }))).not.toContain('RECIPIENT_LOOKALIKE')
  })
  it('first-time recipients are info; contracts are warned', () => {
    expect(codes(run(send(UNKNOWN)))).toEqual(['RECIPIENT_FIRST_TIME'])
    expect(codes(run(send(UNKNOWN), { contracts: { [UNKNOWN]: { hasCode: true } } }))).toContain('RECIPIENT_IS_CONTRACT')
  })
  it('sending more than a tenth of the balance is warned', () => {
    expect(codes(run(send(UNKNOWN), { balances: { native: 50n }, sentTo: [UNKNOWN] }))).toContain('LARGE_SEND')
  })
})

describe('transactions', () => {
  it('EIP-7702 delegation is blocked', () => {
    const a = run({ kind: 'transaction', tx: { from: ME, to: UNKNOWN, data: '0x', value: 0n, chainId: 52014, authorizationList: [{}] } })
    expect(a.presentation.blocked).toBe(true)
  })
  it('a chain mismatch is blocked', () => {
    const a = run({ kind: 'transaction', tx: { from: ME, to: UNKNOWN, data: '0x', value: 0n, chainId: 1 } })
    expect(codes(a)).toContain('CHAIN_MISMATCH')
  })
  it('a dApp swap that tips a third party is warned; the same bytes from our swap are not', () => {
    const commands = `0x${UR_COMMAND.PAY_PORTION.toString(16).padStart(2, '0')}` as Hex
    const inputs = [encodeAbiParameters(parseAbiParameters('address, address, uint256'), [TOKEN, UNKNOWN, 50n])]
    const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
    expect(codes(run(tx(A.universalRouter as Hex, data)))).toContain('DAPP_TIPS_THIRD_PARTY')
    expect(codes(run(tx(A.universalRouter as Hex, data), {}, 'internal:swap'))).not.toContain('DAPP_TIPS_THIRD_PARTY')
  })
  /*
    The drainer shape: swap the user's balance into the router, then sweep it
    to someone else. Both commands were silent — `SWEEP` had no statement arm
    at all and the swap arm never read its `recipient` — so the sheet's only
    line was "Swap N units for at least 1 units" at `info` severity, with no
    delay and no typed confirmation. One tap and the input was gone.
  */
  it('a router call that sweeps the output to a stranger is named and blocked', () => {
    const commands = `0x${[UR_COMMAND.V3_SWAP_EXACT_IN, UR_COMMAND.SWEEP].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
    const path = `0x${TOKEN.slice(2)}000bb8${A.wetn.slice(2)}` as Hex
    const inputs = [
      encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), ['0x0000000000000000000000000000000000000002', 10n ** 18n, 1n, path, true]),
      encodeAbiParameters(parseAbiParameters('address, address, uint256'), [TOKEN, UNKNOWN, 0n]),
    ]
    const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
    const a = run(tx(A.universalRouter as Hex, data))
    expect(codes(a)).toContain('UR_RECIPIENT_NOT_SELF')
    // A minimum-out of one wei against a whole token is not a floor.
    expect(codes(a)).toContain('SWAP_MIN_OUT_IMPLAUSIBLE')
    expect(a.severity).toBe('danger')
    // The sweep is on the sheet, and it names where the money goes.
    const text = a.statements.map((s) => s.text).join('\n')
    expect(text).toContain('0x2222…2222')
    expect(text.toLowerCase()).toContain('send everything left')
  })

  /*
    A partitioned route's intermediate sections are not floors.

    `encodeSwap` emits one Universal Router command per contiguous
    same-protocol run of a mixed route, chained through the router: every
    section after the first is paid `CONTRACT_BALANCE` (`1 << 255`, "whatever
    you are holding") and carries `amountOutMin: 0`, because its output is an
    intermediate token in an amount nobody knows until the pools answer. Judging
    each command on its own read every honest V2→V3 trade as "accepts almost
    nothing in return", so only the last swap is judged — the sections are
    chained, so the final minimum bounds the whole route, and a drainer's single
    swap is still the last one.

    The bytes below are the shape `encodeSwap` produces, not an invention: the
    router sentinel as the intermediate recipient, `CONTRACT_BALANCE` as the
    second section's input, zero as the first section's minimum.
  */
  describe('a swap minimum that offers no protection', () => {
    const ROUTER_AS_RECIPIENT = '0x0000000000000000000000000000000000000002' as Hex
    /** `1 << 255` — the Universal Router's "whatever you are holding" sentinel. */
    const CONTRACT_BALANCE = 1n << 255n
    const ONE_TOKEN = 10n ** 18n
    const V3_PATH = `0x${TOKEN.slice(2)}000bb8${A.wetn.slice(2)}` as Hex

    /** One V3 section into the router, then a V2 section that delivers, exactly as the encoder chains them. */
    const partitioned = (finalMin: bigint): Hex => {
      const commands = `0x${[UR_COMMAND.V3_SWAP_EXACT_IN, UR_COMMAND.V2_SWAP_EXACT_IN].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
      const inputs = [
        encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [ROUTER_AS_RECIPIENT, ONE_TOKEN, 0n, V3_PATH, true]),
        encodeAbiParameters(parseAbiParameters('address, uint256, uint256, address[], bool'), [ME, CONTRACT_BALANCE, finalMin, [A.wetn as Hex, TOKEN], false]),
      ]
      return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
    }

    /** A single swap command, which is both the first section and the last. */
    const oneSwap = (min: bigint): Hex => {
      const commands = `0x${UR_COMMAND.V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')}` as Hex
      const inputs = [encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), [ME, ONE_TOKEN, min, V3_PATH, true])]
      return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
    }

    it('a partitioned route with a real floor at the end is not flagged', () => {
      // Two whole tokens out for one token in: a floor, by any reading.
      expect(codes(run(tx(A.universalRouter as Hex, partitioned(2n * ONE_TOKEN))))).not.toContain('SWAP_MIN_OUT_IMPLAUSIBLE')
    })

    it('a partitioned route that would accept a wei at the end is still flagged', () => {
      const a = run(tx(A.universalRouter as Hex, partitioned(1n)))
      expect(codes(a)).toContain('SWAP_MIN_OUT_IMPLAUSIBLE')
      expect(a.severity).toBe('danger')
    })

    it('a single swap that would accept a wei is still flagged, and a sane one is not', () => {
      expect(codes(run(tx(A.universalRouter as Hex, oneSwap(1n))))).toContain('SWAP_MIN_OUT_IMPLAUSIBLE')
      expect(codes(run(tx(A.universalRouter as Hex, oneSwap(2n * ONE_TOKEN))))).not.toContain('SWAP_MIN_OUT_IMPLAUSIBLE')
      // A millionth of the input is the line itself: at it, not below it.
      expect(codes(run(tx(A.universalRouter as Hex, oneSwap(ONE_TOKEN / 1_000_000n))))).toContain('SWAP_MIN_OUT_IMPLAUSIBLE')
      expect(codes(run(tx(A.universalRouter as Hex, oneSwap(ONE_TOKEN / 1_000_000n + 1n))))).not.toContain('SWAP_MIN_OUT_IMPLAUSIBLE')
    })
  })

  /*
    "Run 3 calls through Multicall3" was the same sentence whether the batch
    checked three balances or granted three unlimited approvals: the inner
    calldata was decoded and then thrown away.
  */
  it('a batch says what is inside it, and an approval within it is assessed', () => {
    const approve = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [UNKNOWN, maxUint256] })
    const data = encodeFunctionData({
      abi: MULTICALL3_ABI,
      functionName: 'aggregate3',
      args: [[{ target: TOKEN, allowFailure: false, callData: approve }]],
    })
    const a = run(tx(A.multicall3 as Hex, data))
    const text = a.statements.map((s) => s.text).join('\n')
    expect(text).toContain('unlimited')
    expect(codes(a)).toContain('APPROVE_UNKNOWN_SPENDER')
  })

  it('a router call that pays the user is not flagged', () => {
    const commands = `0x${UR_COMMAND.SWEEP.toString(16).padStart(2, '0')}` as Hex
    const inputs = [encodeAbiParameters(parseAbiParameters('address, address, uint256'), [TOKEN, ME, 0n])]
    const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
    expect(codes(run(tx(A.universalRouter as Hex, data)))).not.toContain('UR_RECIPIENT_NOT_SELF')
  })

  it('a failed simulation is danger and cannot be lowered by a clean one', () => {
    const req = tx(UNKNOWN, encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [UNKNOWN, 1n] }))
    const failed = assess({ origin: ORIGIN, chainId: 52014, account: ME, request: req, context: emptyContext(), simulation: { mode: 'trace', ok: false, revertReason: 'nope', deltas: [], approvals: [] } })
    expect(codes(failed)).toContain('SIM_FAILED')
    const clean = assess({ origin: ORIGIN, chainId: 52014, account: ME, request: req, context: emptyContext(), simulation: { mode: 'trace', ok: true, deltas: [], approvals: [] } })
    expect(clean.severity).toBe('danger') // APPROVE_UNKNOWN_SPENDER stays
  })
  it('an unknown function on an unknown contract is warned and named honestly', () => {
    const a = run(tx(UNKNOWN, '0xdeadbeef'))
    expect(codes(a)).toContain('UNKNOWN_FUNCTION')
    expect(a.statements[0]?.text).toMatch(/unknown function/)
  })
})

describe('origins', () => {
  it('scam-listed and typosquat origins are blocked', () => {
    expect(run(tx(UNKNOWN, '0x', 1n), { scamOrigins: ['scam.example.com'] }, 'https://scam.example.com').presentation.blocked).toBe(true)
    expect(codes(run(tx(UNKNOWN, '0x', 1n), {}, 'https://electroswop.io'))).toContain('ORIGIN_TYPOSQUAT')
    expect(codes(run(tx(UNKNOWN, '0x', 1n), {}, 'https://app.electroswap.io'))).not.toContain('ORIGIN_TYPOSQUAT')
  })
  it('an unverified WalletConnect peer and a first signature are noted', () => {
    const a = run({ kind: 'message', from: ME, message: '0x68656c6c6f' }, { originVerified: false, firstTimeOrigin: true })
    expect(codes(a)).toEqual(expect.arrayContaining(['ORIGIN_UNVERIFIED', 'ORIGIN_FIRST_TIME']))
  })
})

describe('our own swap fee (T10)', () => {
  const SINK = '0x00000000000000000000000000000000000051ab' as Hex
  const urData = (recipient: Hex, bips: bigint): Hex => {
    const commands = `0x${UR_COMMAND.V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')}${UR_COMMAND.PAY_PORTION.toString(16).padStart(2, '0')}` as Hex
    const inputs = [
      encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), ['0x0000000000000000000000000000000000000002', 1n, 1n, '0x', true]),
      encodeAbiParameters(parseAbiParameters('address, address, uint256'), [TOKEN, recipient, bips]),
    ]
    return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
  }
  it('the pinned sink at the schedule bips is clean', () => {
    const a = run(tx(A.universalRouter as Hex, urData(SINK, 30n)), { expectedFee: { sink: SINK, bips: 30 } }, 'internal:swap')
    expect(codes(a)).not.toContain('FEE_SINK_MISMATCH')
    expect(codes(a)).not.toContain('FEE_TIER_MISMATCH')
  })
  it('a different recipient or bips is blocked', () => {
    expect(codes(run(tx(A.universalRouter as Hex, urData(UNKNOWN, 30n)), { expectedFee: { sink: SINK, bips: 30 } }, 'internal:swap'))).toContain('FEE_SINK_MISMATCH')
    expect(codes(run(tx(A.universalRouter as Hex, urData(SINK, 10n)), { expectedFee: { sink: SINK, bips: 30 } }, 'internal:swap'))).toContain('FEE_TIER_MISMATCH')
  })
  it('no configured sink blocks; a zero tier must omit PAY_PORTION', () => {
    expect(run(tx(A.universalRouter as Hex, urData(SINK, 30n)), {}, 'internal:swap').presentation.blocked).toBe(true)
    expect(codes(run(tx(A.universalRouter as Hex, urData(SINK, 30n)), { expectedFee: { sink: SINK, bips: 0 } }, 'internal:swap'))).toContain('FEE_TIER_MISMATCH')
  })
})
