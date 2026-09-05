/**
 * Ledger over HID with the scripted device: framing round-trips, address
 * derivation on both path schemes, the `v` normalisation vectors (typed and
 * EIP-155 with Electroneum's byte-overflowing chain id), transaction /
 * message / typed-data signatures that recover to the device's address,
 * chunking of long calldata, and the device's refusals mapped to copy.
 */
import { recoverAddress, recoverMessageAddress, recoverTransactionAddress, recoverTypedDataAddress, serializeTransaction, type Hex, type TransactionSerialized } from 'viem'
import { describe, expect, it } from 'vitest'
import { ApduAssembler, FakeLedgerDevice, LedgerEthApp, LedgerError, LedgerHidTransport, eip155TailOffset, frameApdu, ledgerAccount, ledgerModelName, legacyV, pathFor, pathToBytes, schemeOf, yParityFromLedgerV } from '../src'

const ETN = 52014

function setup(opts: ConstructorParameters<typeof FakeLedgerDevice>[0] = {}) {
  const device = new FakeLedgerDevice(opts)
  const transport = new LedgerHidTransport(device, 2_000)
  const app = new LedgerEthApp(transport)
  return { device, transport, app }
}

describe('HID framing', () => {
  it('frames and reassembles an APDU across several 64-byte reports', () => {
    const apdu = new Uint8Array(300).map((_, i) => i & 0xff)
    const packets = frameApdu(apdu)
    expect(packets.length).toBe(6)
    expect(packets.every((p) => p.length === 64)).toBe(true)
    const asm = new ApduAssembler()
    let out: Uint8Array | null = null
    for (const p of packets) out = asm.push(p)
    expect(out).toEqual(apdu)
  })
  it('an empty APDU still needs one report', () => {
    expect(frameApdu(new Uint8Array()).length).toBe(1)
  })
  it('names the model from the product id', () => {
    expect(ledgerModelName(0x5011)).toBe('Ledger Nano S Plus')
    expect(ledgerModelName(0x4011)).toBe('Ledger Nano X')
    expect(ledgerModelName(0x9999, 'Something')).toBe('Something')
  })
})

describe('paths', () => {
  it('encodes BIP-44 and Ledger Live paths', () => {
    expect(pathFor('bip44', 3)).toBe("m/44'/60'/0'/0/3")
    expect(pathFor('live', 3)).toBe("m/44'/60'/3'/0/0")
    expect(schemeOf("m/44'/60'/0'/0/3")).toBe('bip44')
    expect(schemeOf("m/44'/60'/3'/0/0")).toBe('live')
    expect(schemeOf("m/44'/1'/0'/0/0")).toBe('custom')
    const b = pathToBytes("m/44'/60'/0'/0/1")
    expect(b[0]).toBe(5)
    expect(new DataView(b.buffer).getUint32(1)).toBe(0x8000002c)
    expect(new DataView(b.buffer).getUint32(17)).toBe(1)
  })
})

describe('v normalisation', () => {
  it('typed transactions: 0/1 or 27/28', () => {
    expect(yParityFromLedgerV(0, { chainId: ETN, legacy: false })).toBe(0)
    expect(yParityFromLedgerV(1, { chainId: ETN, legacy: false })).toBe(1)
    expect(yParityFromLedgerV(27, { chainId: ETN, legacy: false })).toBe(0)
    expect(yParityFromLedgerV(28, { chainId: ETN, legacy: false })).toBe(1)
  })
  it('legacy EIP-155 on Electroneum overflows the byte and still recovers the parity', () => {
    const base = ETN * 2 + 35 // 104063
    expect(yParityFromLedgerV(base % 256, { chainId: ETN, legacy: true })).toBe(0)
    expect(yParityFromLedgerV((base + 1) % 256, { chainId: ETN, legacy: true })).toBe(1)
    expect(legacyV(ETN, 1)).toBe(104064n)
    // Ethereum mainnet fits in a byte: 37/38.
    expect(yParityFromLedgerV(37, { chainId: 1, legacy: true })).toBe(0)
    expect(yParityFromLedgerV(38, { chainId: 1, legacy: true })).toBe(1)
    // Pre-155: 27/28.
    expect(yParityFromLedgerV(28, { chainId: 0, legacy: true })).toBe(1)
  })
  it('finds the EIP-155 tail of a legacy transaction', () => {
    const raw = serializeTransaction({ type: 'legacy', chainId: ETN, nonce: 1, gasPrice: 1n, gas: 21_000n, to: '0x1111111111111111111111111111111111111111', value: 1n })
    const bytes = Uint8Array.from(Buffer.from(raw.slice(2), 'hex'))
    const off = eip155TailOffset(bytes, ETN)
    // chainId 52014 = 0x82 cb 2e → 3 bytes, then two empty items.
    expect(bytes.length - off).toBe(5)
    expect(bytes[off]).toBe(0x82)
    expect(eip155TailOffset(Uint8Array.from([0x02, 0xc0]), ETN)).toBe(0)
  })
})

