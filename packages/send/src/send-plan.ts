/**
 * Send plan builder (T4.4) — native + ERC-20.
 *
 * Pure: given balances + a fee rate it returns an *unsigned* transfer plan plus
 * the review-card data (token delta, gas, total, USD on ETN). Signing is T2.2
 * (`LocalSigner.signTransaction`); the caller simulates (T2.3) before arming the
 * breaker. Max for native subtracts an estimated gas fee (balance − gas); max
 * for an ERC-20 is the full token balance (gas is native).
 */
import { encodeFunctionData, type Abi, type Hex } from 'viem'

const ERC20_ABI: Abi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
]

export interface NativeSendInput {
  readonly kind: 'native'
  readonly to: string
  /** Raw wei to send. */
  readonly value: bigint
  /** Native balance the sender holds (wei). */
  readonly balance: bigint
  /** Estimated gas price (wei) — for the max calculation + review. */
  readonly gasPrice: bigint
  /** Estimated intrinsic + calldata gas (units). Default 21000. */
  readonly gasLimit?: bigint
}

export interface Erc20SendInput {
  readonly kind: 'erc20'
  readonly to: string
  readonly tokenAddress: string
  readonly decimals: number
  /** Raw base units to send (e.g. 6dp token → 1_000_000 = 1.0). */
  readonly value: bigint
  /** Sender's token balance (base units). */
  readonly tokenBalance: bigint
  /** Native balance (wei) — needed to pay gas. */
  readonly nativeBalance: bigint
  /** Current allowance (base units) the spender has. 0 for self-transfer. */
  readonly allowance: bigint
  readonly gasPrice: bigint
  readonly gasLimit?: bigint
}

export type SendInput = NativeSendInput | Erc20SendInput

export interface ReviewData {
  /** Human token amount, e.g. "1.0". */
  readonly amountDisplay: string
  readonly symbol: string
  readonly to: string
  /** wei — the native gas cost (units * gasPrice). */
  readonly gasCostWei: bigint
  /** wei — total native out for a native send (value + gas). */
  readonly totalNativeWei: bigint | null
  /** For erc20: true when an approve tx must precede the transfer. */
  readonly needsApprove: boolean
  /** erc20 only — the approve tx (spender = recipient) if needsApprove. */
  readonly approve?: { readonly to: string; readonly value: bigint }
  /** erc20 only — the transfer tx data. */
  readonly txData?: Hex
  /** erc20 only — token address. */
  readonly tokenAddress?: string
}

export interface SendPlan {
  readonly kind: 'native' | 'erc20'
  /** The unsigned transfer payload (to/data/value) to hand to LocalSigner. */
  readonly tx: {
    readonly to: string
    readonly data: Hex
    readonly value: bigint
    readonly gasLimit: bigint
    readonly gasPrice: bigint
  }
  readonly review: ReviewData
}

const DEFAULT_GAS = 21_000n

/** Max native send = balance − estimated gas. Returns null when balance < gas. */
export function maxNativeSend(balance: bigint, gasPrice: bigint, gasLimit = DEFAULT_GAS): bigint | null {
  const gasCost = gasLimit * gasPrice
  const remaining = balance - gasCost
  return remaining > 0n ? remaining : null
}

export function buildSendPlan(input: SendInput): SendPlan {
  const gasLimit = input.gasLimit ?? (input.kind === 'erc20' ? 65_000n : DEFAULT_GAS)
  const gasCost = gasLimit * input.gasPrice

  if (input.kind === 'native') {
    if (input.value < 0n) throw new Error('value must be >= 0')
    if (input.value + gasCost > input.balance) throw new Error('insufficient native balance (incl. gas)')
    return {
      kind: 'native',
      tx: {
        to: input.to,
        data: '0x',
        value: input.value,
        gasLimit,
        gasPrice: input.gasPrice,
      },
      review: {
        amountDisplay: weiToDisplay(input.value, 18, 'ETN'),
        symbol: 'ETN',
        to: input.to,
        gasCostWei: gasCost,
        totalNativeWei: input.value + gasCost,
        needsApprove: false,
      },
    }
  }

  // ERC-20
  const { decimals, to, tokenAddress, value, tokenBalance, allowance } = input
  if (value > tokenBalance) throw new Error('exceeds token balance')
  const needsApprove = allowance < value
  const data = encodeFunctionData({
    abi: ERC20_ABI as Abi,
    functionName: 'transfer',
    args: [to, value],
  })
  return {
    kind: 'erc20',
    tx: { to: tokenAddress, data, value: 0n, gasLimit, gasPrice: input.gasPrice },
    review: {
      amountDisplay: weiToDisplay(value, decimals, ''),
      symbol: '',
      to,
      gasCostWei: gasCost,
      totalNativeWei: null,
      needsApprove,
      approve: needsApprove ? { to, value } : undefined,
      txData: data,
      tokenAddress,
    },
  }
}

/** Format a base-unit amount to a display string (≥1 decimal, trailing zeros trimmed). */
export function weiToDisplay(value: bigint, decimals: number, symbol: string): string {
  const suffix = symbol ? ` ${symbol}` : ''
  if (value === 0n) return `0${suffix}`
  const s = 10n ** BigInt(decimals)
  const whole = value / s
  const frac = value % s
  let out = whole.toString()
  if (frac > 0n) {
    let f = frac.toString().padStart(decimals, '0').slice(0, decimals)
    f = f.replace(/0+$/, '')
    if (f !== '') out = `${out}.${f}`
  } else {
    out = `${out}.0`
  }
  return out + suffix
}
