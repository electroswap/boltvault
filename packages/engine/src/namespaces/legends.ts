/**
 * Electric Legends dividends (master plan §8.10): the pieces the account
 * holds, which are registered, what is claimable, the contract-wide numbers
 * for the vessel, and the flows — Activate dividends (`register`), Claim
 * (`claimDividends`), Mint through the marketplace minter. The best claim so
 * far is persisted per account so the vessel visibly refills between claims.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { DIVIDENDS_ABI, LEGENDS_ABI, MINTER_ABI, claimableIds, encodeClaimDividends, encodeMint, encodeRegister, shareOfNextFee, vesselLevel } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import type { Hex } from 'viem'
import { z } from 'zod'
import type { SealedMap } from '../sealed'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { readMany, type ReadCall } from '../multicall'
import { AccountIdSchema, type LegendsStatus } from '../schema'
import type { ChainsService } from './chains'
import type { FlowStore } from './flows'
import type { ProviderService } from './provider'
import type { VaultManager } from './vault'

export interface LegendsDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly flows: FlowStore
  /** Best-seen claim per `<chainId>.<address>`, sealed under the DEK. */
  readonly legendsBest: SealedMap<{ wei: string }>
}

const isEtn = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420
const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const big = (r: { ok: boolean; value?: unknown } | undefined): bigint => (r?.ok && typeof r.value === 'bigint' ? r.value : 0n)
const flag = (r: { ok: boolean; value?: unknown } | undefined): boolean => r?.ok === true && r.value === true

export class LegendsService {
  constructor(private readonly deps: LegendsDeps) {}

  /**
   * The id lives inside the sealed blob now. It used to be the storage key
   * `legends.bestClaim.<chainId>.<address>`, which published the account's
   * address to anyone reading storage — sealing a value cannot fix a key name.
   */
  private key(chainId: number, address: string): string {
    return `${chainId}.${address.toLowerCase()}`
  }

  private async account(accountId: string): Promise<{ id: string; address: Hex; kind: string }> {
    const a = (await this.deps.vault.accounts()).find((x) => x.id === accountId)
    if (!a) throw new EngineError('not_found', 'no such account')
    return { id: a.id, address: a.address as Hex, kind: a.kind }
  }

  /** Everything the vessel and the collection page show, from the chain. */
  async status(accountId: string, chainId: number): Promise<LegendsStatus | null> {
    const d = this.deps
    if (!isEtn(chainId)) return null
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const collection = A.electricLegends as Hex
    const distributor = A.dividendDistributor as Hex
    const minter = A.nftMinter as Hex
    const account = await this.account(accountId)
    const owner = account.address
    const head = await readMany(d.chains, chainId, [
      { address: collection, abi: LEGENDS_ABI, functionName: 'balanceOf', args: [owner] },
      { address: distributor, abi: DIVIDENDS_ABI, functionName: 'dividendsDistributed', args: [] },
      { address: distributor, abi: DIVIDENDS_ABI, functionName: 'activeTokenCount', args: [] },
      { address: distributor, abi: DIVIDENDS_ABI, functionName: 'dividendsEnabled', args: [] },
      { address: collection, abi: LEGENDS_ABI, functionName: 'isMintable', args: [] },
      { address: minter, abi: MINTER_ABI, functionName: 'mintPrice', args: [collection] },
      { address: minter, abi: MINTER_ABI, functionName: 'mintableCount', args: [collection, owner] },
      { address: collection, abi: LEGENDS_ABI, functionName: 'totalSupply', args: [] },
    ])
    const balance = Number(big(head[0]))
    const ids: bigint[] = []
    if (balance > 0) {
      const calls: ReadCall[] = []
      for (let i = 0; i < Math.min(balance, 200); i++) calls.push({ address: collection, abi: LEGENDS_ABI, functionName: 'tokenOfOwnerByIndex', args: [owner, BigInt(i)] })
      for (const r of await readMany(d.chains, chainId, calls)) if (r.ok && typeof r.value === 'bigint') ids.push(r.value)
    }
    const info = ids.length ? await readMany(d.chains, chainId, ids.map((id) => ({ address: distributor, abi: DIVIDENDS_ABI, functionName: 'tokenDividendInfo', args: [id] }))) : []
    const registered: bigint[] = []
    const unregistered: bigint[] = []
    ids.forEach((id, i) => {
      const r = info[i]
      const isRegistered = r?.ok && Array.isArray(r.value) ? Boolean((r.value as [bigint, bigint, boolean])[2]) : false
      ;(isRegistered ? registered : unregistered).push(id)
    })
    const unique = claimableIds(registered)
    const claimable = unique.length ? big((await readMany(d.chains, chainId, [{ address: distributor, abi: DIVIDENDS_ABI, functionName: 'getClaimableDividends', args: [unique] }]))[0]) : 0n
    const bestRaw = (await d.legendsBest.get(this.key(chainId, owner)))?.wei ?? null
    const best = bestRaw && /^\d+$/.test(bestRaw) ? BigInt(bestRaw) : 0n
    const activeTokenCount = Number(big(head[2]))
    const mintable = flag(head[4])
    return {
      accountId,
      chainId,
      collection,
      distributor,
      ownedTokenIds: ids.map(String),
      registeredTokenIds: registered.map(String),
      unregisteredTokenIds: unregistered.map(String),
      claimableWei: claimable.toString(),
      bestClaimWei: best.toString(),
      vesselLevel: vesselLevel(claimable, best),
      lifetimePaidWei: big(head[1]).toString(),
      activeTokenCount,
      shareOfNextFee: shareOfNextFee(registered.length, activeTokenCount),
      dividendsEnabled: flag(head[3]),
      mint: head[4]?.ok === true ? { mintable, priceWei: big(head[5]).toString(), mintableCount: Number(big(head[6])), totalSupply: Number(big(head[7])) } : null,
      observedAt: d.platform.now(),
    }
  }

