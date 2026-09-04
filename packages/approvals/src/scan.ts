/**
 * Multicall scan plan (T6.2, design "Approvals").
 *
 * PURE plan builder — no RPC here. The caller encodes each probe as
 * `ERC20.allowance(owner, spender)` calldata and multicalls the batch via
 * `chunkMulticall` from `@boltvault/chains` (T2.1). `owner` is the allowance
 * owner (the wallet) — it is constant for the whole scan and is threaded
 * through the signature so the caller can encode the calls without
 * re-deriving it.
 *
 * The same plan shape covers Permit2: for the Permit2 spender the allowance is
 * `Permit2.allowance(owner, token, spender-of-record)` — the flat
 * (token × known spender) grid below is what the caller expands.
 */
import type { SpenderKind } from './known-spenters'
import { knownSpenters } from './known-spenters'

export interface AllowanceProbe {
  readonly token: string
  readonly spender: string
  readonly spenderKind: SpenderKind
}

/**
 * Flat list of allowance probes for every token × every known spender of the
 * chain (tokens.length × 6 entries). The caller encodes
 * `allowance(owner, spender)` per probe and multicalls via `chunkMulticall`.
 */
export function buildAllowanceProbe(
  owner: string,
  tokens: readonly string[],
  chainId: number,
): { readonly owner: string; readonly probes: AllowanceProbe[] } {
  const spenders = knownSpenters(chainId)
  const probes: AllowanceProbe[] = []
  for (const token of tokens) {
    for (const s of spenders) {
      probes.push({ token, spender: s.address, spenderKind: s.kind })
    }
  }
  return { owner, probes }
}
