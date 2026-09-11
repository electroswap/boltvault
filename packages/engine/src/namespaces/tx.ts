/**
 * Speed up and cancel a stuck transaction (master plan §2.4, §8.12).
 *
 * Both are the same trick: sign a new transaction at the SAME nonce with a fee
 * high enough that a node will replace the one already in its pool. Speed up
 * repeats the original call; cancel replaces it with a transfer of nothing to
 * yourself, which is the cheapest possible way to burn the nonce.
 *
 * Neither is offered on Electroneum. §8.12: "ETN has no speed-up (5 s)" — a
 * five-second block means a transaction is either already mined or never got
 * out, and a replacement would be a race the user cannot win. Saying so is
 * better than offering a button that does nothing.
 *
 * The replacement goes through `submitInternal` like every other transaction
 * the wallet raises itself, so it gets the same firewall, the same sheet and
 * the same write-ahead row. Nothing here signs anything.
 */
import { isElectroneumChainId } from '@boltvault/chains'
import type { Platform } from '@boltvault/platform'
import type { Hex } from 'viem'
import { z } from 'zod'
import type { ActivityStore } from '../activityStore'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { type ActivityEntry } from '../schema'
import type { ChainsService } from './chains'
import type { ProviderService } from './provider'
import type { VaultManager } from './vault'

/**
 * The bump a node needs before it will evict the transaction already in its
 * pool. Geth wants 10 % on every fee field; 12.5 % is the number the rest of
 * the ecosystem settled on, and paying the extra 2.5 % beats having the
 * replacement silently rejected as underpriced.
 */
const BUMP_NUMERATOR = 1125n
const BUMP_DENOMINATOR = 1000n

const bump = (hex: string): Hex => `0x${((BigInt(hex) * BUMP_NUMERATOR) / BUMP_DENOMINATOR + 1n).toString(16)}`

export interface TxDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly activity: ActivityStore
}

export class TxService {
  constructor(private readonly deps: TxDeps) {}

  /** The pending row this id names, with everything a replacement needs. */
  private async pendingRow(id: string): Promise<ActivityEntry> {
    const row = (await this.deps.activity.list({})).find((e) => e.id === id || e.hash === id)
    if (!row) throw new EngineError('not_found', 'no such transaction')
    if (row.status !== 'pending') throw new EngineError('invalid_argument', 'That transaction has already settled.')
    if (row.nonce === null) throw new EngineError('invalid_argument', 'That transaction has no nonce to replace.')
    if (isElectroneumChainId(row.chainId)) {
      // Honest refusal rather than a button that cannot work (§7.10).
      throw new EngineError('invalid_argument', 'Electroneum settles in about five seconds, so there is nothing to speed up or cancel.')
    }
    return row
  }

  /** The fees the replacement must beat, read from the chain rather than from the old row. */
  private async bumpedFees(chainId: number): Promise<{ maxFeePerGas?: Hex; maxPriorityFeePerGas?: Hex; gasPrice?: Hex }> {
    const rpc = (method: string, params: readonly unknown[]): Promise<unknown> => this.deps.chains.rpc(chainId, method, params)
    const block = (await rpc('eth_getBlockByNumber', ['latest', false]).catch(() => null)) as { baseFeePerGas?: string } | null
    if (block?.baseFeePerGas) {
      const tip = String((await rpc('eth_maxPriorityFeePerGas', []).catch(() => '0x3b9aca00')) ?? '0x3b9aca00')
      const base = BigInt(block.baseFeePerGas)
      const bumpedTip = bump(tip)
      return { maxPriorityFeePerGas: bumpedTip, maxFeePerGas: `0x${(base * 2n + BigInt(bumpedTip)).toString(16)}` as Hex }
    }
    return { gasPrice: bump(String((await rpc('eth_gasPrice', [])) ?? '0x3b9aca00')) }
  }

  private async addressOf(accountId: string): Promise<Hex> {
    const account = (await this.deps.vault.accounts()).find((a) => a.id === accountId)
    if (!account) throw new EngineError('not_found', 'no such account')
    return account.address as Hex
  }

  /** Re-send the same call at the same nonce, priced to replace. */
  async speedUp(input: { id: string }): Promise<{ requestId: string }> {
    const row = await this.pendingRow(input.id)
    if (!row.data && !row.to) throw new EngineError('invalid_argument', 'There is not enough of that transaction left to re-send.')
    const from = await this.addressOf(row.accountId)
    return this.deps.provider.submitInternal({
      kind: 'send_transaction',
      origin: 'internal:activity',
      chainId: row.chainId,
      accountId: row.accountId,
      tx: {
        from,
        ...(row.to ? { to: row.to as Hex } : {}),
        data: (row.data ?? '0x') as Hex,
        value: `0x${BigInt(row.value).toString(16)}` as Hex,
        nonce: `0x${(row.nonce ?? 0).toString(16)}` as Hex,
        ...(await this.bumpedFees(row.chainId)),
      },
      clientRequestId: `speedup:${row.id}:${this.deps.platform.now()}`,
    })
  }

  /** Burn the nonce: nothing, to yourself, priced to replace. */
  async cancel(input: { id: string }): Promise<{ requestId: string }> {
    const row = await this.pendingRow(input.id)
    const from = await this.addressOf(row.accountId)
    return this.deps.provider.submitInternal({
      kind: 'send_transaction',
      origin: 'internal:activity',
      chainId: row.chainId,
      accountId: row.accountId,
      // To yourself, with no value and no calldata: the cheapest thing that can
      // occupy the nonce, and it cannot do anything if it lands.
      tx: { from, to: from, data: '0x', value: '0x0', nonce: `0x${(row.nonce ?? 0).toString(16)}` as Hex, ...(await this.bumpedFees(row.chainId)) },
      clientRequestId: `cancel:${row.id}:${this.deps.platform.now()}`,
    })
  }

  /** Whether Activity should offer the two actions for this row at all. */
  async replaceable(input: { id: string }): Promise<{ can: boolean; why: string | null }> {
    try {
      await this.pendingRow(input.id)
      return { can: true, why: null }
    } catch (err) {
      return { can: false, why: err instanceof EngineError ? err.message : 'That transaction cannot be replaced.' }
    }
  }
}

const Id = z.object({ id: z.string().min(1).max(128) })

export function txNamespace(tx: TxService): NamespaceSpec {
  return {
    speedUp: { input: Id, handler: (arg) => tx.speedUp(arg as { id: string }) },
    cancel: { input: Id, handler: (arg) => tx.cancel(arg as { id: string }) },
    replaceable: { input: Id, handler: (arg) => tx.replaceable(arg as { id: string }) },
  }
}
