/**
 * Yield farms (master plan §8.8): the list from the API (or the chain when
 * the API is unreachable), every position from the chain, the Coil's
 * numbers (duration and BOLT multipliers, the dates to 2.0× and 2.5×), the
 * deposit quote with the dilution plate and BOLT stairs, the withdraw
 * preview, and the flows — Deposit · Withdraw · Collect — through the sheet.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { BOLT_STAIRS, V2_PAIR_ABI, V3_POOL_ABI, YIELD_FARM_ABI, blocksUntilMultiplier, boltStair, dilution, durationMultiplier, encodeCollect, encodeDeposit, encodeWithdraw, fetchFarms, nextBoltStair, v2Counterpart, v2LiquidityMinted, v3AmountsForLiquidity, v3Counterpart, type ElectroSwapClient, type FarmIndexView } from '@boltvault/electroswap'
import type { Platform } from '@boltvault/platform'
import { encodeFunctionData, maxUint256, parseAbi, parseUnits, type Hex } from 'viem'
import { z } from 'zod'
import { EngineError } from '../errors'
import { cacheKey, type Cached, type DocCache } from '../cache'
import type { NamespaceSpec } from '../host'
import { readMany, type ReadCall } from '../multicall'
import { FarmViewSchema, AccountIdSchema, type FarmDepositQuote, type FarmView, type FarmWithdrawQuote, type SwapStep } from '../schema'
import type { SettingsStore } from '../settingsStore'
import type { ChainsService } from './chains'
import type { FlowStepRun, FlowStore } from './flows'
import type { ProviderService } from './provider'
import type { TokensService } from './tokens'
import type { VaultManager } from './vault'

const ERC20 = parseAbi(['function balanceOf(address owner) view returns (uint256)', 'function allowance(address owner, address spender) view returns (uint256)', 'function approve(address spender, uint256 amount) returns (bool)'])

export interface FarmDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly tokens: TokensService
  readonly vault: VaultManager
  readonly provider: ProviderService
  readonly flows: FlowStore
  readonly settings: SettingsStore
  readonly electroswap: ElectroSwapClient | null
  readonly cache?: DocCache
}

/** A farm list is good for a minute. */
const LIST_TTL_MS = 60_000
const listSpec = (chainId: number, accountId: string | undefined) => ({ key: cacheKey('farm', 'list', chainId, accountId ?? '-'), schema: z.array(FarmViewSchema) })

interface FarmTuple {
  readonly id: bigint
  readonly version: number
  readonly name: string
  readonly poolAddr: Hex
  readonly liquidity: bigint
  readonly token0: Hex
  readonly token1: Hex
  readonly tokenId: bigint
  readonly tickLower: number
  readonly tickUpper: number
  readonly fee: number
  readonly active: boolean
  readonly farmerCount: bigint
}

interface FarmerTuple {
  readonly liquidity: bigint
  readonly boltMultiplier: bigint
  readonly boltDeposited: bigint
  readonly durationMultiplier: bigint
  readonly startingBlock: bigint
  readonly rewards: bigint
  readonly thirdPartyRewards: bigint
  readonly fees0: bigint
  readonly fees1: bigint
}

const BLOCK_MS = 5_000
const isEtn = (chainId: number): chainId is 52014 | 5201420 => chainId === 52014 || chainId === 5201420
const hex = (n: bigint): Hex => `0x${n.toString(16)}`
const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()
const big = (r: { ok: boolean; value?: unknown } | undefined): bigint => (r?.ok && typeof r.value === 'bigint' ? r.value : 0n)

function farmTuple(v: unknown): FarmTuple | null {
  if (!v || typeof v !== 'object') return null
  const f = v as Record<string, unknown>
  return {
    id: BigInt(String(f['id'] ?? 0)),
    version: Number(f['version'] ?? 2),
    name: String(f['name'] ?? ''),
    poolAddr: String(f['poolAddr'] ?? '') as Hex,
    liquidity: BigInt(String(f['liquidity'] ?? 0)),
    token0: String(f['token0'] ?? '') as Hex,
    token1: String(f['token1'] ?? '') as Hex,
    tokenId: BigInt(String(f['tokenId'] ?? 0)),
    tickLower: Number(f['tickLower'] ?? 0),
    tickUpper: Number(f['tickUpper'] ?? 0),
    fee: Number(f['fee'] ?? 0),
    active: f['active'] === true,
    farmerCount: BigInt(String(f['farmerCount'] ?? 0)),
  }
}