  /** The mint capability of any EsNFT collection through the marketplace minter (plan C1); null when the contract has no `isMintable`. */
  async mintInfo(chainId: number, collection: string, owner: string | null): Promise<{ mintable: boolean; priceWei: string; mintableCount: number; totalSupply: number } | null> {
    if (!isEtn(chainId)) return null
    const minter = ELECTRONEUM_ADDRESSES[chainId].nftMinter as Hex
    const c = collection as Hex
    const who = (owner ?? '0x0000000000000000000000000000000000000000') as Hex
    const r = await readMany(this.deps.chains, chainId, [
      { address: c, abi: LEGENDS_ABI, functionName: 'isMintable', args: [] },
      { address: minter, abi: MINTER_ABI, functionName: 'mintPrice', args: [c] },
      { address: minter, abi: MINTER_ABI, functionName: 'mintableCount', args: [c, who] },
      { address: c, abi: LEGENDS_ABI, functionName: 'totalSupply', args: [] },
    ]).catch(() => [])
    if (r[0]?.ok !== true) return null
    return { mintable: flag(r[0]), priceWei: big(r[1]).toString(), mintableCount: Number(big(r[2])), totalSupply: Number(big(r[3])) }
  }

  /** Unclaimed dividends for one piece (the Piece view's line), wei; 0 when unregistered. */
  async claimableFor(chainId: number, tokenId: bigint): Promise<bigint> {
    if (!isEtn(chainId)) return 0n
    const distributor = ELECTRONEUM_ADDRESSES[chainId].dividendDistributor as Hex
    const [r] = await readMany(this.deps.chains, chainId, [{ address: distributor, abi: DIVIDENDS_ABI, functionName: 'getClaimableDividends', args: [[tokenId]] }])
    return big(r)
  }

