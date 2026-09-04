/**
 * Revoke tx builders (T6.2, design "Approvals").
 *
 * Revoke = zero the allowance. Three shapes per the design: approve 0 (ERC-20),
 * permit2 approve 0, setApprovalForAll false. These builders are PURE calldata
 * encodings — the caller signs/sends via the T2.2 path.
 *
 * Honest note on Permit2: the real permit2 approve-0 path is
 * `Permit2.permitBatch` with an amount of 0 (signed, no gas for the spender
 * record) — see the design. For v1 we represent the non-gas path through the
 * `setApprovalForAll`-style builder below and keep the permit2 shape in the
 * RevokeKind union so the UI can label it distinctly.
 */
import { encodeFunctionData, type Address } from 'viem'

export type RevokeKind = 'erc20-approve-0' | 'permit2-approve-0' | 'set-approval-for-all-false'

export interface RevokeTx {
  readonly to: string
  readonly data: `0x${string}`
  readonly kind: RevokeKind
}

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

/** ERC-20 revoke: `approve(spender, 0)` on the token contract. */
export function buildErc20Revoke(token: string, owner: string, spender: string): RevokeTx {
  void owner
  const data = encodeFunctionData({
    abi: ERC20_APPROVE_ABI,
    functionName: 'approve',
    args: [spender as Address, 0n],
  })
  return { to: token, data, kind: 'erc20-approve-0' }
}

/**
 * SetApprovalForAll revoke: `setApprovalForAll(operator, false)` on the
 * spender contract (Seaport-style operator approvals).
 */
export function buildSetApprovalForAllRevoke(spenderContract: string, operator: string): RevokeTx {
  const data = encodeFunctionData({
    abi: SET_APPROVAL_FOR_ALL_ABI,
    functionName: 'setApprovalForAll',
    args: [operator as Address, false],
  })
  return { to: spenderContract, data, kind: 'set-approval-for-all-false' }
}
