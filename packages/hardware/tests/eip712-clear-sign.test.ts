/**
 * What the Ledger is actually shown for typed data (ES-BV-006).
 *
 * The adapter used to hash the domain and the struct on the host and hand the
 * device two 32-byte numbers. The device then displayed two opaque hashes, so
 * the sheet was the only place the spender, the amount and the deadline
 * appeared — and a Permit2 or Seaport signature moves tokens with no
 * transaction behind it. A hardware wallet exists for exactly the case where
 * the host is lying, and a hash it cannot read protects against nothing.
 *
 * The fake device is the assertion here. It does not look at what the wallet
 * meant to send: it rebuilds the typed-data object from the struct-definition
 * and struct-implementation APDUs alone and hashes *that*. A signature that
 * recovers to the right address is therefore proof that the bytes on the wire
 * describe the message the wallet meant.
 */
import { recoverTypedDataAddress, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import {
  FakeLedgerDevice,
  LedgerEthApp,
  LedgerHidTransport,
  definitionField,
  eip712Plan,
  encodeLeaf,
  ledgerAccount,
  pathFor,
  supportsClearSigning,
  Eip712Unsupported,
} from '../src'

const ETN = 52014
const STRUCT_DEF = 0x1a
const STRUCT_IMPL = 0x1c
const SIGN = 0x0c

function setup(opts: ConstructorParameters<typeof FakeLedgerDevice>[0] = {}) {
  const device = new FakeLedgerDevice(opts)
  const app = new LedgerEthApp(new LedgerHidTransport(device, 2_000))
  return { device, app }
}

async function ledger(opts: ConstructorParameters<typeof FakeLedgerDevice>[0] = {}) {
  const { device, app } = setup(opts)
  const path = pathFor('bip44', 0)
  const { address } = await app.getAddress(path)
  const hashed: string[] = []
  const account = ledgerAccount({ address, path, app, onHashedTypedData: (r) => hashed.push(r) })
  device.app.log.length = 0
  return { device, app, account, address, hashed }
}

const permit = {
  domain: {
    name: 'Permit2',
    chainId: ETN,
    verifyingContract: '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617' as Hex,
  },
  types: {
    PermitDetails: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
      { name: 'nonce', type: 'uint48' },
    ],
    PermitSingle: [
      { name: 'details', type: 'PermitDetails' },
      { name: 'spender', type: 'address' },
      { name: 'sigDeadline', type: 'uint256' },
    ],
  },
  primaryType: 'PermitSingle' as const,
  message: {
    details: {
      token: '0x1111111111111111111111111111111111111111' as Hex,
      amount: 1461501637330902918203684832716283019655932542975n,
      expiration: 1893456000,
      nonce: 0,
    },
    spender: '0x2222222222222222222222222222222222222222' as Hex,
    sigDeadline: 1893456000n,
  },
}

describe('which app version speaks the flow', () => {
  it('is 1.9.19 and up, read as numbers rather than strings', () => {
    expect(supportsClearSigning('1.9.19')).toBe(true)
    expect(supportsClearSigning('1.9.18')).toBe(false)
    // String order would put "1.10.0" before "1.9.19"; the device disagrees.
    expect(supportsClearSigning('1.10.0')).toBe(true)
    expect(supportsClearSigning('1.12.0')).toBe(true)
    expect(supportsClearSigning('2.0.0')).toBe(true)
    expect(supportsClearSigning('0.9.99')).toBe(false)
    expect(supportsClearSigning('nonsense')).toBe(false)
  })
})

