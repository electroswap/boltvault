/**
 * Names (master plan §8.1 identity, §3.6): `.etn` on Electroneum through its
 * UniversalResolver, `.eth` on Ethereum. Display names are forward-verified
 * (viem checks the reverse record resolves back to the address); input names
 * are resolved live on chain at send time. Never shown for contracts — that
 * decision belongs to the caller, which knows what it is labelling.
 *
 * Registration (§2.4 `names: { … register(); setPrimary(); }`, §8.1 "Claim a
 * name") is the ENS commit–reveal: `makeCommitment` → `commit` → wait out the
 * minimum commitment age → `register`, payable. Nothing here signs anything.
 * Both spending steps are built as transactions and handed to the ordinary
 * approval path (`internal:names`), so a registration meets the same firewall,
 * the same statements and the same sheet as a dApp's transaction would.
 */
import type { Platform } from '@boltvault/platform'
import { mainnet } from 'viem/chains'
import { normalize } from 'viem/ens'
import { bytesToHex, encodeFunctionData, isAddress, namehash, parseAbi, type Abi, type Hex } from 'viem'
import { z } from 'zod'
import { untrusted } from '@boltvault/security'
import { cacheKey, type CacheSpec, type DocCache } from '../cache'
import type { NameCommitmentSecret } from '../blobs'
import type { SealedMap } from '../sealed'
import { EngineError } from '../errors'
import type { NamespaceSpec } from '../host'
import { AccountIdSchema, type NameLookup } from '../schema'
import { readDoc, writeDoc, type DocSpec } from '../storage'
import type { ChainsService } from './chains'
import type { ProviderService } from './provider'
import type { VaultManager } from './vault'

/** Peer ENS plan: Electroneum's UniversalResolver. */
export const ETN_UNIVERSAL_RESOLVER = '0x75509153af7db00BeeCc30EC042299fD30e2cb6e' as const

const RESOLVERS: Record<number, Hex> = {
  52014: ETN_UNIVERSAL_RESOLVER,
  1: mainnet.contracts.ensUniversalResolver.address,
}

const SUFFIX: Record<number, string> = { 52014: '.etn', 1: '.eth' }
const CACHE_MS = 5 * 60_000

/**
 * A display name survives the popup closing.
 *
 * `lookup` is what puts a name where an address would go — the seat, the
 * accounts rail, an activity row — and the popup is a page that dies every time
 * it loses focus. The in-memory map below is therefore never more than a
 * within-page guard: on its own it bought one UniversalResolver round trip per
 * address per open, which is a lookup per screen, not per session. The answer
 * rides in the DEK-sealed document cache like every other served resource
 * (`cache.ts`), one entry per address, so a reopened popup paints the name
 * before the chain is asked anything.
 *
 * Six hours, because a primary name changes when somebody registers or
 * re-points one — not on a block. `setPrimary` invalidates the one address it
 * just changed rather than waiting the window out.
 */
const REVERSE_TTL_MS = 6 * 60 * 60 * 1000
/*
  `reverse2`: the cached shape gained `verified` (ES-BV-036). A name is only
  worth showing in place of an address once the forward record has been read
  back, and a document written before that check existed cannot say whether it
  was done — so it is not read.
*/
const reverseSpec = (chainId: number, address: string): CacheSpec<{ name: string | null; verified: boolean }> => ({
  key: cacheKey('names', 'reverse2', chainId, address.toLowerCase()),
  schema: z.object({ name: z.string().nullable(), verified: z.boolean() }),
})

/** How much of a name fits where a short address would have been; `untrusted`'s own default. */
const NAME_MAX = 32

/**
 * A third party's name, as it is safe to print where an address would go.
 *
 * The string comes off somebody else's resolver, so it gets exactly what a
 * contract's label gets in the approval sheet: NFKC, then control, format and
 * bidi characters stripped, then bounded (`untrusted`, security/explain.ts).
 * Two rules on top of that, because this text REPLACES an address on screen
 * rather than sitting in a sentence:
 *
 *  - it must still end in the suffix it resolved on. `untrusted` marks a
 *    truncation with an ellipsis, so a 300-character name arrives here clipped
 *    mid-label, and a clipped label is not a name — it is a smear the length of
 *    whatever the attacker chose.
 *  - it must not open with `0x`. `0xYou….etn` standing in the slot the short
 *    address occupies is an address that is not one, which is the whole
 *    impersonation the short form invites.
 *
 * Anything that fails either is not printed at all, and the caller falls back
 * to the shortened address — which is never a lie.
 */
export function displayName(chainId: number, raw: string | null): string | null {
  if (raw === null) return null
  /*
    ENSIP-15 first (ES-BV-036).

    Lowercasing and stripping format characters is not the same as normalising:
    a name that does not survive `normalize()` is not a name any resolver will
    agree about, and one whose normal form differs from what was served is a
    name being shown in a spelling nobody else sees. Both are exactly the
    confusables the short-address form was meant to stop inviting.
  */
  let normal: string
  try {
    normal = normalize(raw.trim())
  } catch {
    return null
  }
  const clean = untrusted(normal, NAME_MAX)
  if (clean.length === 0 || clean !== normal) return null
  const suffix = SUFFIX[chainId]
  if (suffix !== undefined && !clean.endsWith(suffix)) return null
  if (clean.startsWith('0x')) return null
  return clean
}