function farmerTuple(v: unknown): FarmerTuple | null {
  if (!v || typeof v !== 'object') return null
  const f = v as Record<string, unknown>
  const n = (k: string): bigint => BigInt(String(f[k] ?? 0))
  return { liquidity: n('liquidity'), boltMultiplier: n('boltMultiplier'), boltDeposited: n('boltDeposited'), durationMultiplier: n('durationMultiplier'), startingBlock: n('startingBlock'), rewards: n('rewards'), thirdPartyRewards: n('thirdPartyRewards'), fees0: n('fees0'), fees1: n('fees1') }
}

export class FarmService {
  constructor(private readonly deps: FarmDeps) {}

  private farmAddress(chainId: 52014 | 5201420): Hex {
    return ELECTRONEUM_ADDRESSES[chainId].yieldFarm as Hex
  }

  private async account(accountId: string): Promise<{ id: string; address: Hex; kind: string }> {
    const a = (await this.deps.vault.accounts()).find((x) => x.id === accountId)
    if (!a) throw new EngineError('not_found', 'no such account')
    return { id: a.id, address: a.address as Hex, kind: a.kind }
  }

  private async head(chainId: number): Promise<bigint> {
    const h = await this.deps.chains.head(chainId).catch(() => null)
    return h ? BigInt(h.blockNumber) : 0n
  }

  /** Every farm's chain tuple; the API adds APY/TVL when reachable. */
  private async farms(chainId: 52014 | 5201420, farmer: Hex | null): Promise<Array<{ tuple: FarmTuple; index: FarmIndexView | null }>> {
    const d = this.deps
    const farm = this.farmAddress(chainId)
    let index: FarmIndexView[] = []
    if (d.electroswap) index = await fetchFarms(d.electroswap, chainId, farmer ?? undefined).catch(() => [])
    let ids: bigint[]
    if (index.length) ids = index.map((f) => BigInt(f.id))
    else {
      const [count] = await readMany(d.chains, chainId, [{ address: farm, abi: YIELD_FARM_ABI, functionName: 'farmCount', args: [] }])
      const n = Number(big(count))
      ids = Array.from({ length: Math.min(n, 100) }, (_, i) => BigInt(i))
    }
    const tuples = await readMany(d.chains, chainId, ids.map((id) => ({ address: farm, abi: YIELD_FARM_ABI, functionName: 'getFarmById', args: [id] })))
    const out: Array<{ tuple: FarmTuple; index: FarmIndexView | null }> = []
    ids.forEach((id, i) => {
      const t = tuples[i]?.ok ? farmTuple(tuples[i]?.value) : null
      if (t) out.push({ tuple: t, index: index.find((x) => BigInt(x.id) === id) ?? null })
    })
    return out
  }