  /** Activate dividends: `register` every unregistered piece in one transaction. */
  async activate(accountId: string, chainId: number): Promise<{ flowId: string; requestId: string | null }> {
    const st = await this.status(accountId, chainId)
    if (!st) throw new EngineError('invalid_argument', 'Electric Legends live on Electroneum.')
    if (st.unregisteredTokenIds.length === 0) throw new EngineError('invalid_argument', 'Every piece you hold already earns dividends.')
    const account = await this.account(accountId)
    const ids = st.unregisteredTokenIds.map((x) => BigInt(x))
    const flow = await this.deps.flows.start({
      kind: 'legends',
      accountId,
      chainId,
      quote: null,
      steps: [{ step: 'register', waitReceipt: true, run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:legends:register', chainId, accountId, tx: { from: account.address, to: st.distributor as Hex, value: '0x0', data: encodeRegister(ids) }, clientRequestId: `legends:register:${this.deps.platform.now()}` }) }],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Claim: one transaction for every registered piece; the vessel drains on receipt. */
  async claim(accountId: string, chainId: number): Promise<{ flowId: string; requestId: string | null }> {
    const st = await this.status(accountId, chainId)
    if (!st) throw new EngineError('invalid_argument', 'Electric Legends live on Electroneum.')
    if (st.registeredTokenIds.length === 0) throw new EngineError('invalid_argument', 'Activate dividends first.')
    if (BigInt(st.claimableWei) === 0n) throw new EngineError('invalid_argument', 'Nothing to claim yet.')
    const account = await this.account(accountId)
    const ids = claimableIds(st.registeredTokenIds.map((x) => BigInt(x)))
    const claimable = BigInt(st.claimableWei)
    const flow = await this.deps.flows.start({
      kind: 'legends',
      accountId,
      chainId,
      quote: null,
      steps: [
        {
          step: 'claim',
          waitReceipt: true,
          run: async () => {
            const r = await this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:legends:claim', chainId, accountId, tx: { from: account.address, to: st.distributor as Hex, value: '0x0', data: encodeClaimDividends(ids) }, clientRequestId: `legends:claim:${this.deps.platform.now()}` })
            const settled = r.result.then(async (v) => {
              // The vessel's ceiling is the best claim so far (§8.10).
              const best = BigInt(st.bestClaimWei)
              if (claimable > best) await this.deps.legendsBest.set(this.key(chainId, account.address), { wei: claimable.toString() })
              return v
            })
            settled.catch(() => undefined)
            return { requestId: r.requestId, result: settled }
          },
        },
      ],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Mint through EsMinterV2 at the minter's price (the collection's price plus the marketplace markup). */
  async mint(accountId: string, chainId: number, count: number, collection?: string): Promise<{ flowId: string; requestId: string | null }> {
    if (!isEtn(chainId)) throw new EngineError('invalid_argument', 'Electric Legends live on Electroneum.')
    if (!Number.isInteger(count) || count < 1 || count > 20) throw new EngineError('invalid_argument', 'Mint between 1 and 20 at a time.')
    const A = ELECTRONEUM_ADDRESSES[chainId]
    const account = await this.account(accountId)
    const [price, mintable, allowed] = await readMany(this.deps.chains, chainId, [
      { address: A.nftMinter as Hex, abi: MINTER_ABI, functionName: 'mintPrice', args: [(collection ?? A.electricLegends) as Hex] },
      { address: (collection ?? A.electricLegends) as Hex, abi: LEGENDS_ABI, functionName: 'isMintable', args: [] },
      { address: A.nftMinter as Hex, abi: MINTER_ABI, functionName: 'mintableCount', args: [(collection ?? A.electricLegends) as Hex, account.address] },
    ])
    if (!flag(mintable)) throw new EngineError('invalid_argument', 'Minting is closed right now.')
    if (Number(big(allowed)) < count) throw new EngineError('invalid_argument', `You can mint ${Number(big(allowed))} more.`)
    const value = big(price) * BigInt(count)
    const flow = await this.deps.flows.start({
      kind: 'legends',
      accountId,
      chainId,
      quote: null,
      steps: [{ step: 'mint', waitReceipt: true, run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:nft:mint', chainId, accountId, tx: { from: account.address, to: A.nftMinter as Hex, value: hex(value), data: encodeMint((collection ?? A.electricLegends) as Hex, BigInt(count)) }, clientRequestId: `legends:mint:${this.deps.platform.now()}` }) }],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }
}

const AccountChain = z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() })

export function legendsNamespace(legends: LegendsService): NamespaceSpec {
  return {
    status: { input: AccountChain, handler: (arg) => legends.status((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId) },
    activate: { input: AccountChain, handler: (arg) => legends.activate((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId) },
    claim: { input: AccountChain, handler: (arg) => legends.claim((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId) },
    mint: { input: AccountChain.extend({ count: z.number().int().min(1).max(20) }), handler: (arg) => legends.mint((arg as { accountId: string }).accountId, (arg as { chainId: number }).chainId, (arg as { count: number }).count) },
  }
}
