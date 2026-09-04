import { describe, expect, it } from 'vitest'
import type { PublicClient } from 'viem'
import {
  createEip1193Reader,
  fromCurrencyAmount,
  toViemTx,
  type SdkAmount,
  type SdkMethodParameters,
} from '../src/index.js'

// Minimal fake SDK CurrencyAmount (structural — mirrors sdk-core shape).
function fakeAmount(opts: {
  raw: string
  chainId: number
  decimals: number
  address?: string
  symbol?: string
}): SdkAmount {
  return {
    raw: { toString: () => opts.raw },
    currency: {
      chainId: opts.chainId,
      decimals: opts.decimals,
      ...(opts.address ? { address: opts.address } : {}),
      ...(opts.symbol ? { symbol: opts.symbol } : {}),
    },
  }
}

describe('adapters/electroswap-sdk (T2.4)', () => {
  it('bridges a token CurrencyAmount to a viem amount', () => {
    const a = fromCurrencyAmount(
      fakeAmount({
        raw: '1000000000000000000',
        chainId: 52014,
        decimals: 18,
        address: '0x' + 'cd'.repeat(20),
        symbol: 'FOO',
      }),
    )
    expect(a.raw).toBe(1_000_000_000_000_000_000n)
    expect(a.decimals).toBe(18)
    expect(a.chainId).toBe(52014)
    expect((a.token as any).address).toBe('0x' + 'cd'.repeat(20))
  })

  it('bridges a NativeCurrency amount (no address) to NATIVE', () => {
    const a = fromCurrencyAmount(
      fakeAmount({ raw: '5', chainId: 52014, decimals: 18, symbol: 'ETN' }),
    )
    expect((a.token as any).address).toBe('NATIVE')
    expect(a.raw).toBe(5n)
  })

  it('bridges MethodParameters to a viem TransactionRequest (value + to + data)', () => {
    const p: SdkMethodParameters = {
      to: '0x' + 'ef'.repeat(20),
      data: '0xdeadbeef',
      value: { toString: () => '25' },
    }
    const tx = toViemTx(p, { from: `0x${'11'.repeat(20)}`, chainId: 52014 })
    expect(tx.to).toBe('0x' + 'ef'.repeat(20))
    expect(tx.value).toBe(25n)
    expect(tx.data).toBe('0xdeadbeef')
    expect(tx.chainId).toBe(52014)
  })

  it('treats null value as 0 and omits to when absent', () => {
    const p: SdkMethodParameters = { data: '0x', value: null }
    const tx = toViemTx(p, { from: `0x${'11'.repeat(20)}`, chainId: 52014 })
    expect(tx.value).toBe(0n)
    expect(tx.to).toBeUndefined()
  })

  it('createEip1193Reader maps read methods off a viem client', async () => {
    // Stub the viem PublicClient surface the reader uses.
    const client = {
      getChainId: async () => 52014,
      getBlockNumber: async () => 1000n,
      getBalance: async () => 10n ** 18n,
      getBytecode: async () => '0x60016001',
      call: async () => ({ data: '0x' + 'ab'.repeat(32) }),
      getGasPrice: async () => 20_000_000_000n,
      estimateGas: async () => 21_000n,
    } as unknown as PublicClient
    const reader = createEip1193Reader(client)
    expect(await reader.request({ method: 'eth_chainId' })).toBe(
      `0x${(52014).toString(16)}`,
    )
    expect(await reader.request({ method: 'eth_blockNumber' })).toBe('0x3e8')
    expect(await reader.request({ method: 'eth_getBalance', params: ['0x' + '11'.repeat(20)] })).toBe(
      `0x${(10n ** 18n).toString(16)}`,
    )
    expect(
      await reader.request({
        method: 'eth_call',
        params: [{ to: '0x' + 'cd'.repeat(20), data: '0x' }, 'latest'],
      }),
    ).toBe('0x' + 'ab'.repeat(32))
    expect(await reader.request({ method: 'eth_estimateGas', params: [{ from: '0x' + '11'.repeat(20) }] })).toBe(
      `0x${(21000).toString(16)}`,
    )
    // unknown method → null
    expect(await reader.request({ method: 'eth_somethingElse' })).toBeNull()
  })
})
