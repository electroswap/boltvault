/**
 * M6 inside the engine, against the mock RPC and a scripted ElectroSwap API:
 * Explore lists tokens and pins Electric Legends; farms come from the chain
 * with the position, the deposit quote (ratio, dilution, stairs, sheets) and
 * Collect as `withdraw(id, 0)`; the Legends vault reads, Activate → Claim
 * with the best claim persisted; the launchpad's chain-truth status and a
 * Contribute with the remembered referrer; the marketplace's List (approve
 * the conduit → sign the order → the API intake body) and Buy (`ownerOf`
 * check → `fulfillOrder` with the ETN); the watchlist's alerts and nudges.
 */
import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { DIVIDENDS_ABI, LAUNCHPAD_POOL_ABI, LEGENDS_ABI, MINTER_ABI, SEAPORT_ABI, YIELD_FARM_ABI, buildListing, orderHash, type MarketplaceConfig } from '@boltvault/electroswap'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { parseTypedData } from '@boltvault/security'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, parseAbiParameters, parseTransaction, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, marketplaceConfig, parseApprovalPayload, resetMulticallCache, CANONICAL_MULTICALL3, type ApprovalRequest, type Engine, type SwapFlow, cacheKey } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const CHAIN = 52014
const A = ELECTRONEUM_ADDRESSES[52014]
const WETN = A.wetn as Hex
const USDC = A.usdc as Hex
const BOLT = A.bolt as Hex
const FARM = A.yieldFarm as Hex
const PAIR = '0x7777777777777777777777777777777777777777' as Hex
const LEGENDS = A.electricLegends as Hex
const DIVIDENDS = A.dividendDistributor as Hex
const MINTER = A.nftMinter as Hex
const SEAPORT = A.seaport15 as Hex
const POOL = '0x9999999999999999999999999999999999999999' as Hex
const REFERRER = '0x5555555555555555555555555555555555555555' as Hex
const SELLER = '0x6666666666666666666666666666666666666666' as Hex
const config: MarketplaceConfig = marketplaceConfig(52014)

const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])
const bool = (v: boolean): Hex => encodeAbiParameters(parseAbiParameters('bool'), [v])
const addr = (v: Hex): Hex => encodeAbiParameters(parseAbiParameters('address'), [v])

async function approvalById(engine: Engine, id: string): Promise<ApprovalRequest> {
  const existing = engine.approvals.get(id)
  if (existing) return existing
  return new Promise((resolve) => {
    const off = engine.host.events.subscribe((e) => {
      const hit = e.type === 'approvals.changed' ? e.pending.find((p) => p.id === id) : undefined
      if (hit) {
        off()
        resolve(hit)
      }
    })
  })
}

function waitStep(engine: Engine, flowId: string, index: number, status: SwapFlow['steps'][number]['status']): Promise<SwapFlow> {
  const now = engine.swap.flow(flowId)
  if (now && (now.steps[index]?.status === status || now.status !== 'running')) return Promise.resolve(now)
  return new Promise((resolve) => {
    const off = engine.host.events.subscribe((e) => {
      if (e.type !== 'swap.progress' || e.flow.id !== flowId) return
      if (e.flow.steps[index]?.status === status || e.flow.status !== 'running') {
        off()
        resolve(e.flow)
      }
    })
  })
}

function waitDone(engine: Engine, flowId: string): Promise<SwapFlow> {
  const now = engine.swap.flow(flowId)
  if (now && now.status !== 'running') return Promise.resolve(now)
  return new Promise((resolve) => {
    const off = engine.host.events.subscribe((e) => {
      if (e.type === 'swap.progress' && e.flow.id === flowId && e.flow.status !== 'running') {
        off()
        resolve(e.flow)
      }
    })
  })
}