/**
 * The `.etn` registrar, verified on chain 2026-09-11 against Electroneum
 * mainnet (52014) — not copied from a plan or a sibling repo:
 *
 *   - the controller answers `ens()` = the registry below, `reverseRegistrar()`
 *     and `defaultReverseRegistrar()` = the two below, and the base registrar
 *     answers `controllers(controller) == true`, so it is a live controller and
 *     not a lookalike;
 *   - its `register` is the 2025 ENS shape, `register(Registration)` with a
 *     struct and a `referrer`, NOT the `register(string,address,…)` the older
 *     deployments carry — the master plan's own note to "verify the exact
 *     signature against the deployed bytecode (v2/v3 differ)" was well placed;
 *   - `makeCommitment` computed locally over the same struct matches what the
 *     deployed contract returns, which is the property the reveal depends on;
 *   - all five contracts are source-verified on Electroneum's Blockscout.
 *
 * There is no `.eth` entry and no testnet entry, and neither is an oversight:
 * Ethereum's controller was not verified from here, and Electroneum's testnet
 * has no ENS deployment at all. A wallet that sends money to a guessed address
 * is worse than one that says it cannot register yet, so those chains report a
 * reason instead of an address.
 */
export interface EtnRegistrar {
  readonly controller: Hex
  readonly baseRegistrar: Hex
  readonly registry: Hex
  readonly publicResolver: Hex
  readonly reverseRegistrar: Hex
  readonly defaultReverseRegistrar: Hex
}

const REGISTRARS: Record<number, EtnRegistrar> = {
  52014: {
    controller: '0x3CFa6D6E7e1216393C2cb9393Bc0f411492E33e9',
    baseRegistrar: '0x5207496C1248BbD2AeeDd57Bde44dd9d4E9F1b59',
    registry: '0x6F311F2212593165988Dff84977e24C1005dBb85',
    publicResolver: '0xDb4A3Abb6703232e20a118a104e7f4EbB3e2738D',
    reverseRegistrar: '0xFBB14eDBD8D3f6E7BB240bFA388f6582df0d8E7A',
    defaultReverseRegistrar: '0x3bED61fE4d7d3Bc79E46912Ee7ACce2c231aA0a6',
  },
}

/** Why a chain cannot register, in the voice the plate will show. */
function registrarReason(chainId: number): string {
  if (chainId === 5201420) return 'Electroneum’s testnet has no name service, so there is nothing to register there.'
  if (chainId === 1) return 'Registering a .eth name is not in this build: its registrar has not been verified from here, and BoltVault does not send money to an address it has not checked.'
  return 'Names are registered on Electroneum. Switch to Electroneum to claim one.'
}

const CONTROLLER_ABI = parseAbi([
  'struct Registration { string label; address owner; uint256 duration; bytes32 secret; address resolver; bytes[] data; uint8 reverseRecord; bytes32 referrer; }',
  'function makeCommitment(Registration registration) pure returns (bytes32)',
  'function commit(bytes32 commitment)',
  'function register(Registration registration) payable',
  'function available(string label) view returns (bool)',
  'function valid(string label) view returns (bool)',
  'function rentPrice(string label, uint256 duration) view returns (uint256 base, uint256 premium)',
  'function minCommitmentAge() view returns (uint256)',
  'function maxCommitmentAge() view returns (uint256)',
  'function commitments(bytes32 commitment) view returns (uint256)',
  'function MIN_REGISTRATION_DURATION() view returns (uint256)',
])

/**
 * The same ABI seen loosely, so one helper can serve every read on the
 * controller. Encoding keeps the narrow type — that is the side where a
 * mistyped argument costs money — while the read path, whose answers are
 * checked against the shapes below anyway, does not need eight overloads.
 */
const CONTROLLER_READ_ABI: Abi = CONTROLLER_ABI

const RESOLVER_ABI = parseAbi(['function setAddr(bytes32 node, address a)'])
const REVERSE_ABI = parseAbi(['function setName(string name) returns (bytes32)'])

/**
 * The reverse-record bitmask the controller takes. Bit 1 is `addr.reverse`,
 * which is the record `lookup()` reads back through the UniversalResolver;
 * bit 2 is the ENSIP-19 default reverse, which the ElectroSwap indexer watches.
 * A name claimed as a primary sets both, so it shows up wherever it is looked
 * for; `0` claims the name and leaves the reverse record alone.
 */
const REVERSE_BOTH = 3
const REVERSE_NONE = 0

/** A registration is a year by default; the registrar's own floor is 28 days. */
export const DEFAULT_DURATION_SECONDS = 365 * 24 * 60 * 60

