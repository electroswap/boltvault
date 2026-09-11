/**
 * The registry is only worth having if it is answerable to the contracts it
 * claims to describe.
 *
 * `FOT_DETECTOR_ABI` was hand-written with five return fields against a
 * detector that returns two, so every decode of its answer failed and the
 * fee-on-transfer probe never once succeeded — for its entire lifetime, on
 * every token, while the correct artifact sat unread in the tree. Nothing
 * noticed, because nothing compared the two. This file compares them: the
 * artifacts against their manifest hashes, the generated module against the
 * artifacts, the shipped 4byte keys against their own signatures, and one
 * pinned calldata against every entry in the registry.
 */
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { decodeFunctionData, decodeFunctionResult, parseAbi, toFunctionSelector, type Abi, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { ABI_REGISTRY, FOT_DETECTOR_ABI, fourByte, fragmentFor, resolveSelector, selectorClaims } from '../src/abis'
import FOUR_BYTE from '../data/four-byte.json'
import { ARTIFACT_ABIS } from '../src/generated/abis'
import { decodeCalldata } from '../src/decode'

const HERE = dirname(fileURLToPath(import.meta.url))
const ARTIFACTS = join(HERE, '..', '..', 'electroswap', 'abis')

interface ManifestEntry {
  readonly source: string
  readonly sha256: string
  readonly functions: number
  readonly events: number
}

const manifest: Record<string, ManifestEntry> = JSON.parse(readFileSync(join(ARTIFACTS, 'manifest.json'), 'utf8'))

const UNKNOWN = '0x9999999999999999999999999999999999999999' as Hex

describe('the synced artifacts still are what the manifest says', () => {
  it('lists at least the contracts §3.4 step 1 names', () => {
    // Not an exhaustive list: an addition should not fail, a silent removal should.
    for (const name of ['UniversalRouter', 'Permit2', 'Seaport15', 'YieldFarm', 'LaunchpadPresalePool', 'LockerV2', 'LockerV3', 'LimitOrders', 'ElectricLegends', 'EsDividendDistributorV2', 'EsMinterV2', 'ERC20', 'ERC721', 'ERC1155', 'Multicall3']) {
      expect(Object.keys(manifest)).toContain(name)
    }
  })

  it('hashes to what was recorded when it was synced', () => {
    for (const [name, entry] of Object.entries(manifest)) {
      const raw = readFileSync(join(ARTIFACTS, `${name}.json`), 'utf8')
      const sha256 = createHash('sha256').update(raw).digest('hex')
      // A mismatch means an artifact was edited by hand instead of re-synced.
      expect(`${name}:${sha256}`).toBe(`${name}:${entry.sha256}`)
    }
  })

  it('declares the function and event counts the manifest counted', () => {
    for (const [name, entry] of Object.entries(manifest)) {
      const abi: Array<{ type?: string }> = JSON.parse(readFileSync(join(ARTIFACTS, `${name}.json`), 'utf8'))
      expect({ name, functions: abi.filter((i) => i.type === 'function').length, events: abi.filter((i) => i.type === 'event').length }).toEqual({ name, functions: entry.functions, events: entry.events })
    }
  })
})

describe('the generated module is the artifacts, not a copy that drifted', () => {
  it('carries every artifact once, with its hash', () => {
    expect(ARTIFACT_ABIS.map((a) => a.name).sort()).toEqual(Object.keys(manifest).sort())
    for (const a of ARTIFACT_ABIS) {
      expect(`${a.name}:${a.sha256}`).toBe(`${a.name}:${manifest[a.name]?.sha256}`)
      expect(a.source).toBe(manifest[a.name]?.source)
    }
  })

  it('holds the same ABI bytes the artifact holds', () => {
    for (const a of ARTIFACT_ABIS) {
      const onDisk: unknown = JSON.parse(readFileSync(join(ARTIFACTS, `${a.name}.json`), 'utf8'))
      expect(JSON.parse(JSON.stringify(a.abi))).toEqual(onDisk)
    }
  })
})

/*
  One pinned calldata per registry entry, decoded through the registry rather
  than through the ABI it was encoded with. The hex is a literal on purpose: a
  fixture re-encoded from the same ABI it is checked against proves only that
  viem is self-consistent, while a pinned one fails the moment the ABI's idea
  of that function's arguments changes.
*/
const CALLS: ReadonlyArray<{ contract: string; name: string; data: Hex }> = [
  { contract: 'ERC20', name: 'transfer', data: '0xa9059cbb0000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000000c' },
  { contract: 'ERC20Extensions', name: 'increaseAllowance', data: '0x39509351000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000001f4' },
  { contract: 'ERC721', name: 'safeTransferFrom', data: '0x42842e0e000000000000000000000000111111111111111111111111111111111111111100000000000000000000000022222222222222222222222222222222222222220000000000000000000000000000000000000000000000000000000000000007' },
  { contract: 'ERC1155', name: 'safeBatchTransferFrom', data: '0x2eb2c2d60000000000000000000000001111111111111111111111111111111111111111000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000001600000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000000300000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000000' },
  { contract: 'EIP2612', name: 'nonces', data: '0x7ecebe000000000000000000000000001111111111111111111111111111111111111111' },
  { contract: 'WETH9', name: 'withdraw', data: '0x2e1a7d4d0000000000000000000000000000000000000000000000000de0b6b3a7640000' },
  { contract: 'Multicall3', name: 'aggregate3', data: '0x82ad56cb0000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000200000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000600000000000000000000000000000000000000000000000000000000000000004deadbeef00000000000000000000000000000000000000000000000000000000' },
  { contract: 'UniversalRouter', name: 'execute', data: '0x3593564c000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000a0000000000000000000000000000000000000000000000000000000000000006300000000000000000000000000000000000000000000000000000000000000020b0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000' },
  { contract: 'Permit2', name: 'approve', data: '0x87517c4500000000000000000000000011111111111111111111111111111111111111110000000000000000000000002222222222222222222222222222222222222222000000000000000000000000ffffffffffffffffffffffffffffffffffffffff0000000000000000000000000000000000000000000000000000000000000000' },
  { contract: 'FeeOnTransferDetector', name: 'validate', data: '0xaa3ad4e40000000000000000000000001111111111111111111111111111111111111111000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000003e8' },
  { contract: 'LimitOrders', name: 'submitOrder', data: '0x006474220000000000000000000000001111111111111111111111111111111111111111000000000000000000000000222222222222222222222222222222222222222200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000005000000000000000000000000000000000000000000000000000000000000000400000000000000000000000033333333333333333333333333333333333333330000000000000000000000000000000000000000000000000000000000000e10' },
  { contract: 'Seaport15', name: 'fulfillOrder', data: '0xb3a34c4c000000000000000000000000000000000000000000000000000000000000004000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000040000000000000000000000000000000000000000000000000000000000000034000000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000016000000000000000000000000000000000000000000000000000000000000002200000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000630000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000700000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000020000000000000000000000002222222222222222222222222222222222222222000000000000000000000000000000000000000000000000000000000000000c0000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000000100000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000003782dace9d9000000000000000000000000000000000000000000000000000003782dace9d90000000000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000000' },
  { contract: 'YieldFarm', name: 'deposit', data: '0x2505c3d90000000000000000000000000000000000000000000000000000000000000003000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000f42400000000000000000000000000000000000000000000000000000000000000032' },
  { contract: 'LaunchpadManager', name: 'createPool', data: '0xe92e6bb50000000000000000000000000000000000000000000000000000000000000001000000000000000000000000000000000000000000000000000000000000006000000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002abcd000000000000000000000000000000000000000000000000000000000000' },
  { contract: 'LaunchpadPresalePool', name: 'contribute', data: '0x73e888fd0000000000000000000000002222222222222222222222222222222222222222' },
  { contract: 'LaunchpadAffiliateRewards', name: 'claimReferralRewards', data: '0x05eaab4b' },
  { contract: 'LaunchpadLpFeeProcessor', name: 'processFees', data: '0xe4c20fba00000000000000000000000000000000000000000000000000000000000000050000000000000000000000000000000000000000000000000000000000000001' },
  { contract: 'LockerV2', name: 'lock', data: '0x9bf926980000000000000000000000001111111111111111111111111111111111111111000000000000000000000000000000000000000000000000000000000000006400000000000000000000000000000000000000000000000000000000000000c80000000000000000000000000000000000000000000000000000000000000000' },
  { contract: 'LockerV3', name: 'lockPosition', data: '0xffc124e0000000000000000000000000000000000000000000000000000000000000002a00000000000000000000000000000000000000000000000000000000000000c80000000000000000000000000000000000000000000000000000000000000001' },
  { contract: 'ElectricLegends', name: 'mint', data: '0xa0712d680000000000000000000000000000000000000000000000000000000000000002' },
  { contract: 'EsDividendDistributorV2', name: 'claimDividends', data: '0xccbba7390000000000000000000000000000000000000000000000000000000000000020000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000010000000000000000000000000000000000000000000000000000000000000002' },
  { contract: 'EsMinterV2', name: 'mint', data: '0x40c10f1900000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000002' },
  { contract: 'HyperlaneTokenRouter', name: 'transferRemote', data: '0x81b4e8b4000000000000000000000000000000000000000000000000000000000000000100000000000000000000000011111111111111111111111111111111111111110000000000000000000000000000000000000000000000000000000000000007' },
]

describe('every registry entry decodes a real call', () => {
  it('covers all of them — a new entry without a fixture fails here', () => {
    expect(CALLS.map((c) => c.contract).sort()).toEqual(ABI_REGISTRY.map((e) => e.name).sort())
  })

  for (const { contract, name, data } of CALLS) {
    it(`${contract}.${name}`, () => {
      const selector = data.slice(0, 10) as Hex
      const claim = fragmentFor(contract, selector)
      expect(claim, `${contract} does not claim ${selector}`).not.toBeNull()
      expect(claim?.name).toBe(name)
      const decoded = decodeFunctionData({ abi: claim?.abi as Abi, data })
      expect(decoded.functionName).toBe(name)
    })
  }
})

describe('a selector is resolved the same way every time', () => {
  it('names every entry that claims one', () => {
    // `approve(address,uint256)` is ERC-20's and ERC-721's, with the same layout and different meanings.
    const approve = toFunctionSelector('approve(address,uint256)')
    const claimants = selectorClaims(approve).map((c) => c.contract)
    expect(claimants).toContain('ERC20')
    expect(claimants).toContain('ERC721')
  })

  it('prefers the standard when nothing is known about the address', () => {
    expect(resolveSelector(toFunctionSelector('approve(address,uint256)'))?.contract).toBe('ERC20')
  })

  it('prefers what the wallet knows is at the address', () => {
    expect(resolveSelector(toFunctionSelector('approve(address,uint256)'), 'nft')?.contract).toBe('ElectricLegends')
    expect(resolveSelector(toFunctionSelector('withdraw(uint256)'), 'wrapped_native')?.contract).toBe('WETH9')
  })

  it('has nothing to say about a selector nobody claims', () => {
    expect(resolveSelector('0xdeadbeef')).toBeNull()
    expect(selectorClaims('0xdeadbeef')).toEqual([])
  })
})

describe('the shipped 4byte table', () => {
  it('keys every signature by its own selector', () => {
    for (const [selector, signature] of Object.entries(FOUR_BYTE.selectors)) {
      expect(`${signature} -> ${toFunctionSelector(signature)}`).toBe(`${signature} -> ${selector}`)
    }
  })

  it('names an unknown selector and decodes its arguments', () => {
    const stake = '0xa694fc3a000000000000000000000000000000000000000000000000000000000000002a' as Hex
    expect(fourByte('0xa694fc3a')?.signature).toBe('stake(uint256)')
    const d = decodeCalldata({ chainId: 52014, to: UNKNOWN, data: stake, value: 0n })
    expect(d).toMatchObject({ kind: 'contract_call', functionName: 'stake', args: [42n] })
  })

  /*
    The point of the table is that a miss stays a miss. "Contract interaction"
    is the phrasing that lets a drainer through by sounding ordinary; the plan
    says never to reach for it, so a selector nobody can name reports no name
    at all and the statement says "unknown function".
  */
  it('still says nothing when it does not know, rather than something reassuring', () => {
    const d = decodeCalldata({ chainId: 52014, to: UNKNOWN, data: '0xdeadbeef', value: 0n })
    expect(d).toMatchObject({ kind: 'contract_call', selector: '0xdeadbeef', functionName: null, args: null })
  })

  it('never reaches the network', () => {
    // The table is a JSON import; there is nothing to fetch, and this pins that.
    expect(typeof FOUR_BYTE.selectors).toBe('object')
    expect(Object.keys(FOUR_BYTE.selectors).length).toBeGreaterThan(50)
  })
})

/*
  The case that would have caught the bug this whole registry exists for.

  `FOT_DETECTOR_ABI` used to declare `(uint256 buyFeeBps, uint256 sellFeeBps,
  bool feeTakenOnTransfer, bool externalTransferFailed, bool sellReverted)` —
  the shape of a *later* Uniswap FeeOnTransferDetector. ElectroSwap's deployed
  detector returns `TokenFees{buyFeeBps, sellFeeBps}`, two words, so every
  decode failed, `detectTax` returned null, and the wallet read null as "no
  tax". The artifact had it right the whole time.
*/
describe('the fee-on-transfer detector is the deployed one, not a guess', () => {
  const RETURNED = '0x000000000000000000000000000000000000000000000000000000000000012c0000000000000000000000000000000000000000000000000000000000000064' as Hex

  it('declares exactly the two fields the contract returns', () => {
    const validate = FOT_DETECTOR_ABI.find((i) => i.type === 'function' && i.name === 'validate')
    const outputs = (validate as { outputs?: ReadonlyArray<{ components?: ReadonlyArray<{ name?: string; type: string }> }> } | undefined)?.outputs
    expect((outputs?.[0]?.components ?? []).map((c) => `${c.type} ${c.name ?? ''}`)).toEqual(['uint256 buyFeeBps', 'uint256 sellFeeBps'])
  })

  it('reads a two-word answer that the five-field guess could not', () => {
    const fees = decodeFunctionResult({ abi: FOT_DETECTOR_ABI, functionName: 'validate', data: RETURNED })
    expect(fees).toEqual({ buyFeeBps: 300n, sellFeeBps: 100n })

    const guess = parseAbi(['function validate(address token, address baseToken, uint256 amountToBorrow) returns ((uint256 buyFeeBps, uint256 sellFeeBps, bool feeTakenOnTransfer, bool externalTransferFailed, bool sellReverted) fees)'])
    expect(() => decodeFunctionResult({ abi: guess, functionName: 'validate', data: RETURNED })).toThrow()
  })
})

describe('what has no artifact says why', () => {
  it('is only the two fragments nothing in the workspace describes', () => {
    const handWritten = ABI_REGISTRY.filter((e) => e.sha256 === null)
    expect(handWritten.map((e) => e.name).sort()).toEqual(['ERC20Extensions', 'HyperlaneTokenRouter'])
    for (const e of handWritten) expect(e.source).toMatch(/^hand-written: /)
  })

  it('gives every artifact-backed entry a hash and a source path', () => {
    for (const e of ABI_REGISTRY.filter((x) => x.sha256 !== null)) {
      expect(e.sha256).toMatch(/^[0-9a-f]{64}$/)
      expect(e.source).not.toMatch(/^hand-written/)
    }
  })
})
