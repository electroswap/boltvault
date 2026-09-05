/**
 * Universal Router command decoder. Command bytes and input layouts are
 * pinned from `sdks/universal-router-sdk/src/utils/routerCommands.ts`
 * (CommandType enum + ABI_DEFINITION) — the swap encoder in M5 is asserted
 * against this table by a build test, and `PAY_PORTION` is what the fee
 * rules (§3.4 T10) inspect.
 */
import { decodeAbiParameters, decodeFunctionData, parseAbiParameters, type Hex } from 'viem'
import { UNIVERSAL_ROUTER_ABI } from './abis'

export const UR_COMMAND = {
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
  PERMIT2_TRANSFER_FROM_BATCH: 0x0d,
  BALANCE_CHECK_ERC20: 0x0e,
  SEAPORT_V1_5: 0x10,
} as const

const NAMES: Record<number, string> = Object.fromEntries(Object.entries(UR_COMMAND).map(([k, v]) => [v, k]))

/** The `msg.sender` sentinel the router uses for recipients. */
export const UR_MSG_SENDER = '0x0000000000000000000000000000000000000001'
/** The `address(this)` sentinel. */
export const UR_ROUTER_SELF = '0x0000000000000000000000000000000000000002'

export type UrCommand =
  | { readonly type: 'V3_SWAP_EXACT_IN' | 'V3_SWAP_EXACT_OUT'; readonly recipient: Hex; readonly amountIn: bigint; readonly amountOut: bigint; readonly path: Hex; readonly payerIsUser: boolean }
  | { readonly type: 'V2_SWAP_EXACT_IN' | 'V2_SWAP_EXACT_OUT'; readonly recipient: Hex; readonly amountIn: bigint; readonly amountOut: bigint; readonly path: readonly Hex[]; readonly payerIsUser: boolean }
  | { readonly type: 'PERMIT2_PERMIT'; readonly token: Hex; readonly amount: bigint; readonly expiration: number; readonly spender: Hex; readonly sigDeadline: bigint }
  | { readonly type: 'PERMIT2_PERMIT_BATCH'; readonly details: ReadonlyArray<{ token: Hex; amount: bigint; expiration: number }>; readonly spender: Hex }
  | { readonly type: 'PERMIT2_TRANSFER_FROM'; readonly token: Hex; readonly recipient: Hex; readonly amount: bigint }
  | { readonly type: 'PERMIT2_TRANSFER_FROM_BATCH'; readonly transfers: ReadonlyArray<{ from: Hex; to: Hex; amount: bigint; token: Hex }> }
  | { readonly type: 'SWEEP' | 'TRANSFER' | 'BALANCE_CHECK_ERC20'; readonly token: Hex; readonly recipient: Hex; readonly amount: bigint }
  | { readonly type: 'PAY_PORTION'; readonly token: Hex; readonly recipient: Hex; readonly bips: bigint }
  | { readonly type: 'WRAP_ETH' | 'UNWRAP_WETH'; readonly recipient: Hex; readonly amount: bigint }
  | { readonly type: 'SEAPORT_V1_5'; readonly value: bigint; readonly data: Hex }
  | { readonly type: 'UNKNOWN'; readonly byte: number; readonly input: Hex }

export interface DecodedUniversalRouter {
  readonly commands: readonly UrCommand[]
  readonly deadline: bigint | null
  /** A command byte with the revert-allowed flag (0x80) set. */
  readonly allowRevert: readonly number[]
}

const PERMIT_SINGLE = parseAbiParameters('((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permit, bytes sig')
const PERMIT_BATCH = parseAbiParameters('((address token, uint160 amount, uint48 expiration, uint48 nonce)[] details, address spender, uint256 sigDeadline) permit, bytes sig')
const V3_SWAP = parseAbiParameters('address recipient, uint256 amountIn, uint256 amountOut, bytes path, bool payerIsUser')
const V2_SWAP = parseAbiParameters('address recipient, uint256 amountIn, uint256 amountOut, address[] path, bool payerIsUser')
const ADDR_ADDR_UINT = parseAbiParameters('address a, address b, uint256 c')
const ADDR_UINT = parseAbiParameters('address a, uint256 b')
const P2_TRANSFER = parseAbiParameters('address token, address recipient, uint160 amount')
const P2_TRANSFER_BATCH = parseAbiParameters('(address from, address to, uint160 amount, address token)[] transfers')
const SEAPORT = parseAbiParameters('uint256 value, bytes data')