  private async positionOf(chainId: 52014 | 5201420, tuple: FarmTuple, owner: Hex, currentBlock: bigint, poolState: { reserves?: [bigint, bigint, bigint]; sqrtPriceX96?: bigint }): Promise<FarmView['position']> {
    const d = this.deps
    const [r] = await readMany(d.chains, chainId, [{ address: this.farmAddress(chainId), abi: YIELD_FARM_ABI, functionName: 'getFarmerByFarmIdAndAddress', args: [tuple.id, owner] }])
    const f = r?.ok ? farmerTuple(r.value) : null
    if (!f || f.liquidity === 0n) return null
    const blocksServed = currentBlock > f.startingBlock ? currentBlock - f.startingBlock : 0n
    const duration = f.durationMultiplier > 0n ? f.durationMultiplier : durationMultiplier(blocksServed)
    const to2 = blocksUntilMultiplier(blocksServed, 20_000n)
    const to25 = blocksUntilMultiplier(blocksServed, 25_000n)
    const now = d.platform.now()
    let amount0 = 0n
    let amount1 = 0n
    if (tuple.version === 2 && poolState.reserves) {
      const [res0, res1, supply] = poolState.reserves
      if (supply > 0n) {
        amount0 = (res0 * f.liquidity) / supply
        amount1 = (res1 * f.liquidity) / supply
      }
    } else if (poolState.sqrtPriceX96 !== undefined) {
      const a = v3AmountsForLiquidity(poolState.sqrtPriceX96, tuple.tickLower, tuple.tickUpper, f.liquidity)
      amount0 = a.amount0
      amount1 = a.amount1
    }
    const next = nextBoltStair(f.boltDeposited)
    return {
      liquidity: f.liquidity.toString(),
      shareOfFarm: tuple.liquidity > 0n ? Number((f.liquidity * 1_000_000n) / tuple.liquidity) / 1_000_000 : 0,
      durationMultiplier: Number(duration),
      boltMultiplier: Number(f.boltMultiplier || 10_000n),
      boltDeposited: f.boltDeposited.toString(),
      startingBlock: Number(f.startingBlock),
      blocksServed: Number(blocksServed),
      pendingRewards: f.rewards.toString(),
      pendingThirdParty: f.thirdPartyRewards.toString(),
      fees0: f.fees0.toString(),
      fees1: f.fees1.toString(),
      at2x: to2 === 0n ? null : now + Number(to2) * BLOCK_MS,
      at25x: to25 === 0n ? null : now + Number(to25) * BLOCK_MS,
      nextStair: next ? { bolt: next.bolt.toString(), multiplier: Number(next.multiplier), more: next.more.toString() } : null,
      amount0: amount0.toString(),
      amount1: amount1.toString(),
    }
  }

  private async poolState(chainId: 52014 | 5201420, tuple: FarmTuple): Promise<{ reserves?: [bigint, bigint, bigint]; sqrtPriceX96?: bigint }> {
    const d = this.deps
    if (tuple.version === 2) {
      const [res, supply, t0] = await readMany(d.chains, chainId, [
        { address: tuple.poolAddr, abi: V2_PAIR_ABI, functionName: 'getReserves', args: [] },
        { address: tuple.poolAddr, abi: V2_PAIR_ABI, functionName: 'totalSupply', args: [] },
        { address: tuple.poolAddr, abi: V2_PAIR_ABI, functionName: 'token0', args: [] },
      ])
      if (!res?.ok || !Array.isArray(res.value)) return {}
      const [r0, r1] = res.value as [bigint, bigint, number]
      // The pair's token0 may not be the farm's token0.
      const flipped = t0?.ok && typeof t0.value === 'string' && !same(t0.value, tuple.token0)
      return { reserves: [flipped ? r1 : r0, flipped ? r0 : r1, big(supply)] }
    }
    const [slot] = await readMany(d.chains, chainId, [{ address: tuple.poolAddr, abi: V3_POOL_ABI, functionName: 'slot0', args: [] }])
    if (!slot?.ok || !Array.isArray(slot.value)) return {}
    return { sqrtPriceX96: (slot.value as [bigint])[0] }
  }

  private async view(chainId: 52014 | 5201420, tuple: FarmTuple, index: FarmIndexView | null, owner: Hex | null, currentBlock: bigint): Promise<FarmView> {
    const [t0, t1] = await Promise.all([this.deps.tokens.get(chainId, tuple.token0), this.deps.tokens.get(chainId, tuple.token1)])
    const wetn = ELECTRONEUM_ADDRESSES[chainId].wetn
    const sym = (addr: string, t: { symbol: string } | null): string => (t ? t.symbol : same(addr, wetn) ? 'ETN' : `${addr.slice(0, 6)}…`)
    const state = owner ? await this.poolState(chainId, tuple) : {}
    const position = owner ? await this.positionOf(chainId, tuple, owner, currentBlock, state) : null
    return {
      chainId,
      id: Number(tuple.id),
      version: tuple.version === 3 ? 3 : 2,
      name: tuple.name || index?.name || `Farm #${tuple.id.toString()}`,
      poolAddr: tuple.poolAddr,
      token0: tuple.token0,
      token1: tuple.token1,
      symbol0: sym(tuple.token0, t0),
      symbol1: sym(tuple.token1, t1),
      decimals0: t0?.decimals ?? 18,
      decimals1: t1?.decimals ?? 18,
      active: tuple.active,
      tvlUsd: index?.tvlUsd ?? null,
      baseApy: index?.baseApy ?? null,
      thirdPartyApy: index?.thirdPartyApy ?? null,
      thirdParty: index?.thirdParty ? { token: index.thirdParty.token, symbol: index.thirdParty.symbol } : null,
      farmerCount: index?.farmerCount ?? Number(tuple.farmerCount),
      position,
    }
  }