/**
 * How much over the quote the reveal is funded.
 *
 * The price oracle is `ExponentialPremiumPriceOracle`, which converts a USD
 * price through `usdOracle()` — so the ETN a name costs moves between the
 * moment this quote is read and the moment the transaction is mined, and a
 * reveal that lands one wei short reverts with `InsufficientValue` and burns
 * the commitment's window. The controller refunds the difference to the sender
 * inside the same transaction, so the headroom costs nothing but the sheet's
 * "up to" figure.
 */
const PRICE_HEADROOM_PERCENT = 3n

/**
 * A pending commitment as the rest of this file wants it: the sealed half
 * (`NameCommitmentSecret`, validated where it is unsealed) rejoined with the
 * three fields that may sit in the clear (ES-BV-013). Nothing validates it
 * again here because neither half arrives unchecked.
 */
export type CommitmentRecord = NameCommitmentSecret & {
  readonly chainId: number
  readonly commitment: string
  readonly createdAt: number
}

/**
 * What a pending commitment may say in the clear (ES-BV-013).
 *
 * The whole record used to sit here — the account id, the owner address and
 * the name being registered — for up to three days, so any storage dump taken
 * while a registration was pending tied this install to an address and to a
 * name somebody had chosen but not yet claimed. The countdown that has to
 * survive a locked vault needs the chain and the hash and nothing else; the
 * rest lives in a sealed map keyed by the same hash.
 */
const PublicCommitmentSchema = z.object({
  chainId: z.number().int().positive(),
  commitment: z.string(),
  createdAt: z.number(),
})
type PublicCommitment = z.infer<typeof PublicCommitmentSchema>

/**
 * Pending commitments, in plain local storage rather than the DEK-sealed
 * blobs.
 *
 * The wait between commit and reveal is a minute at the least and can be a
 * day, and it has to survive a service-worker eviction — which is the whole
 * reason it is persisted at all. It also has to be readable while the vault is
 * locked, because the countdown is the one thing the Identity plate can still
 * show then, and a sealed store needs the DEK. What is stored is a name the
 * user chose and a random secret whose only power is to let someone else
 * reconstruct the same commitment for the same owner — it is not key material,
 * and the reveal is guarded by the chain, not by this file.
 */
const COMMITMENTS_DOC: DocSpec<PublicCommitment[]> = {
  // `names.commitments2`: the old key held whole records, including the name
  // and the owner. It is not read; a pending registration from before this
  // change simply has to be re-committed, which costs one transaction.
  key: 'names.commitments2',
  version: 1,
  schema: z.array(PublicCommitmentSchema).max(32),
  defaultValue: () => [],
}

/** A commitment older than this is past any chain's `maxCommitmentAge` and is swept on the next read. */
const RECORD_TTL_MS = 3 * 24 * 60 * 60 * 1000

export interface RegistrarView {
  readonly chainId: number
  readonly supported: boolean
  /** Null when registration works here; otherwise why it does not, in plain language. */
  readonly reason: string | null
  readonly suffix: string | null
  readonly controller: string | null
  readonly resolver: string | null
  readonly minDurationSeconds: number | null
  readonly minCommitmentAgeSeconds: number | null
  readonly maxCommitmentAgeSeconds: number | null
}

export interface AvailabilityView {
  readonly supported: boolean
  readonly reason: string | null
  /** The normalised label without the suffix, when the input was a usable name. */
  readonly label: string | null
  readonly name: string | null
  /** The registrar's own `valid()` — three characters or more. */
  readonly valid: boolean
  readonly available: boolean
}

export interface PriceView {
  readonly name: string
  readonly durationSeconds: number
  /** Wei, decimal strings — never a bigint across the wire. */
  readonly baseWei: string
  readonly premiumWei: string
  readonly totalWei: string
  readonly symbol: string
}

export type CommitmentState = 'unmined' | 'waiting' | 'ready' | 'expired'

export interface PendingRegistration {
  readonly id: string
  readonly chainId: number
  readonly accountId: string
  readonly name: string
  readonly durationSeconds: number
  readonly setsPrimary: boolean
  readonly state: CommitmentState
  readonly commitRequestId: string
  /** Unix ms, from the chain's own record of the commit; null until it is mined. */
  readonly committedAt: number | null
  readonly readyAt: number | null
  readonly expiresAt: number | null
}

interface Ages {
  readonly min: number
  readonly max: number
  readonly minDuration: number
}

export interface NamesDeps {
  readonly platform: Platform
  readonly chains: ChainsService
  readonly vault: VaultManager
  readonly provider: ProviderService
  /** Absent in a test harness: `lookup` then answers live every five minutes instead of from disk. */
  readonly cache?: DocCache
  /**
   * The sealed half of a pending registration, keyed by commitment hash
   * (ES-BV-013). Absent in a harness with no vault, in which case a
   * registration cannot be revealed — which is the honest outcome, since the
   * secret it needs was never stored.
   */
  readonly commitments?: SealedMap<NameCommitmentSecret>
}

