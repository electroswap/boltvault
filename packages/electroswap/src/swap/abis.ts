/**
 * ABIs for the swap path (master plan §8.6): the quoters we read, the
 * Universal Router we execute, Permit2, the fee schedule (§8.18), the
 * fee-on-transfer detector and the limit-order manager. Human-readable so
 * the shapes are reviewable in one place; the ElectroSwap artifacts in
 * ../../abis are the reference for the contract ones.
 */
import { parseAbi } from 'viem'

export const QUOTER_V2_ABI = parseAbi([
  'function quoteExactInputSingle((address tokenIn, address tokenOut, uint256 amountIn, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
  'function quoteExactOutputSingle((address tokenIn, address tokenOut, uint256 amount, uint24 fee, uint160 sqrtPriceLimitX96) params) returns (uint256 amountIn, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate)',
  /*
    The multi-hop exact-output quote. Its `path` runs OUTPUT first — V3 walks an
    exact-output path backwards, from the token you want to the token you pay —
    which is the opposite of `quoteExactInput`'s. `v3PackedPathExactOut` is the
    only place that reversal is expressed, so the quoter and the router are
    always handed the same bytes.
  */
  'function quoteExactOutput(bytes path, uint256 amountOut) returns (uint256 amountIn, uint160[] sqrtPriceX96AfterList, uint32[] initializedTicksCrossedList, uint256 gasEstimate)',
])

/** Uniswap's MixedRouteQuoterV1: V2 hops carry the fee sentinel 0x800000 in the path. */
export const MIXED_ROUTE_QUOTER_ABI = parseAbi([
  'function quoteExactInput(bytes path, uint256 amountIn) returns (uint256 amountOut, uint160[] v3SqrtPriceX96AfterList, uint32[] v3InitializedTicksCrossedList, uint256 v3SwapGasEstimate)',
])

export const V2_ROUTER_ABI = parseAbi([
  'function getAmountsOut(uint256 amountIn, address[] path) view returns (uint256[] amounts)',
  /** V2's exact-output quote. Unlike V3's, its `path` stays in trade order — input first. */
  'function getAmountsIn(uint256 amountOut, address[] path) view returns (uint256[] amounts)',
])

export const V2_FACTORY_ABI = parseAbi(['function getPair(address tokenA, address tokenB) view returns (address pair)'])
export const V3_FACTORY_ABI = parseAbi(['function getPool(address tokenA, address tokenB, uint24 fee) view returns (address pool)'])

export const UNIVERSAL_ROUTER_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable', 'function execute(bytes commands, bytes[] inputs) payable'])

export const PERMIT2_ABI = parseAbi([
  'function allowance(address owner, address token, address spender) view returns (uint160 amount, uint48 expiration, uint48 nonce)',
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
])

export const ERC20_ABI = parseAbi([
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function balanceOf(address owner) view returns (uint256)',
  'function decimals() view returns (uint8)',
])

/** BoltVaultFeeSchedule (contracts/src/BoltVaultFeeSchedule.sol). */
export const FEE_SCHEDULE_ABI = parseAbi([
  'function feeBipsFor(address account) view returns (uint16 bips, uint8 tier, uint256 score)',
  'function schedule() view returns (uint16 baseBips, (uint256 minScore, uint16 bips)[] tiers, uint256 dynoWeight, bool countFarmBolt)',
  'function baseBips() view returns (uint16)',
])

/** Uniswap's FeeOnTransferDetector (the interface's useSwapTaxes). */
/*
  The detector ElectroSwap actually deployed, which returns two fields.

  This ABI used to declare five — `feeTakenOnTransfer`, `externalTransferFailed`
  and `sellReverted` as well — which is the shape of a *later* Uniswap
  FeeOnTransferDetector. The deployed contract
  (`contracts/electroswap/ElectroSwapV3`, verified) returns
  `TokenFees{buyFeeBps, sellFeeBps}` and nothing else, so every decode of a
  two-word return against a five-field tuple failed and the probe has never
  once succeeded. The three extra fields were always `undefined`, which is why
  the `sellReverted` guard never fired either.

  It matches `packages/electroswap/abis/FeeOnTransferDetector.json`, which is
  synced from the interface and had it right all along.
*/
export const FOT_DETECTOR_ABI = parseAbi([
  'function validate(address token, address baseToken, uint256 amountToBorrow) returns ((uint256 buyFeeBps, uint256 sellFeeBps) fees)',
  'function batchValidate(address[] tokens, address baseToken, uint256 amountToBorrow) returns ((uint256 buyFeeBps, uint256 sellFeeBps)[] fotResults)',
])

/** EsLimitOrderManagerV1 (apps/interface/src/abis/limit-orders.json, synced). */
export const LIMIT_ORDERS_ABI = parseAbi([
  'function submitOrder(address tokenIn, address tokenOut, bool unwrapOutput, uint256 amountInExact, uint256 amountOutMin, address recipient, uint256 duration)',
  'function submitOrderWithPermit(address tokenIn, address tokenOut, bool unwrapOutput, uint256 amountInExact, uint256 amountOutMin, address recipient, uint256 duration, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes permitSignature)',
  'function closeOrder(uint256 orderId)',
  'function closeOrders(uint256[] orderIds)',
  'function openOrdersByUser(address user) view returns (uint256[])',
  'function closedOrdersByUser(address user) view returns (uint256[])',
  'function isOrderValid(uint256 orderId) view returns (bool)',
  'function lastOrderId() view returns (uint256)',
])