export function decodeUrCommand(byte: number, input: Hex): UrCommand {
  const type = byte & 0x3f
  try {
    switch (type) {
      case UR_COMMAND.V3_SWAP_EXACT_IN:
      case UR_COMMAND.V3_SWAP_EXACT_OUT: {
        const [recipient, amountIn, amountOut, path, payerIsUser] = decodeAbiParameters(V3_SWAP, input)
        return { type: type === UR_COMMAND.V3_SWAP_EXACT_IN ? 'V3_SWAP_EXACT_IN' : 'V3_SWAP_EXACT_OUT', recipient, amountIn, amountOut, path, payerIsUser }
      }
      case UR_COMMAND.V2_SWAP_EXACT_IN:
      case UR_COMMAND.V2_SWAP_EXACT_OUT: {
        const [recipient, amountIn, amountOut, path, payerIsUser] = decodeAbiParameters(V2_SWAP, input)
        return { type: type === UR_COMMAND.V2_SWAP_EXACT_IN ? 'V2_SWAP_EXACT_IN' : 'V2_SWAP_EXACT_OUT', recipient, amountIn, amountOut, path, payerIsUser }
      }
      case UR_COMMAND.PERMIT2_PERMIT: {
        const [permit] = decodeAbiParameters(PERMIT_SINGLE, input)
        return { type: 'PERMIT2_PERMIT', token: permit.details.token, amount: permit.details.amount, expiration: permit.details.expiration, spender: permit.spender, sigDeadline: permit.sigDeadline }
      }
      case UR_COMMAND.PERMIT2_PERMIT_BATCH: {
        const [permit] = decodeAbiParameters(PERMIT_BATCH, input)
        return { type: 'PERMIT2_PERMIT_BATCH', details: permit.details.map((d) => ({ token: d.token, amount: d.amount, expiration: d.expiration })), spender: permit.spender }
      }
      case UR_COMMAND.PERMIT2_TRANSFER_FROM: {
        const [token, recipient, amount] = decodeAbiParameters(P2_TRANSFER, input)
        return { type: 'PERMIT2_TRANSFER_FROM', token, recipient, amount }
      }
      case UR_COMMAND.PERMIT2_TRANSFER_FROM_BATCH: {
        const [transfers] = decodeAbiParameters(P2_TRANSFER_BATCH, input)
        return { type: 'PERMIT2_TRANSFER_FROM_BATCH', transfers: transfers.map((t) => ({ from: t.from, to: t.to, amount: t.amount, token: t.token })) }
      }
      case UR_COMMAND.SWEEP:
      case UR_COMMAND.TRANSFER:
      case UR_COMMAND.BALANCE_CHECK_ERC20: {
        const [token, recipient, amount] = decodeAbiParameters(ADDR_ADDR_UINT, input)
        return { type: type === UR_COMMAND.SWEEP ? 'SWEEP' : type === UR_COMMAND.TRANSFER ? 'TRANSFER' : 'BALANCE_CHECK_ERC20', token, recipient, amount }
      }
      case UR_COMMAND.PAY_PORTION: {
        const [token, recipient, bips] = decodeAbiParameters(ADDR_ADDR_UINT, input)
        return { type: 'PAY_PORTION', token, recipient, bips }
      }
      case UR_COMMAND.WRAP_ETH:
      case UR_COMMAND.UNWRAP_WETH: {
        const [recipient, amount] = decodeAbiParameters(ADDR_UINT, input)
        return { type: type === UR_COMMAND.WRAP_ETH ? 'WRAP_ETH' : 'UNWRAP_WETH', recipient, amount }
      }
      case UR_COMMAND.SEAPORT_V1_5: {
        const [value, data] = decodeAbiParameters(SEAPORT, input)
        return { type: 'SEAPORT_V1_5', value, data }
      }
      default:
        return { type: 'UNKNOWN', byte: type, input }
    }
  } catch {
    return { type: 'UNKNOWN', byte: type, input }
  }
}

/** Decode `execute(bytes,bytes[],uint256)` / `execute(bytes,bytes[])` calldata; null when it is neither. */
export function decodeUniversalRouter(data: Hex): DecodedUniversalRouter | null {
  let decoded: { functionName: string; args: readonly unknown[] }
  try {
    decoded = decodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, data }) as { functionName: string; args: readonly unknown[] }
  } catch {
    return null
  }
  const [commandsHex, inputs, deadline] = decoded.args as [Hex, readonly Hex[], bigint | undefined]
  const bytes = commandsHex.slice(2).match(/.{2}/g) ?? []
  const commands: UrCommand[] = []
  const allowRevert: number[] = []
  bytes.forEach((b, i) => {
    const byte = parseInt(b, 16)
    if (byte & 0x80) allowRevert.push(i)
    commands.push(decodeUrCommand(byte, inputs[i] ?? '0x'))
  })
  return { commands, deadline: deadline ?? null, allowRevert }
}

export function urCommandName(byte: number): string {
  return NAMES[byte & 0x3f] ?? `0x${(byte & 0x3f).toString(16).padStart(2, '0')}`
}
