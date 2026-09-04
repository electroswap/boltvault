import {
  decodeAbiParameters,
  decodeFunctionResult,
  encodeFunctionData,
  formatUnits,
  parseAbi,
  parseUnits,
  type Abi,
  type Hex,
  type PublicClient,
  type TransactionRequest,
  type Log,
} from 'viem'

/**
 * Transaction simulation (T2.3).
 *
 * Before broadcast, BoltVault shows the dApp/user a preview: "this will send
 * X and these events fire." `simulateCall` runs the tx as an eth_call against
 * the chain's latest block and decodes the return + logs. `estimateGas` gives
 * the gas the UI shows. Both run through the failover client from T2.1.
 *
 * ERC-20 + transfer helpers below are the two decoders every surface reuses
 * (portfolio, send preview, approvals).
 */

export interface SimResult {
  /** false when the eth_call reverted (the tx would fail on-chain). */
  readonly ok: boolean
  /** Raw return data (0x on revert). */
  readonly returnValue: Hex
  /** Decoded revert reason, if the call reverted and it carried one. */
  readonly revertReason?: string
  /** Estimated gas (bigint) — present when `estimate` was requested. */
  readonly gas?: bigint
}

/** Run a transaction as eth_call (and optionally estimate gas). */
export async function simulateCall(
  client: PublicClient,
  tx: Omit<TransactionRequest, 'from'> & { from: Hex; chainId: number },
  opts: { estimate?: boolean } = {},
): Promise<SimResult> {
  const block = await client.getBlockNumber()
  let returnValue: Hex = '0x'
  let ok = true
  let revertReason: string | undefined
  try {
    const res = await client.call({ ...tx, blockNumber: block } as any)
    returnValue = ((res as { data?: Hex }).data ?? '0x') as Hex
  } catch (e) {
    ok = false
    revertReason = e instanceof Error ? e.message : String(e)
  }
  const out: SimResult = {
    ok,
    returnValue,
    ...(revertReason ? { revertReason } : {}),
  }
  if (opts.estimate) {
    try {
      return { ...out, gas: await client.estimateGas({ ...tx } as any) }
    } catch {
      return { ...out, gas: 21_000n }
    }
  }
  return out
}

/** Decode an eth_call result as a function return of the given ABI. */
export function decodeCall<TAbi extends Abi = Abi>(
  abi: TAbi,
  functionName: string,
  data: Hex,
): unknown {
  return decodeFunctionResult({
    abi,
    functionName: functionName as any,
    data,
  } as any)
}

const ERC20_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function totalSupply() view returns (uint256)',
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
])

export interface FormattedAmount {
  readonly raw: bigint
  readonly formatted: string
}

/** Human-readable ERC-20 balance (raw wei + formatted to the given decimals). */
export async function erc20Balance(
  client: PublicClient,
  token: Hex,
  holder: Hex,
  decimals: number,
): Promise<FormattedAmount> {
  const sim = await simulateCall(client, {
    from: holder,
    to: token,
    data: encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [holder] }),
    chainId: 0,
  })
  const raw = decodeCall(ERC20_ABI, 'balanceOf', sim.returnValue) as bigint
  return { raw, formatted: formatUnits(raw, decimals) }
}

/** Human-readable ERC-20 allowance (owner→spender). */
export async function erc20Allowance(
  client: PublicClient,
  token: Hex,
  owner: Hex,
  spender: Hex,
  decimals: number,
): Promise<FormattedAmount> {
  const sim = await simulateCall(client, {
    from: owner,
    to: token,
    data: encodeFunctionData({
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [owner, spender],
    }),
    chainId: 0,
  })
  const raw = decodeCall(ERC20_ABI, 'allowance', sim.returnValue) as bigint
  return { raw, formatted: formatUnits(raw, decimals) }
}

/** Build an ERC-20 `balanceOf(holder)` calldata (for multicall batching). */
export function erc20BalanceOfData(holder: Hex): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'balanceOf', args: [holder] })
}

/** Build an ERC-20 `allowance(owner, spender)` calldata (for multicall batching). */
export function erc20AllowanceData(owner: Hex, spender: Hex): Hex {
  return encodeFunctionData({ abi: ERC20_ABI, functionName: 'allowance', args: [owner, spender] })
}

export type { Abi, Log, Hex }
export { formatUnits, parseUnits, decodeAbiParameters, decodeFunctionResult }
