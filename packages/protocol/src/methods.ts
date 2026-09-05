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