describe('the Ethereum app through the fake device', () => {
  it('reports its configuration and derives addresses on both schemes', async () => {
    const { app, device } = setup({ blindSigning: false })
    const cfg = await app.getAppConfiguration()
    expect(cfg).toEqual({ blindSigning: false, erc20Provisioning: true, version: '1.12.0' })
    const a = await app.getAddress(pathFor('bip44', 1))
    const b = await app.getAddress(pathFor('live', 1))
    expect(a.address).toMatch(/^0x[0-9a-fA-F]{40}$/)
    // Index 0 is the same path on both schemes; from 1 on they diverge.
    expect(a.address).not.toBe(b.address)
    expect((await app.getAddress(pathFor('bip44', 0))).address).toBe((await app.getAddress(pathFor('live', 0))).address)
    expect(a.address.toLowerCase()).toBe(device.app.accountFor(pathToBytes(pathFor('bip44', 1))).address.toLowerCase())
    // Verify on device asks with P1 = 1.
    await app.getAddress(pathFor('bip44', 0), true)
    expect(device.app.log.at(-1)).toMatchObject({ ins: 0x02, p1: 1 })
  })

  it('signs a legacy transaction on Electroneum and the signature recovers to the device address', async () => {
    const { app } = setup()
    const path = pathFor('bip44', 0)
    const { address } = await app.getAddress(path)
    const account = ledgerAccount({ address, path, app })
    const signed = (await account.signTransaction({ type: 'legacy', chainId: ETN, nonce: 4, gasPrice: 1_000_000_000n, gas: 21_000n, to: '0x2222222222222222222222222222222222222222', value: 10n ** 18n })) as TransactionSerialized
    expect(await recoverTransactionAddress({ serializedTransaction: signed })).toBe(address)
  })

  it('signs an EIP-1559 transaction with long calldata in several chunks', async () => {
    const { app, device } = setup()
    const path = pathFor('live', 2)
    const { address } = await app.getAddress(path)
    const account = ledgerAccount({ address, path, app })
    const data = `0x${'ab'.repeat(700)}` as Hex
    const signed = (await account.signTransaction({ type: 'eip1559', chainId: ETN, nonce: 9, maxFeePerGas: 2_000_000_000n, maxPriorityFeePerGas: 1_000_000_000n, gas: 250_000n, to: '0x3333333333333333333333333333333333333333', value: 0n, data })) as TransactionSerialized
    expect(await recoverTransactionAddress({ serializedTransaction: signed })).toBe(address)
    const chunks = device.app.log.filter((l) => l.ins === 0x04)
    expect(chunks.length).toBeGreaterThan(4)
    expect(chunks[0]?.p1).toBe(0x00)
    expect(chunks.slice(1).every((c) => c.p1 === 0x80)).toBe(true)
    expect(chunks.every((c) => c.len <= 150)).toBe(true)
  })

  it('signs a personal message and typed data', async () => {
    const { app } = setup()
    const path = pathFor('bip44', 1)
    const { address } = await app.getAddress(path)
    const account = ledgerAccount({ address, path, app })
    const sig = await account.signMessage({ message: 'Sign in to ElectroSwap' })
    expect(await recoverMessageAddress({ message: 'Sign in to ElectroSwap', signature: sig })).toBe(address)
    const typed = {
      domain: { name: 'Permit2', chainId: ETN, verifyingContract: '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617' as Hex },
      types: { PermitDetails: [{ name: 'token', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }, { name: 'nonce', type: 'uint48' }], PermitSingle: [{ name: 'details', type: 'PermitDetails' }, { name: 'spender', type: 'address' }, { name: 'sigDeadline', type: 'uint256' }] },
      primaryType: 'PermitSingle' as const,
      message: { details: { token: '0x1111111111111111111111111111111111111111' as Hex, amount: 5n, expiration: 1, nonce: 0 }, spender: '0x2222222222222222222222222222222222222222' as Hex, sigDeadline: 1n },
    }
    const tsig = await account.signTypedData(typed)
    expect(await recoverTypedDataAddress({ ...typed, signature: tsig })).toBe(address)
    if (!account.sign) throw new Error('sign() should exist and refuse')
    await expect(account.sign({ hash: `0x${'11'.repeat(32)}` })).rejects.toBeInstanceOf(LedgerError)
    // Raw hash recovery is meaningless here; the sheet never offers eth_sign to a Ledger.
    expect(typeof recoverAddress).toBe('function')
  })

  it('maps the device’s refusals to plain copy', async () => {
    const { app, device } = setup({ blindSigning: false })
    const path = pathFor('bip44', 0)
    const { address } = await app.getAddress(path)
    const account = ledgerAccount({ address, path, app })
    await expect(account.signTransaction({ type: 'eip1559', chainId: ETN, nonce: 0, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, gas: 50_000n, to: '0x3333333333333333333333333333333333333333', data: '0xa9059cbb' })).rejects.toMatchObject({ code: 'blind_signing_off' })
    device.app.rejectNext = true
    await expect(account.signMessage({ message: 'hi' })).rejects.toMatchObject({ code: 'rejected' })
    device.app.locked = true
    await expect(app.getAppConfiguration()).rejects.toMatchObject({ code: 'locked' })
  })
})