  /** Explore › Farms and Home › Positions (plan C5, owner item F1): active farms, plus a closed farm the account still has a position in; positions first, then by TVL, closed-with-position last. */
  async list(chainId: number, accountId?: string): Promise<FarmView[]> {
    if (!isEtn(chainId)) return []
    const build = async (): Promise<FarmView[]> => {
      const owner = accountId ? (await this.account(accountId)).address : null
      const farms = await this.farms(chainId, owner)
      const block = await this.head(chainId)
      // Across farms, not one after another. This was a sequential loop, and
      // each `view` makes two dependent reads (the pool's state, then the
      // position), so N farms cost 2N round trips one behind the other.
      // Fanning out means every farm's pool read is in flight at the same
      // moment, and the multicall coalescer folds them into a single
      // aggregate — then does the same for the position reads. 2N becomes 2.
      // Promise.all keeps the order, and the sort below owns the ordering.
      const views = await Promise.all(farms.filter((f) => f.tuple.active || owner).map((f) => this.view(chainId, f.tuple, f.index, owner, block)))
      const out = views.filter((v) => v.active || v.position !== null)
      const rank = (f: FarmView): number => (f.position && f.active ? 0 : f.active ? 1 : 2)
      out.sort((a, b) => rank(a) - rank(b) || (b.tvlUsd ?? 0) - (a.tvlUsd ?? 0))
      return out
    }
    if (!this.deps.cache) return build()
    // Same as launchpad: no TTL meant every Explore mount and every
    // positions.snapshot re-ran YieldFarms and its multicall batches.
    return (await this.deps.cache.through(listSpec(chainId, accountId), LIST_TTL_MS, build)).value
  }

  async cachedList(chainId: number, accountId?: string): Promise<Cached<FarmView[]> | null> {
    return (await this.deps.cache?.read(listSpec(chainId, accountId))) ?? null
  }

  async farm(chainId: number, farmId: number, accountId?: string): Promise<FarmView | null> {
    if (!isEtn(chainId)) return null
    const owner = accountId ? (await this.account(accountId)).address : null
    const [r] = await readMany(this.deps.chains, chainId, [{ address: this.farmAddress(chainId), abi: YIELD_FARM_ABI, functionName: 'getFarmById', args: [BigInt(farmId)] }])
    const tuple = r?.ok ? farmTuple(r.value) : null
    if (!tuple) return null
    let index: FarmIndexView | null = null
    if (this.deps.electroswap) index = (await fetchFarms(this.deps.electroswap, chainId, owner ?? undefined).catch(() => [])).find((x) => x.id === farmId) ?? null
    return this.view(chainId, tuple, index, owner, await this.head(chainId))
  }