export class NamesService {
  private readonly reverse = new Map<string, { name: string | null; verified: boolean; at: number }>()
  /** Immutable on the contract (all three are `constant`/`immutable`), so one read stands for the session. */
  private readonly ages = new Map<number, Ages>()
  /** The half that survives a locked vault: chain, hash, and when (ES-BV-013). */
  private publicHalf: PublicCommitment[] | null = null

  constructor(private readonly deps: NamesDeps) {}

  private now(): number {
    return this.deps.platform.now()
  }

  supports(chainId: number): boolean {
    return RESOLVERS[chainId] !== undefined
  }

  /** The chain a name resolves on: `.etn` on Electroneum, `.eth` on Ethereum — from any chain's recipient field (§8.1); none on the testnet. */
  chainFor(chainId: number, input: string): number | null {
    if (chainId === 5201420 || isAddress(input)) return null
    const name = input.trim().toLowerCase()
    for (const [id, suffix] of Object.entries(SUFFIX)) if (name.endsWith(suffix) && name.length > suffix.length) return Number(id)
    return null
  }

  /** True when the input is a name that can be resolved for a send on this chain (not an address). */
  isName(chainId: number, input: string): boolean {
    return this.chainFor(chainId, input) !== null
  }

  async lookup(chainId: number, addresses: readonly string[]): Promise<NameLookup[]> {
    const resolver = RESOLVERS[chainId]
    if (!resolver) return addresses.map((address) => ({ address, name: null, verified: false }))
    const out: NameLookup[] = []
    for (const address of addresses.slice(0, 200)) {
      /*
        `verified` used to be `name !== null`, which says nothing: a reverse
        record is set by whoever owns the address, so anyone can point one at
        "electroswap.etn" and have the wallet print it beside their own
        address. It means something only when the name resolves forward to the
        same address (ES-BV-036).
      */
      const { name, verified } = await this.reverseName(chainId, address, resolver)
      out.push({ address, name, verified })
    }
    return out
  }

  /**
   * One address's primary name, sanitised, or null.
   *
   * Three layers, cheapest first: the session map, because a list on screen
   * asks for the same address on every render; the sealed document cache,
   * because a popup open is a fresh process; then the resolver. The client is
   * built inside the loader rather than above it, so a screen whose names are
   * all cached touches no chain at all.
   *
   * A failure answers null and is remembered for the session only — never
   * written to disk, so an RPC outage cannot persist "this address has no
   * name" for six hours.
   */
  private async reverseName(chainId: number, address: string, resolver: Hex): Promise<{ name: string | null; verified: boolean }> {
    const k = `${chainId}:${address.toLowerCase()}`
    const hit = this.reverse.get(k)
    if (hit && this.now() - hit.at < CACHE_MS) return { name: hit.name, verified: hit.verified }
    const load = async (): Promise<{ name: string | null; verified: boolean }> => {
      const client = await this.deps.chains.client(chainId)
      const raw = await client.getEnsName({ address: address as Hex, universalResolverAddress: resolver })
      const name = displayName(chainId, raw ?? null)
      if (name === null) return { name: null, verified: false }
      /*
        The forward record decides. A reverse record is a claim by whoever
        controls the address; the forward one is a claim by whoever controls
        the name. Only when they agree does the name stand for the address.
      */
      const forward = await client
        .getEnsAddress({ name, universalResolverAddress: resolver })
        .catch(() => null)
      return { name, verified: typeof forward === 'string' && forward.toLowerCase() === address.toLowerCase() }
    }
    let answer: { name: string | null; verified: boolean } = { name: null, verified: false }
    try {
      const cache = this.deps.cache
      answer = cache ? (await cache.through(reverseSpec(chainId, address), REVERSE_TTL_MS, load)).value : await load()
    } catch {
      answer = { name: null, verified: false }
    }
    this.reverse.set(k, { name: answer.name, verified: answer.verified, at: this.now() })
    return answer
  }

  async resolve(chainId: number, name: string): Promise<string | null> {
    const on = this.chainFor(chainId, name)
    const resolver = on === null ? undefined : RESOLVERS[on]
    if (on === null || !resolver) return null
    chainId = on
    const client = await this.deps.chains.client(chainId)
    try {
      const address = await client.getEnsAddress({ name: normalize(name.trim()), universalResolverAddress: resolver })
      return address ?? null
    } catch {
      return null
    }
  }

  // ---- registration -----------------------------------------------------------------

