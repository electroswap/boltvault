/**
 * Universal Router calldata for an in-wallet swap (master plan §8.6). The
 * command sequence mirrors `@electroswap/universal-router-sdk`'s
 * `UniswapTrade.encode` byte for byte:
 *
 *   [PERMIT2_PERMIT]  [WRAP_ETH → router]  V2/V3/mixed swaps (recipient =
 *   router when it must custody)  PAY_PORTION(outputWrapped, sink, bips)
 *   UNWRAP_WETH(recipient, minOut) | SWEEP(output, recipient, minOut)
 *
 * with `minOut` reduced by the fee after PAY_PORTION exactly as the SDK does.
 * Command bytes are pinned from `sdks/universal-router-sdk/src/utils/routerCommands.ts`.
 */
import { concatHex, encodeAbiParameters, encodeFunctionData, encodePacked, parseAbiParameters, type Hex } from 'viem'
import { UNIVERSAL_ROUTER_ABI } from './abis'
import { BIPS, feeAmount } from './fee'

export const COMMAND = {
  V3_SWAP_EXACT_IN: 0x00,
  V3_SWAP_EXACT_OUT: 0x01,
  PERMIT2_TRANSFER_FROM: 0x02,
  PERMIT2_PERMIT_BATCH: 0x03,
  SWEEP: 0x04,
  TRANSFER: 0x05,
  PAY_PORTION: 0x06,
  V2_SWAP_EXACT_IN: 0x08,
  V2_SWAP_EXACT_OUT: 0x09,
  PERMIT2_PERMIT: 0x0a,
  WRAP_ETH: 0x0b,
  UNWRAP_WETH: 0x0c,
} as const

/** Router sentinels (`utils/constants.ts` in the SDK). */
export const SENDER_AS_RECIPIENT = '0x0000000000000000000000000000000000000001' as const
export const ROUTER_AS_RECIPIENT = '0x0000000000000000000000000000000000000002' as const
export const CONTRACT_BALANCE = (1n << 255n) as bigint

/** The MixedRouteQuoter/UR fee sentinel that marks a V2 hop inside a mixed path. */
export const V2_FEE_FLAG = 0x800000

export type Hop = { readonly kind: 'v3'; readonly tokenIn: Hex; readonly tokenOut: Hex; readonly fee: number } | { readonly kind: 'v2'; readonly tokenIn: Hex; readonly tokenOut: Hex }

export interface SwapRoute {
  /** 'v2' | 'v3' | 'mixed' by the hops' kinds. */
  readonly hops: readonly Hop[]
}

export interface PermitInput {
  readonly token: Hex
  readonly amount: bigint
  readonly expiration: number
  readonly nonce: number
  readonly spender: Hex
  readonly sigDeadline: bigint
  readonly signature: Hex
}

export interface EncodeSwapInput {
  readonly route: SwapRoute
  readonly amountIn: bigint
  /** The quoted output before the fee. */
  readonly quotedOut: bigint
  readonly slippageBips: number
  /** Native in → WRAP_ETH; native out → UNWRAP_WETH. */
  readonly nativeIn: boolean
  readonly nativeOut: boolean
  readonly wrappedNative: Hex
  readonly recipient: Hex
  /** The wallet fee; `null` only when the schedule says 0 bips (PAY_PORTION reverts on 0). */
  readonly fee: { readonly sink: Hex; readonly bips: number } | null
  readonly permit?: PermitInput
  readonly deadline: bigint
  readonly universalRouter: Hex
}

export interface EncodedSwap {
  readonly to: Hex
  readonly data: Hex
  readonly value: bigint
  readonly commands: readonly number[]
  /** What the user is guaranteed after fee and slippage. */
  readonly minimumOut: bigint
}