  /** The deposit plate: the other side from the pool's ratio, the BOLT stair, the dilution, the sheets it takes. */
  async quoteDeposit(input: { accountId: string; chainId: number; farmId: number; amount0?: string; amount1?: string; bolt?: string }): Promise<FarmDepositQuote> {
    const d = this.deps
    const problems: string[] = []
    const empty: FarmDepositQuote = { farmId: input.farmId, amount0Raw: '0', amount1Raw: '0', boltRaw: '0', nativeSide: null, liquidityAdded: '0', multiplierBefore: 10_000, multiplierAfter: 10_000, boltStair: null, steps: [], ok: false, problems }
    if (!isEtn(input.chainId)) return { ...empty, problems: ['Farms live on Electroneum.'] }
    const chainId = input.chainId
    const account = await this.account(input.accountId)
    const view = await this.farm(chainId, input.farmId, input.accountId)
    if (!view) return { ...empty, problems: ['No such farm.'] }
    if (!view.active) problems.push('This farm is closed to deposits.')
    if (account.kind === 'watch') problems.push('Watch-only — import a key or pair a device to deposit.')
    const [r] = await readMany(d.chains, chainId, [{ address: this.farmAddress(chainId), abi: YIELD_FARM_ABI, functionName: 'getFarmById', args: [BigInt(input.farmId)] }])
    const tuple = r?.ok ? farmTuple(r.value) : null
    if (!tuple) return { ...empty, problems: ['No such farm.'] }
    const wetn = ELECTRONEUM_ADDRESSES[chainId].wetn
    const nativeSide: 0 | 1 | null = same(tuple.token0, wetn) ? 0 : same(tuple.token1, wetn) ? 1 : null
    const state = await this.poolState(chainId, tuple)
    let amount0 = 0n
    let amount1 = 0n
    try {
      if (input.amount0?.trim()) amount0 = parseUnits(input.amount0.trim(), view.decimals0)
      if (input.amount1?.trim()) amount1 = parseUnits(input.amount1.trim(), view.decimals1)
    } catch {
      problems.push('That amount is not a number.')
    }
    let liquidityAdded = 0n
    if (amount0 > 0n && amount1 === 0n) {
      if (tuple.version === 2 && state.reserves) amount1 = v2Counterpart(amount0, state.reserves[0], state.reserves[1])
      else if (state.sqrtPriceX96 !== undefined) amount1 = v3Counterpart(amount0, state.sqrtPriceX96, tuple.tickLower, tuple.tickUpper).amount1
    } else if (amount1 > 0n && amount0 === 0n) {
      if (tuple.version === 2 && state.reserves) amount0 = v2Counterpart(amount1, state.reserves[1], state.reserves[0])
      else if (state.sqrtPriceX96 !== undefined) {
        // Mirror: quote token0 from token1 by inverting the range maths through a token0 probe.
        const probe = v3Counterpart(10n ** 18n, state.sqrtPriceX96, tuple.tickLower, tuple.tickUpper)
        amount0 = probe.amount1 > 0n ? (amount1 * 10n ** 18n) / probe.amount1 : 0n
      }
    }
    if (tuple.version === 2 && state.reserves) liquidityAdded = v2LiquidityMinted(amount0, amount1, state.reserves[0], state.reserves[1], state.reserves[2])
    else if (state.sqrtPriceX96 !== undefined) liquidityAdded = v3Counterpart(amount0, state.sqrtPriceX96, tuple.tickLower, tuple.tickUpper).liquidity
    if (amount0 <= 0n || amount1 <= 0n) problems.push('Both sides need an amount; the pool sets the ratio.')
    let bolt = 0n
    try {
      if (input.bolt?.trim()) bolt = parseUnits(input.bolt.trim(), 18)
    } catch {
      problems.push('That BOLT amount is not a number.')
    }
    const existingBolt = view.position ? BigInt(view.position.boltDeposited) : 0n
    const total = existingBolt + bolt
    const stair = bolt > 0n ? boltStair(total) : boltStair(existingBolt)
    if (bolt > 0n && !stair) problems.push(`BOLT boosts land on ${BOLT_STAIRS.slice(1).map((s) => (s.bolt / 10n ** 18n).toString()).join(' or ')} BOLT in total.`)
    // Balances and allowances.
    const owner = account.address
    const bolt2 = ELECTRONEUM_ADDRESSES[chainId].bolt as Hex | null
    const calls: ReadCall[] = [
      { address: tuple.token0, abi: ERC20, functionName: 'balanceOf', args: [owner] },
      { address: tuple.token1, abi: ERC20, functionName: 'balanceOf', args: [owner] },
      { address: tuple.token0, abi: ERC20, functionName: 'allowance', args: [owner, this.farmAddress(chainId)] },
      { address: tuple.token1, abi: ERC20, functionName: 'allowance', args: [owner, this.farmAddress(chainId)] },
      ...(bolt2 ? [{ address: bolt2, abi: ERC20, functionName: 'balanceOf', args: [owner] }, { address: bolt2, abi: ERC20, functionName: 'allowance', args: [owner, this.farmAddress(chainId)] }] : []),
    ]
    const st = await readMany(d.chains, chainId, calls)
    const native = BigInt(String((await d.chains.rpc(chainId, 'eth_getBalance', [owner, 'latest']).catch(() => '0x0')) ?? '0x0'))
    const bal0 = nativeSide === 0 ? native : big(st[0])
    const bal1 = nativeSide === 1 ? native : big(st[1])
    if (amount0 > bal0) problems.push(`Not enough ${view.symbol0}.`)
    if (amount1 > bal1) problems.push(`Not enough ${view.symbol1}.`)
    if (bolt > 0n && bolt > big(st[4])) problems.push('Not enough BOLT for that boost.')
    const steps: SwapStep[] = []
    if (nativeSide !== 0 && amount0 > 0n && big(st[2]) < amount0) steps.push('approve')
    if (nativeSide !== 1 && amount1 > 0n && big(st[3]) < amount1) steps.push('approve')
    if (bolt > 0n && bolt2 && big(st[5]) < bolt) steps.push('approve')
    steps.push('deposit')
    const block = await this.head(chainId)
    const dil = view.position ? dilution({ existingLiquidity: BigInt(view.position.liquidity), startingBlock: BigInt(view.position.startingBlock), currentBlock: block, addedLiquidity: liquidityAdded }) : { before: 10_000n, after: 10_000n, blocksLost: 0n }
    return {
      farmId: input.farmId,
      amount0Raw: amount0.toString(),
      amount1Raw: amount1.toString(),
      boltRaw: bolt.toString(),
      nativeSide,
      liquidityAdded: liquidityAdded.toString(),
      multiplierBefore: Number(dil.before),
      multiplierAfter: Number(dil.after),
      boltStair: stair ? { total: stair.bolt.toString(), multiplier: Number(stair.multiplier) } : null,
      steps,
      ok: problems.length === 0,
      problems,
    }
  }

