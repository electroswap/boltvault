import { describe, expect, it } from 'vitest'
import { availableActions, type TokenActionContext } from '../src/actions'

const base: TokenActionContext = {
  chainId: 52014,
  address: '0xabc',
  isNative: false,
  isWarpAsset: false,
  hasApprovals: false,
  inWalletSwapEnabled: false,
}

describe('availableActions', () => {
  it('always includes send, first', () => {
    expect(availableActions(base)).toEqual(['send'])
  })
  it('native warp asset on ETN with swap enabled + approvals → all four in order', () => {
    const ctx: TokenActionContext = {
      ...base,
      isNative: true,
      isWarpAsset: true,
      hasApprovals: true,
      inWalletSwapEnabled: true,
    }
    expect(availableActions(ctx)).toEqual(['send', 'swap', 'bridge', 'approvals'])
  })
  it('non-warp, swap-disabled, no approvals → send only', () => {
    expect(availableActions(base)).toEqual(['send'])
  })
  it('warp but swap disabled → send + bridge', () => {
    const ctx: TokenActionContext = { ...base, isWarpAsset: true }
    expect(availableActions(ctx)).toEqual(['send', 'bridge'])
  })
  it('swap enabled but no warp/approvals → send + swap', () => {
    const ctx: TokenActionContext = { ...base, inWalletSwapEnabled: true }
    expect(availableActions(ctx)).toEqual(['send', 'swap'])
  })
  it('approvals only → send + approvals', () => {
    const ctx: TokenActionContext = { ...base, hasApprovals: true }
    expect(availableActions(ctx)).toEqual(['send', 'approvals'])
  })
})
