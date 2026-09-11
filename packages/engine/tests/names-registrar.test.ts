/**
 * `.etn` registration (master plan §2.4 `names: { … register(); setPrimary(); }`,
 * §8.1 "Claim a name").
 *
 * The registrar is stood up on the mock chain from the SAME human-readable
 * signatures the engine encodes with, and the commitment is recomputed here
 * the way the deployed contract does it — `keccak256(abi.encode(registration))`
 * over the 2025 ENS `Registration` struct. That is the one property the whole
 * commit–reveal rests on: if the two encodings ever drift, the reveal reverts
 * with `CommitmentNotFound` after the money has been committed.
 *
 * Checked against Electroneum mainnet on 2026-09-11: controller
 * 0x3CFa…33E9's `makeCommitment` returns exactly this hash for these inputs.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import type { Platform } from '@boltvault/platform'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { decodeFunctionData, encodeAbiParameters, encodeFunctionResult, keccak256, parseAbi, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, parseApprovalPayload, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ETN = 52014
const TESTNET = 5201420

const CONTROLLER = '0x3CFa6D6E7e1216393C2cb9393Bc0f411492E33e9' as Hex
const PUBLIC_RESOLVER = '0xDb4A3Abb6703232e20a118a104e7f4EbB3e2738D' as Hex

const MIN_COMMITMENT_AGE = 60n
const MAX_COMMITMENT_AGE = 86_400n
const MIN_DURATION = 2_419_200n
const YEAR = 365 * 24 * 60 * 60
const BASE_WEI = 5_000_000_000_000_000_000n

const ABI = parseAbi([
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

const REGISTRATION_TUPLE = parseAbiParameters('(string,address,uint256,bytes32,address,bytes[],uint8,bytes32)')

interface RegistrationArgs {
  label: string
  owner: Hex
  duration: bigint
  secret: Hex
  resolver: Hex
  data: readonly Hex[]
  reverseRecord: number
  referrer: Hex
}

/** What the deployed controller computes: keccak over the abi-encoded struct. */
function commitmentOf(r: RegistrationArgs): Hex {
  return keccak256(encodeAbiParameters(REGISTRATION_TUPLE, [[r.label, r.owner, r.duration, r.secret, r.resolver, r.data, r.reverseRecord, r.referrer]]))
}

const offline: typeof fetch = async () => new Response('not found', { status: 404 })

