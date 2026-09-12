/**
 * At-rest secrecy (master plan §3.2, at-rest audit 2026-09-06).
 *
 * A live audit copied `chrome.storage.local` out of a real profile and read it
 * with the vault LOCKED: USD totals, per-token quantities, the connected
 * address, the dApps it was connected to, cached prices and per-NFT balance
 * counts were all plaintext JSON. §3.2 promises the opposite — "a stolen
 * `chrome.storage.local` reveals nothing but ciphertext and the vault id".
 *
 * The audit's key list was only what that user's usage happened to create, so
 * asserting against it would miss the next feature that adds a plaintext key.
 * This test instead runs a session, locks, and sweeps EVERY key: nothing may
 * carry an identifier or a figure, and the plaintext key set must stay within
 * an explicit allowlist. A new plaintext key fails here by default.
 */
import { describe, expect, it } from 'vitest'
import { createMemoryPlatform } from '@boltvault/platform/memory'
import type { ProviderPortMessage } from '@boltvault/protocol'
import { z } from 'zod'
import { createChannelPair, type Engine } from '../src'
import { createEngine } from '../src/create'

const heads = { blockNumber: async (chainId: number) => BigInt(chainId === 52014 ? 15_100_000 : 20_000_000) }
const FAST = { m: 1024, t: 1, p: 1 }
const PHRASE = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
const ADDRESS = '0x9858EfFD232B4033E47d90003D41EC34EcaEda94'
const ORIGIN = 'https://app.electroswap.io'

/** Drive a real `eth_requestAccounts` through to an approved session. */
async function connectDapp(eng: Engine, origin: string, accountId: string): Promise<void> {
  const [a, b] = createChannelPair()
  eng.provider.serve(b, origin)
  // Await the dApp's *response*, not just the approval decision: rpcFlow calls
  // sites.connect() after deciding, so returning early raced the write that
  // persists the session — and every assertion downstream would then pass
  // because nothing had been stored at all.
  const answered = new Promise<void>((resolve, reject) => {
    a.onMessage((raw) => {
      const m = raw as ProviderPortMessage
      if (m.kind !== 'response' || m.id !== 1) return
      if (m.error) reject(m.error)
      else resolve()
    })
  })
  a.post({ kind: 'request', id: 1, method: 'eth_requestAccounts', params: undefined, session: 'sess' })
  const req = await new Promise<{ id: string }>((resolve) => {
    const seen = eng.approvals.list()[0]
    if (seen) return resolve(seen)
    const off = eng.host.events.subscribe((e) => {
      if (e.type === 'approvals.changed' && e.pending[0]) {
        off()
        resolve(e.pending[0])
      }
    })
  })
  await eng.engine.approvals.decide({ id: req.id, approve: true, data: { accountId, chainId: 52014 } })
  await answered
}

/**
 * The only documents allowed to stay readable with the vault locked, each for a
 * reason that cannot be designed away:
 *
 * - `settings`   — the content script reads it at `document_start` to decide
 *                  `defaultWallet`/`metaMaskCompat`, long before any unlock.
 * - `vault.kdf`  — needed to derive the KEK *in order to* unlock.
 * - `vault.file` — the sealed vault itself (in the `secret` area).
 * - `statics.*`  — ed25519-signed public lists, read on the boot path.
 * - `chains.rpc` — endpoint config, global.
 * - `tokens.list.<chainId>` — public token metadata, global.
 * - `ui.prefs`   — last tab, chart range and similar. No account, address or
 *                  amount appears in it.
 * - `sites.chains` — origin→chain, read on every RPC while locked. The dApp
 *                    origins stay readable (a documented residual: they are a
 *                    small, well-known space, so hashing them buys little);
 *                    the accountId and the addresses live in `sites.blob`.
 */
/** The label a registration in flight is for, so the dump can be searched for it. */
const REGISTERING = 'attestiumcheck'

