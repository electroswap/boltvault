import { ELECTRONEUM_ADDRESSES, feeRecipient } from '@boltvault/chains'
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

  /*
    The other place the same fee can be: out of the token the user is spending.

    For an output token that charges on transfer, `PAY_PORTION` is not safe —
    it needs the router to custody the output, and the hop from the router to
    the user is taxed after `Payments.sweep` has already checked its minimum
    against the router's own balance. The encoder pays the sink first instead,
    out of the input, and lets the swap deliver straight to the user. The shape
    on the wire is a `PERMIT2_TRANSFER_FROM` (or a `TRANSFER`, when the input
    was just wrapped) of an exact amount to the pinned sink, and no portion of
    the output at all.

    Built the way `encodeSwap` builds it: `address token, address recipient,
    uint160 amount` for the transfer, the swap paying the user directly.
    `packages/electroswap/tests/swap.test.ts` checks the real encoder's bytes
    against this rule from the other side of the layering, which is where the
    two shapes are pinned to each other.
  */
  describe('taken out of the input instead', () => {
    const ONE = 10n ** 18n
    /** 30 bips of one whole token. */
    const FEE = 3_000_000_000_000_000n
    const expectedOnInput = { sink: SINK, bips: 30, onInput: { token: TOKEN, amount: FEE } }

    /** `[PERMIT2_TRANSFER_FROM → sink] V2_SWAP_EXACT_IN(user) [PAY_PORTION]`, as the encoder writes it. */
    const onInputData = (opts: { paid?: { to: Hex; amount: bigint }; portion?: boolean } = { paid: { to: SINK, amount: FEE } }): Hex => {
      const bytes: number[] = []
      const inputs: Hex[] = []
      if (opts.paid) {
        bytes.push(UR_COMMAND.PERMIT2_TRANSFER_FROM)
        inputs.push(encodeAbiParameters(parseAbiParameters('address, address, uint160'), [TOKEN, opts.paid.to, opts.paid.amount]))
      }
      bytes.push(UR_COMMAND.V2_SWAP_EXACT_IN)
      inputs.push(encodeAbiParameters(parseAbiParameters('address, uint256, uint256, address[], bool'), [ME, ONE - (opts.paid?.amount ?? 0n), ONE / 2n, [TOKEN, A.wetn as Hex], true]))
      if (opts.portion) {
        bytes.push(UR_COMMAND.PAY_PORTION)
        inputs.push(encodeAbiParameters(parseAbiParameters('address, address, uint256'), [A.wetn as Hex, SINK, 30n]))
      }
      const commands = `0x${bytes.map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
      return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
    }

    it('the pinned sink, in the input token, at the exact amount the tier says, is clean', () => {
      const a = run(tx(A.universalRouter as Hex, onInputData()), { expectedFee: expectedOnInput }, 'internal:swap')
      expect(codes(a)).not.toContain('FEE_SINK_MISMATCH')
      expect(codes(a)).not.toContain('FEE_TIER_MISMATCH')
      expect(a.presentation.blocked).toBe(false)
    })

    /*
      A swap that pays the wallet nothing is not a favour to the user.

      It is the same assertion as the output side's missing `PAY_PORTION`: the
      encoder said a fee was due, and bytes that do not pay it are bytes nobody
      in this wallet produced.
    */
    it('no transfer to the sink at all is the fee missing', () => {
      const a = run(tx(A.universalRouter as Hex, onInputData({})), { expectedFee: expectedOnInput }, 'internal:swap')
      expect(codes(a)).toContain('FEE_SINK_MISMATCH')
      expect(a.presentation.blocked).toBe(true)
    })

    it('a transfer of the right amount to the wrong address is not the fee', () => {
      const a = run(tx(A.universalRouter as Hex, onInputData({ paid: { to: UNKNOWN, amount: FEE } })), { expectedFee: expectedOnInput }, 'internal:swap')
      expect(codes(a)).toContain('FEE_SINK_MISMATCH')
      expect(a.presentation.blocked).toBe(true)
    })

    /*
      The amount is asserted, not the bips, because there are no bips in these
      bytes to read: the swap command's `amountIn` is already net of the fee, so
      the firewall is given the exact figure the schedule produced and compares
      it whole. A single wei over is a different fee.
    */
    it('the wrong amount is the wrong tier', () => {
      const a = run(tx(A.universalRouter as Hex, onInputData({ paid: { to: SINK, amount: FEE + 1n } })), { expectedFee: expectedOnInput }, 'internal:swap')
      expect(codes(a)).toContain('FEE_TIER_MISMATCH')
      expect(a.presentation.blocked).toBe(true)
      // Ten times the fee to the right address is the same refusal.
      expect(codes(run(tx(A.universalRouter as Hex, onInputData({ paid: { to: SINK, amount: FEE * 10n } })), { expectedFee: expectedOnInput }, 'internal:swap'))).toContain('FEE_TIER_MISMATCH')
    })

    /*
      Both at once is the one shape neither side's assertion would have caught.

      The input-side fee is paid, so the transfer check passes; a `PAY_PORTION`
      on top of it is a second fee out of the output, and the user pays the
      wallet twice for one swap. The old rule only ever counted portions, so it
      would have read this as the ordinary output-side plan and approved it.
    */
    it('an input-side fee and a portion of the output as well is paying twice', () => {
      const a = run(tx(A.universalRouter as Hex, onInputData({ paid: { to: SINK, amount: FEE }, portion: true })), { expectedFee: expectedOnInput }, 'internal:swap')
      expect(codes(a)).toContain('FEE_TIER_MISMATCH')
      expect(a.presentation.blocked).toBe(true)
      expect(a.rules.find((r) => r.code === 'FEE_TIER_MISMATCH')?.title).toMatch(/twice/)
    })

    /*
      The wallet's own fee is not a stranger taking the user's money.

      `urRecipientNotSelf` reads the recipient of every command that moves
      something — `PERMIT2_TRANSFER_FROM` and `TRANSFER` among them — and calls
      anything that is not one of the user's own accounts "This swap sends the
      output somewhere else". `PAY_PORTION` is exempt precisely because the fee
      sink has its own pinned rules; the input-side fee is that same fee to that
      same pinned address through a different command, and it is exempt from
      nothing. So the wallet's own correct swap accuses itself, at `danger`,
      with a typed confirmation the user has to type out to swap at all.
    */
    it('is not read as a swap that pays a stranger', () => {
      const a = run(tx(A.universalRouter as Hex, onInputData()), { expectedFee: expectedOnInput }, 'internal:swap')
      expect(codes(a)).not.toContain('UR_RECIPIENT_NOT_SELF')
      expect(a.severity).not.toBe('danger')
      expect(a.presentation.typedConfirmation).toBeNull()
    })
  })
})

/*
  The wallet fee arriving from ElectroSwap's own site (§8.6, §8.18).

  Until the site encoded it, every `PAY_PORTION` from a dApp origin meant a
  stranger taking a cut, and the sheet said so. Now our own site encodes our
  own sink, so the same bytes mean the ordinary wallet fee — and the two must
  not be told apart by the origin, which a fork or a mirror could change, but
  by the recipient, which is pinned in the build.
*/
describe("the wallet fee from ElectroSwap's own site", () => {
  const OURS = feeRecipient(52014) as Hex
  const urData = (recipient: Hex, bips: bigint): Hex => {
    const commands = `0x${UR_COMMAND.V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')}${UR_COMMAND.PAY_PORTION.toString(16).padStart(2, '0')}` as Hex
    const inputs = [
      encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), ['0x0000000000000000000000000000000000000002', 1n, 1n, '0x', true]),
      encodeAbiParameters(parseAbiParameters('address, address, uint256'), [TOKEN, recipient, bips]),
    ]
    return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
  }
  const SITE = 'https://app.electroswap.io'
  const tier = { sink: OURS, bips: 30, tier: 'Magneto' }

  it('a portion to our own sink is our fee, not a third party tip', () => {
    const a = run(tx(A.universalRouter as Hex, urData(OURS, 30n)), { walletFee: tier }, SITE)
    expect(codes(a)).not.toContain('DAPP_TIPS_THIRD_PARTY')
    expect(codes(a)).not.toContain('WALLET_FEE_OVERCHARGE')
  })

  it('a portion to anyone else is still a third party tip', () => {
    const a = run(tx(A.universalRouter as Hex, urData(UNKNOWN, 30n)), { walletFee: tier }, SITE)
    expect(codes(a)).toContain('DAPP_TIPS_THIRD_PARTY')
  })

  /*
    The disclosure the owner asked for. The old line named an address and a
    percentage and left the user to work out whose money it was; a fee we
    charge has to say that it is ours and which rung it came from.
  */
  it('names the fee and the rung in the statements instead of a bare address', () => {
    const a = run(tx(A.universalRouter as Hex, urData(OURS, 30n)), { walletFee: tier }, SITE)
    expect(a.statements.map((s) => s.text)).toContain('BoltVault wallet fee 0.30% of the output · Magneto tier')
  })

  it('says whose fee it is even when the rung could not be read', () => {
    const a = run(tx(A.universalRouter as Hex, urData(OURS, 50n)), {}, SITE)
    expect(a.statements.map((s) => s.text)).toContain('BoltVault wallet fee 0.50% of the output')
    expect(codes(a)).not.toContain('DAPP_TIPS_THIRD_PARTY')
  })

  it('charging above the rung is danger, and takes a typed confirmation', () => {
    const a = run(tx(A.universalRouter as Hex, urData(OURS, 50n)), { walletFee: tier }, SITE)
    expect(codes(a)).toContain('WALLET_FEE_OVERCHARGE')
    expect(a.severity).toBe('danger')
    expect(a.presentation.typedConfirmation).toBe('app.electroswap.io')
  })

  /*
    Under-charging is our problem, not the user's. A wallet that warned about
    paying less than it hoped for would be reading as a shakedown, and §7.10
    does not allow the sheet to lobby.
  */
  it('charging below the rung, or not at all, says nothing', () => {
    expect(codes(run(tx(A.universalRouter as Hex, urData(OURS, 10n)), { walletFee: tier }, SITE))).not.toContain('WALLET_FEE_OVERCHARGE')
    const commands = `0x${UR_COMMAND.V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')}` as Hex
    const inputs = [encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), ['0x0000000000000000000000000000000000000002', 1n, 1n, '0x', true])]
    const none = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
    const a = run(tx(A.universalRouter as Hex, none), { walletFee: tier }, SITE)
    expect(codes(a)).not.toContain('WALLET_FEE_OVERCHARGE')
    expect(codes(a)).not.toContain('DAPP_TIPS_THIRD_PARTY')
  })

  /*
    T10 is a separate rule with a separate field, and it stays that way: the
    reading must never become the assertion our own Swap screen is held to.
  */
  it('our own swap is still judged by expectedFee, not by this', () => {
    const a = run(tx(A.universalRouter as Hex, urData(OURS, 50n)), { walletFee: tier }, 'internal:swap')
    expect(codes(a)).not.toContain('WALLET_FEE_OVERCHARGE')
    expect(codes(a)).toContain('FEE_SINK_MISMATCH')
  })
})
