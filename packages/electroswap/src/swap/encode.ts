/**
 * Universal Router calldata for an in-wallet swap (master plan §8.6). The
 * command sequence mirrors `@electroswap/universal-router-sdk`'s
 * `UniswapTrade.encode` byte for byte:
 *
 *   [PERMIT2_PERMIT]  [WRAP_ETH → router]  one swap command per contiguous
 *   same-protocol run of the route (recipient = router when it must custody)
 *   PAY_PORTION(outputWrapped, sink, bips)
 *   UNWRAP_WETH(recipient, minOut) | SWEEP(output, recipient, minOut)
 *
 * with `minOut` reduced by the fee after PAY_PORTION exactly as the SDK does.
 * Command bytes are pinned from `sdks/universal-router-sdk/src/utils/routerCommands.ts`.
 */
import { concatHex, encodeAbiParameters, encodeFunctionData, encodePacked, parseAbiParameters, type Hex } from 'viem'
import { UNIVERSAL_ROUTER_ABI } from './abis'
import { BIPS, feeAmount, grossOutForExactOut } from './fee'

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
  /**
   * Take the fee out of the input token, before the swap, instead of out of the
   * output with `PAY_PORTION`.
   *
   * `PAY_PORTION` needs the router to hold the output, and the router handing it
   * on to the user is one more transfer. For an ordinary token that is free; for
   * one that charges on transfer it is another cut, taken *after* the only
   * on-chain check — `Payments.sweep` compares `balanceOf(address(this))` with
   * the minimum and then transfers, so the assertion covers the router's receipt
   * and not the user's. The minimum received shown on screen was therefore not
   * the amount guaranteed.
   *
   * Charging the input instead means the router never holds the output at all:
   * the swap delivers straight to the user, and `V2SwapRouter` measures
   * `balanceOf(recipient)` before and after. The floor becomes a real
   * delivered-amount assertion, with no extra hop for a tax to apply to.
   */
  readonly feeOnInput?: boolean
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

/**
 * The same path walked backwards, which is what V3 wants for an exact output.
 *
 * `exactOutput` starts from the token you asked for and works back to the one
 * you pay, so its packed path runs output → … → input. Handing it a forward
 * path does not fail loudly: it addresses different pools, quotes a different
 * trade, or finds nothing at all. The quoter and the router read the same
 * bytes, so the reversal is expressed once, here.
 */
export function v3PackedPathExactOut(hops: readonly Hop[]): Hex {
  const reversed = [...hops].reverse()
  const types: string[] = ['address']
  const values: unknown[] = [reversed[0]?.tokenOut]
  for (const h of reversed) {
    types.push('uint24', 'address')
    values.push(h.kind === 'v3' ? h.fee : V2_FEE_FLAG, h.tokenIn)
  }
  return encodePacked(types, values)
}

function classify(route: SwapRoute): 'v2' | 'v3' | 'mixed' {
  const kinds = new Set(route.hops.map((h) => h.kind))
  return kinds.size === 1 ? (route.hops[0]?.kind ?? 'v3') : 'mixed'
}

/**
 * The route split into contiguous runs of one protocol.
 *
 * A run is the unit the Universal Router actually has a command for: there is
 * `V2_SWAP_EXACT_IN` and there is `V3_SWAP_EXACT_IN`, and nothing that reads a
 * path containing both. `partitionMixedRouteByProtocol` in
 * `sdks/router-sdk/src/utils/index.ts` splits a mixed route the same way, and
 * the universal-router-sdk emits one command per section from it.
 */
