import { describe, it, expect } from 'vitest'
import { decodeFunctionData } from 'viem'
import { buildErc20Revoke, buildSetApprovalForAllRevoke } from '../src/revoke'

const ERC20_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

const SET_APPROVAL_FOR_ALL_ABI = [
  {
    type: 'function',
    name: 'setApprovalForAll',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'operator', type: 'address' },
      { name: 'approved', type: 'bool' },
    ],
    outputs: [],
  },
] as const

const OWNER = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77'
const TOKEN = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
const SPENDER = '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617'

describe('buildErc20Revoke', () => {
  it('targets the token and encodes approve(spender, 0)', () => {
    const tx = buildErc20Revoke(TOKEN, OWNER, SPENDER)
    expect(tx.to).toBe(TOKEN)
    expect(tx.kind).toBe('erc20-approve-0')
    const decoded = decodeFunctionData({ abi: ERC20_APPROVE_ABI, data: tx.data })
    expect(decoded.functionName).toBe('approve')
    expect(decoded.args).toEqual([SPENDER, 0n])
  })
})

describe('buildSetApprovalForAllRevoke', () => {
  it('targets the spender contract and encodes setApprovalForAll(operator, false)', () => {
    const OPERATOR = '0x678748317e7fD5B7699D07e666087608B401cbFd'
    const tx = buildSetApprovalForAllRevoke(OPERATOR, OWNER)
    expect(tx.to).toBe(OPERATOR)
    expect(tx.kind).toBe('set-approval-for-all-false')
    const decoded = decodeFunctionData({ abi: SET_APPROVAL_FOR_ALL_ABI, data: tx.data })
    expect(decoded.functionName).toBe('setApprovalForAll')
    expect(decoded.args).toEqual([OWNER, false])
  })
})
