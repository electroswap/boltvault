/**
 * The method table (master plan §4.6). A method's class decides the funnel:
 * SAFE runs with no UI, CONNECT opens the Connect sheet, APPROVAL opens the
 * signing sheet, CHAIN manages the origin's session, REJECTED answers 4200.
 */
export type MethodClass = 'safe' | 'connect' | 'approval' | 'chain' | 'rejected' | 'unknown'

export const SAFE_METHODS: ReadonlySet<string> = new Set([
  'eth_chainId',
  'net_version',
  'net_listening',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_getBalance',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_sendRawTransaction',
  'web3_clientVersion',
  'wallet_getCapabilities',
  'wallet_getPermissions',
  'eth_accounts',
  'eth_subscribe',
  'eth_unsubscribe',
  'boltvault_feePolicy',
])

/**
 * The SAFE methods any origin may call without ever connecting.
 *
 * Discovery needs these: EIP-1193 expects a provider to answer `eth_chainId`
 * before a page decides whether to prompt. They reveal nothing about the user —
 * `eth_accounts` returns `[]` until a session exists.
 */
export const PUBLIC_METHODS: ReadonlySet<string> = new Set([
  'eth_chainId',
  'net_version',
  'net_listening',
  'web3_clientVersion',
  'eth_accounts',
  'wallet_getPermissions',
])

/**
 * SAFE methods that require a connected origin.
 *
 * The at-rest audit's F4 was reported as "a connected dApp can read the address
 * and balance", which is the intended EIP-1193 model. The real defect it
 * pointed at is different: the connection gate only ever existed in the
 * approval funnel, so *any* page the user visited — never connected, never
 * prompted — could reach chain state through the wallet's RPC at 60 req/s, and
 * could broadcast an already-signed transaction with `eth_sendRawTransaction`.
 * That made the wallet an open RPC relay for the whole web.
 *
 * Requiring a session here costs compatibility with dApps that probe chain
 * state before prompting to connect; they now get 4100 until the user connects.
 */
export const SESSION_METHODS: ReadonlySet<string> = new Set([
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_getBalance',
  /*
    The wallet fee ElectroSwap's own site should charge for this account
    (master plan §8.6, §8.18). It is here rather than in PUBLIC_METHODS
    because the answer is a reading of what the account holds: the tier is a
    BOLT/DYNO balance in four buckets, and a page that could ask before
    connecting would learn it of anyone who merely visited. `RpcFlow.safe`
    narrows it further — only ElectroSwap's own origins get an answer at all.
  */
  'boltvault_feePolicy',
  'eth_getCode',
  'eth_getStorageAt',
  'eth_getLogs',
  'eth_getTransactionReceipt',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
  'eth_gasPrice',
  'eth_maxPriorityFeePerGas',
  'eth_feeHistory',
  'eth_getBlockByNumber',
  'eth_getBlockByHash',
  'eth_sendRawTransaction',
  'wallet_getCapabilities',
  'eth_subscribe',
  'eth_unsubscribe',
])

export const CONNECT_METHODS: ReadonlySet<string> = new Set(['eth_requestAccounts', 'wallet_requestPermissions'])

export const APPROVAL_METHODS: ReadonlySet<string> = new Set(['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v3', 'eth_signTypedData_v4', 'eth_sign', 'wallet_watchAsset'])

export const CHAIN_METHODS: ReadonlySet<string> = new Set(['wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_revokePermissions'])

export const REJECTED_METHODS: ReadonlySet<string> = new Set([
  'eth_signTransaction',
  'eth_signTypedData',
  'eth_signTypedData_v1',
  'eth_getEncryptionPublicKey',
  'eth_decrypt',
  'wallet_sendCalls',
  'wallet_getCallsStatus',
  'wallet_showCallsStatus',
  'eth_coinbase',
])

export function classify(method: string): MethodClass {
  if (SAFE_METHODS.has(method)) return 'safe'
  if (CONNECT_METHODS.has(method)) return 'connect'
  if (APPROVAL_METHODS.has(method)) return 'approval'
  if (CHAIN_METHODS.has(method)) return 'chain'
  if (REJECTED_METHODS.has(method)) return 'rejected'
  return 'unknown'
}

/** Methods the page provider must hold while the tab is hidden (§4.3). */
export function needsUserAttention(method: string): boolean {
  const c = classify(method)
  return c === 'connect' || c === 'approval' || method === 'wallet_addEthereumChain'
}

/** The largest eth_getLogs block range served from a dApp (§4.6). */
export const MAX_LOG_RANGE = 10_000

/** SAFE requests per second per origin. */
export const SAFE_RATE_PER_SECOND = 60
/**
 * A much lower budget for the classes that do work per call (ES-BV-016).
 *
 * `eth_requestAccounts` on an already-connected origin touches the site row,
 * and switching between two already-allowed chains persists the choice — so
 * either one, called in a loop, re-encrypts the whole sites blob as fast as
 * the page can ask. No honest page connects or switches chains five times a
 * second; the leaky bucket refills, so a burst is still absorbed.
 */
export const CONNECT_RATE_PER_SECOND = 5
