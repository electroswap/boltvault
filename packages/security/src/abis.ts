/**
 * Minimal ABIs for the standards the decoder must always understand. The
 * ElectroSwap contract ABIs (farm, launchpad, Legends, distributor) come from
 * the synced artifacts in packages/electroswap/abis and join the registry in
 * M6; the standards are human-readable here so the decoder has no JSON
 * dependency.
 */
import { parseAbi } from 'viem'

export const ERC20_ABI = parseAbi([
  'function transfer(address to, uint256 amount) returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function increaseAllowance(address spender, uint256 added) returns (bool)',
  'function permit(address owner, address spender, uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s)',
  'event Transfer(address indexed from, address indexed to, uint256 value)',
  'event Approval(address indexed owner, address indexed spender, uint256 value)',
])

export const ERC721_ABI = parseAbi([
  'function transferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId)',
  'function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)',
  'function approve(address to, uint256 tokenId)',
  'function setApprovalForAll(address operator, bool approved)',
  'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
  'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
])

export const ERC1155_ABI = parseAbi([
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)',
  'function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)',
  'function setApprovalForAll(address operator, bool approved)',
  'event TransferSingle(address indexed operator, address indexed from, address indexed to, uint256 id, uint256 value)',
  'event TransferBatch(address indexed operator, address indexed from, address indexed to, uint256[] ids, uint256[] values)',
])

export const PERMIT2_ABI = parseAbi([
  'function approve(address token, address spender, uint160 amount, uint48 expiration)',
  'function lockdown((address token, address spender)[] approvals)',
  'function invalidateNonces(address token, address spender, uint48 newNonce)',
])

export const WETH_ABI = parseAbi(['function deposit() payable', 'function withdraw(uint256 wad)'])

export const UNIVERSAL_ROUTER_ABI = parseAbi([
  'function execute(bytes commands, bytes[] inputs, uint256 deadline) payable',
  'function execute(bytes commands, bytes[] inputs) payable',
])

export const MULTICALL3_ABI = parseAbi([
  'function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[] returnData)',
  'function aggregate((address target, bytes callData)[] calls) payable returns (uint256 blockNumber, bytes[] returnData)',
])

/** EsLimitOrderManagerV1 (§8.6) — the calls the wallet itself makes. */
export const LIMIT_ORDERS_ABI = parseAbi([
  'function submitOrder(address tokenIn, address tokenOut, bool unwrapOutput, uint256 amountInExact, uint256 amountOutMin, address recipient, uint256 duration)',
  'function submitOrderWithPermit(address tokenIn, address tokenOut, bool unwrapOutput, uint256 amountInExact, uint256 amountOutMin, address recipient, uint256 duration, ((address token, uint160 amount, uint48 expiration, uint48 nonce) details, address spender, uint256 sigDeadline) permitSingle, bytes permitSignature)',
  'function closeOrder(uint256 orderId)',
  'function closeOrders(uint256[] orderIds)',
])

/** ElectroSwap yield farm (§8.8). */
export const FARM_ABI = parseAbi(['function deposit(uint256 _farmId, uint256 _amount0, uint256 _amount1, uint256 _amountBolt) payable', 'function withdraw(uint256 _farmId, uint256 _liquidityAmt, bool _asNative)'])

/** Launchpad pools and referrals (§8.9). Pools are per campaign, so these are matched by selector on any address the wallet itself targets. */
export const LAUNCHPAD_ABI = parseAbi(['function contribute(address referrer) payable', 'function claimTokens(address recipient)', 'function claimRefund(address recipient)', 'function claimReferralRewards()'])

/** Seaport 1.5 fulfilment and cancellation (§8.10). */
export const SEAPORT_ABI = parseAbi([
  'struct OfferItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; }',
  'struct ConsiderationItem { uint8 itemType; address token; uint256 identifierOrCriteria; uint256 startAmount; uint256 endAmount; address recipient; }',
  'struct OrderParameters { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 totalOriginalConsiderationItems; }',
  'struct OrderComponents { address offerer; address zone; OfferItem[] offer; ConsiderationItem[] consideration; uint8 orderType; uint256 startTime; uint256 endTime; bytes32 zoneHash; uint256 salt; bytes32 conduitKey; uint256 counter; }',
  'struct Order { OrderParameters parameters; bytes signature; }',
  'function fulfillOrder(Order order, bytes32 fulfillerConduitKey) payable returns (bool fulfilled)',
  'function cancel(OrderComponents[] orders) returns (bool cancelled)',
])

/** Electric Legends dividends and the marketplace minter (§8.10). */
export const DIVIDENDS_ABI = parseAbi(['function register(uint256[] tokenIds)', 'function claimDividends(uint256[] tokenIds)'])
export const MINTER_ABI = parseAbi(['function mint(address collection, uint256 mintCount) payable'])

/** Event topic0 hashes the simulator reads from traces. */
export const TOPICS = {
  transfer: '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',
  approval: '0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925',
  approvalForAll: '0x17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31',
  transferSingle: '0xc3d58168c5ae7397731d063d5bbf3d657854427343f4c083240f7aacaa2d0f62',
  transferBatch: '0x4a39dc06d4c0dbc64b70af90fd698a233a518aa5d07e595d983b8c0526c8f7fb',
} as const