describe('the bytes a struct definition is made of', () => {
  it('describes a Solidity leaf by type, size and name', () => {
    // uint256: type 2, the size bit, 32 bytes, then "amount".
    expect(Array.from(definitionField({ name: 'amount', type: 'uint256' }))).toEqual([
      0x42, 32, 6, 0x61, 0x6d, 0x6f, 0x75, 0x6e, 0x74,
    ])
    // address and bool carry no size.
    expect(Array.from(definitionField({ name: 'to', type: 'address' })).slice(0, 2)).toEqual([0x03, 2])
    expect(Array.from(definitionField({ name: 'ok', type: 'bool' })).slice(0, 2)).toEqual([0x04, 2])
    // bytes32 is the fixed kind with a size; bytes is the dynamic one.
    expect(Array.from(definitionField({ name: 'h', type: 'bytes32' })).slice(0, 3)).toEqual([0x46, 32, 1])
    expect(Array.from(definitionField({ name: 'h', type: 'bytes' })).slice(0, 2)).toEqual([0x07, 1])
  })

  it('names a struct and marks an array', () => {
    const bytes = Array.from(definitionField({ name: 'offer', type: 'OfferItem[]' }))
    // Custom type (0) with the array bit, then the type name, then one dynamic level.
    expect(bytes[0]).toBe(0x80)
    expect(bytes[1]).toBe('OfferItem'.length)
    expect(bytes.slice(11, 13)).toEqual([1, 0x00])
    const fixed = Array.from(definitionField({ name: 'three', type: 'uint8[3]' }))
    expect(fixed.slice(0, 5)).toEqual([0xc2, 1, 1, 0x01, 3])
  })

  it('refuses the shapes the app cannot be told about', () => {
    expect(() => definitionField({ name: 'deep', type: 'uint256[][]' })).toThrow(Eip712Unsupported)
    expect(() => definitionField({ name: 'odd', type: 'uint7' })).toThrow(Eip712Unsupported)
    expect(() => definitionField({ name: 'odd', type: 'bytes33' })).toThrow(Eip712Unsupported)
  })
})

describe('the bytes a value is made of', () => {
  it('sends numbers big-endian with no leading zero byte', () => {
    expect(Array.from(encodeLeaf('uint256', 0n))).toEqual([0])
    expect(Array.from(encodeLeaf('uint256', 255n))).toEqual([0xff])
    expect(Array.from(encodeLeaf('uint256', 256n))).toEqual([0x01, 0x00])
    // The app left-pads to the declared width itself when it hashes.
    expect(encodeLeaf('uint160', 2n ** 160n - 1n).length).toBe(20)
  })

  it('takes a negative int as two’s complement at its declared width', () => {
    expect(Array.from(encodeLeaf('int8', -1n))).toEqual([0xff])
    expect(Array.from(encodeLeaf('int16', -2n))).toEqual([0xff, 0xfe])
  })

  it('is exact about addresses, bools and text', () => {
    expect(encodeLeaf('address', `0x${'11'.repeat(20)}`).length).toBe(20)
    expect(() => encodeLeaf('address', '0x1111')).toThrow(Eip712Unsupported)
    expect(Array.from(encodeLeaf('bool', true))).toEqual([1])
    expect(Array.from(encodeLeaf('bool', false))).toEqual([0])
    expect(Array.from(encodeLeaf('string', 'hi'))).toEqual([0x68, 0x69])
    expect(encodeLeaf('string', '').length).toBe(0)
  })
})