export function protocolRuns(hops: readonly Hop[]): Hop[][] {
  const runs: Hop[][] = []
  for (const hop of hops) {
    const open = runs[runs.length - 1]
    if (open && open[0]?.kind === hop.kind) open.push(hop)
    else runs.push([hop])
  }
  return runs
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

  /*
    The fee on the input side is paid before anything is swapped, out of the
    token the user is spending — from their Permit2 allowance directly, or from
    the router's own balance when the input was just wrapped for them.
  */
  const feeOnInput = input.feeOnInput === true && input.fee !== null
  const inputFee = feeOnInput && input.fee ? feeAmount(input.amountIn, input.fee.bips) : 0n
  if (feeOnInput && input.fee) {
    const token = input.nativeIn ? input.wrappedNative : (input.route.hops[0]?.tokenIn as Hex)
    if (input.nativeIn) push(COMMAND.TRANSFER, encodeAbiParameters(parseAbiParameters('address token, address recipient, uint256 value'), [token, input.fee.sink, inputFee]))
    else push(COMMAND.PERMIT2_TRANSFER_FROM, encodeAbiParameters(parseAbiParameters('address token, address recipient, uint160 amount'), [token, input.fee.sink, inputFee]))
  }
  const swapAmountIn = input.amountIn - inputFee

  // The router must custody the output to take a portion of it, or to unwrap it.
  const routerMustCustody = (input.fee !== null && !feeOnInput) || input.nativeOut
  const swapRecipient = routerMustCustody ? ROUTER_AS_RECIPIENT : input.recipient
  /*
    The floor has to be a floor under the trade that is actually made.

    `quotedOut` is what the pools offered for the whole input, but with the fee
    taken off the front only `amountIn - fee` reaches them, so the output is
    smaller in the same proportion. Writing the unscaled figure into the
    delivering command leaves a floor the swap cannot clear on its own merits:
    at a 50 bps tier and 50 bps of slippage the margin collapses to about a
    basis point, and any ordinary movement between quoting and mining reverts a
    swap that was never going to be bad. Scaling it keeps the user's slippage
    theirs, which is what it was for.
  */
  const quotedOut = feeOnInput && input.amountIn > 0n ? (input.quotedOut * swapAmountIn) / input.amountIn : input.quotedOut
  const routerMinOut = quotedOut - (quotedOut * BigInt(input.slippageBips)) / BIPS

  /*
    One command per contiguous same-protocol run, which is how a mixed route is
    expressed — `partitionMixedRouteByProtocol` in the router-sdk, then one
    command per section in `universal-router-sdk`'s `uniswap.ts`. A
    single-protocol route is the one-section case of the same loop and encodes
    byte for byte as it did before.

    The route used to be squeezed into a single `V3_SWAP_EXACT_IN` whose packed
    path marked V2 hops with the `0x800000` sentinel. That is a
    MixedRouteQuoterV1 convention for *quoting*; `V3SwapRouter` has no such
    concept, and derives a pool address for fee tier 8388608 — which no contract
    occupies — so the calldata was well formed, passed every check the wallet
    makes, and reverted on chain with the user's gas.

    Sections are chained through the router rather than by paying the next V2
    pair directly the way the SDK does. The SDK's version is one ERC-20 transfer
    cheaper, but it requires deriving the pair address here from the factory and
    an init-code hash, and a wrong hash sends the whole trade to an address with
    no contract behind it. `ROUTER_AS_RECIPIENT` makes the router derive the
    pair from its own immutables instead: `Payments.pay` and
    `V3SwapRouter.v3SwapExactInput` both read `CONTRACT_BALANCE` as "whatever
    you are holding", so each section picks up exactly what the last one left.

    Only the final section carries a minimum. An intermediate one cannot: its
    output is an intermediate token, and the amount is not known until the pools
    answer. The floor that matters is enforced twice at the end anyway — on the
    last swap, and again by the SWEEP or UNWRAP_WETH that delivers.
  */
  const runs = protocolRuns(input.route.hops)
  runs.forEach((hops, i) => {
    const isLast = i === runs.length - 1
    const recipient = isLast ? swapRecipient : ROUTER_AS_RECIPIENT
    const amountIn = i === 0 ? swapAmountIn : CONTRACT_BALANCE
    const amountOutMin = isLast ? routerMinOut : 0n
    const payer = payerIsUser && i === 0
    if (hops[0]?.kind === 'v2') {
      const path = [hops[0].tokenIn, ...hops.map((h) => h.tokenOut)]
      push(COMMAND.V2_SWAP_EXACT_IN, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountIn, uint256 amountOutMin, address[] path, bool payerIsUser'), [recipient, amountIn, amountOutMin, path, payer]))
    } else {
      push(COMMAND.V3_SWAP_EXACT_IN, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountIn, uint256 amountOutMin, bytes path, bool payerIsUser'), [recipient, amountIn, amountOutMin, v3Path(hops), payer]))
    }
  })

  const outputToken = input.route.hops[input.route.hops.length - 1]?.tokenOut as Hex
  let minimumOut = routerMinOut
  if (routerMustCustody) {
    if (input.fee && !feeOnInput) {
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

export interface EncodeSwapExactOutInput {
  readonly route: SwapRoute
  /** What the user must end up holding. Not a floor and not an estimate: the number they typed. */
  readonly amountOut: bigint
  /**
   * The most this swap may spend — `maximumIn(quotedIn, slippage)`, which is
   * all slippage does in this direction.
   *
   * Passed in rather than derived here, because the caller has a constraint the
   * encoder cannot see: a Permit2 signature already given for a particular
   * amount. A re-quote at signing time can move the cost a little, and the
   * encoded `amountInMaximum` must never promise the router more than the user
   * has actually authorised it to pull.
   */
  readonly maximumIn: bigint
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

export interface EncodedSwapExactOut {
  readonly to: Hex
  readonly data: Hex
  readonly value: bigint
  readonly commands: readonly number[]
  /** Exactly what the user receives — the figure written into the delivering command. */
  readonly exactOut: bigint
  /** The most the swap can take. Slippage guards this side now, not the output. */
  readonly maximumIn: bigint
  /** What the router buys, so the fee comes off the top and the user's exact amount survives it. */
  readonly grossOut: bigint
}

/**
 * Universal Router calldata for a swap priced by its output (master plan §8.6,
 * "exact-out is a power toggle").
 *
 *   [PERMIT2_PERMIT]  [WRAP_ETH(router, maxIn)]
 *   V2/V3_SWAP_EXACT_OUT(recipient, grossOut, maxIn, path, payerIsUser)
 *   [PAY_PORTION(outputWrapped, sink, bips)]
 *   SWEEP(output, recipient, exactOut) | UNWRAP_WETH(recipient, exactOut)
 *   [UNWRAP_WETH(recipient, 0)]        ← native input: hand back the change
 *
 * Two things differ from the exact-in plan beyond the command byte.
 *
 * The router is asked for `grossOut`, not `amountOut`: `PAY_PORTION` takes its
 * bips of what the router is holding, so buying exactly what the user asked for
 * would pay the fee out of the user's exact amount. Grossing up first means the
 * fee is paid in extra input and the delivered amount is exact — which is the
 * whole promise of the mode. The `PAY_PORTION` command itself is untouched: one
 * portion, the pinned sink, the tier's bips, so the firewall's FEE_SINK /
 * FEE_TIER assertion reads exactly what it reads for an exact-in swap.
 *
 * And a native input has to be refunded. `WRAP_ETH` wraps the whole maximum
 * because the router cannot know the real cost until the pools answer, so
 * whatever is left over is WETN sitting in the router — a trailing
 * `UNWRAP_WETH(recipient, 0)` returns it. Without it the change is a tip to
 * whoever sweeps the router next.
 */
export function encodeSwapExactOut(input: EncodeSwapExactOutInput): EncodedSwapExactOut {
  if (input.route.hops.length === 0) throw new Error('empty route')
  /*
    Exact-in learned to partition a mixed route; exact-out has not, and upstream
    has not either — `encodeMixedRouteToPath` is marked "only supports exactIn
    route encodings" and `MixedRouteTrade` is exact-in only. Working backwards
    through a chain of sections means solving each section's input from the next
    section's required input, which the router's `CONTRACT_BALANCE` chaining
    cannot express: there is no "whatever you are holding" for an amount you
    have not acquired yet. So this stays a refusal rather than a revert.
  */
  if (classify(input.route) === 'mixed') throw new Error('mixed route')
  if (input.amountOut <= 0n) throw new Error('empty output')
  if (input.maximumIn <= 0n) throw new Error('no spending ceiling')
  const commands: number[] = []
  const inputs: Hex[] = []
  let payerIsUser = true
  const push = (cmd: number, data: Hex): void => {
    commands.push(cmd)
    inputs.push(data)
  }

  const grossOut = grossOutForExactOut(input.amountOut, input.fee?.bips ?? 0)
  const maxIn = input.maximumIn

  if (input.permit) {
    const p = input.permit
    push(COMMAND.PERMIT2_PERMIT, encodeAbiParameters(parseAbiParameters('((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit, bytes signature'), [{ details: { token: p.token, amount: p.amount, expiration: p.expiration, nonce: p.nonce }, spender: p.spender, sigDeadline: p.sigDeadline }, p.signature]))
  }
  if (input.nativeIn) {
    push(COMMAND.WRAP_ETH, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amount'), [ROUTER_AS_RECIPIENT, maxIn]))
    payerIsUser = false
  }

  const routerMustCustody = input.fee !== null || input.nativeOut
  const swapRecipient = routerMustCustody ? ROUTER_AS_RECIPIENT : input.recipient
  const kind = classify(input.route)
  if (kind === 'v2') {
    const path = [input.route.hops[0]?.tokenIn as Hex, ...input.route.hops.map((h) => h.tokenOut)]
    push(COMMAND.V2_SWAP_EXACT_OUT, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountOut, uint256 amountInMax, address[] path, bool payerIsUser'), [swapRecipient, grossOut, maxIn, path, payerIsUser]))
  } else {
    push(COMMAND.V3_SWAP_EXACT_OUT, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountOut, uint256 amountInMax, bytes path, bool payerIsUser'), [swapRecipient, grossOut, maxIn, v3PackedPathExactOut(input.route.hops), payerIsUser]))
  }

  const outputToken = input.route.hops[input.route.hops.length - 1]?.tokenOut as Hex
  if (routerMustCustody) {
    if (input.fee) push(COMMAND.PAY_PORTION, encodeAbiParameters(parseAbiParameters('address token, address recipient, uint256 bips'), [outputToken, input.fee.sink, BigInt(input.fee.bips)]))
    // The floor is the exact amount itself — grossing up is what makes that safe.
    if (input.nativeOut) push(COMMAND.UNWRAP_WETH, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountMin'), [input.recipient, input.amountOut]))
    else push(COMMAND.SWEEP, encodeAbiParameters(parseAbiParameters('address token, address recipient, uint256 amountMin'), [outputToken, input.recipient, input.amountOut]))
  }
  if (input.nativeIn) push(COMMAND.UNWRAP_WETH, encodeAbiParameters(parseAbiParameters('address recipient, uint256 amountMin'), [input.recipient, 0n]))

  const commandBytes = concatHex(commands.map((c) => `0x${c.toString(16).padStart(2, '0')}` as Hex))
  const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commandBytes, inputs, input.deadline] })
  return { to: input.universalRouter, data, value: input.nativeIn ? maxIn : 0n, commands, exactOut: input.amountOut, maximumIn: maxIn, grossOut }
}

/** ERC-20 approve(Permit2, amount) — the one-time step before permits (§8.6). */
export function encodeApprovePermit2(permit2: Hex, amount: bigint): { readonly data: Hex } {
  return { data: encodeFunctionData({ abi: [{ type: 'function', name: 'approve', stateMutability: 'nonpayable', inputs: [{ name: 'spender', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [{ type: 'bool' }] }], functionName: 'approve', args: [permit2, amount] }) }
}