describe('names — claiming a .etn name', () => {
  let rpc: MockRpc
  let engine: Engine
  let platform: Platform
  let address: Hex
  let accountId: string
  /** commitment hash → block timestamp, as the registrar's own mapping. */
  const committed = new Map<string, bigint>()
  let taken = false

  beforeAll(async () => {
    rpc = await startMockRpc({ chainId: ETN })
    rpc.state.code.set(CONTROLLER.toLowerCase(), '0x6080')
    rpc.state.calls.set(CONTROLLER.toLowerCase(), ({ data }) => {
      const decoded = decodeFunctionData({ abi: ABI, data })
      switch (decoded.functionName) {
        case 'valid':
          return encodeFunctionResult({ abi: ABI, functionName: 'valid', result: String(decoded.args[0]).length >= 3 })
        case 'available':
          return encodeFunctionResult({ abi: ABI, functionName: 'available', result: !taken })
        case 'rentPrice':
          return encodeFunctionResult({ abi: ABI, functionName: 'rentPrice', result: [BASE_WEI, 0n] })
        case 'minCommitmentAge':
          return encodeFunctionResult({ abi: ABI, functionName: 'minCommitmentAge', result: MIN_COMMITMENT_AGE })
        case 'maxCommitmentAge':
          return encodeFunctionResult({ abi: ABI, functionName: 'maxCommitmentAge', result: MAX_COMMITMENT_AGE })
        case 'MIN_REGISTRATION_DURATION':
          return encodeFunctionResult({ abi: ABI, functionName: 'MIN_REGISTRATION_DURATION', result: MIN_DURATION })
        case 'commitments':
          return encodeFunctionResult({ abi: ABI, functionName: 'commitments', result: committed.get(String(decoded.args[0]).toLowerCase()) ?? 0n })
        case 'makeCommitment':
          return encodeFunctionResult({ abi: ABI, functionName: 'makeCommitment', result: commitmentOf(decoded.args[0] as RegistrationArgs) })
        default:
          throw new Error(`unexpected call ${decoded.functionName}`)
      }
    })
    platform = createMemoryPlatform()
    engine = createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: offline, staticsUrl: null, electroswapUrl: null })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    accountId = created.accounts[0]?.id ?? ''
    await engine.chains.setRpc(ETN, rpc.url)
    rpc.state.balances.set(address.toLowerCase(), 10n ** 20n)
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('says plainly where it cannot register, instead of guessing an address', async () => {
    const testnet = await engine.engine.names.registrar({ chainId: TESTNET })
    expect(testnet.supported).toBe(false)
    expect(testnet.controller).toBeNull()
    expect(testnet.reason).toMatch(/testnet/i)

    // Ethereum resolves `.eth` for display, but its registrar was never
    // verified from here — so claiming is off, with the reason said out loud.
    const ethereum = await engine.engine.names.registrar({ chainId: 1 })
    expect(ethereum.supported).toBe(false)
    expect(ethereum.controller).toBeNull()
    expect(ethereum.reason).toMatch(/verified/i)

    await expect(engine.engine.names.commit({ accountId, chainId: TESTNET, name: 'nope.etn' })).rejects.toThrow()
  })

  it('reads the registrar’s own answers for availability, price and the commitment ages', async () => {
    const reg = await engine.engine.names.registrar({ chainId: ETN })
    expect(reg.supported).toBe(true)
    expect(reg.controller).toBe(CONTROLLER)
    expect(reg.resolver).toBe(PUBLIC_RESOLVER)
    expect(reg.minCommitmentAgeSeconds).toBe(60)
    expect(reg.maxCommitmentAgeSeconds).toBe(86_400)

    expect(await engine.engine.names.availability({ chainId: ETN, name: 'ab' })).toMatchObject({ valid: false, label: 'ab' })
    expect(await engine.engine.names.availability({ chainId: ETN, name: 'boltvault.etn' })).toMatchObject({ supported: true, valid: true, available: true, label: 'boltvault', name: 'boltvault.etn' })

    const price = await engine.engine.names.price({ chainId: ETN, name: 'boltvault.etn', durationSeconds: YEAR })
    // Decimal strings across the wire — never a bigint (§2.4).
    expect(price).toMatchObject({ baseWei: BASE_WEI.toString(), premiumWei: '0', totalWei: BASE_WEI.toString(), symbol: 'ETN' })
    expect(typeof price.totalWei).toBe('string')

    // Under the registrar's own 28-day floor.
    await expect(engine.engine.names.price({ chainId: ETN, name: 'boltvault.etn', durationSeconds: 86_400 })).rejects.toThrow()
  })

  it('commits through the approval path — never signing anything itself', async () => {
    const before = engine.approvals.list().length
    const result = await engine.engine.names.commit({ accountId, chainId: ETN, name: 'boltvault.etn', durationSeconds: YEAR })
    expect(result.name).toBe('boltvault.etn')
    expect(result.waitSeconds).toBe(60)
    expect(engine.approvals.list()).toHaveLength(before + 1)

    const request = engine.approvals.list().find((r) => r.id === result.requestId)
    expect(request?.origin).toBe('internal:names')
    const payload = parseApprovalPayload(request?.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction sheet')
    expect(payload.tx.to?.toLowerCase()).toBe(CONTROLLER.toLowerCase())
    // Committing costs a fee and nothing else; the money is in the reveal.
    expect(BigInt(payload.tx.value)).toBe(0n)
    const decoded = decodeFunctionData({ abi: ABI, data: payload.tx.data as Hex })
    expect(decoded.functionName).toBe('commit')
    expect(decoded.args[0]).toBe(result.commitment)
  })

  it('counts the wait off the chain, so a worker restart does not lose the claim', async () => {
    const pending = await engine.engine.names.pending({ chainId: ETN })
    expect(pending).toHaveLength(1)
    const row = pending[0]
    if (!row) throw new Error('expected a pending commitment')
    // The commit transaction has not been mined, so there is nothing to count yet.
    expect(row.state).toBe('unmined')
    expect(row.setsPrimary).toBe(true)

    // The registrar records the commit at the current block's timestamp.
    const hash = (await lastCommitment()).toLowerCase()
    committed.set(hash, BigInt(Math.floor(platform.now() / 1000)))
    const waiting = (await engine.engine.names.pending({ chainId: ETN }))[0]
    expect(waiting?.state).toBe('waiting')
    expect(waiting?.readyAt).toBeGreaterThan(platform.now())
    await expect(engine.engine.names.register({ id: row.id })).rejects.toThrow(/another/)

    // A whole engine later — the service worker died and came back — the
    // commitment is still here, and so is its countdown.
    engine.dispose()
    const restarted = createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: offline, staticsUrl: null, electroswapUrl: null })
    await restarted.ready
    const survived = await restarted.engine.names.pending({ chainId: ETN })
    expect(survived.map((r) => r.name)).toEqual(['boltvault.etn'])
    expect(survived[0]?.state).toBe('waiting')
    restarted.dispose()

    // Re-open the original engine's stores for the rest of the suite.
    engine = createEngine({ platform, kdf: KDF, receiptPollMs: 20, fetch: offline, staticsUrl: null, electroswapUrl: null })
    await engine.ready
    await engine.engine.vault.unlock({ password: PASSWORD })
  })

  it('reveals only once the commitment is old enough, and funds it from the registrar’s own quote', async () => {
    const hash = (await lastCommitment()).toLowerCase()
    // Old enough to reveal, nowhere near old enough to expire.
    committed.set(hash, BigInt(Math.floor(platform.now() / 1000)) - MIN_COMMITMENT_AGE - 1n)
    const row = (await engine.engine.names.pending({ chainId: ETN }))[0]
    expect(row?.state).toBe('ready')

    const result = await engine.engine.names.register({ id: row?.id ?? '' })
    expect(result.priceWei).toBe(BASE_WEI.toString())
    // Funded a little over the quote: the price oracle is USD-denominated, and
    // the controller refunds the difference in the same transaction.
    expect(BigInt(result.valueWei)).toBeGreaterThan(BigInt(result.priceWei))

    const payload = parseApprovalPayload(engine.approvals.list().find((r) => r.id === result.requestId)?.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected a transaction sheet')
    expect(BigInt(payload.tx.value)).toBe(BigInt(result.valueWei))
    const decoded = decodeFunctionData({ abi: ABI, data: payload.tx.data as Hex })
    expect(decoded.functionName).toBe('register')
    const registration = decoded.args[0] as RegistrationArgs
    expect(registration.label).toBe('boltvault')
    expect(registration.owner.toLowerCase()).toBe(address.toLowerCase())
    expect(registration.resolver).toBe(PUBLIC_RESOLVER)
    // Both reverse records, so the name shows up wherever it is looked for.
    expect(registration.reverseRecord).toBe(3)
    /*
      The reveal has to hash to the commitment that was published a minute ago,
      or the registrar answers CommitmentNotFound and the wait was for nothing.
    */
    expect(commitmentOf(registration).toLowerCase()).toBe(hash)
  })

  it('refuses a reveal for a name that was taken while the commitment sat', async () => {
    taken = true
    const row = (await engine.engine.names.pending({ chainId: ETN }))[0]
    await expect(engine.engine.names.register({ id: row?.id ?? '' })).rejects.toThrow(/taken/)
    taken = false
  })

  it('expires a commitment the registrar would no longer accept', async () => {
    const hash = (await lastCommitment()).toLowerCase()
    committed.set(hash, BigInt(Math.floor(platform.now() / 1000)) - MAX_COMMITMENT_AGE - 1n)
    const row = (await engine.engine.names.pending({ chainId: ETN }))[0]
    expect(row?.state).toBe('expired')
    await expect(engine.engine.names.register({ id: row?.id ?? '' })).rejects.toThrow(/expired/)
    expect(await engine.engine.names.cancel({ id: row?.id ?? '' })).toEqual([])
  })

  it('will not set a primary name it cannot verify forward', async () => {
    // Wrong suffix for the chain.
    await expect(engine.engine.names.setPrimary({ accountId, chainId: ETN, name: 'boltvault.eth' })).rejects.toThrow(/ends in/)
    /*
      §3.6: a name is only shown when it resolves back to the address. Setting a
      reverse record for a name whose forward record is somebody else's costs a
      fee and changes nothing anyone will ever display, so it is refused here
      rather than sent.
    */
    await expect(engine.engine.names.setPrimary({ accountId, chainId: ETN, name: 'boltvault.etn' })).rejects.toThrow(/does not resolve/)
  })

  /** The commitment the engine published, read back off the commit approval. */
  async function lastCommitment(): Promise<Hex> {
    const rows = await engine.engine.names.pending({ chainId: ETN })
    const id = rows[0]?.commitRequestId
    const payload = parseApprovalPayload(engine.approvals.list().find((r) => r.id === id)?.payload)
    if (payload?.kind !== 'send_transaction') throw new Error('expected the commit sheet')
    return decodeFunctionData({ abi: ABI, data: payload.tx.data as Hex }).args[0] as Hex
  }
})
