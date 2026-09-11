/**
 * The account activity feed client (§8.12, §9.2). The two properties that
 * matter are direction, which the API decides per viewer, and amounts, which
 * arrive in whole units and must reach the wallet in raw units without ever
 * passing through a float.
 */
import { describe, expect, it } from 'vitest'
import { ElectroSwapClient, fetchWalletActivity, toRawUnits } from '../src'

const ALICE = '0x1111111111111111111111111111111111111111'
const BOB = '0x2222222222222222222222222222222222222222'
const TOKEN = '0x3333333333333333333333333333333333333333'
const HASH = '0xabc'
const ETN = 52014

function clientWith(answer: (variables: Record<string, unknown>) => unknown): ElectroSwapClient {
  const fetchImpl: typeof fetch = async (_input, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as { variables: Record<string, unknown> }
    return new Response(JSON.stringify({ data: answer(body.variables) }), { status: 200, headers: { 'content-type': 'application/json' } })
  }
  return new ElectroSwapClient({ fetchImpl })
}

const transfer = (direction: string, over: Record<string, unknown> = {}) => ({
  id: 'row-1',
  timestamp: 1_757_000_000,
  type: direction === 'IN' ? 'RECEIVE' : 'SEND',
  chain: 'ELECTRONEUM',
  transaction: { blockNumber: 15_100_000, hash: HASH, from: BOB, to: ALICE, status: 'CONFIRMED' },
  details: {
    __typename: 'TransactionDetails',
    type: direction === 'IN' ? 'RECEIVE' : 'SEND',
    hash: HASH,
    transactionStatus: 'CONFIRMED',
    assetChanges: [{ __typename: 'TokenTransfer', tokenStandard: 'ERC20', sender: BOB, recipient: ALICE, quantity: '1.5', direction, asset: { address: TOKEN, symbol: 'BOLT', decimals: 18, standard: 'ERC20' }, ...over }],
  },
})

const feed = (rows: unknown[]) => () => ({ portfolios: [{ assetActivities: rows }] })

describe('the wallet activity feed', () => {
  it('reads the direction the API gave, rather than guessing from from/to', async () => {
    for (const direction of ['IN', 'OUT'] as const) {
      const rows = await fetchWalletActivity(clientWith(feed([transfer(direction)])), { chainId: ETN, owner: ALICE })
      expect(rows[0]?.changes[0]?.direction).toBe(direction)
    }
  })

  it('asks for the owner whose feed it is, because the same row reads differently per party', async () => {
    let seen: Record<string, unknown> = {}
    await fetchWalletActivity(
      clientWith((vars) => {
        seen = vars
        return { portfolios: [{ assetActivities: [] }] }
      }),
      { chainId: ETN, owner: ALICE, page: 2, pageSize: 10 },
    )
    expect(seen['owner']).toBe(ALICE)
    expect(seen['page']).toBe(2)
    expect(seen['pageSize']).toBe(10)
  })

  it('converts whole units to raw without touching a float', async () => {
    const rows = await fetchWalletActivity(clientWith(feed([transfer('IN')])), { chainId: ETN, owner: ALICE })
    expect(rows[0]?.changes[0]?.amountRaw).toBe('1500000000000000000')
  })

  it('carries the chain’s timestamp and block, not this device’s clock', async () => {
    const rows = await fetchWalletActivity(clientWith(feed([transfer('IN')])), { chainId: ETN, owner: ALICE })
    expect(rows[0]?.timestamp).toBe(1_757_000_000)
    expect(rows[0]?.blockNumber).toBe(15_100_000)
    expect(rows[0]?.hash).toBe(HASH)
    expect(rows[0]?.status).toBe('CONFIRMED')
  })

  it('keeps an NFT transfer’s token id and collection address', async () => {
    const nft = {
      id: 'row-nft',
      timestamp: 1,
      type: 'NFT',
      transaction: { blockNumber: 1, hash: HASH, from: BOB, to: ALICE, status: 'CONFIRMED' },
      details: { type: 'RECEIVE', hash: HASH, transactionStatus: 'CONFIRMED', assetChanges: [{ __typename: 'NftTransfer', nftStandard: 'ERC721', sender: BOB, recipient: ALICE, direction: 'IN', asset: { tokenId: '7', name: 'Volt #7', collection: { nftContracts: [{ address: TOKEN }] } } }] },
    }
    const rows = await fetchWalletActivity(clientWith(feed([nft])), { chainId: ETN, owner: ALICE })
    expect(rows[0]?.changes[0]).toMatchObject({ standard: 'ERC721', tokenId: '7', address: TOKEN })
  })

  /*
    Activity is enrichment. A feed that cannot be parsed must leave the local
    log alone, not take the screen down with it.
  */
  it('survives a body that is nothing like the schema', async () => {
    for (const body of [{}, { portfolios: null }, { portfolios: [null] }, { portfolios: [{ assetActivities: [null, { id: null }] }] }, { portfolios: 'no' }]) {
      await expect(fetchWalletActivity(clientWith(() => body), { chainId: ETN, owner: ALICE })).resolves.toEqual([])
    }
  })

  it('drops a row with no transaction hash, because there is nothing to merge it against', async () => {
    const noHash = { id: 'x', timestamp: 1, type: 'SEND', transaction: { blockNumber: 1, hash: null, from: BOB, to: ALICE, status: 'CONFIRMED' }, details: { type: 'SEND', hash: null, transactionStatus: 'CONFIRMED', assetChanges: [] } }
    await expect(fetchWalletActivity(clientWith(feed([noHash])), { chainId: ETN, owner: ALICE })).resolves.toEqual([])
  })
})

describe('whole units to raw units', () => {
  it('handles the cases a float would get wrong', () => {
    expect(toRawUnits('0.1', 18)).toBe('100000000000000000')
    expect(toRawUnits('1', 18)).toBe('1000000000000000000')
    expect(toRawUnits('123456789.123456789', 18)).toBe('123456789123456789000000000')
    expect(toRawUnits('0', 18)).toBe('0')
    expect(toRawUnits('0.000001', 6)).toBe('1')
    expect(toRawUnits('12.5', 0)).toBe('12')
  })

  it('truncates rather than rounds, because the API’s precision is not ours to extend', () => {
    expect(toRawUnits('0.1234567', 6)).toBe('123456')
    expect(toRawUnits('0.9999999', 6)).toBe('999999')
  })

  it('refuses anything that is not a plain decimal', () => {
    for (const bad of ['', '.', '-', 'abc', '1e18', '0x10', '1.2.3', ' 1 2 ']) expect(toRawUnits(bad, 18)).toBeNull()
    expect(toRawUnits('1', -1)).toBeNull()
    expect(toRawUnits('1', 1.5)).toBeNull()
  })
})