const ALLOWED_PLAINTEXT = [
  /^settings$/,
  /^vault\.kdf$/,
  /^statics\.(flags|scam)$/,
  /^chains\.rpc$/,
  /^tokens\.list\.\d+$/,
  /^sites\.chains$/,
  /^ui\.prefs$/,
  /*
    A pending name registration keeps a countdown the locked screen can still
    show: the chain, the commitment hash and when it was made (ES-BV-013).
    Everything that names anybody — the account, the owner address, the name —
    is in `name-commitments.blob`.
  */
  /^names\.commitments2$/,
  /^vault\.throttle$/,
]

/** Everything else on disk must be one of these sealed blobs. */
const SEALED_BLOB = /\.blob$/

function isAllowed(key: string): boolean {
  return SEALED_BLOB.test(key) || ALLOWED_PLAINTEXT.some((re) => re.test(key))
}

/** Run a realistic session so every family actually gets written. */
async function useTheWallet(): Promise<{ dump: Record<string, string>; accountId: string }> {
  const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
  const eng = createEngine({ platform, heads, kdf: FAST, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
  await eng.ready
  await eng.engine.vault.import({ mnemonic: PHRASE, password: 'correct horse battery staple' })
  const account = await eng.engine.accounts.active()
  const accountId = account?.id ?? ''

  // Portfolio (F1): the USD total and per-token quantities.
  await eng.portfolio.refresh(accountId).catch(() => undefined)
  // Caches (F2): prices, history, inventories, positions.
  await eng.cache.write({ key: 'explore.tokens.52014', schema: z.array(z.string()) }, ['BOLT', 'DYNO'])
  await eng.cache.write({ key: `nft.inventory.52014.${accountId}`, schema: z.array(z.string()) }, ['collection-a'])
  // The families the audit never saw, because that profile had not used them.
  // Not swallowed: a silent failure here would make the leak assertions below
  // pass because nothing was ever written.
  await eng.engine.tokens.setPrefs({ chainId: 52014, address: '0xfeedfacefeedfacefeedfacefeedfacefeedface', pinned: true })
  await eng.engine.launchpad.rememberFromLink({ url: 'boltvault://launchpad/0x2222222222222222222222222222222222222222?ref=0x1111111111111111111111111111111111111111' })
  await eng.watchlist.star({ kind: 'token', chainId: 52014, address: '0xfeedfacefeedfacefeedfacefeedfacefeedface', label: 'WATCHED' })
  /*
    A registration in flight (ES-BV-013). The audit's profile had never started
    one, so the commitment family — which held the account id, the owner
    address and the name in the clear for three days — was never looked at.
  */
  // Bounded: the registrar reads live contracts, and this harness has no
  // registrar to answer — what matters here is the document it writes.
  await Promise.race([
    eng.engine.names
      .commit({ accountId, chainId: 52014, name: `${REGISTERING}.etn`, durationSeconds: 31_536_000 })
      .catch(() => undefined),
    new Promise((r) => setTimeout(r, 500)),
  ])

  // Connected sites (F3): actually connect, so the address really is handed to
  // a dApp and really is persisted. `setChain` alone throws `not_found` on an
  // unconnected origin, which would make this test pass without exercising it.
  await connectDapp(eng, ORIGIN, accountId)

  await eng.engine.vault.lock()

  const dump: Record<string, string> = {}
  for (const k of await platform.storage.local.keys()) dump[k] = (await platform.storage.local.get(k)) ?? ''
  for (const k of await platform.storage.secret.keys()) dump[`secret:${k}`] = (await platform.storage.secret.get(k)) ?? ''
  return { dump, accountId }
}

describe('at rest, with the vault locked', () => {
  it('leaks no account id, address, phrase or figure into any stored value', async () => {
    const { dump, accountId } = await useTheWallet()
    const all = JSON.stringify(dump)

    expect(all).not.toContain(ADDRESS)
    expect(all).not.toContain(ADDRESS.toLowerCase())
    expect(all).not.toContain('abandon')
    if (accountId) expect(all).not.toContain(accountId)
    // A value the user's own activity produced. (The public token catalogue in
    // `tokens.list.*` legitimately names BOLT and friends whether or not this
    // user ever looked at them, so a symbol is not on its own a leak.)
    expect(all).not.toContain('collection-a')
    // Families the audit's dump never contained, so its key list never named them.
    expect(all).not.toContain('0xfeedface')
    expect(all).not.toContain('WATCHED')
    expect(all).not.toContain('0x1111111111111111111111111111111111111111')
  })

  it('actually exercised each family — the blobs exist, so the assertions are not vacuous', async () => {
    const { dump } = await useTheWallet()
    // Without this, a swallowed error upstream would make the leak assertions
    // pass because the code path never ran (as `setChain` once did).
    for (const blob of ['portfolio.blob', 'sites.blob', 'watchlist.blob', 'tokens.prefs.blob', 'launchpad.ref.blob', 'cache.explore.tokens.blob', 'cache.nft.inventory.blob']) {
      expect(Object.keys(dump)).toContain(blob)
    }
  })

  /*
    ES-BV-013: what a pending registration is allowed to say while the vault is
    locked. The hash is not an identifier of anybody — it is a commitment to a
    name and an owner that only the holder of the secret can reconstruct.
  */
  it('keeps the name, the owner and the account out of the public commitment half', async () => {
    const { dump, accountId } = await useTheWallet()
    const half = dump['names.commitments2'] ?? ''
    expect(half).not.toContain(REGISTERING)
    expect(half).not.toContain(ADDRESS)
    expect(half).not.toContain(accountId)
  })

  it('keeps the connected address and account out of the public sites half', async () => {
    const { dump, accountId } = await useTheWallet()
    const publicSites = dump['sites.chains'] ?? ''
    expect(publicSites).toContain('52014')
    // The origin is the documented residual; the identity is not.
    expect(publicSites).not.toContain(ADDRESS)
    expect(publicSites).not.toContain(accountId)
    expect(publicSites).not.toContain('lastAccounts')
    expect(dump['sites']).toBeUndefined()
  })

  it('stores nothing outside the sealed blobs and the documented allowlist', async () => {
    const { dump } = await useTheWallet()
    const offenders = Object.keys(dump)
      .filter((k) => !k.startsWith('secret:'))
      .filter((k) => !isAllowed(k))
    // A new plaintext key must be justified in ALLOWED_PLAINTEXT or sealed.
    expect(offenders).toEqual([])
  })

  it('comes back after unlocking — sealing must not lose data across a lock', async () => {
    const platform = createMemoryPlatform({ now: 1_700_000_000_000 })
    const eng = createEngine({ platform, heads, kdf: FAST, electroswapUrl: null, pricesUrl: null, staticsUrl: null })
    await eng.ready
    await eng.engine.vault.import({ mnemonic: PHRASE, password: 'correct horse battery staple 42' })
    const accountId = (await eng.engine.accounts.active())?.id ?? ''
    await eng.watchlist.star({ kind: 'token', chainId: 52014, address: '0xfeedfacefeedfacefeedfacefeedfacefeedface', label: 'WATCHED' })
    await eng.engine.tokens.setPrefs({ chainId: 52014, address: '0xfeedfacefeedfacefeedfacefeedfacefeedface', pinned: true })

    await eng.engine.vault.lock()
    // Locked: empty, never a throw.
    expect(await eng.watchlist.list()).toEqual([])
    expect(await eng.engine.accounts.active()).toBeNull()

    await eng.engine.vault.unlock({ password: 'correct horse battery staple 42' })
    // A service that hydrated while locked cached an empty result; if it is not
    // dropped on unlock it serves "nothing watched" for the rest of the session.
    expect((await eng.watchlist.list()).map((i) => i.label)).toEqual(['WATCHED'])
    expect((await eng.tokens.prefs()).pinned).toHaveLength(1)
    expect((await eng.engine.accounts.active())?.id).toBe(accountId)
  })

  it('never leaves a quarantine copy, which would re-create plaintext', async () => {
    const { dump } = await useTheWallet()
    expect(Object.keys(dump).filter((k) => k.includes('.quarantine.'))).toEqual([])
  })
})
