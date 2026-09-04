/**
 * Send/Swap/Bridge/Approvals filters (design T5.5). Which token actions are
 * available for a token in the wallet.
 *
 * Rules (fixed order, deduped):
 *   1. 'send'      — always (you can send a token you hold)
 *   2. 'swap'      — when in-wallet swap is enabled (ETN + pinned fee sink)
 *   3. 'bridge'    — when the token is a Warp/Hyperlane bridged asset
 *   4. 'approvals' — when the token has outstanding approvals to manage/revoke
 */
export type TokenAction = 'send' | 'swap' | 'bridge' | 'approvals'

export interface TokenActionContext {
  readonly chainId: number
  readonly address: string
  readonly isNative: boolean
  readonly isWarpAsset: boolean
  readonly hasApprovals: boolean
  readonly inWalletSwapEnabled: boolean
}

export function availableActions(ctx: TokenActionContext): TokenAction[] {
  const actions: TokenAction[] = ['send']
  if (ctx.inWalletSwapEnabled) actions.push('swap')
  if (ctx.isWarpAsset) actions.push('bridge')
  if (ctx.hasApprovals) actions.push('approvals')
  return actions
}