  /** Whether this chain can register a name at all, and the addresses it would use. */
  async registrar(chainId: number): Promise<RegistrarView> {
    const reg = REGISTRARS[chainId]
    if (!reg)
      return { chainId, supported: false, reason: registrarReason(chainId), suffix: SUFFIX[chainId] ?? null, controller: null, resolver: null, minDurationSeconds: null, minCommitmentAgeSeconds: null, maxCommitmentAgeSeconds: null }
    const ages = await this.agesFor(chainId, reg).catch(() => null)
    return {
      chainId,
      supported: true,
      reason: null,
      suffix: SUFFIX[chainId] ?? null,
      controller: reg.controller,
      resolver: reg.publicResolver,
      minDurationSeconds: ages?.minDuration ?? null,
      minCommitmentAgeSeconds: ages?.min ?? null,
      maxCommitmentAgeSeconds: ages?.max ?? null,
    }
  }

  /** `valid()` and `available()` on the registrar itself — never a cached answer. */
  async availability(chainId: number, input: string): Promise<AvailabilityView> {
    const reg = REGISTRARS[chainId]
    if (!reg) return { supported: false, reason: registrarReason(chainId), label: null, name: null, valid: false, available: false }
    let label: string
    try {
      label = this.labelOf(chainId, input)
    } catch (err) {
      return { supported: true, reason: err instanceof EngineError ? err.message : 'That is not a name this registrar can take.', label: null, name: null, valid: false, available: false }
    }
    const [valid, available] = await Promise.all([
      this.read<boolean>(chainId, reg, 'valid', [label]),
      this.read<boolean>(chainId, reg, 'available', [label]),
    ])
    return { supported: true, reason: null, label, name: `${label}${SUFFIX[chainId] ?? ''}`, valid, available }
  }

  async price(chainId: number, input: string, durationSeconds: number): Promise<PriceView> {
    const reg = this.requireRegistrar(chainId)
    const label = this.labelOf(chainId, input)
    const ages = await this.agesFor(chainId, reg)
    if (durationSeconds < ages.minDuration) throw new EngineError('invalid_argument', `A name is registered for at least ${Math.round(ages.minDuration / 86_400)} days.`)
    const [base, premium] = await this.read<readonly [bigint, bigint]>(chainId, reg, 'rentPrice', [label, BigInt(durationSeconds)])
    return {
      name: `${label}${SUFFIX[chainId] ?? ''}`,
      durationSeconds,
      baseWei: base.toString(),
      premiumWei: premium.toString(),
      totalWei: (base + premium).toString(),
      symbol: this.deps.chains.def(chainId).nativeCurrency.symbol,
    }
  }