function v3Path(hops: readonly Hop[]): Hex {
  const types: string[] = ['address']
  const values: unknown[] = [hops[0]?.tokenIn]
  for (const h of hops) {
    types.push('uint24', 'address')
    values.push(h.kind === 'v3' ? h.fee : V2_FEE_FLAG, h.tokenOut)
  }
  return encodePacked(types, values)
}

/** Split a route into runs of the same kind (the SDK encodes a mixed route as one V3-style path through the mixed quoter / UR). */
function classify(route: SwapRoute): 'v2' | 'v3' | 'mixed' {
  const kinds = new Set(route.hops.map((h) => h.kind))
  return kinds.size === 1 ? (route.hops[0]?.kind ?? 'v3') : 'mixed'
}

export function encodeSwap(input: EncodeSwapInput): EncodedSwap {
  if (input.route.hops.length === 0) throw new Error('empty route')
  const commands: number[] = []
  const inputs: Hex[] = []
  let payerIsUser = true
  const push = (cmd: number, data: Hex): void => {
    commands.push(cmd)
    inputs.push(data)
  }

  if (input.permit) {
    const p = input.permit
    push(COMMAND.PERMIT2_PERMIT, encodeAbiParameters(parseAbiParameters('((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit, bytes signature'), [{ details: { token: p.token, amount: p.amount, expiration: p.expiration, nonce: p.nonce }, spender: p.spender, sigDeadline: p.sigDeadline }, p.signature]))
  }
  if (input.nativeIn) {
    push(COMMAND.WRAP_ETH, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amount'), [ROUTER_AS_RECIPIENT, input.amountIn]))
    payerIsUser = false
  }

  // The router must custody the output when it takes a fee or must unwrap.
  const routerMustCustody = input.fee !== null || input.nativeOut
  const swapRecipient = routerMustCustody ? ROUTER_AS_RECIPIENT : input.recipient
  const routerMinOut = input.quotedOut - (input.quotedOut * BigInt(input.slippageBips)) / BIPS
  const kind = classify(input.route)
  if (kind === 'v2') {
    const path = [input.route.hops[0]?.tokenIn as Hex, ...input.route.hops.map((h) => h.tokenOut)]
    push(COMMAND.V2_SWAP_EXACT_IN, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser'), [swapRecipient, input.amountIn, routerMinOut, path, payerIsUser]))
  } else {
    // V3 and mixed routes share the packed-path form; the UR reads the 0x800000 flag for V2 hops.
    push(COMMAND.V3_SWAP_EXACT_IN, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser'), [swapRecipient, input.amountIn, routerMinOut, v3Path(input.route.hops), payerIsUser]))
  }

  const outputToken = input.route.hops[input.route.hops.length - 1]?.tokenOut as Hex
  let minimumOut = routerMinOut
  if (routerMustCustody) {
    if (input.fee) {
      push(COMMAND.PAY_PORTION, encodeAbiParameters(parseAbiParameters('address token, address recipient, uint256 bips'), [outputToken, input.fee.sink, BigInt(input.fee.bips)]))
      minimumOut = minimumOut - feeAmount(minimumOut, input.fee.bips)
    }
    if (input.nativeOut) push(COMMAND.UNWRAP_WETH, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountMin'), [input.recipient, minimumOut]))
    else push(COMMAND.SWEEP, encodeAbiParameters(parseAbiParameters('address token, address recipient, uint256 amountMin'), [outputToken, input.recipient, minimumOut]))
  }

  const commandBytes = concatHex(commands.map((c) => `0x${c.toString(16).padStart(2, '0')}` as Hex))
  const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commandBytes, inputs, input.deadline] })
  return { to: input.universalRouter, data, value: input.nativeIn ? input.amountIn : 0n, commands, minimumOut }
}

/** ERC-20 approve(Permit2, amount) — the one-time step before permits (§8.6). */
export function encodeApprovePermit2(permit2: Hex, amount: bigint): { readonly data: Hex } {
  return { data: encodeFunctionData({ abi: [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }], functionName: 'approve', args: [permit2, amount] }) }
}
