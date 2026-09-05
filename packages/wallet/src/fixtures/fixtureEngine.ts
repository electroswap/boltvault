/**
 * Fixture engines for the screenshot harness and tests: a real engine over
 * the memory platform, with a deterministic head source and (for the
 * `funded` scenario) a portfolio namespace answering from fixture rows. No
 * network, no service worker, byte-identical output run to run.
 */
import { createEngine, type ActivityEntry, type AllowanceView, type Engine, type HeadSource, type PortfolioSnapshot, type TokenView } from '@boltvault/engine'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { z } from 'zod'

export type FixtureScenario = 'fresh' | 'locked' | 'unlocked' | 'funded' | 'connect' | 'sign'

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

export async function createFixtureEngine(scenario: FixtureScenario): Promise<Engine> {
  const platform = createMemoryPlatform({ now: FIXED_NOW })
  const engine = createEngine({ platform, heads })
  await engine.ready
  if (scenario !== 'fresh') {
    const { seedId, accounts } = await engine.engine.vault.import({ mnemonic: MNEMONIC, password: PASSWORD })
    const account = accounts[0]
    if (scenario === 'funded' || scenario === 'connect' || scenario === 'sign') {
      // A mature account: the backup quiz has been passed, so no gate plate on Home.
      const words = MNEMONIC.split(' ')
      const quiz = await engine.engine.vault.backupQuiz({ seedId })
      await engine.engine.vault.confirmBackup({ seedId, answers: quiz.positions.map((position) => ({ position, word: words[position - 1] ?? '' })) })
    }
    if (scenario === 'funded' && account) {
      await engine.sites.registry.connect(SITE, { accountId: account.id, chainId: 52014, accounts: [account.address], now: FIXED_NOW - 86_400_000 })
      engine.sites.emit()
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
            presentation: { delayMs: 1500, typedConfirmation: 'app.electroswap.io', blocked: false },
            simulationMode: 'estimate',
          },
          clientRequestId: 'fixture-sign',
        },
      })
    }
    if (scenario === 'locked') await engine.engine.vault.lock()
  }
  if (scenario === 'funded') {
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
      { chainId: 52014, token: '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1', tokenSymbol: 'BOLT', spender: '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617', spenderName: 'Permit2', known: true, standard: 'erc20', amount: 'unlimited', expiration: null },
      { chainId: 52014, token: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', tokenSymbol: 'USDC', spender: '0x2c12c8F15637b7A182DEc202816148A5E767DCEC', spenderName: 'ElectroSwap Universal Router', known: true, standard: 'permit2', amount: '1248000000', expiration: Math.floor(FIXED_NOW / 1000) + 1_800 },
      { chainId: 52014, token: '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e', tokenSymbol: 'USDC', spender: '0x9999999999999999999999999999999999999999', spenderName: null, known: false, standard: 'erc20', amount: 'unlimited', expiration: null },
    ]
    const AccountArg = z.object({ accountId: z.string() }).passthrough()
    engine.host.override('portfolio', {
      snapshot: { input: AccountArg, handler: async () => snap },
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
  }
  return engine
}

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = ['fresh', 'locked', 'unlocked', 'funded', 'connect', 'sign']
