/**
 * The approved eip155 namespaces for a session (CAIP-25): every chain the
 * wallet knows that the dApp required or asked for, one account on each,
 * the methods the rpcFlow serves, and the two events it emits. A required
 * chain the wallet does not have makes the proposal unsatisfiable.
 */
import { caipAccount, caipChain, chainIdFromCaip, type ApprovedNamespaces, type SessionProposal } from './walletkit'

/** Methods the engine's rpcFlow answers over WalletConnect (the APPROVAL and CONNECT classes, plus the SAFE reads dApps ask wallets for). */
/*
  `eth_signTypedData` is not here (ES-BV-053).

  The unversioned method is in `REJECTED_METHODS` — its encoding is
  ambiguous and no wallet should sign it — so advertising it at the Connect
  sheet promised something the flow refuses on arrival. A dApp that reads the
  namespace and picks it gets a refusal it could have avoided, and the user
  gets a failure that looks like the wallet's.
*/
export const WC_METHODS = ['eth_sendTransaction', 'personal_sign', 'eth_signTypedData_v4', 'eth_signTypedData_v3', 'wallet_switchEthereumChain', 'wallet_addEthereumChain', 'wallet_watchAsset', 'wallet_getCapabilities', 'eth_accounts', 'eth_chainId', 'eth_requestAccounts'] as const

export const WC_EVENTS = ['accountsChanged', 'chainChanged'] as const

export interface NamespaceInput {
  readonly proposal: SessionProposal
  /** Chains this wallet can serve. */
  readonly knownChainIds: readonly number[]
  readonly address: string
  /** The chain the site session starts on; always included. */
  readonly homeChainId: number
}

export type NamespaceOutcome = { readonly ok: true; readonly namespaces: ApprovedNamespaces; readonly chainIds: number[] } | { readonly ok: false; readonly missing: string[] }

export function buildNamespaces(input: NamespaceInput): NamespaceOutcome {
  const known = new Set(input.knownChainIds)
  const required = input.proposal.requiredNamespaces['eip155']?.chains ?? []
  const optional = input.proposal.optionalNamespaces['eip155']?.chains ?? []
  const missing = required.filter((c) => {
    const id = chainIdFromCaip(c)
    return id === null || !known.has(id)
  })
  if (missing.length) return { ok: false, missing }
  const chainIds = new Set<number>([input.homeChainId])
  for (const c of [...required, ...optional]) {
    const id = chainIdFromCaip(c)
    if (id !== null && known.has(id)) chainIds.add(id)
  }
  const ordered = [...chainIds]
  return {
    ok: true,
    chainIds: ordered,
    namespaces: {
      eip155: {
        chains: ordered.map(caipChain),
        accounts: ordered.map((id) => caipAccount(id, input.address)),
        methods: [...WC_METHODS],
        events: [...WC_EVENTS],
      },
    },
  }
}
