/**
 * Fixture engines for the screenshot harness and tests: a real engine over
 * the memory platform, with a deterministic head source and (for the
 * `funded` scenario) a portfolio namespace answering from fixture rows. No
 * network, no service worker, byte-identical output run to run.
 */
import { createEngine, type ActivityEntry, type AllowanceView, type Engine, type FeeScheduleView, type HeadSource, type HolderTier, type PortfolioSnapshot, type SwapQuote, type TokenView, type AssetView, type CollectionView, type ExploreToken, type FarmView, type CampaignView, type LegendsStatus, type Positions, type WatchItem, type Inventory, type OffersInbox, type BridgeRoute, type BridgeStatus } from '@boltvault/engine'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { z } from 'zod'

export type FixtureScenario = 'fresh' | 'locked' | 'unlocked' | 'funded' | 'connect' | 'sign' | 'keystone'

const FIXED_NOW = 1_757_000_000_000
const PASSWORD = 'fixture password'
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const SITE = 'https://app.electroswap.io'

const heads: HeadSource = { blockNumber: async (chainId) => BigInt(chainId === 52014 ? 15_212_345 : 21_000_000) }

export function fixtureSnapshot(accountId: string): PortfolioSnapshot {
  const rows: PortfolioSnapshot['rows'] = [
    { chainId: 52014, address: 'native', symbol: 'ETN', name: 'Electroneum', decimals: 18, logoUri: null, raw: '2613600000000000000000000', quantity: '2613600', fiat: 7736.26, change24h: 0.021, share: 0.62, pinned: true, custom: false, hidden: false },
    { chainId: 52014, address: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1', symbol: 'BOLT', name: 'BOLT', decimals: 18, logoUri: null, raw: '18400000000000000000000', quantity: '18400', fiat: 3494.4, change24h: -0.008, share: 0.28, pinned: false, custom: false, hidden: false },
    { chainId: 52014, address: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', symbol: 'USDC', name: 'Hyperlane USDC', decimals: 6, logoUri: null, raw: '1248000000', quantity: '1248', fiat: 1248, change24h: 0, share: 0.1, pinned: false, custom: false, hidden: false },
    { chainId: 52014, address: '0xEe432C220273e4F949007B4c1946562826Efa055', symbol: 'DYNO', name: 'DYNO', decimals: 18, logoUri: null, raw: '12000000000000000000', quantity: '12', fiat: null, change24h: null, share: 0, pinned: false, custom: false, hidden: false },
  ]
  return { accountId, chainIds: [52014], currency: 'USD', total: 12478.66, change24h: 0.021, unpricedCount: 1, rows, observedAt: FIXED_NOW, stale: false }
}

/**
 * The collection's real artwork, for a screenshot that has to look like the
 * product rather than like a fixture.
 *
 * It is OFF unless asked for, and the default stays exactly as it was, because
 * the harness's whole promise is "no network, so screenshots are
 * deterministic" — the committed baselines must not start depending on a CDN
 * being up. `harness.html?art=on` turns it on for the landing page's shots,
 * which are taken by hand and can afford a fetch.
 */
const ART_BASE = 'https://static.electroswap.io'
const LEGENDS_ART = {
  banner: `${ART_BASE}/images/ElectricLegends_Banner.webp`,
  logo: `${ART_BASE}/images/ElectricLegends_Logo.webp`,
  piece: (tokenId: string): string => `${ART_BASE}/nfts/0x31cbb613D14cc85Cf3A8889007562E4B5cE9518b/${tokenId}_medium.webp`,
} as const

export interface FixtureOptions {
  /** Load the collection's real images from the CDN. Off by default; see LEGENDS_ART. */
  readonly art?: boolean
}

export async function createFixtureEngine(scenario: FixtureScenario, options: FixtureOptions = {}): Promise<Engine> {
  // With art on, the owned pieces are the ones the CDN actually has, so a
  // medallion's number and the picture under it agree.
  const art = options.art === true
  const ownedIds = art ? ['5', '4', '6'] : ['12', '13', '41']
  const artOf = (tokenId: string): string | null => (art ? LEGENDS_ART.piece(tokenId) : null)
  const platform = createMemoryPlatform({ now: FIXED_NOW })
  const engine = createEngine({ platform, heads })
  await engine.ready
  if (scenario !== 'fresh') {
    const { seedId, accounts } = await engine.engine.vault.import({ mnemonic: MNEMONIC, password: PASSWORD })
    const account = accounts[0]
    if (scenario === 'funded' || scenario === 'connect' || scenario === 'sign' || scenario === 'keystone') {
      // A mature account: the backup quiz has been passed, so no gate plate on Home.
      const words = MNEMONIC.split(' ')
      const quiz = await engine.engine.vault.backupQuiz({ seedId })
      await engine.engine.vault.confirmBackup({ seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    }
    if (scenario === 'funded' && account) {
      await engine.sites.registry.connect(SITE, { accountId: account.id, chainId: 52014, accounts: [account.address], now: FIXED_NOW - 86_400_000 })
      engine.sites.emit()
      // Plan C2: a second address kept hidden, a watch-only address and a Ledger account, so Accounts shows every group.
      const savings = await engine.engine.accounts.derive({ seedId, label: 'Savings' })
      await engine.engine.accounts.setHidden({ id: savings.id, hidden: true })
      await engine.engine.accounts.addWatch({ address: '0x9a2c4f1e8b7d3c6a5e4f2d1c0b9a8e7d6c5b41e0', label: 'Cold storage' })
      await engine.engine.accounts.addHardware({ kind: 'ledger', address: '0x7b63c5e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7', path: "m/44'/60'/0'/0/3", deviceId: 'fx-ledger', label: 'Ledger #3' })
    }
    if (scenario === 'connect') {
      await engine.approvals.create({ kind: 'connect', origin: SITE, accountId: null, chainId: 52014, payload: { kind: 'connect', requestedChainId: 52014, reconnect: false, firstTime: true, clientRequestId: 'fixture-connect' } })
    }
    if (scenario === 'sign' && account) {
      await engine.approvals.create({
        kind: 'send_transaction',
        origin: SITE,
        accountId: account.id,
        chainId: 52014,
        payload: {
          kind: 'send_transaction',
          tx: { from: account.address, to: '0x1111111111111111111111111111111111111111', value: '0x0', data: '0x095ea7b3', nonce: 4, gas: '0xea60', type: 'legacy', gasPrice: '0x3b9aca00' },
          fee: { gasLimit: '60000', maxTotalWei: '60000000000000', symbol: 'ETN' },
          assessment: {
            severity: 'danger',
            rules: [
              { code: 'APPROVE_UNKNOWN_SPENDER', severity: 'danger', title: 'Allowance for an unknown contract', detail: 'This lets 0x2222…2222 spend an unlimited amount of 0x1111…1111. BoltVault does not recognise the spender.' },
              { code: 'SIM_INCOMPLETE', severity: 'warn', title: 'Preview shows no balance changes', detail: 'This network cannot preview what moves. Only the revert check ran.' },
            ],
            statements: [{ text: 'Allow 0x2222…2222 to move an unlimited amount of 0x1111…1111', tone: 'warn' }],
            changes: [],
            presentation: { delayMs: 1500, typedConfirmation: 'CONFIRM', blocked: false },
            simulationMode: 'estimate',
          },
          clientRequestId: 'fixture-sign',
        },
      })
    }
    if (scenario === 'locked') await engine.engine.vault.lock()
  }
  if (scenario === 'funded' || scenario === 'keystone') {
    const accountId = (await engine.engine.accounts.list())[0]?.id ?? 'fixture'
    const address = (await engine.engine.accounts.list())[0]?.address ?? '0x0000000000000000000000000000000000000000'
    const snap = fixtureSnapshot(accountId)
    const tokens: TokenView[] = snap.rows.map((r) => ({ chainId: r.chainId, address: r.address, symbol: r.symbol, name: r.name, decimals: r.decimals, logoUri: r.logoUri, source: r.address === 'native' ? 'native' : 'list', pinned: r.pinned, hidden: false, tags: [] }))
    const activity: ActivityEntry[] = [
      { id: 'fx-1', hash: `0x${'a1'.repeat(32)}`, chainId: 52014, accountId, to: '0x2222222222222222222222222222222222222222', value: '1000000000000000000000', nonce: 3, submittedAt: FIXED_NOW - 3_600_000, origin: 'internal:send', category: 'SEND', statements: ['Send 1,000 ETN to 0x2222…2222'], riskCodes: ['RECIPIENT_FIRST_TIME'], status: 'confirmed', blockNumber: 15_212_100, token: 'native' },
      { id: 'fx-2', hash: `0x${'b2'.repeat(32)}`, chainId: 52014, accountId, to: address, from: '0x3333333333333333333333333333333333333333', value: '250000000', nonce: null, submittedAt: FIXED_NOW - 7_200_000, origin: null, category: 'RECEIVE', statements: ['Received USDC from 0x3333…3333'], riskCodes: [], status: 'confirmed', blockNumber: 15_211_000, token: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e' },
      { id: 'fx-3', hash: `0x${'c3'.repeat(32)}`, chainId: 52014, accountId, to: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1', value: '0', nonce: 4, submittedAt: FIXED_NOW - 600_000, origin: 'https://app.electroswap.io', category: 'APPROVE', statements: ['Allow Permit2 to move up to 5,000 BOLT'], riskCodes: [], status: 'pending', blockNumber: null, token: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1' },
    ]
    const allowances: AllowanceView[] = [
      { chainId: 52014, token: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1', tokenSymbol: 'BOLT', decimals: 18, spender: '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617', spenderName: 'Permit2', known: true, standard: 'erc20', amount: 'unlimited', expiration: null },
      { chainId: 52014, token: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', tokenSymbol: 'USDC', decimals: 6, spender: '0x2c12c8F15637b7A182DEc202816148A5E767DCEC', spenderName: 'ElectroSwap Universal Router', known: true, standard: 'permit2', amount: '1248000000', expiration: Math.floor(FIXED_NOW / 1000) + 1_800 },
      { chainId: 52014, token: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', tokenSymbol: 'USDC', decimals: 6, spender: '0x9999999999999999999999999999999999999999', spenderName: null, known: false, standard: 'erc20', amount: 'unlimited', expiration: null },
    ]
    const AccountArg = z.object({ accountId: z.string() }).passthrough()
    engine.host.override('portfolio', {
      snapshot: { input: AccountArg, handler: async () => snap },
      cached: { input: AccountArg, handler: async () => snap },
      refresh: { input: AccountArg, handler: async () => snap },
      lastLook: { input: AccountArg, handler: async () => ({ previous: null, total: snap.total }) },
    })
    engine.host.override('tokens', {
      universe: { input: z.object({}).passthrough(), handler: async () => tokens },
      get: { input: z.object({ address: z.string() }).passthrough(), handler: async (arg) => tokens.find((t) => t.address.toLowerCase() === (arg as { address: string }).address.toLowerCase()) ?? null },
      search: { input: z.object({ query: z.string() }).passthrough(), handler: async (arg) => tokens.filter((t) => t.symbol.toLowerCase().includes((arg as { query: string }).query.toLowerCase())) },
    })
    engine.host.override('activity', {
      list: { input: z.object({}).passthrough().optional(), handler: async () => activity },
    })
    engine.host.override('activityScan', { scan: { input: AccountArg, handler: async () => ({ added: 0, fromBlock: 15_212_000, toBlock: 15_212_345 }) } })
    engine.host.override('allowances', {
      cached: { input: AccountArg, handler: async () => ({ rows: allowances, at: FIXED_NOW - 30_000 }) },
      scan: { input: AccountArg, handler: async () => allowances },
    })
    engine.host.override('names', { lookup: { input: z.object({ addresses: z.array(z.string()) }).passthrough(), handler: async (arg) => (arg as { addresses: string[] }).addresses.map((a) => ({ address: a, name: null, verified: false })) } })
    engine.host.override('send', {
      quote: {
        input: z.object({ to: z.string(), amount: z.string(), token: z.string() }).passthrough(),
        handler: async (arg) => {
          const { to, amount, token } = arg as { to: string; amount: string; token: string }
          const row = snap.rows.find((r) => r.address.toLowerCase() === token.toLowerCase()) ?? snap.rows[0]
          const ok = /^0x[0-9a-fA-F]{40}$/.test(to) && Number(amount) > 0
          return { to: /^0x[0-9a-fA-F]{40}$/.test(to) ? to : null, name: null, token, symbol: row?.symbol ?? 'ETN', decimals: row?.decimals ?? 18, amountRaw: '0', balanceRaw: row?.raw ?? '0', maxRaw: row?.raw ?? '0', max: row?.quantity ?? '0', feeWei: '21000000000000', feeSymbol: 'ETN', ok, problems: ok ? [] : [Number(amount) > 0 ? 'Enter a full address or a name.' : 'Enter an amount above zero.'] }
        },
      },
    })
    // M5: a live-looking quote, the holder tier and an open limit order for the Swap screen.
    const BOLT = '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1'
    const USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
    const SINK = '0x00000000000000000000000000000000000051ab'
    const tierView: HolderTier = { chainId: 52014, bips: 40, tier: 1, name: 'Charge', nextTierName: 'Magneto', score: '18400000000000000000000', nextTierAt: '136000000000000000000000', nextTierBips: 30, source: 'config', sink: SINK, schedule: '0x00000000000000000000000000000000000005c4', breakdown: { wallet: '18400000000000000000000', farm: '0', dyno: '0' } }
    const schedule: FeeScheduleView = { chainId: 52014, baseName: 'Static', baseBips: 50, tiers: [{ name: 'Charge', minScore: '13600000000000000000000', bips: 40 }, { name: 'Magneto', minScore: '136000000000000000000000', bips: 30 }, { name: 'Turbine', minScore: '680000000000000000000000', bips: 20 }, { name: 'Reactor', minScore: '1360000000000000000000000', bips: 10 }], dynoWeight: '828590000000000000000', dynoWeightSource: 'average', countFarmBolt: true, source: 'config', sink: SINK, address: '0x00000000000000000000000000000000000005c4' }
    const swapQuote = (arg: { tokenIn: string; tokenOut: string; amountIn: string; slippageBips?: number }): SwapQuote => {
      const inRow = snap.rows.find((r) => r.address.toLowerCase() === arg.tokenIn.toLowerCase()) ?? snap.rows[0]
      const outRow = snap.rows.find((r) => r.address.toLowerCase() === arg.tokenOut.toLowerCase()) ?? snap.rows[2]
      const decIn = inRow?.decimals ?? 18
      const decOut = outRow?.decimals ?? 6
      const amountIn = BigInt(Math.round(Number(arg.amountIn || '0') * 1e6)) * 10n ** BigInt(Math.max(0, decIn - 6))
      // A fixed rate so the screenshot is stable: 1 in = 0.00296 out (ETN → USDC).
      const amountOut = (amountIn * 296n * 10n ** BigInt(decOut)) / (100_000n * 10n ** BigInt(decIn))
      const fee = (amountOut * 40n) / 10_000n
      const receive = amountOut - fee
      const slippage = BigInt(arg.slippageBips ?? 50)
      const minOut = receive - (receive * slippage) / 10_000n
      const ok = amountIn > 0n && amountIn <= BigInt(inRow?.raw ?? '0')
      return {
        chainId: 52014,
        tokenIn: arg.tokenIn,
        tokenOut: arg.tokenOut,
        symbolIn: inRow?.symbol ?? 'ETN',
        symbolOut: outRow?.symbol ?? 'USDC',
        decimalsIn: decIn,
        decimalsOut: decOut,
        amountInRaw: amountIn.toString(),
        balanceInRaw: inRow?.raw ?? '0',
        amountOutRaw: amountOut.toString(),
        receiveRaw: receive.toString(),
        minimumOutRaw: minOut.toString(),
        rate: 0.00296,
        priceImpactPct: 0.12,
        slippageBips: Number(slippage),
        taxBips: 0,
        taxUnknown: false,
        fee: { bips: 40, tier: 1, name: 'Charge', amountRaw: fee.toString(), sink: SINK, source: 'config', nextTierAt: '136000000000000000000000', nextTierBips: 30 },
        route: { label: 'V3 0.3%', hops: [{ kind: 'v3', tokenIn: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77', tokenOut: USDC, fee: 3000 }] },
        gasEstimate: '210000',
        steps: arg.tokenIn === 'native' ? ['swap'] : ['approve', 'permit', 'swap'],
        quotedAt: Date.now(),
        ok,
        problems: ok ? [] : [amountIn > 0n ? `Not enough ${inRow?.symbol ?? 'ETN'}.` : 'Enter an amount above zero.'],
      }
    }
    engine.host.override('holder', {
      tier: { input: AccountArg, handler: async () => tierView },
      schedule: { input: z.object({}).passthrough(), handler: async () => schedule },
      addresses: { input: z.object({}).passthrough(), handler: async () => ({ sink: SINK, schedule: schedule.address }) },
    })
    engine.host.override('swap', {
      quote: { input: z.object({ tokenIn: z.string(), tokenOut: z.string(), amountIn: z.string(), slippageBips: z.number().optional() }).passthrough(), handler: async (arg) => swapQuote(arg as { tokenIn: string; tokenOut: string; amountIn: string; slippageBips?: number }) },
      flows: { input: z.object({}).passthrough().optional(), handler: async () => [] },
    })
    engine.host.override('limit', {
      list: { input: AccountArg, handler: async () => [{ chainId: 52014, orderId: '42', tokenIn: BOLT, tokenOut: USDC, symbolIn: 'BOLT', symbolOut: 'USDC', decimalsIn: 18, decimalsOut: 6, amountInExact: '5000000000000000000000', amountOutMin: '1100000000', amountInRemaining: '5000000000000000000000', amountOutFilled: '0', unwrapOutput: false, createdAt: Math.floor(FIXED_NOW / 1000) - 3_600, expiresAt: Math.floor(FIXED_NOW / 1000) + 6 * 86_400, status: 'open' as const }] },
      quote: {
        input: z.object({ tokenIn: z.string(), tokenOut: z.string(), amountIn: z.string(), minOut: z.string(), durationSeconds: z.number() }).passthrough(),
        handler: async (arg) => {
          const a = arg as { tokenIn: string; tokenOut: string; amountIn: string; minOut: string; durationSeconds: number }
          const q = swapQuote({ tokenIn: a.tokenIn, tokenOut: a.tokenOut, amountIn: a.amountIn })
          const minOut = BigInt(Math.round(Number(a.minOut || '0') * 10 ** q.decimalsOut))
          const target = Number(a.amountIn) > 0 ? Number(a.minOut) / Number(a.amountIn) : null
          return { chainId: 52014, tokenIn: a.tokenIn, tokenOut: a.tokenOut, symbolIn: q.symbolIn, symbolOut: q.symbolOut, decimalsIn: q.decimalsIn, decimalsOut: q.decimalsOut, amountInRaw: q.amountInRaw, balanceInRaw: q.balanceInRaw, minOutRaw: minOut.toString(), targetRate: target, marketRate: 0.00296, distancePct: target ? (target / 0.00296 - 1) * 100 : null, durationSeconds: a.durationSeconds, platformFeeBips: 10, steps: ['approve', 'permit', 'submit'], ok: q.ok && minOut > 0n, problems: q.ok && minOut > 0n ? [] : ['Enter the least you will accept.'] }
        },
      },
    })
    // M6: Explore, the marketplace, the Legends vault, a farm position, a live campaign, positions and the watchlist.
    const LEGENDS = '0x31cbb613D14cc85Cf3A8889007562E4B5cE9518b'
    const POOL = '0x9999999999999999999999999999999999999999'
    const OTHER = '0x6666666666666666666666666666666666666666'
    const exploreTokens: ExploreToken[] = [
      { chainId: 52014, address: 'native', symbol: 'ETN', name: 'Electroneum', decimals: 18, logoUri: null, price: 0.00296, change24h: 2.1, change7d: 5.4, volume24h: 184_200, tvl: 1_240_000, marketCap: 53_000_000, safety: 'VERIFIED', pinned: false },
      { chainId: 52014, address: BOLT, symbol: 'BOLT', name: 'BOLT', decimals: 18, logoUri: null, price: 0.19, change24h: -0.8, change7d: 3.2, volume24h: 42_100, tvl: 380_000, marketCap: 1_900_000, safety: 'VERIFIED', pinned: true },
      { chainId: 52014, address: USDC, symbol: 'USDC', name: 'Hyperlane USDC', decimals: 6, logoUri: null, price: 1, change24h: 0, change7d: 0, volume24h: 96_400, tvl: 610_000, marketCap: null, safety: 'VERIFIED', pinned: false },
      { chainId: 52014, address: '0xEe432C220273e4F949007B4c1946562826Efa055', symbol: 'DYNO', name: 'DYNO', decimals: 18, logoUri: null, price: 0.012, change24h: 11.4, change7d: -2.2, volume24h: 12_000, tvl: 41_000, marketCap: 240_000, safety: 'VERIFIED', pinned: false },
    ]
    const legendsCollection: CollectionView = { chainId: 52014, address: LEGENDS, name: 'Electric Legends', volumeEtn: 128, volumeChangePct: 12.5, floorChangePct: -3.1, sales: 4, description: 'The flagship ElectroSwap collection. Every Legend shares a third of the marketplace fees.', verified: true, standard: 'ERC721', totalSupply: 500, imageUrl: art ? LEGENDS_ART.logo : null, bannerUrl: art ? LEGENDS_ART.banner : null, creatorFee: { payoutAddress: OTHER, basisPoints: 500 }, floorEtn: 40, volume24hEtn: 128, totalVolumeEtn: 41_208, owners: 212, listed: 31, percentListed: 6.2, traits: [{ name: 'Element', values: ['Volt', 'Arc', 'Plasma'] }], paysDividends: true, starred: false, owned: 2, mint: { mintable: true, priceWei: '25000000000000000000', mintableCount: 3, totalSupply: 500 } }
    const voltsCollection: CollectionView = { chainId: 52014, address: '0x8888888888888888888888888888888888888888', name: 'Volts', volumeEtn: 900, volumeChangePct: -8, floorChangePct: 2.4, sales: 11, description: null, verified: true, standard: 'ERC721', totalSupply: 2_000, imageUrl: null, bannerUrl: null, creatorFee: null, floorEtn: 2.4, volume24hEtn: 900, totalVolumeEtn: 12_000, owners: 640, listed: 140, percentListed: 7, traits: [], paysDividends: false, starred: false, owned: 0 }
    const piece = (tokenId: string, extra: Partial<AssetView> = {}): AssetView => ({ chainId: 52014, address: LEGENDS, tokenId, name: `Legend #${tokenId}`, description: 'A Volt-class Legend, struck in the first storm.', imageUrl: artOf(tokenId), smallImageUrl: artOf(tokenId), animationUrl: null, mediaType: 'IMAGE', owner: address, mine: true, standard: 'ERC721', collectionName: 'Electric Legends', collectionVerified: true, collectionImageUrl: art ? LEGENDS_ART.logo : null, creatorFee: { payoutAddress: OTHER, basisPoints: 500 }, suspicious: false, rarityRank: Number(tokenId) * 3, traits: [{ name: 'Element', value: 'Volt', rarity: 0.12 }, { name: 'Charge', value: 'High', rarity: 0.3 }], lastPriceEtn: 38, listing: null, bestBid: null, bids: [], dividendsWei: '310000000000000000', paysDividends: true, ...extra })
    const offer = { type: 'BID' as const, status: 'VALID' as const, priceEtn: 36.5, priceRaw: '36500000000000000000', orderHash: '0xbid1', maker: OTHER, createdAt: Math.floor(FIXED_NOW / 1000) - 3_600, endAt: Math.floor(FIXED_NOW / 1000) + 5 * 86_400, actionable: true }
    const listing = { type: 'LISTING' as const, status: 'VALID' as const, priceEtn: 42, priceRaw: '42000000000000000000', orderHash: '0xlist1', maker: address, createdAt: Math.floor(FIXED_NOW / 1000) - 7_200, endAt: Math.floor(FIXED_NOW / 1000) + 6 * 86_400, actionable: true }
    const owned: AssetView[] = [piece(ownedIds[0] as string, { bids: [offer], bestBid: offer }), piece(ownedIds[1] as string, { listing }), piece(ownedIds[2] as string, { rarityRank: 9, dividendsWei: '0' })]
    const inventory: Inventory = { accountId, chainId: 52014, assets: owned, collections: [{ address: LEGENDS, name: 'Electric Legends', logoUrl: art ? LEGENDS_ART.logo : null, balance: 3, floorEtn: 40 }], floorValueEtn: 120, listedCount: 1, withOffersCount: 1, observedAt: FIXED_NOW }
    const legendsStatus: LegendsStatus = { accountId, chainId: 52014, collection: LEGENDS, distributor: '0xc4065B310d64a02Ac4BF43CFd35C5Fe1A42811ea', ownedTokenIds: ownedIds, registeredTokenIds: ['12', '13'], unregisteredTokenIds: ['41'], claimableWei: '3210000000000000000', bestClaimWei: '5000000000000000000', vesselLevel: 0.64, lifetimePaidWei: '41208000000000000000000', activeTokenCount: 300, shareOfNextFee: 0.00222, dividendsEnabled: true, mint: { mintable: true, priceWei: '105000000000000000000', mintableCount: 3, totalSupply: 500 }, observedAt: FIXED_NOW }
    const farm: FarmView = { chainId: 52014, id: 0, version: 2, name: 'ETN/USDC', poolAddr: '0x7777777777777777777777777777777777777777', token0: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77', token1: USDC, symbol0: 'ETN', symbol1: 'USDC', decimals0: 18, decimals1: 6, active: true, tvlUsd: 12_400, baseApy: 41.2, thirdPartyApy: 3.1, thirdParty: { token: '0x8888888888888888888888888888888888888888', symbol: 'ZAP' }, farmerCount: 88, position: { liquidity: '100000000000000000000', shareOfFarm: 0.043, durationMultiplier: 17_500, boltMultiplier: 10_500, boltDeposited: '50000000000000000000000', startingBlock: 12_058_000, blocksServed: 3_153_600, pendingRewards: '12400000000000000000', pendingThirdParty: '0', fees0: '0', fees1: '0', at2x: FIXED_NOW + 61 * 86_400_000, at25x: FIXED_NOW + 183 * 86_400_000, nextStair: { bolt: '100000000000000000000000', multiplier: 11_500, more: '50000000000000000000000' }, amount0: '410000000000000000000000', amount1: '1213000000' } }
    const farm2: FarmView = { ...farm, id: 1, version: 3, name: 'BOLT/ETN', token0: BOLT, token1: '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77', symbol0: 'BOLT', symbol1: 'ETN', decimals0: 18, decimals1: 18, tvlUsd: 6_100, baseApy: 58.9, thirdPartyApy: null, thirdParty: null, farmerCount: 41, position: null }
    const campaign: CampaignView = { chainId: 52014, pool: POOL, status: 'ACTIVE', phase: 'live', token: { name: 'Zap Protocol', symbol: 'ZAP', decimals: 18, address: null }, creator: OTHER, creatorName: 'zap.etn', logoUrl: null, bannerUrl: null, description: 'Zap is a lightning-fast payments layer on Electroneum.', links: { website: 'https://zap.example', twitter: null, discord: null, telegram: 'https://t.me/zap' }, starts: Math.floor(FIXED_NOW / 1000) - 86_400, ends: Math.floor(FIXED_NOW / 1000) + 3 * 86_400, raisedWei: '3120000000000000000000', minEtnToLaunchWei: '5000000000000000000000', maxContributionWei: '500000000000000000000', minContributionWei: '1000000000000000000', fill: 0.624, contributorCount: 63, affiliatePercent: 5, shareLink: 'zap7k', contributedWei: '250000000000000000000', claimed: false, claimableTokensRaw: '0', referralClaimableWei: '0', keys: ['contribute'], starred: true }
    const campaign2: CampaignView = { ...campaign, pool: '0x9999999999999999999999999999999999999998', status: 'PENDING', phase: 'upcoming', token: { name: 'Nimbus', symbol: 'NIM', decimals: 18, address: null }, starts: Math.floor(FIXED_NOW / 1000) + 2 * 86_400, ends: Math.floor(FIXED_NOW / 1000) + 9 * 86_400, raisedWei: '0', fill: 0, contributorCount: 0, contributedWei: '0', keys: [], starred: false, creatorName: null }
    const positions: Positions = { accountId, chainId: 52014, farms: [farm], legends: legendsStatus, orders: [{ chainId: 52014, orderId: '42', tokenIn: BOLT, tokenOut: USDC, symbolIn: 'BOLT', symbolOut: 'USDC', decimalsIn: 18, decimalsOut: 6, amountInExact: '5000000000000000000000', amountOutMin: '1100000000', amountInRemaining: '5000000000000000000000', amountOutFilled: '0', unwrapOutput: false, createdAt: Math.floor(FIXED_NOW / 1000) - 3_600, expiresAt: Math.floor(FIXED_NOW / 1000) + 6 * 86_400, status: 'open' }], campaigns: [campaign], accessories: [{ kind: 'dividends', text: '3.21 ETN in dividends to claim', target: 'legends' }, { kind: 'collect', text: '12.4 DYNO to collect', target: 'farm:1' }], observedAt: FIXED_NOW }
    const watch: WatchItem[] = [
      { kind: 'token', chainId: 52014, address: BOLT, label: 'BOLT', above: 0.25, below: null, onLive: false, addedAt: FIXED_NOW - 86_400_000, lastValue: 0.19 },
      { kind: 'campaign', chainId: 52014, address: POOL, label: 'ZAP', above: null, below: null, onLive: true, addedAt: FIXED_NOW - 3_600_000, lastValue: 1 },
    ]
    const offersInbox: OffersInbox = { received: [{ asset: owned[0] as AssetView, offer }], made: [{ address: '0x8888888888888888888888888888888888888888', tokenId: '404', name: 'Volt #404', imageUrl: null, collectionName: 'Volts', offer: { ...offer, priceEtn: 2.5, priceRaw: '2500000000000000000', orderHash: '0xbid2', maker: address }, expiresAt: Math.floor(FIXED_NOW / 1000) + 2 * 86_400 }], obligationWei: '2500000000000000000', wetnBalanceWei: '4000000000000000000' }
    const Any = z.object({}).passthrough()
    // The first-swap coach has been read (plan B4); the screenshot shows the console, not the overlay.
    await engine.engine.prefs.set({ swapCoachDismissed: true })
    engine.host.override('activityScan', {
      scanAll: { input: Any, handler: async () => ({ accountId, chainIds: [52014, 1, 56, 8453], added: 0, problems: [], observedAt: FIXED_NOW }) },
      cached: { input: Any, handler: async () => ({ value: { accountId, chainIds: [52014, 1, 56, 8453], added: 0, problems: [], observedAt: FIXED_NOW - 120_000 }, observedAt: FIXED_NOW - 120_000 }) },
    })
    // The inbox (plan A6): one offer and one fired alert, so Activity's attention section and the dock badge have something to show.
    await engine.notifications.push({ id: 'offer:fixture', kind: 'offer', title: 'Offer on Electric Legend #77', body: '1,400 ETN from 0x9a2c…41e0', target: 'offers' })
    await engine.notifications.push({ id: 'above:token:fixture', kind: 'alert', title: 'BOLT crossed $0.19', body: 'Your alert at $0.18 fired.', target: `token:${BOLT}` })
    engine.host.override('explore', {
      available: { handler: async () => true },
      tokens: { input: Any, handler: async () => exploreTokens },
      tokenDetail: {
        input: Any,
        handler: async (arg) => {
          const a = (arg as { address: string }).address.toLowerCase()
          if (a === 'native') {
            return { address: 'native', symbol: 'ETN', name: 'Electroneum', decimals: 18, native: true, price: 0.0065, change24h: 2.1, change7d: 5.4, volume24h: 184_200, tvl: 1_240_000, marketCap: 53_000_000, fdv: 53_000_000, safety: 'VERIFIED', spam: false, logoUrl: null, description: "Electroneum's own coin, and the gas of every transaction on the chain.", homepageUrl: 'https://electroneum.com', twitterUrl: null, telegramUrl: null, sparkline: fixturePrices('1D').points }
          }
          if (a !== BOLT.toLowerCase()) return null
          return { address: BOLT, symbol: 'BOLT', name: 'BOLT', decimals: 18, native: false, price: 0.19, change24h: -0.8, change7d: 3.2, volume24h: 42_100, tvl: 380_000, marketCap: 1_900_000, fdv: 2_400_000, safety: 'VERIFIED', spam: false, logoUrl: null, description: 'BOLT is the ElectroSwap utility token. Holding it lowers the wallet fee on every swap, boosts farm rewards through the multiplier stairs, and puts you on the launchpad allowlist. Supply is fixed; a share of every marketplace fee buys BOLT back for the Legends vault.', homepageUrl: 'https://electroswap.io', twitterUrl: 'https://x.com/electroswap', telegramUrl: 'https://t.me/electroswap', sparkline: fixturePrices('1D').points }
        },
      },
      priceHistory: { input: Any, handler: async (arg) => ((arg as { address: string }).address.toLowerCase() === BOLT.toLowerCase() ? fixturePrices((arg as { duration: '1D' | '1W' | '1M' | '1Y' }).duration) : null) },
      liquidity: { input: Any, handler: async (arg) => ((arg as { address: string }).address.toLowerCase() === BOLT.toLowerCase() ? { chainId: 52014, address: BOLT, lockedPct: 87, lockCount: 2 } : null) },
      collections: { input: Any, handler: async () => [legendsCollection, voltsCollection] },
      collection: { input: Any, handler: async (arg) => ((arg as { address: string }).address.toLowerCase() === LEGENDS.toLowerCase() ? legendsCollection : voltsCollection) },
      search: { input: Any, handler: async (arg) => ({ tokens: exploreTokens.filter((x) => x.symbol.toLowerCase().includes(String((arg as { query: string }).query).toLowerCase())), collections: [] }) },
    })
    engine.host.override('nft', {
      inventory: { input: Any, handler: async () => inventory },
      assets: { input: Any, handler: async () => ({ assets: [...owned, piece('77', { owner: OTHER, mine: false, listing: { ...listing, maker: OTHER, priceEtn: 44, priceRaw: '44000000000000000000' }, dividendsWei: '0' }), piece('78', { owner: OTHER, mine: false, dividendsWei: '0' })], total: 500, next: null }) },
      asset: { input: Any, handler: async (arg) => owned.find((a) => a.tokenId === (arg as { tokenId: string }).tokenId) ?? piece(String((arg as { tokenId: string }).tokenId), { owner: OTHER, mine: false, listing: { ...listing, maker: OTHER, priceEtn: 44, priceRaw: '44000000000000000000' }, dividendsWei: '0' }) },
      activity: { input: Any, handler: async () => [{ address: LEGENDS, tokenId: art ? '24' : '13', name: art ? 'Legend #24' : 'Legend #13', imageUrl: artOf(art ? '24' : '13'), type: 'LISTING' as const, from: address, to: null, hash: null, priceEtn: 42, timestamp: Math.floor(FIXED_NOW / 1000) - 7_200 }, { address: LEGENDS, tokenId: art ? '6' : '9', name: art ? 'Legend #6' : 'Legend #9', imageUrl: artOf(art ? '6' : '9'), type: 'SALE' as const, from: OTHER, to: address, hash: `0x${'d4'.repeat(32)}`, priceEtn: 38, timestamp: Math.floor(FIXED_NOW / 1000) - 86_400 }] },
      offers: { input: Any, handler: async () => offersInbox },
      collectionApproved: { input: Any, handler: async () => true },
      customCollections: { input: Any, handler: async () => [] },
      previewCollection: { input: Any, handler: async (arg) => ({ chainId: 52014, address: (arg as { address: string }).address, name: 'Volt Punks', symbol: 'VPUNK', standard: 'ERC721' as const, enumerable: true }) },
      addCollection: { input: Any, handler: async (arg) => ({ chainId: 52014, address: (arg as { address: string }).address, name: 'Volt Punks', symbol: 'VPUNK', standard: 'ERC721' as const, enumerable: true, addedAt: FIXED_NOW }) },
      removeCollection: { input: Any, handler: async () => undefined },
    })
    engine.host.override('legends', { status: { input: Any, handler: async () => legendsStatus } })
    engine.host.override('farm', {
      list: { input: Any, handler: async () => [farm, farm2] },
      farm: { input: Any, handler: async (arg) => ((arg as { farmId: number }).farmId === 1 ? farm2 : farm) },
      quoteDeposit: { input: Any, handler: async () => ({ farmId: 0, amount0Raw: '10000000000000000000', amount1Raw: '29600', boltRaw: '0', nativeSide: 0, liquidityAdded: '1000000000000000', multiplierBefore: 17_500, multiplierAfter: 17_320, boltStair: null, steps: ['approve', 'deposit'], ok: true, problems: [] }) },
      quoteWithdraw: { input: Any, handler: async (arg) => { const pct = (arg as { percent: number }).percent; return { farmId: 0, liquidityRaw: '50000000000000000000', percent: pct, amount0Raw: String(BigInt(410_000n * 10n ** 18n) * BigInt(Math.round(pct)) / 100n), amount1Raw: String(1_213_000_000n * BigInt(Math.round(pct)) / 100n), rewardsRaw: '12400000000000000000', thirdPartyRaw: '0', fees0Raw: '0', fees1Raw: '0', boltReturnedRaw: pct >= 100 ? '50000000000000000000000' : '0', keepsMultiplier: pct < 100, ok: true, problems: [] } } },
    })
    engine.host.override('launchpad', {
      list: { input: Any, handler: async () => [campaign, campaign2] },
      detail: { input: Any, handler: async (arg) => ((arg as { pool: string }).pool.toLowerCase() === POOL ? campaign : campaign2) },
    })
    engine.host.override('positions', {
      cached: { input: Any, handler: async () => positions },
      snapshot: { input: Any, handler: async () => positions },
    })
    engine.host.override('watchlist', {
      list: { handler: async () => watch },
      star: { input: Any, handler: async () => watch },
      unstar: { input: Any, handler: async () => watch },
      setAlert: { input: Any, handler: async () => watch },
      check: { handler: async () => [] },
    })
    engine.host.override('holder', {
      tier: { input: AccountArg, handler: async () => tierView },
      schedule: { input: z.object({}).passthrough(), handler: async () => schedule },
      addresses: { input: z.object({}).passthrough(), handler: async () => ({ sink: SINK, schedule: schedule.address }) },
    })
    // M7: verified Hyperlane corridors, a quote, and one USDC transfer mid-flight.
    const USDC_ETN = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e'
    const USDT_ETN = '0x48E722f1458b253c2FB0E573F939318D7Dbd54e7'
    const USDC_ETH = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    /*
      Corridors in BOTH directions.

      They only ever ran outward from Electroneum here, which was fine while the
      screen opened there — and the moment the default corridor became Ethereum
      USDC → Electroneum (the direction people actually arrive in), the fixture
      answered "no Hyperlane corridor starts on this chain" and the harness
      screenshotted an error state as the bridge's resting face.
    */
    const routes: BridgeRoute[] = [
      { symbol: 'USDC', fromChainId: 1, toChainId: 52014, token: USDC_ETH, router: USDC_ETH, standard: 'collateral', decimals: 6, verified: true, reason: null },
      { symbol: 'USDC', fromChainId: 52014, toChainId: 1, token: USDC_ETN, router: USDC_ETN, standard: 'synthetic', decimals: 6, verified: true, reason: null },
      { symbol: 'USDC', fromChainId: 52014, toChainId: 8453, token: USDC_ETN, router: USDC_ETN, standard: 'synthetic', decimals: 6, verified: true, reason: null },
      { symbol: 'USDC', fromChainId: 52014, toChainId: 43114, token: USDC_ETN, router: USDC_ETN, standard: 'synthetic', decimals: 6, verified: true, reason: null },
      { symbol: 'USDT', fromChainId: 52014, toChainId: 1, token: USDT_ETN, router: USDT_ETN, standard: 'synthetic', decimals: 6, verified: true, reason: null },
    ]
    const transfers: BridgeStatus[] = [
      { id: `0x${'d1'.repeat(32)}`, accountId, fromChainId: 52014, toChainId: 8453, symbol: 'USDC', amountRaw: '250000000', decimals: 6, recipient: address, originHash: `0x${'d1'.repeat(32)}`, messageId: `0x${'ee'.repeat(32)}`, destinationHash: null, state: 'dispatched', startedAt: FIXED_NOW - 90_000, updatedAt: FIXED_NOW - 15_000, scanFrom: 21_000_000 },
      { id: `0x${'d2'.repeat(32)}`, accountId, fromChainId: 1, toChainId: 52014, symbol: 'USDC', amountRaw: '1000000000', decimals: 6, recipient: address, originHash: `0x${'d2'.repeat(32)}`, messageId: `0x${'ef'.repeat(32)}`, destinationHash: `0x${'d3'.repeat(32)}`, state: 'delivered', startedAt: FIXED_NOW - 86_400_000, updatedAt: FIXED_NOW - 86_000_000, scanFrom: null },
    ]
    engine.host.override('bridge', {
      routes: { input: Any, handler: async (arg) => routes.filter((r) => r.fromChainId === (arg as { fromChainId: number }).fromChainId && (!(arg as { token?: string }).token || r.token.toLowerCase() === ((arg as { token?: string }).token ?? '').toLowerCase())) },
      quote: {
        input: Any,
        handler: async (arg) => {
          const a = arg as { toChainId: number; token: string; amount: string; recipient?: string }
          const r = routes.find((x) => x.toChainId === a.toChainId && x.token.toLowerCase() === a.token.toLowerCase()) ?? routes[0]
          const amountRaw = BigInt(Math.round(Number(a.amount || '0') * 1e6))
          const problems = amountRaw <= 0n ? ['Enter an amount above zero.'] : amountRaw > 1_248_000_000n ? ['Not enough USDC.'] : []
          return { fromChainId: 52014, toChainId: r?.toChainId ?? 8453, symbol: r?.symbol ?? 'USDC', token: a.token, decimals: 6, amountRaw: amountRaw.toString(), balanceRaw: '1248000000', recipient: a.recipient ?? address, gasQuoteWei: '1250000000000000000', txFeeWei: '220000000000000', feeSymbol: 'ETN', etaMinutes: r?.toChainId === 1 ? 20 : 5, steps: ['submit'], recipientCode: { origin: false, destination: false }, ok: problems.length === 0, problems }
        },
      },
      list: { input: Any, handler: async () => transfers },
      status: { input: Any, handler: async (arg) => transfers.find((x) => x.id === (arg as { id: string }).id) ?? null },
    })
  }
  if (scenario === 'keystone') {
    // M8: a signing request waiting on the Keystone — the prompt sheet over Home (frames are placeholders; a real request is the same shape).
    const address = (await engine.engine.accounts.list())[0]?.address ?? '0x0000000000000000000000000000000000000000'
    const frames = ['UR:ETH-SIGN-REQUEST/1-2/LPADAOCFADHDCYWEHGLGHDCSOEADTPDAGDWEDRGSBBFTMOAOCXAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAE', 'UR:ETH-SIGN-REQUEST/2-2/LPAOAOCFADHDCYWEHGLGHDCSOEADTPDAGDWEDRGSBBFTMOAOCXAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAEAE']
    engine.host.override('hardware', { keystonePending: { handler: async () => [{ id: 'fx-keystone', frames, kind: 'transaction', address, path: "m/44'/60'/0'/0/0", createdAt: FIXED_NOW - 5_000 }] } })
  }
  return engine
}

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = ['fresh', 'locked', 'unlocked', 'funded', 'connect', 'sign', 'keystone']

/** A deterministic BOLT price series for the chart baselines: a gentle climb with two dips, ending at $0.19. */
function fixturePrices(duration: '1D' | '1W' | '1M' | '1Y'): { chainId: number; address: string; duration: '1D' | '1W' | '1M' | '1Y'; points: Array<{ t: number; v: number }>; high: number | null; low: number | null } {
  const span = duration === '1D' ? 86_400 : duration === '1W' ? 7 * 86_400 : duration === '1M' ? 30 * 86_400 : 365 * 86_400
  const n = 48
  const end = Math.floor(FIXED_NOW / 1000)
  const points: Array<{ t: number; v: number }> = []
  for (let i = 0; i < n; i += 1) {
    const x = i / (n - 1)
    const v = 0.19 * (0.86 + 0.14 * x + 0.05 * Math.sin(x * 9.5) - 0.03 * Math.cos(x * 23))
    points.push({ t: end - Math.round((1 - x) * span), v: Math.round(v * 1e5) / 1e5 })
  }
  const last = points[points.length - 1]
  if (last) last.v = 0.19
  const vs = points.map((p) => p.v)
  return { chainId: 52014, address: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1', duration, points, high: Math.max(...vs), low: Math.min(...vs) }
}
