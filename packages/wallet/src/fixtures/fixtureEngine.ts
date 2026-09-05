/**
 * Fixture engines for the screenshot harness and tests: a real engine over
 * the memory platform, with a deterministic head source and (for the
 * `funded` scenario) a portfolio namespace answering from fixture rows. No
 * network, no service worker, byte-identical output run to run.
 */
import { createEngine, type Engine, type HeadSource, type PortfolioSnapshot } from '@boltvault/engine'
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
    engine.host.register('portfolio', {
      snapshot: {
        input: z.object({ accountId: z.string(), chainIds: z.array(z.number()).optional() }),
        handler: async (arg) => fixtureSnapshot((arg as { accountId: string }).accountId),
      },
      refresh: {
        input: z.object({ accountId: z.string() }),
        handler: async (arg) => fixtureSnapshot((arg as { accountId: string }).accountId),
      },
    })
  }
  return engine
}

export const FIXTURE_SCENARIOS: readonly FixtureScenario[] = ['fresh', 'locked', 'unlocked', 'funded', 'connect', 'sign']
