/**
 * The one-shot move of pre-2026-09 plaintext documents into sealed blobs.
 *
 * Sealing only protects new writes; an already-installed wallet keeps the
 * plaintext the audit read until this runs. The two things worth proving are
 * that the data survives, and that the plaintext does not.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { createSealedStores } from '../src/blobs'
import { migrateSealed } from '../src/migrateSealed'

const DEK = async (): Promise<Uint8Array> => new Uint8Array(32).fill(3)
const env = (data: unknown): string => JSON.stringify({ v: 1, data })
const ACCT = 'acct_4ea7f813c364ab11'
const ADDR = '0xD6Cf49CbCF84B2cd2472a376B5f791689A0769d0'

function boot() {
  const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
  const sealed = createSealedStores(platform, DEK)
  return { platform, sealed }
}

describe('migrateSealed', () => {
  it('moves the audited plaintext keys into sealed blobs and deletes the originals', async () => {
    const { platform, sealed } = boot()
    const local = platform.storage.local
    // Exactly the shapes the audit dump showed.
    await local.set(`portfolio.${ACCT}`, env({ accountId: ACCT, total: 20645.80997362545, rows: [], chainIds: [52014], currency: 'USD', change24h: null, unpricedCount: 0, observedAt: 1, stale: false }))
    await local.set(`portfolio.look.${ACCT}`, env({ at: 5, total: 20000 }))
    await local.set('accounts.active', env({ id: ACCT }))
    await local.set('sites', env({ 'https://app.electroswap.io': { origin: 'https://app.electroswap.io', chainId: 52014, accountId: ACCT, connected: true, lastAccounts: [ADDR] } }))
    await local.set(`allowances.${ACCT}.52014`, env({ rows: [], at: 7 }))
    await local.set(`positions.52014.${ACCT}`, JSON.stringify({ accountId: ACCT, chainId: 52014, farms: [], legends: null, orders: [], campaigns: [], accessory: null, observedAt: 3 }))
    await local.set(`activity.scan.${ACCT}.52014`, env({ block: 15_000_000 }))
    await local.set('bridge.transfers', env({ items: [] }))
    await local.set('notifications', env([]))

    const report = await migrateSealed(platform, sealed)
    expect(report.moved).toBeGreaterThanOrEqual(9)

    // The data survived, in ciphertext.
    expect((await sealed.portfolio.get(ACCT))?.total).toBeCloseTo(20645.81, 2)
    expect((await sealed.looks.get(ACCT))?.total).toBe(20000)
    expect((await sealed.active.get('active'))?.id).toBe(ACCT)
    expect((await sealed.sites.get('https://app.electroswap.io'))?.lastAccounts).toEqual([ADDR])
    expect((await sealed.allowances.get(`${ACCT}.52014`))?.at).toBe(7)
    expect((await sealed.positions.get(`52014.${ACCT}`))?.observedAt).toBe(3)
    expect((await sealed.scan.get(`${ACCT}.52014`))?.block).toBe(15_000_000)

    // The plaintext did not.
    const left = await local.keys()
    expect(left.filter((k) => !k.endsWith('.blob'))).toEqual([])
    const dump = JSON.stringify(await Promise.all(left.map((k) => local.get(k))))
    expect(dump).not.toContain(ACCT)
    expect(dump).not.toContain(ADDR)
    expect(dump).not.toContain('20645')
  })

  it('sweeps quarantine copies, which are verbatim plaintext of whatever failed to parse', async () => {
    const { platform, sealed } = boot()
    await platform.storage.local.set('portfolio.acct_x.quarantine.42', `{"total":20645.81,"address":"${ADDR}"}`)
    await migrateSealed(platform, sealed)
    expect(await platform.storage.local.keys()).toEqual([])
  })

  it('drops the old per-key cache documents rather than re-encrypting them', async () => {
    const { platform, sealed } = boot()
    await platform.storage.local.set('cache.explore.history.52014.0xabc.1d', env({ value: [1, 2, 3], observedAt: 1 }))
    await migrateSealed(platform, sealed)
    // Caches refetch; keeping a stale shape inside a sealed shard buys nothing.
    expect(await platform.storage.local.keys()).toEqual([])
  })

  it('never routes a legacy document through readDoc, which would re-create plaintext', async () => {
    const { platform, sealed } = boot()
    // Unparseable: readDoc would copy this verbatim to `<key>.quarantine.<ts>`.
    await platform.storage.local.set(`portfolio.${ACCT}`, '{not json')
    await migrateSealed(platform, sealed)
    const left = await platform.storage.local.keys()
    expect(left.filter((k) => k.includes('quarantine'))).toEqual([])
    expect(left.filter((k) => !k.endsWith('.blob'))).toEqual([])
  })

  it('is idempotent — a second run finds nothing and changes nothing', async () => {
    const { platform, sealed } = boot()
    await platform.storage.local.set('accounts.active', env({ id: ACCT }))
    await migrateSealed(platform, sealed)
    const after = await migrateSealed(platform, sealed)
    expect(after.moved).toBe(0)
    expect(after.removed).toEqual([])
    expect((await sealed.active.get('active'))?.id).toBe(ACCT)
  })
})