describe('a Permit2 signature on a current Ethereum app', () => {
  it('describes every struct and walks every value before asking for the signature', async () => {
    const { device, account, address, hashed } = await ledger()
    const signature = await account.signTypedData(permit)

    // The device hashed what it was told, and that hash is the permit's.
    expect(await recoverTypedDataAddress({ ...permit, signature })).toBe(address)
    expect(hashed).toEqual([])

    const log = device.app.log
    const defs = log.filter((l) => l.ins === STRUCT_DEF)
    const impls = log.filter((l) => l.ins === STRUCT_IMPL)
    const sign = log.filter((l) => l.ins === SIGN)
    expect(defs.length).toBeGreaterThan(0)
    expect(impls.length).toBeGreaterThan(0)
    expect(sign.length).toBe(1)
    // The signature request comes last, and asks for the full flow.
    expect(log.at(-1)).toMatchObject({ ins: SIGN, p2: 0x01 })
    expect(log.indexOf(defs[0] as (typeof log)[number])).toBeLessThan(
      log.indexOf(impls[0] as (typeof log)[number]),
    )

    // Three struct names: the domain and the permit's two.
    const names = defs.filter((l) => l.p2 === 0x00).map((l) => String.fromCharCode(...l.data))
    expect(names).toEqual(['EIP712Domain', 'PermitDetails', 'PermitSingle'])
    // The domain is implemented first, then the primary type.
    const roots = impls.filter((l) => l.p2 === 0x00).map((l) => String.fromCharCode(...l.data))
    expect(roots).toEqual(['EIP712Domain', 'PermitSingle'])
    // Nothing here is the hashed instruction.
    expect(log.some((l) => l.ins === SIGN && l.p2 === 0x00)).toBe(false)
  })

  it('walks arrays, text and bytes, and splits a long value across APDUs', async () => {
    const { device, account, address, hashed } = await ledger()
    const order = {
      domain: { name: 'Seaport', version: '1.5', chainId: ETN, verifyingContract: `0x${'44'.repeat(20)}` as Hex },
      types: {
        OfferItem: [
          { name: 'token', type: 'address' },
          { name: 'amount', type: 'uint256' },
        ],
        Listing: [
          { name: 'offerer', type: 'address' },
          { name: 'offer', type: 'OfferItem[]' },
          { name: 'note', type: 'string' },
          { name: 'salt', type: 'bytes32' },
          { name: 'extra', type: 'bytes' },
          { name: 'restricted', type: 'bool' },
        ],
      },
      primaryType: 'Listing' as const,
      message: {
        offerer: `0x${'55'.repeat(20)}` as Hex,
        offer: [
          { token: `0x${'66'.repeat(20)}` as Hex, amount: 1n },
          { token: `0x${'77'.repeat(20)}` as Hex, amount: 2n ** 200n },
        ],
        // Long enough that one APDU cannot carry it.
        note: 'a'.repeat(600),
        salt: `0x${'88'.repeat(32)}` as Hex,
        extra: '0x' as Hex,
        restricted: true,
      },
    }
    const signature = await account.signTypedData(order)
    expect(await recoverTypedDataAddress({ ...order, signature })).toBe(address)
    expect(hashed).toEqual([])

    const impls = device.app.log.filter((l) => l.ins === STRUCT_IMPL)
    // One array header, carrying the two offer items.
    const arrays = impls.filter((l) => l.p2 === 0x0f)
    expect(arrays.length).toBe(1)
    expect(arrays[0]?.data[0]).toBe(2)
    // The long string arrives as several APDUs, all but the last marked "more".
    const partial = impls.filter((l) => l.p2 === 0xff && l.p1 === 0x01)
    expect(partial.length).toBeGreaterThan(1)
    expect(impls.every((l) => l.len <= 255)).toBe(true)
  })

  it('lets a refusal on the device stand rather than quietly signing hashes', async () => {
    const { device, account, hashed } = await ledger()
    device.app.rejectNext = true
    await expect(account.signTypedData(permit)).rejects.toMatchObject({ code: 'rejected' })
    expect(hashed).toEqual([])
    expect(device.app.log.some((l) => l.ins === SIGN && l.p2 === 0x00)).toBe(false)
  })
})

describe('when the device cannot be told', () => {
  it('falls back to hashes on an app too old, and says why', async () => {
    const { device, account, address, hashed } = await ledger({ version: [1, 9, 18] })
    const signature = await account.signTypedData(permit)
    expect(await recoverTypedDataAddress({ ...permit, signature })).toBe(address)
    // Not a single struct APDU was sent: the version answered the question.
    expect(device.app.log.some((l) => l.ins === STRUCT_DEF || l.ins === STRUCT_IMPL)).toBe(false)
    expect(device.app.log.at(-1)).toMatchObject({ ins: SIGN, p2: 0x00 })
    expect(hashed).toHaveLength(1)
    expect(hashed[0]).toMatch(/too old/i)
  })

  it('falls back on a message shaped in a way the app has no words for', async () => {
    const { device, account, address, hashed } = await ledger()
    const nested = {
      domain: { name: 'Grid', chainId: ETN },
      types: { Grid: [{ name: 'cells', type: 'uint256[][]' }] },
      primaryType: 'Grid' as const,
      message: { cells: [[1n, 2n], [3n]] },
    }
    const signature = await account.signTypedData(nested)
    expect(await recoverTypedDataAddress({ ...nested, signature })).toBe(address)
    // `eip712Plan` refuses before a byte is sent, so the device is never left
    // half-told.
    expect(device.app.log.some((l) => l.ins === STRUCT_DEF || l.ins === STRUCT_IMPL)).toBe(false)
    expect(device.app.log.at(-1)).toMatchObject({ ins: SIGN, p2: 0x00 })
    expect(hashed).toHaveLength(1)
    expect(hashed[0]).toMatch(/nested arrays/i)
  })

  it('says so from the plan alone, with no device in the room', () => {
    expect(() =>
      eip712Plan({
        types: { EIP712Domain: [], Grid: [{ name: 'cells', type: 'uint256[][]' }] },
        primaryType: 'Grid',
        domain: {},
        message: { cells: [] },
      }),
    ).toThrow(Eip712Unsupported)
    expect(() =>
      eip712Plan({
        types: { EIP712Domain: [], Thing: [{ name: 'who', type: 'Missing' }] },
        primaryType: 'Thing',
        domain: {},
        message: { who: {} },
      }),
    ).toThrow(Eip712Unsupported)
  })
})