  /** Deposit: approve what the farm may not pull yet, then `deposit` with the native side in `value`. */
  async deposit(input: { accountId: string; chainId: number; farmId: number; amount0?: string; amount1?: string; bolt?: string }): Promise<{ flowId: string; requestId: string | null }> {
    const q = await this.quoteDeposit(input)
    if (!q.ok || !isEtn(input.chainId)) throw new EngineError('invalid_argument', q.problems[0] ?? 'cannot deposit')
    const chainId = input.chainId
    const account = await this.account(input.accountId)
    const [r] = await readMany(this.deps.chains, chainId, [{ address: this.farmAddress(chainId), abi: YIELD_FARM_ABI, functionName: 'getFarmById', args: [BigInt(input.farmId)] }])
    const tuple = r?.ok ? farmTuple(r.value) : null
    if (!tuple) throw new EngineError('not_found', 'No such farm.')
    const farm = this.farmAddress(chainId)
    const exact = (await this.deps.settings.get()).exactApprovals
    const amount0 = BigInt(q.amount0Raw)
    const amount1 = BigInt(q.amount1Raw)
    const bolt = BigInt(q.boltRaw)
    const bolt2 = ELECTRONEUM_ADDRESSES[chainId].bolt as Hex | null
    const owner = account.address
    const allowances = await readMany(this.deps.chains, chainId, [
      { address: tuple.token0, abi: ERC20, functionName: 'allowance', args: [owner, farm] },
      { address: tuple.token1, abi: ERC20, functionName: 'allowance', args: [owner, farm] },
      ...(bolt2 ? [{ address: bolt2, abi: ERC20, functionName: 'allowance', args: [owner, farm] }] : []),
    ])
    const steps: FlowStepRun[] = []
    const approve = (token: Hex, amount: bigint): FlowStepRun => ({
      step: 'approve',
      waitReceipt: true,
      run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:farm:approve', chainId, accountId: input.accountId, tx: { from: owner, to: token, value: '0x0', data: encodeFunctionData({ abi: ERC20, functionName: 'approve', args: [farm, exact ? amount : maxUint256] }) }, clientRequestId: `farm:approve:${token}:${this.deps.platform.now()}` }),
    })
    if (q.nativeSide !== 0 && big(allowances[0]) < amount0) steps.push(approve(tuple.token0, amount0))
    if (q.nativeSide !== 1 && big(allowances[1]) < amount1) steps.push(approve(tuple.token1, amount1))
    if (bolt > 0n && bolt2 && big(allowances[2]) < bolt) steps.push(approve(bolt2, bolt))
    const value = q.nativeSide === 0 ? amount0 : q.nativeSide === 1 ? amount1 : 0n
    steps.push({ step: 'deposit', waitReceipt: true, run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:farm:deposit', chainId, accountId: input.accountId, tx: { from: owner, to: farm, value: hex(value), data: encodeDeposit(BigInt(input.farmId), amount0, amount1, bolt) }, clientRequestId: `farm:deposit:${input.farmId}:${this.deps.platform.now()}` }) })
    const flow = await this.deps.flows.start({ kind: 'farm', accountId: input.accountId, chainId, quote: null, steps })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** The withdraw slider's preview: what leaves at this percentage, what is collected with it, what multiplier stays. */
  async quoteWithdraw(input: { accountId: string; chainId: number; farmId: number; percent: number; asNative: boolean }): Promise<FarmWithdrawQuote> {
    const problems: string[] = []
    const base: FarmWithdrawQuote = { farmId: input.farmId, liquidityRaw: '0', percent: input.percent, amount0Raw: '0', amount1Raw: '0', rewardsRaw: '0', thirdPartyRaw: '0', fees0Raw: '0', fees1Raw: '0', boltReturnedRaw: '0', keepsMultiplier: true, ok: false, problems }
    if (!isEtn(input.chainId)) return { ...base, problems: ['Farms live on Electroneum.'] }
    const view = await this.farm(input.chainId, input.farmId, input.accountId)
    if (!view?.position) return { ...base, problems: ['You have nothing in this farm.'] }
    const pct = Math.max(0, Math.min(100, input.percent))
    const liquidity = (BigInt(view.position.liquidity) * BigInt(Math.round(pct * 100))) / 10_000n
    const all = pct >= 100
    const scale = (raw: string): string => ((BigInt(raw) * BigInt(Math.round(pct * 100))) / 10_000n).toString()
    if (input.asNative && !same(view.token0, ELECTRONEUM_ADDRESSES[input.chainId].wetn) && !same(view.token1, ELECTRONEUM_ADDRESSES[input.chainId].wetn)) problems.push('This farm has no ETN side to unwrap.')
    return {
      ...base,
      liquidityRaw: (all ? BigInt(view.position.liquidity) : liquidity).toString(),
      amount0Raw: all ? view.position.amount0 : scale(view.position.amount0),
      amount1Raw: all ? view.position.amount1 : scale(view.position.amount1),
      rewardsRaw: view.position.pendingRewards,
      thirdPartyRaw: view.position.pendingThirdParty,
      fees0Raw: view.position.fees0,
      fees1Raw: view.position.fees1,
      boltReturnedRaw: all ? view.position.boltDeposited : '0',
      keepsMultiplier: !all,
      ok: problems.length === 0,
      problems,
    }
  }

  async withdraw(input: { accountId: string; chainId: number; farmId: number; percent: number; asNative: boolean }): Promise<{ flowId: string; requestId: string | null }> {
    const q = await this.quoteWithdraw(input)
    if (!q.ok || !isEtn(input.chainId)) throw new EngineError('invalid_argument', q.problems[0] ?? 'cannot withdraw')
    const chainId = input.chainId
    const account = await this.account(input.accountId)
    const flow = await this.deps.flows.start({
      kind: 'farm',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps: [{ step: 'withdraw', waitReceipt: true, run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:farm:withdraw', chainId, accountId: input.accountId, tx: { from: account.address, to: this.farmAddress(chainId), value: '0x0', data: encodeWithdraw(BigInt(input.farmId), BigInt(q.liquidityRaw), input.asNative) }, clientRequestId: `farm:withdraw:${input.farmId}:${this.deps.platform.now()}` }) }],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }

  /** Collect = `withdraw(farmId, 0, asNative)`: rewards and fees out, liquidity untouched (§8.8). */
  async collect(input: { accountId: string; chainId: number; farmId: number; asNative: boolean }): Promise<{ flowId: string; requestId: string | null }> {
    if (!isEtn(input.chainId)) throw new EngineError('invalid_argument', 'Farms live on Electroneum.')
    const chainId = input.chainId
    const account = await this.account(input.accountId)
    const view = await this.farm(chainId, input.farmId, input.accountId)
    if (!view?.position) throw new EngineError('invalid_argument', 'You have nothing in this farm.')
    const flow = await this.deps.flows.start({
      kind: 'farm',
      accountId: input.accountId,
      chainId,
      quote: null,
      steps: [{ step: 'collect', waitReceipt: true, run: () => this.deps.provider.runInternal({ kind: 'send_transaction', origin: 'internal:farm:collect', chainId, accountId: input.accountId, tx: { from: account.address, to: this.farmAddress(chainId), value: '0x0', data: encodeCollect(BigInt(input.farmId), input.asNative) }, clientRequestId: `farm:collect:${input.farmId}:${this.deps.platform.now()}` }) }],
    })
    return { flowId: flow.id, requestId: flow.steps[0]?.requestId ?? null }
  }
}

const AccountChain = z.object({ accountId: AccountIdSchema, chainId: z.number().int().positive() })
const FarmArg = AccountChain.extend({ farmId: z.number().int().nonnegative() })

export function farmNamespace(farm: FarmService): NamespaceSpec {
  return {
    list: { input: z.object({ chainId: z.number().int().positive(), accountId: AccountIdSchema.optional() }), handler: (arg) => farm.list((arg as { chainId: number }).chainId, (arg as { accountId?: string }).accountId) },
    cachedList: { input: z.object({ chainId: z.number().int().positive(), accountId: AccountIdSchema.optional() }), handler: (arg) => farm.cachedList((arg as { chainId: number }).chainId, (arg as { accountId?: string }).accountId) },
    farm: { input: z.object({ chainId: z.number().int().positive(), farmId: z.number().int().nonnegative(), accountId: AccountIdSchema.optional() }), handler: (arg) => farm.farm((arg as { chainId: number }).chainId, (arg as { farmId: number }).farmId, (arg as { accountId?: string }).accountId) },
    quoteDeposit: { input: FarmArg.extend({ amount0: z.string().max(60).optional(), amount1: z.string().max(60).optional(), bolt: z.string().max(60).optional() }), handler: (arg) => farm.quoteDeposit(arg as { accountId: string; chainId: number; farmId: number; amount0?: string; amount1?: string; bolt?: string }) },
    deposit: { input: FarmArg.extend({ amount0: z.string().max(60).optional(), amount1: z.string().max(60).optional(), bolt: z.string().max(60).optional() }), handler: (arg) => farm.deposit(arg as { accountId: string; chainId: number; farmId: number; amount0?: string; amount1?: string; bolt?: string }) },
    quoteWithdraw: { input: FarmArg.extend({ percent: z.number().min(0).max(100), asNative: z.boolean() }), handler: (arg) => farm.quoteWithdraw(arg as { accountId: string; chainId: number; farmId: number; percent: number; asNative: boolean }) },
    withdraw: { input: FarmArg.extend({ percent: z.number().min(0).max(100), asNative: z.boolean() }), handler: (arg) => farm.withdraw(arg as { accountId: string; chainId: number; farmId: number; percent: number; asNative: boolean }) },
    collect: { input: FarmArg.extend({ asNative: z.boolean() }), handler: (arg) => farm.collect(arg as { accountId: string; chainId: number; farmId: number; asNative: boolean }) },
  }
}