describe('the uber-app on the mainnet mock', () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let accountId: string
  const notes: Array<{ title: string; body: string }> = []
  const posted: unknown[] = []
  let price = 0.19
  let listingParams: Record<string, unknown> | null = null
  let listingSignature = '0x'
  const legendsOwned = [12n, 13n]
  const registered = new Set<string>(['13'])
  let claimable = 3n * 10n ** 18n
  let farmerLiquidity = 0n
  let poolStatus = 0

  function graphql(query: string, variables: Record<string, unknown>): unknown {
    if (query.startsWith('query TopTokens')) return { topTokens: [{ address: 'NATIVE', symbol: 'ETN', name: 'Electroneum', decimals: 18, standard: 'NATIVE', market: { price: { value: 0.00296 }, volume: { value: 10 } } }, { address: BOLT, symbol: 'BOLT', name: 'BOLT', decimals: 18, standard: 'ERC20', market: { price: { value: price }, volume: { value: 500 } }, project: { safetyLevel: 'VERIFIED' } }] }
    if (query.startsWith('query TopCollections')) return { topCollections: { edges: [{ node: { collectionId: '0x8888888888888888888888888888888888888888', name: 'Volts', isVerified: true, nftContracts: [{ address: '0x8888888888888888888888888888888888888888', standard: 'ERC721' }], markets: [{ floorPrice: { value: 2 }, volume: { value: 900 } }] } }, { node: { collectionId: LEGENDS, name: 'Electric Legends', isVerified: true, nftContracts: [{ address: LEGENDS, standard: 'ERC721' }], listingFees: [{ payoutAddress: SELLER, basisPoints: 500 }], markets: [{ floorPrice: { value: 40 }, volume: { value: 100 } }] } }] } }
    if (query.startsWith('query NftCollectionBalances')) return { nftCollectionBalances: { collections: [{ address: LEGENDS, name: 'Electric Legends', logoImage: null, balance: 2 }] } }
    if (query.startsWith('query NftCollections')) return { nftCollections: { edges: [{ node: { collectionId: LEGENDS, name: 'Electric Legends', isVerified: true, nftContracts: [{ address: LEGENDS, standard: 'ERC721' }], listingFees: [{ payoutAddress: SELLER, basisPoints: 500 }], markets: [{ floorPrice: { value: 40 } }] } }] } }
    if (query.startsWith('query NftBalances')) return { nftBalances: { pageInfo: { hasNextPage: false }, edges: legendsOwned.map((id) => ({ node: { quantity: 1, listedMarketplaces: [], ownedAsset: { tokenId: id.toString(), name: `Legend #${id}`, ownerAddress: address, nftContract: { address: LEGENDS, standard: 'ERC721' }, collection: { collectionId: LEGENDS, name: 'Electric Legends', listingFees: [{ payoutAddress: SELLER, basisPoints: 500 }] } } } })) } }
    if (query.startsWith('query NftAssetDetails')) {
      const tokenId = String(variables['tokenId'])
      if (tokenId === '77') return { nftAssetDetails: { tokenId: '77', name: 'Legend #77', ownerAddress: SELLER, nftContract: { address: LEGENDS, standard: 'ERC721' }, collection: { collectionId: LEGENDS, name: 'Electric Legends', listingFees: [{ payoutAddress: SELLER, basisPoints: 500 }] }, listings: { edges: listingParams ? [{ node: { type: 'LISTING', status: 'VALID', maker: SELLER, price: { value: 4.2 }, orderHash: '0xabc', signature: listingSignature, protocolParameters: JSON.stringify(listingParams) } }] : [] } } }
      return { nftAssetDetails: { tokenId, name: `Legend #${tokenId}`, ownerAddress: address, nftContract: { address: LEGENDS, standard: 'ERC721' }, collection: { collectionId: LEGENDS, name: 'Electric Legends', listingFees: [{ payoutAddress: SELLER, basisPoints: 500 }] } } }
    }
    if (query.startsWith('query NftBids')) return { nftBids: { edges: [] } }
    if (query.startsWith('query NftBidObligation')) return { nftBidObligation: { wetnObligation: '0' } }
    if (query.startsWith('query Presales')) return { presales: { edges: [{ node: { pool: POOL, status: 'ACTIVE', shareLink: 'zap', affiliate: { percent: 5 }, token: { name: 'Zap', symbol: 'ZAP', decimals: 18 }, campaign: { manager: A.launchpadManager, creator: SELLER, description: 'Zap it', starts: 1, ends: 4_000_000_000, etnRaised: 1000, minEtnToLaunch: 5000, minEtnToList: 100, contributorCount: 3 } } }] } }
    if (query.startsWith('query Presale(')) return { presale: { pool: POOL, status: 'ACTIVE', shareLink: 'zap', affiliate: { percent: 5 }, token: { name: 'Zap', symbol: 'ZAP', decimals: 18 }, campaign: { manager: A.launchpadManager, creator: SELLER, description: 'Zap it', starts: 1, ends: 4_000_000_000, etnRaised: 1000, minEtnToLaunch: 5000, minEtnToList: 100, contributorCount: 3 } } }
    if (query.startsWith('query YieldFarms')) return { yieldFarms: [{ id: 0, version: 2, name: 'ETN/USDC', poolAddr: PAIR, liquidity: '1000', token0: WETN, token1: USDC, tokenId: 0, fee: 0, active: true, tvl: 12_000, baseRewardApy: 41.2 }] }
    return {}
  }

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: CHAIN })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    for (const a of [WETN, USDC, BOLT, FARM, PAIR, LEGENDS, DIVIDENDS, MINTER, SEAPORT, POOL, A.launchpadManager, A.launchpadAffiliate, A.seaportConduit]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    const erc20 = (name: string, symbol: string, decimals: bigint, balance: bigint, allowance: bigint) => ({ data }: { data: Hex }): Hex => {
      const sel = data.slice(0, 10)
      if (sel === '0x06fdde03') return str(name)
      if (sel === '0x95d89b41') return str(symbol)
      if (sel === '0x313ce567') return u(decimals)
      if (sel === '0x70a08231') return u(balance)
      if (sel === '0xdd62ed3e') return u(allowance)
      return '0x'
    }
    rpc.state.calls.set(WETN.toLowerCase(), erc20('Wrapped ETN', 'WETN', 18n, 0n, 0n))
    rpc.state.calls.set(USDC.toLowerCase(), erc20('Hyperlane USDC', 'USDC', 6n, 5_000_000_000n, 0n))
    rpc.state.calls.set(BOLT.toLowerCase(), erc20('BOLT', 'BOLT', 18n, 100_000n * 10n ** 18n, 0n))
    rpc.state.calls.set(PAIR.toLowerCase(), ({ data }) => {
      const sel = data.slice(0, 10)
      if (sel === '0x0902f1ac') return encodeAbiParameters(parseAbiParameters('uint112, uint112, uint32'), [1_000_000n * 10n ** 18n, 2_960_000_000n, 0])
      if (sel === '0x18160ddd') return u(10_000n * 10n ** 18n)
      if (sel === '0x0dfe1681') return addr(WETN)
      return '0x'
    })
    const farmTuple = { id: 0n, version: 2, name: 'ETN/USDC', poolAddr: PAIR, liquidity: 1_000n * 10n ** 18n, allocPoint: 1n, lastCalcBlock: 0n, accRewardsPerShare: 0n, accThirdPartyRewardsPerShare: 0n, farmers: [], farmerCount: 3n, token0: WETN, token1: USDC, tokenId: 0n, tickLower: 0, tickUpper: 0, fee: 0, accFees0PerShare: 0n, accFees1PerShare: 0n, active: true }
    rpc.state.calls.set(FARM.toLowerCase(), ({ data }) => {
      const d = decodeFunctionData({ abi: YIELD_FARM_ABI, data })
      if (d.functionName === 'farmCount') return u(1n)
      if (d.functionName === 'getFarmById') return encodeFunctionResult({ abi: YIELD_FARM_ABI, functionName: 'getFarmById', result: farmTuple })
      if (d.functionName === 'getFarmerByFarmIdAndAddress') return encodeFunctionResult({ abi: YIELD_FARM_ABI, functionName: 'getFarmerByFarmIdAndAddress', result: { addr: address, liquidity: farmerLiquidity, boltMultiplier: 10_000n, boltDeposited: 0n, durationMultiplier: 17_500n, startingBlock: 100n, rewards: 12n * 10n ** 18n, rewardDebt: 0n, thirdPartyRewards: 0n, thirdPartyRewardDebt: 0n, fees0: 0n, fees0Debt: 0n, fees1: 0n, fees1Debt: 0n } })
      throw new Error('farm: unhandled')
    })
    rpc.state.calls.set(LEGENDS.toLowerCase(), ({ data }) => {
      const d = decodeFunctionData({ abi: LEGENDS_ABI, data })
      if (d.functionName === 'balanceOf') return u(BigInt(legendsOwned.length))
      if (d.functionName === 'tokenOfOwnerByIndex') return u(legendsOwned[Number(d.args[1])] ?? 0n)
      if (d.functionName === 'ownerOf') return addr(d.args[0] === 77n ? SELLER : address)
      if (d.functionName === 'isApprovedForAll') return bool(false)
      if (d.functionName === 'totalSupply') return u(500n)
      if (d.functionName === 'isMintable') return bool(true)
      throw new Error('legends: unhandled')
    })
    rpc.state.calls.set(DIVIDENDS.toLowerCase(), ({ data }) => {
      const d = decodeFunctionData({ abi: DIVIDENDS_ABI, data })
      if (d.functionName === 'tokenDividendInfo') return encodeAbiParameters(parseAbiParameters('uint256, uint256, bool'), [0n, 0n, registered.has(String(d.args[0]))])
      if (d.functionName === 'getClaimableDividends') return u(claimable)
      if (d.functionName === 'dividendsDistributed') return u(41_208n * 10n ** 18n)
      if (d.functionName === 'activeTokenCount') return u(300n)
      if (d.functionName === 'dividendsEnabled') return bool(true)
      throw new Error('dividends: unhandled')
    })
    rpc.state.calls.set(MINTER.toLowerCase(), ({ data }) => {
      const d = decodeFunctionData({ abi: MINTER_ABI, data })
      if (d.functionName === 'mintPrice') return u(105n * 10n ** 18n)
      if (d.functionName === 'mintableCount') return u(3n)
      throw new Error('minter: unhandled')
    })
    rpc.state.calls.set(SEAPORT.toLowerCase(), ({ data }) => {
      const d = decodeFunctionData({ abi: SEAPORT_ABI, data })
      if (d.functionName === 'getCounter') return u(0n)
      throw new Error('seaport: unhandled')
    })
    rpc.state.calls.set(POOL.toLowerCase(), ({ data }) => {
      const d = decodeFunctionData({ abi: LAUNCHPAD_POOL_ABI, data })
      if (d.functionName === 'status') return u(BigInt(poolStatus))
      if (d.functionName === 'totalEtnRaised') return u(1_000n * 10n ** 18n)
      if (d.functionName === 'maxContribution') return u(500n * 10n ** 18n)
      if (d.functionName === 'minEtnToLaunch') return u(5_000n * 10n ** 18n)
      if (d.functionName === 'contributionByAddress') return encodeAbiParameters(parseAbiParameters('uint256, bool'), [0n, false])
      if (d.functionName === 'claimableTokens') return u(0n)
      throw new Error('pool: unhandled')
    })
    rpc.state.calls.set(A.launchpadManager.toLowerCase(), () => u(10n ** 18n))
    rpc.state.calls.set(A.launchpadAffiliate.toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint256, uint256, uint256'), [0n, 0n, 0n]))
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input)
      if (url.includes('tokenlist.json')) return new Response(JSON.stringify({ name: 'fixture', tokens: [{ chainId: CHAIN, address: USDC, name: 'Hyperlane USDC', symbol: 'USDC', decimals: 6 }, { chainId: CHAIN, address: BOLT, name: 'BOLT', symbol: 'BOLT', decimals: 18 }, { chainId: CHAIN, address: WETN, name: 'Wrapped ETN', symbol: 'WETN', decimals: 18 }] }), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.endsWith('/api/nfts/order')) {
        posted.push(JSON.parse(String(init?.body)))
        return new Response(JSON.stringify({ code: 200 }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      if (url.endsWith('/graphql')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as { query: string; variables: Record<string, unknown> }
        return new Response(JSON.stringify({ data: graphql(body.query, body.variables) }), { status: 200, headers: { 'content-type': 'application/json' } })
      }
      return new Response('not found', { status: 404 })
    }
    const platform = createMemoryPlatform()
    const notifying = { ...platform, notify: async (n: { title: string; body: string }) => { notes.push({ title: n.title, body: n.body }) } }
    engine = createEngine({ platform: notifying, kdf: KDF, receiptPollMs: 20, fetch: fetchImpl, electroswapUrl: 'https://electroswap.test/graphql' })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    const quiz = await engine.engine.vault.backupQuiz({ seedId: created.seedId })
    const words = created.mnemonic.split(' ')
    await engine.engine.vault.confirmBackup({ seedId: created.seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    await engine.chains.setRpc(CHAIN, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 500n * 10n ** 18n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('Explore lists tokens by volume and pins Electric Legends with the dividends mark', async () => {
    const tokens = await engine.engine.explore.tokens({ chainId: CHAIN })
    expect(tokens.map((t) => t.symbol)).toEqual(['BOLT', 'ETN'])
    const collections = await engine.engine.explore.collections({ chainId: CHAIN, accountId })
    expect(collections[0]).toMatchObject({ name: 'Electric Legends', paysDividends: true, owned: 2, floorEtn: 40 })
    const found = await engine.engine.explore.search({ chainId: CHAIN, query: 'bol' })
    expect(found.tokens[0]?.symbol).toBe('BOLT')
  })

  it('farms: the chain position, the deposit quote with dilution and stairs, and Collect as withdraw(id, 0)', async () => {
    farmerLiquidity = 100n * 10n ** 18n
    const farms = await engine.engine.farm.list({ chainId: CHAIN, accountId })
    expect(farms[0]).toMatchObject({ id: 0, version: 2, symbol0: 'WETN', symbol1: 'USDC', tvlUsd: 12_000, baseApy: 41.2 })
    expect(farms[0]?.position).toMatchObject({ durationMultiplier: 17_500, pendingRewards: (12n * 10n ** 18n).toString(), shareOfFarm: 0.1 })
    expect(BigInt(farms[0]?.position?.amount1 ?? '0')).toBe(29_600_000n)
    const q = await engine.engine.farm.quoteDeposit({ accountId, chainId: CHAIN, farmId: 0, amount0: '10', bolt: '50000' })
    expect(q.ok, q.problems.join(' ')).toBe(true)
    expect(q.amount1Raw).toBe('29600')
    expect(q.nativeSide).toBe(0)
    expect(q.boltStair).toEqual({ total: (50_000n * 10n ** 18n).toString(), multiplier: 10_500 })
    expect(q.multiplierBefore).toBeGreaterThan(q.multiplierAfter)
    expect(q.steps).toEqual(['approve', 'approve', 'deposit'])
    const bad = await engine.engine.farm.quoteDeposit({ accountId, chainId: CHAIN, farmId: 0, amount0: '10', bolt: '1' })
    expect(bad.problems.join(' ')).toMatch(/50000 or 100000 BOLT/)
    const { flowId } = await engine.engine.farm.collect({ accountId, chainId: CHAIN, farmId: 0, asNative: true })
    const flow = await waitStep(engine, flowId, 0, 'signing')
    const req = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind === 'send_transaction' && payload.assessment.statements[0]?.text).toBe('Collect rewards and fees from farm #0')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(1)
    const tx = parseTransaction([...rpc.state.transactions.values()][0]?.raw as Hex)
    const d = decodeFunctionData({ abi: YIELD_FARM_ABI, data: tx.data as Hex })
    expect(d.functionName).toBe('withdraw')
    expect(d.args).toEqual([0n, 0n, true])
    rpc.advanceBlocks()
    expect((await waitDone(engine, flowId)).status).toBe('done')
  })

  it('the Legends vault: status, Activate for the unregistered piece, Claim with the best claim kept', async () => {
    const st = await engine.engine.legends.status({ accountId, chainId: CHAIN })
    expect(st).toMatchObject({ ownedTokenIds: ['12', '13'], registeredTokenIds: ['13'], unregisteredTokenIds: ['12'], claimableWei: claimable.toString(), activeTokenCount: 300, vesselLevel: 1 })
    expect(st?.mint).toMatchObject({ mintable: true, priceWei: (105n * 10n ** 18n).toString(), mintableCount: 3 })
    const act = await engine.engine.legends.activate({ accountId, chainId: CHAIN })
    let flow = await waitStep(engine, act.flowId, 0, 'signing')
    let req = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    expect(parseApprovalPayload(req.payload)?.kind === 'send_transaction' && (parseApprovalPayload(req.payload) as { assessment: { statements: Array<{ text: string }> } }).assessment.statements[0]?.text).toBe('Activate dividends for 1 Electric Legend')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(2)
    registered.add('12')
    rpc.advanceBlocks()
    await waitDone(engine, act.flowId)
    const claim = await engine.engine.legends.claim({ accountId, chainId: CHAIN })
    flow = await waitStep(engine, claim.flowId, 0, 'signing')
    req = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(3)
    const tx = parseTransaction([...rpc.state.transactions.values()][2]?.raw as Hex)
    const d = decodeFunctionData({ abi: DIVIDENDS_ABI, data: tx.data as Hex })
    expect(d.functionName).toBe('claimDividends')
    expect(d.args).toEqual([[12n, 13n]])
    rpc.advanceBlocks()
    await waitDone(engine, claim.flowId)
    claimable = 10n ** 18n
    const after = await engine.engine.legends.status({ accountId, chainId: CHAIN })
    expect(after?.bestClaimWei).toBe((3n * 10n ** 18n).toString())
    expect(after?.vesselLevel).toBeCloseTo(0.333, 2)
  })

  it('launchpad: the pool status is the truth, and Contribute carries the remembered referrer', async () => {
    const list = await engine.engine.launchpad.list({ chainId: CHAIN, accountId })
    expect(list[0]).toMatchObject({ pool: POOL, phase: 'live', keys: ['contribute'], fill: 0.2, minContributionWei: (10n ** 18n).toString() })
    poolStatus = 4
    expect((await engine.engine.launchpad.detail({ chainId: CHAIN, pool: POOL, accountId }))?.phase).toBe('upcoming')
    poolStatus = 0
    await engine.engine.launchpad.rememberFromLink({ url: `boltvault://launchpad/${POOL}?ref=${REFERRER}` })
    const { flowId } = await engine.engine.launchpad.contribute({ accountId, chainId: CHAIN, pool: POOL, amountEtn: '5' })
    const flow = await waitStep(engine, flowId, 0, 'signing')
    const req = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind === 'send_transaction' && payload.assessment.statements[0]?.text).toMatch(/^Contribute 5 ETN to the campaign/)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(4)
    const tx = parseTransaction([...rpc.state.transactions.values()][3]?.raw as Hex)
    expect(tx.value).toBe(5n * 10n ** 18n)
    const d = decodeFunctionData({ abi: LAUNCHPAD_POOL_ABI, data: tx.data as Hex })
    expect(d.functionName).toBe('contribute')
    expect(d.args).toEqual([REFERRER])
    rpc.advanceBlocks()
    await waitDone(engine, flowId)
    await expect(engine.engine.launchpad.contribute({ accountId, chainId: CHAIN, pool: POOL, amountEtn: '0.5' })).rejects.toMatchObject({ message: 'Below the minimum contribution.' })
  })

  it('marketplace: List approves the conduit, signs the order the firewall reads, and hands the API the intake body', async () => {
    const inv = await engine.engine.nft.inventory({ accountId, chainId: CHAIN })
    expect(inv.assets.map((a) => a.tokenId)).toEqual(['12', '13'])
    expect(inv.assets[0]).toMatchObject({ mine: true, paysDividends: true, collectionName: 'Electric Legends' })
    expect(inv.floorValueEtn).toBe(80)
    const before = rpc.state.transactions.size
    const { flowId } = await engine.engine.nft.list({ accountId, chainId: CHAIN, address: LEGENDS, tokenId: '12', priceEtn: '4.2', days: 7 })
    let flow = await waitStep(engine, flowId, 0, 'signing')
    expect(flow.steps.map((s) => s.step)).toEqual(['approve_collection', 'sign_order', 'post_order'])
    let req = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    expect(parseApprovalPayload(req.payload)?.kind === 'send_transaction' && (parseApprovalPayload(req.payload) as { assessment: { statements: Array<{ text: string }> } }).assessment.statements[0]?.text).toMatch(/^Allow ElectroSwap marketplace conduit to move any item in Electric Legends/)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(before + 1)
    rpc.advanceBlocks()
    flow = await waitStep(engine, flowId, 1, 'signing')
    req = await approvalById(engine, flow.steps[1]?.requestId ?? '')
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind).toBe('sign_typed_data')
    if (payload?.kind !== 'sign_typed_data') throw new Error('unreachable')
    expect(payload.primaryType).toBe('OrderComponents')
    const parsed = parseTypedData(payload.typedData)
    expect(parsed?.decoded.kind).toBe('seaport_order')
    expect(payload.assessment.presentation.blocked).toBe(false)
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    const done = await waitDone(engine, flowId)
    expect(done.status).toBe('done')
    const body = posted[0] as { type: string; tokenId: number; order_hash: string; parameters: { offerer: string; consideration: Array<{ recipient: string; startAmount: string }> } }
    expect(body.type).toBe('LISTING')
    expect(body.tokenId).toBe(12)
    expect(body.parameters.offerer.toLowerCase()).toBe(address.toLowerCase())
    const price = 4_200_000_000_000_000_000n
    expect(body.parameters.consideration.map((c) => [c.recipient.toLowerCase(), c.startAmount])).toEqual([
      [address.toLowerCase(), (price - (price * 500n) / 10_000n - (price * 300n) / 10_000n).toString()],
      [SELLER.toLowerCase(), ((price * 500n) / 10_000n).toString()],
      [A.nftFeeReceiver.toLowerCase(), ((price * 300n) / 10_000n).toString()],
    ])
    expect(done.hash).toBe(body.order_hash)
  })

  it('marketplace: Buy checks the chain owner and fulfils the listing with the ETN', async () => {
    // A listing by SELLER for #77, as the API would store it.
    const order = buildListing({ config, seller: SELLER, token: LEGENDS, tokenId: 77n, standard: 'ERC721', priceWei: 4_200_000_000_000_000_000n, creatorFee: { payoutAddress: SELLER, basisPoints: 500 }, endTime: 4_000_000_000n, counter: 0n, salt: 7n, now: 1_757_000_000_000 })
    listingParams = { ...order, offer: order.offer.map((o) => ({ ...o, identifierOrCriteria: o.identifierOrCriteria.toString(), startAmount: o.startAmount.toString(), endAmount: o.endAmount.toString() })), consideration: order.consideration.map((c) => ({ ...c, identifierOrCriteria: c.identifierOrCriteria.toString(), startAmount: c.startAmount.toString(), endAmount: c.endAmount.toString() })), startTime: order.startTime.toString(), endTime: order.endTime.toString(), salt: order.salt.toString(), counter: '0', totalOriginalConsiderationItems: 3 }
    listingSignature = `0x${'cd'.repeat(65)}`
    const asset = await engine.engine.nft.asset({ chainId: CHAIN, address: LEGENDS, tokenId: '77', accountId })
    expect(asset?.listing).toMatchObject({ priceEtn: 4.2, actionable: true, priceRaw: '4200000000000000000' })
    expect(asset?.mine).toBe(false)
    const before = rpc.state.transactions.size
    const { flowId } = await engine.engine.nft.buy({ accountId, chainId: CHAIN, address: LEGENDS, tokenId: '77' })
    const flow = await waitStep(engine, flowId, 0, 'signing')
    const req = await approvalById(engine, flow.steps[0]?.requestId ?? '')
    const payload = parseApprovalPayload(req.payload)
    expect(payload?.kind === 'send_transaction' && payload.assessment.statements[0]?.text).toBe('Buy Electric Legends #77 for 4.2 ETN')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 10_000 }).toBe(before + 1)
    const tx = parseTransaction([...rpc.state.transactions.values()][before]?.raw as Hex)
    expect(tx.to?.toLowerCase()).toBe(SEAPORT.toLowerCase())
    expect(tx.value).toBe(4_200_000_000_000_000_000n)
    const d = decodeFunctionData({ abi: SEAPORT_ABI, data: tx.data as Hex })
    expect(d.functionName).toBe('fulfillOrder')
    expect(orderHash(order)).toMatch(/^0x[0-9a-f]{64}$/)
    rpc.advanceBlocks()
    await waitDone(engine, flowId)
  })

  it('positions aggregate the farm, the vault and the campaign; the watchlist alerts and nudges once', async () => {
    const pos = await engine.engine.positions.snapshot({ accountId, chainId: CHAIN })
    expect(pos.farms.length).toBe(1)
    expect(pos.legends?.ownedTokenIds).toEqual(['12', '13'])
    expect(pos.accessories[0]?.kind).toBe('dividends')
    await engine.engine.watchlist.star({ kind: 'token', chainId: CHAIN, address: BOLT, label: 'BOLT' })
    await engine.engine.watchlist.setAlert({ kind: 'token', chainId: CHAIN, address: BOLT, above: 0.25, below: null, onLive: false })
    expect((await engine.engine.watchlist.list())[0]).toMatchObject({ kind: 'token', above: 0.25 })
    // On a token list the star is the pin (plan A5): starring for alerts does not pin, pinning does.
    expect((await engine.engine.explore.tokens({ chainId: CHAIN }))[0]?.pinned).toBe(false)
    await engine.engine.tokens.setPrefs({ chainId: CHAIN, address: BOLT, pinned: true })
    expect((await engine.engine.explore.tokens({ chainId: CHAIN }))[0]?.pinned).toBe(true)
    // First pass records the value (0.19) and nudges about the dividends; the second sees the crossing.
    const first = await engine.engine.watchlist.check()
    expect(first).toContain(`dividends:${accountId}`)
    price = 0.3
    await new Promise((r) => setTimeout(r, 5))
    await engine.cache.invalidate(cacheKey('explore', 'tokens', CHAIN))
    const second = await engine.engine.watchlist.check()
    expect(second).toContain(`above:token:${BOLT}`)
    expect(second).not.toContain(`dividends:${accountId}`)
    expect(notes.some((n) => n.title === 'BOLT above $0.25')).toBe(true)
  })
})
