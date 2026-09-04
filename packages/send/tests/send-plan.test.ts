import { describe, expect, it } from 'vitest'
import { decodeFunctionData, isHex } from 'viem'
import {
  buildSendPlan,
  maxNativeSend,
  weiToDisplay,
  type NativeSendInput,
  type Erc20SendInput,
} from '../src'

const TO = '0xb2b2b2b2b2B2b2B2B2b2b2B2B2b2B2B2b2b2b2b2'
const TOKEN = '0xA1A1a1a1A1A1A1A1A1a1a1a1a1a1A1A1a1A1a1a1'

describe('weiToDisplay', () => {
  it('formats whole + fractional, ≥1 decimal, trimming trailing zeros', () => {
    expect(weiToDisplay(1_000_000n, 6, 'USDC')).toBe('1.0 USDC')
    expect(weiToDisplay(1_234_500n, 6, 'USDC')).toBe('1.2345 USDC')
    expect(weiToDisplay(10n ** 18n, 18, 'ETN')).toBe('1.0 ETN')
    expect(weiToDisplay(5n, 18, 'ETN')).toBe('0.000000000000000005 ETN')
    expect(weiToDisplay(0n, 18, 'ETN')).toBe('0 ETN')
    expect(weiToDisplay(2_000_000n, 6, 'USDC')).toBe('2.0 USDC')
  })
})

describe('maxNativeSend', () => {
  it('subtracts estimated gas; null when balance < gas', () => {
    const gasPrice = 10n
    const gasLimit = 21_000n
    const bal = 1_000_000n
    expect(maxNativeSend(bal, gasPrice)).toBe(bal - gasLimit * gasPrice)
    // balance smaller than the gas cost → null (can't afford even the fee)
    expect(maxNativeSend(100_000n, gasPrice)).toBeNull()
  })
})

describe('buildSendPlan native', () => {
  const gasPrice = 10n
  const base: NativeSendInput = {
    kind: 'native',
    to: TO,
    value: 10n ** 18n,
    balance: 10n ** 19n,
    gasPrice,
  }

  it('builds an unsigned native tx (data 0x) with review totals', () => {
    const plan = buildSendPlan(base)
    expect(plan.kind).toBe('native')
    expect(plan.tx.to).toBe(TO)
    expect(plan.tx.data).toBe('0x')
    expect(plan.tx.value).toBe(10n ** 18n)
    const gasCost = plan.tx.gasLimit * plan.tx.gasPrice
    expect(plan.review.totalNativeWei).toBe(plan.tx.value + gasCost)
    expect(plan.review.needsApprove).toBe(false)
    expect(plan.review.amountDisplay).toContain('ETN')
  })

  it('throws when value + gas > balance', () => {
    // balance is exactly value + gas - 1 → insufficient
    const gasCost = 21_000n * gasPrice
    const insufficient = base.value + gasCost - 1n
    expect(() => buildSendPlan({ ...base, balance: insufficient })).toThrow(/insufficient/)
  })
})

describe('buildSendPlan erc20', () => {
  const base: Erc20SendInput = {
    kind: 'erc20',
    to: TO,
    tokenAddress: TOKEN,
    decimals: 6,
    value: 1_000_000n, // 1.0 USDC
    tokenBalance: 5_000_000n,
    nativeBalance: 10n ** 18n,
    allowance: 0n,
    gasPrice: 10n,
  }

  it('encodes ERC-20 transfer(to, amount) and flags needsApprove when allowance < value', () => {
    const plan = buildSendPlan(base)
    expect(plan.kind).toBe('erc20')
    expect(plan.tx.to).toBe(TOKEN)
    expect(plan.tx.value).toBe(0n)
    expect(plan.review.needsApprove).toBe(true)
    expect(plan.review.approve).toBeDefined()
    const dec = decodeFunctionData({
      abi: [
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
      ],
      data: plan.tx.data,
    })
    expect(dec.functionName).toBe('transfer')
    expect(dec.args).toEqual([TO, 1_000_000n])
    expect(isHex(plan.tx.data)).toBe(true)
  })

  it('no approve needed when allowance is sufficient', () => {
    const plan = buildSendPlan({ ...base, allowance: 1_000_000n })
    expect(plan.review.needsApprove).toBe(false)
    expect(plan.review.approve).toBeUndefined()
  })

  it('throws when value > token balance', () => {
    expect(() => buildSendPlan({ ...base, value: 6_000_000n })).toThrow(/token balance/)
  })
})
