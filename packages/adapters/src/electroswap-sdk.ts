import { isHex, type Hex, type PublicClient, type TransactionRequest } from 'viem'

/**
 * adapters/electroswap-sdk (T2.4) — viem ⇄ ElectroSwap SDK bridge.
 *
 * The ElectroSwap SDKs (universal-router-sdk, sdk-core) are **ethers/JSBI
 * based** and are consumed prebuilt from the monorepo sdks dist output. We do
 * NOT import them structurally-typed here: the whole point of the bridge is
 * that the rest of BoltVault (viem-native) only ever sees viem types + plain
 * bigint amounts, never an ethers Provider or BigNumber. Because Claude Code is
 * actively refactoring the sdks, everything here is **structural** (reads
 * `.raw` / `.currency`) so it keeps working as long as the SDK keeps those
 * fields.
 */

/** A viem-style token: an address, or 'NATIVE' for the chain gas coin. */
export type ViemToken = { address: `0x${string}` } | { address: 'NATIVE' }

/** The minimal structural shape of the SDK's CurrencyAmount we consume. */
export interface SdkAmount {
  /** JSBI or ethers BigNumber — we only call `.toString()` on it. */
  readonly raw: { toString(): string }
  readonly currency: {
    readonly chainId: number
    readonly decimals: number
    /** present on Token, absent on NativeCurrency */
    readonly address?: string
    readonly symbol?: string
  }
}

/** The minimal structural shape of SwapRouter `MethodParameters`. */
export interface SdkMethodParameters {
  readonly to?: string
  readonly data: string
  readonly value: string | { toString(): string } | null
  readonly valueHex?: string
}

/** Bridge a CurrencyAmount → a plain viem-friendly amount. */
export function fromCurrencyAmount(amt: SdkAmount): {
  readonly token: ViemToken
  readonly chainId: number
  readonly decimals: number
  readonly raw: bigint
  readonly symbol?: string
} {
  const cur = amt.currency
  const addr = cur.address
  const token: ViemToken = addr
    ? { address: normalizeAddr(addr) }
    : { address: 'NATIVE' }
  return {
    token,
    chainId: cur.chainId,
    decimals: cur.decimals,
    raw: BigInt(amt.raw.toString()),
    ...(cur.symbol ? { symbol: cur.symbol } : {}),
  }
}

/** A viem-ready transaction (+ the chainId the signer needs for EIP-155). */
export interface ViemTx extends Omit<TransactionRequest, 'chainId'> {
  readonly chainId: number
}

/** Bridge SwapRouter MethodParameters → a viem-ready tx. */
export function toViemTx(
  p: SdkMethodParameters,
  opts: { from: `0x${string}`; chainId: number },
): ViemTx {
  const value =
    p.valueHex ?? (p.value === null || p.value === undefined ? '0' : p.value.toString())
  const tx: ViemTx = {
    from: opts.from,
    chainId: opts.chainId,
    data: p.data as Hex,
    value: BigInt(value || 0),
  }
  if (p.to) tx.to = normalizeAddr(p.to)
  return tx
}

/**
 * Read-only EIP-1193 provider backed by a viem PublicClient. The SDK (and any
 * ethers-flavoured library) can read chain state through this without us ever
 * handing it a raw ethers Provider (design: "do not leak ethers Provider").
 * Unhandled methods resolve `null` (ethers treats that as "no data").
 */
export function createEip1193Reader(client: PublicClient): {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
} {
  return {
    async request({ method, params = [] }) {
      // viem PublicClient method map (a pragmatic subset)
      switch (method) {
        case 'eth_chainId': {
          const c = await client.getChainId()
          return `0x${c.toString(16)}`
        }
        case 'eth_blockNumber': {
          const b = await client.getBlockNumber()
          return `0x${b.toString(16)}`
        }
        case 'eth_getBalance': {
          const [address, blockTag] = params as [Hex, any]
          const bal = await client.getBalance({ address, blockNumber: toBlockNumber(blockTag) })
          return `0x${bal.toString(16)}`
        }
        case 'eth_getCode': {
          const [address, blockTag] = params as [Hex, any]
          const code = await client.getBytecode({ address, blockNumber: toBlockNumber(blockTag) })
          return code ?? '0x'
        }
        case 'eth_call': {
          const [tx, blockTag] = params as [any, any]
          const res = await client.call({
            ...tx,
            blockNumber: toBlockNumber(blockTag) ?? undefined,
          } as any)
          return (res as { data?: Hex }).data ?? '0x'
        }
        case 'eth_gasPrice': {
          const gp = await client.getGasPrice()
          return `0x${gp.toString(16)}`
        }
        case 'eth_estimateGas': {
          const [tx] = params as [any]
          const g = await client.estimateGas(tx)
          return `0x${g.toString(16)}`
        }
        default:
          return null
      }
    },
  }
}

function normalizeAddr(a: string): `0x${string}` {
  const s = a.startsWith('0x') ? a : `0x${a}`
  if (!isHex(s)) throw new Error(`not hex: ${a}`)
  return s as `0x${string}`
}

function toBlockNumber(tag?: string | number): bigint | undefined {
  if (tag === undefined || tag === 'latest') return undefined
  if (tag === 'pending') return undefined
  if (typeof tag === 'string' && tag.startsWith('0x')) return BigInt(tag)
  if (typeof tag === 'number') return BigInt(tag)
  return undefined
}

export type { PublicClient, TransactionRequest, Hex }