  /**
   * Step one of the commit–reveal: a commitment nobody can read the name out
   * of, published on chain, so the reveal a minute later cannot be front-run.
   *
   * The commitment hash is computed BY the contract that will recompute it at
   * reveal time, not by us — the whole scheme rests on the two agreeing, and a
   * struct we encode a hair differently would only be found out after the
   * commit transaction had been paid for.
   */
  async commit(input: { accountId: string; chainId: number; name: string; durationSeconds?: number; setPrimary?: boolean }): Promise<{ id: string; requestId: string; commitment: string; name: string; waitSeconds: number }> {
    const reg = this.requireRegistrar(input.chainId)
    const account = await this.account(input.accountId)
    const label = this.labelOf(input.chainId, input.name)
    const ages = await this.agesFor(input.chainId, reg)
    const duration = input.durationSeconds ?? DEFAULT_DURATION_SECONDS
    if (duration < ages.minDuration) throw new EngineError('invalid_argument', `A name is registered for at least ${Math.round(ages.minDuration / 86_400)} days.`)
    if (!(await this.read<boolean>(input.chainId, reg, 'available', [label]))) throw new EngineError('invalid_argument', 'That name is taken.')

    const owner = account.address as Hex
    const name = `${label}${SUFFIX[input.chainId] ?? ''}`
    const secret = bytesToHex(this.deps.platform.random(32))
    const node = namehash(name)
    const registration = {
      label,
      owner,
      duration: BigInt(duration),
      secret: secret as Hex,
      resolver: reg.publicResolver,
      // The forward record, set inside `register` so the name points at the
      // owner from the block it exists; without it a fresh name resolves to
      // nothing and the recipient field would refuse it.
      data: [encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setAddr', args: [node, owner] })] as readonly Hex[],
      reverseRecord: input.setPrimary === false ? REVERSE_NONE : REVERSE_BOTH,
      referrer: `0x${'0'.repeat(64)}` as Hex,
    }
    const commitment = await this.read<Hex>(input.chainId, reg, 'makeCommitment', [registration])

    const record: CommitmentRecord = {
      id: bytesToHex(this.deps.platform.random(8)).slice(2),
      chainId: input.chainId,
      accountId: input.accountId,
      owner,
      label,
      name,
      durationSeconds: duration,
      secret,
      resolver: reg.publicResolver,
      reverseRecord: registration.reverseRecord,
      referrer: registration.referrer,
      commitment,
      createdAt: this.now(),
      commitRequestId: '',
    }
    /*
      Written before the approval is raised, not after.

      The secret is the only thing that can open this commitment again, and the
      sheet outlives this call — a worker evicted between the two would leave a
      commit the user can still approve and a wallet that has forgotten how to
      reveal it. The other order costs nothing worse than a record for a
      transaction that was never sent, which reads as `unmined` and is swept.
    */
    await this.putRecord(record)
    const { requestId } = await this.deps.provider.submitInternal({
      kind: 'send_transaction',
      origin: 'internal:names',
      chainId: input.chainId,
      accountId: input.accountId,
      tx: { from: owner, to: reg.controller, value: '0x0', data: encodeFunctionData({ abi: CONTROLLER_ABI, functionName: 'commit', args: [commitment] }) },
      clientRequestId: `names.commit:${commitment}`,
    })
    await this.putRecord({ ...record, commitRequestId: requestId })
    return { id: record.id, requestId, commitment, name, waitSeconds: ages.min }
  }

  /** Every commitment this device is holding, with the countdown read off the chain. */
  async pending(chainId?: number): Promise<PendingRegistration[]> {
    const all = await this.loadRecords()
    const rows: PendingRegistration[] = []
    for (const r of all) {
      if (chainId !== undefined && r.chainId !== chainId) continue
      rows.push(await this.toPending(r))
    }
    return rows
  }

  /**
   * Step two: reveal. The registrar checks the commitment's age itself, but
   * every reason it would revert is checked here first — a reverted reveal
   * costs the gas and, worse, spends the commitment's window.
   */
  async register(id: string): Promise<{ requestId: string; name: string; priceWei: string; valueWei: string }> {
    const record = (await this.loadRecords()).find((r) => r.id === id)
    if (!record) throw new EngineError('not_found', 'no such commitment')
    const reg = this.requireRegistrar(record.chainId)
    const state = await this.toPending(record)
    if (state.state === 'unmined') throw new EngineError('invalid_argument', 'The commit transaction has not been mined yet.')
    if (state.state === 'waiting') {
      const seconds = Math.max(1, Math.ceil(((state.readyAt ?? 0) - this.now()) / 1000))
      throw new EngineError('invalid_argument', `The commitment has to sit for another ${seconds}s before the name can be claimed.`)
    }
    if (state.state === 'expired') throw new EngineError('expired', 'That commitment has expired. Start the claim again.')
    if (!(await this.read<boolean>(record.chainId, reg, 'available', [record.label]))) throw new EngineError('invalid_argument', 'That name was taken while you waited.')

    const [base, premium] = await this.read<readonly [bigint, bigint]>(record.chainId, reg, 'rentPrice', [record.label, BigInt(record.durationSeconds)])
    const price = base + premium
    const value = price + (price * PRICE_HEADROOM_PERCENT) / 100n
    const node = namehash(record.name)
    const registration = {
      label: record.label,
      owner: record.owner as Hex,
      duration: BigInt(record.durationSeconds),
      secret: record.secret as Hex,
      resolver: record.resolver as Hex,
      data: [encodeFunctionData({ abi: RESOLVER_ABI, functionName: 'setAddr', args: [node, record.owner as Hex] })] as readonly Hex[],
      reverseRecord: record.reverseRecord,
      referrer: record.referrer as Hex,
    }
    const { requestId } = await this.deps.provider.submitInternal({
      kind: 'send_transaction',
      origin: 'internal:names',
      chainId: record.chainId,
      accountId: record.accountId,
      tx: { from: record.owner as Hex, to: reg.controller, value: `0x${value.toString(16)}`, data: encodeFunctionData({ abi: CONTROLLER_ABI, functionName: 'register', args: [registration] }) },
      clientRequestId: `names.register:${record.commitment}`,
    })
    return { requestId, name: record.name, priceWei: price.toString(), valueWei: value.toString() }
  }

  /** Forget a commitment this device is holding. The chain keeps its own until it expires. */
  async cancel(id: string): Promise<PendingRegistration[]> {
    const all = await this.loadRecords()
    const gone = all.filter((r) => r.id === id)
    // Both halves, or the secret outlives the thing it was the secret for.
    for (const r of gone) await this.deps.commitments?.delete(r.commitment).catch(() => undefined)
    await this.savePublic((this.publicHalf ?? []).filter((p) => !gone.some((r) => r.commitment === p.commitment)))
    return this.pending()
  }

  /**
   * The primary name — what every other wallet will show for this address
   * (§8.1). One transaction on the reverse registrar, through the same sheet.
   */
  async setPrimary(input: { accountId: string; chainId: number; name: string }): Promise<{ requestId: string; name: string }> {
    const reg = this.requireRegistrar(input.chainId)
    const account = await this.account(input.accountId)
    const name = normalize(input.name.trim())
    const suffix = SUFFIX[input.chainId] ?? ''
    if (!name.endsWith(suffix) || name.length <= suffix.length) throw new EngineError('invalid_argument', `A primary name on this chain ends in ${suffix}.`)
    /*
      The name has to resolve back to this account before it is worth setting:
      a reverse record pointing at a name whose forward record is somebody else
      is exactly what forward verification (§3.6) refuses to display, so the
      transaction would cost a fee and change nothing anyone can see.
    */
    const forward = await this.resolve(input.chainId, name)
    if (forward === null) throw new EngineError('invalid_argument', 'That name does not resolve to an address yet.')
    if (forward.toLowerCase() !== account.address.toLowerCase()) throw new EngineError('invalid_argument', `${name} points at another address, so it cannot be this account’s primary name.`)
    const { requestId } = await this.deps.provider.submitInternal({
      kind: 'send_transaction',
      origin: 'internal:names',
      chainId: input.chainId,
      accountId: input.accountId,
      tx: { from: account.address as Hex, to: reg.reverseRegistrar, value: '0x0', data: encodeFunctionData({ abi: REVERSE_ABI, functionName: 'setName', args: [name] }) },
      clientRequestId: `names.setPrimary:${name}`,
    })
    // Both layers, or the display keeps showing the old answer — the session
    // map for five minutes and the sealed entry for six hours.
    this.reverse.delete(`${input.chainId}:${account.address.toLowerCase()}`)
    await this.deps.cache?.invalidate(reverseSpec(input.chainId, account.address).key)
    return { requestId, name }
  }

  // ---- internals --------------------------------------------------------------------

  private requireRegistrar(chainId: number): EtnRegistrar {
    const reg = REGISTRARS[chainId]
    if (!reg) throw new EngineError('invalid_argument', registrarReason(chainId))
    return reg
  }

  private async account(accountId: string): Promise<{ id: string; address: string; kind: string }> {
    const account = (await this.deps.vault.accounts()).find((a) => a.id === accountId)
    if (!account) {
      // A locked vault lists no accounts, so the two cases look the same here.
      const status = await this.deps.vault.status()
      if (status.exists && !status.unlocked) throw new EngineError('locked', 'Unlock BoltVault to claim a name.')
      throw new EngineError('not_found', 'no such account')
    }
    if (account.kind === 'watch') throw new EngineError('invalid_argument', 'Watch-only — import a key or pair a device to claim a name.')
    return account
  }

  /** The label a registrar takes: one normalised component, with the chain's suffix stripped if it was typed. */
  private labelOf(chainId: number, input: string): string {
    const suffix = SUFFIX[chainId] ?? ''
    let name: string
    try {
      name = normalize(input.trim().toLowerCase())
    } catch {
      throw new EngineError('invalid_argument', 'That name has characters a registrar cannot take.')
    }
    const label = suffix && name.endsWith(suffix) ? name.slice(0, -suffix.length) : name
    if (label.length === 0 || label.includes('.')) throw new EngineError('invalid_argument', `Enter one name, like yourname${suffix}.`)
    return label
  }

  private async agesFor(chainId: number, reg: EtnRegistrar): Promise<Ages> {
    const cached = this.ages.get(chainId)
    if (cached) return cached
    const [min, max, minDuration] = await Promise.all([
      this.read<bigint>(chainId, reg, 'minCommitmentAge', []),
      this.read<bigint>(chainId, reg, 'maxCommitmentAge', []),
      this.read<bigint>(chainId, reg, 'MIN_REGISTRATION_DURATION', []),
    ])
    const ages: Ages = { min: Number(min), max: Number(max), minDuration: Number(minDuration) }
    this.ages.set(chainId, ages)
    return ages
  }

  /**
   * The chain is what knows when a commitment was made.
   *
   * `commitments(hash)` is the block timestamp of the commit, so the countdown
   * needs nothing remembered locally beyond the parameters — which is what
   * makes it survive a worker restart, a reinstall of the popup, or a device
   * that was asleep for the whole wait.
   */
  private async toPending(record: CommitmentRecord): Promise<PendingRegistration> {
    const reg = REGISTRARS[record.chainId]
    const setsPrimary = record.reverseRecord !== REVERSE_NONE
    const base = { id: record.id, chainId: record.chainId, accountId: record.accountId, name: record.name, durationSeconds: record.durationSeconds, setsPrimary, commitRequestId: record.commitRequestId }
    if (!reg) return { ...base, state: 'expired', committedAt: null, readyAt: null, expiresAt: null }
    const [seconds, ages] = await Promise.all([
      this.read<bigint>(record.chainId, reg, 'commitments', [record.commitment as Hex]).catch(() => 0n),
      this.agesFor(record.chainId, reg).catch(() => null),
    ])
    if (seconds === 0n || !ages) return { ...base, state: 'unmined', committedAt: null, readyAt: null, expiresAt: null }
    const committedAt = Number(seconds) * 1000
    const readyAt = committedAt + ages.min * 1000
    const expiresAt = committedAt + ages.max * 1000
    const now = this.now()
    const state: CommitmentState = now >= expiresAt ? 'expired' : now >= readyAt ? 'ready' : 'waiting'
    return { ...base, state, committedAt, readyAt, expiresAt }
  }

  private async read<T>(chainId: number, reg: EtnRegistrar, functionName: string, args: readonly unknown[]): Promise<T> {
    const client = await this.deps.chains.client(chainId)
    const result: unknown = await client.readContract({ address: reg.controller, abi: CONTROLLER_READ_ABI, functionName, args })
    return result as T
  }

  /**
   * Both halves, rejoined (ES-BV-013).
   *
   * While the vault is locked the sealed half cannot be read, so a record
   * comes back without it — which is the state the Identity plate's countdown
   * is written for, and the only thing it needs is the chain and the hash.
   */
  private async loadRecords(): Promise<CommitmentRecord[]> {
    if (!this.publicHalf) {
      const { value } = await readDoc(this.deps.platform.storage.local, COMMITMENTS_DOC, () => this.now())
      this.publicHalf = value
    }
    const fresh = this.publicHalf.filter((r) => this.now() - r.createdAt < RECORD_TTL_MS)
    if (fresh.length !== this.publicHalf.length) await this.savePublic(fresh)
    const out: CommitmentRecord[] = []
    for (const pub of this.publicHalf) {
      const secret = await this.deps.commitments?.get(pub.commitment).catch(() => null)
      out.push(
        secret
          ? { ...secret, chainId: pub.chainId, commitment: pub.commitment, createdAt: pub.createdAt }
          : {
              id: pub.commitment,
              chainId: pub.chainId,
              accountId: '',
              owner: '',
              label: '',
              name: '',
              durationSeconds: DEFAULT_DURATION_SECONDS,
              secret: '',
              resolver: '',
              reverseRecord: REVERSE_NONE,
              referrer: '',
              commitment: pub.commitment,
              createdAt: pub.createdAt,
              commitRequestId: '',
            },
      )
    }
    return out
  }

  private async putRecord(record: CommitmentRecord): Promise<void> {
    const { chainId, commitment, createdAt, ...secret } = record
    await this.deps.commitments?.set(commitment, secret)
    const all = (this.publicHalf ?? []).filter((r) => r.commitment !== commitment)
    // Newest first, and bounded: the document schema caps the array, and a
    // write that fails validation would quarantine the whole list.
    await this.savePublic([{ chainId, commitment, createdAt }, ...all].slice(0, 32))
  }

  private async savePublic(records: PublicCommitment[]): Promise<void> {
    this.publicHalf = records
    await writeDoc(this.deps.platform.storage.local, COMMITMENTS_DOC, records)
  }
}

const ChainIdSchema = z.number().int().positive()
const NameSchema = z.string().min(1).max(255)

export function namesNamespace(names: NamesService): NamespaceSpec {
  return {
    lookup: {
      input: z.object({ chainId: ChainIdSchema, addresses: z.array(z.string()).max(200) }),
      handler: (arg) => names.lookup((arg as { chainId: number }).chainId, (arg as { addresses: string[] }).addresses),
    },
    resolve: {
      input: z.object({ chainId: ChainIdSchema, name: NameSchema }),
      handler: async (arg) => ({ address: await names.resolve((arg as { chainId: number }).chainId, (arg as { name: string }).name) }),
    },
    registrar: {
      input: z.object({ chainId: ChainIdSchema }),
      handler: (arg) => names.registrar((arg as { chainId: number }).chainId),
    },
    availability: {
      input: z.object({ chainId: ChainIdSchema, name: NameSchema }),
      handler: (arg) => {
        const { chainId, name } = arg as { chainId: number; name: string }
        return names.availability(chainId, name)
      },
    },
    price: {
      input: z.object({ chainId: ChainIdSchema, name: NameSchema, durationSeconds: z.number().int().positive().max(100 * 365 * 24 * 60 * 60).optional() }),
      handler: (arg) => {
        const { chainId, name, durationSeconds } = arg as { chainId: number; name: string; durationSeconds?: number }
        return names.price(chainId, name, durationSeconds ?? DEFAULT_DURATION_SECONDS)
      },
    },
    commit: {
      input: z.object({ accountId: AccountIdSchema, chainId: ChainIdSchema, name: NameSchema, durationSeconds: z.number().int().positive().max(100 * 365 * 24 * 60 * 60).optional(), setPrimary: z.boolean().optional() }),
      handler: (arg) => names.commit(arg as { accountId: string; chainId: number; name: string; durationSeconds?: number; setPrimary?: boolean }),
    },
    pending: {
      input: z.object({ chainId: ChainIdSchema.optional() }).optional(),
      handler: (arg) => names.pending((arg as { chainId?: number } | undefined)?.chainId),
    },
    register: {
      input: z.object({ id: z.string().min(1).max(64) }),
      handler: (arg) => names.register((arg as { id: string }).id),
    },
    cancel: {
      input: z.object({ id: z.string().min(1).max(64) }),
      handler: (arg) => names.cancel((arg as { id: string }).id),
    },
    setPrimary: {
      input: z.object({ accountId: AccountIdSchema, chainId: ChainIdSchema, name: NameSchema }),
      handler: (arg) => names.setPrimary(arg as { accountId: string; chainId: number; name: string }),
    },
  }
}
