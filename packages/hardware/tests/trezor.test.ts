/**
 * Trezor (master plan §2.7 S3/S7): `v` normalisation vectors, the five
 * Connect calls through the fake, and a viem account whose transactions,
 * messages and typed data recover to the device's address.
 */
import { hashMessage, hashTypedData, parseTransaction, recoverAddress, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem'
import { describe, expect, it } from 'vitest'
import { FakeTrezorConnect, TrezorError, normaliseTrezorSignature, pathFor, trezorAccount, trezorErrorMessage, yParityFromTrezorV } from '../src'

const PATH = pathFor('bip44', 1)

describe('Trezor v normalisation', () => {
  it('reads the EIP-155 offset, 27/28 and the bare parity, as hex strings or numbers', () => {
    expect(yParityFromTrezorV(52014 * 2 + 35)).toBe(0)
    expect(yParityFromTrezorV(52014 * 2 + 36)).toBe(1)
    expect(yParityFromTrezorV('0x1b')).toBe(0)
    expect(yParityFromTrezorV('0x1c')).toBe(1)
    expect(yParityFromTrezorV('28')).toBe(1)
    expect(yParityFromTrezorV(0)).toBe(0)
    expect(yParityFromTrezorV(1)).toBe(1)
    expect(() => yParityFromTrezorV('nope')).toThrow(TrezorError)
  })

  it('fixes a 0/1 recovery byte to 27/28 and refuses odd lengths', () => {
    const sig = `${'ab'.repeat(32)}${'cd'.repeat(32)}01`
    expect(normaliseTrezorSignature(sig).endsWith('1c')).toBe(true)
    expect(normaliseTrezorSignature(`0x${'ab'.repeat(32)}${'cd'.repeat(32)}1b`).endsWith('1b')).toBe(true)
    expect(() => normaliseTrezorSignature('0x1234')).toThrow(/length/)
  })

  it('translates Connect failures into the wallet voice', () => {
    expect(trezorErrorMessage({ error: 'Action cancelled by user', code: 'Failure_ActionCancelled' })).toMatch(/Cancelled on the Trezor/)
    expect(trezorErrorMessage({ error: 'Popup closed' })).toMatch(/window was closed/)
    expect(trezorErrorMessage({ error: 'device disconnected during action' })).toMatch(/No Trezor is connected/)
  })
})

describe('a Trezor account over the fake Connect', () => {
  const connect = new FakeTrezorConnect()
  const address = connect.addressFor(PATH)
  const account = trezorAccount({ address, path: PATH, connect })

  it('signs a legacy Electroneum transaction (Connect reports the offset v) and a 1559 one (27/28)', async () => {
    const legacy = await account.signTransaction({ chainId: 52014, nonce: 3, to: '0x1111111111111111111111111111111111111111', value: 10n ** 18n, gas: 21_000n, gasPrice: 10n ** 9n, type: 'legacy' })
    expect(await recoverTransactionAddress({ serializedTransaction: legacy as TransactionSerialized })).toBe(address)
    const parsed = parseTransaction(legacy)
    expect(parsed.chainId).toBe(52014)
    expect(parsed.v === 52014n * 2n + 35n || parsed.v === 52014n * 2n + 36n).toBe(true)
    const typed = await account.signTransaction({ chainId: 8453, nonce: 0, to: '0x2222222222222222222222222222222222222222', value: 1n, gas: 21_000n, maxFeePerGas: 2n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n, type: 'eip1559', data: '0xabcdef' })
    expect(await recoverTransactionAddress({ serializedTransaction: typed as TransactionSerialized })).toBe(address)
    expect(connect.log.filter((l) => l.startsWith('signTransaction'))).toHaveLength(2)
  })

  it('signs a personal message as hex bytes and typed data with the v4 flag', async () => {
    const sig = await account.signMessage({ message: 'hello electroneum' })
    expect(await recoverAddress({ hash: hashMessage('hello electroneum'), signature: sig })).toBe(address)
    const typedData = { domain: { name: 'Permit2', chainId: 52014, verifyingContract: '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617' as Hex }, types: { Thing: [{ name: 'x', type: 'uint256' }] }, primaryType: 'Thing' as const, message: { x: 7n } }
    const ts = await account.signTypedData(typedData)
    expect(await recoverAddress({ hash: hashTypedData(typedData), signature: ts })).toBe(address)
  })

  it('surfaces a cancel on the device, never a raw hash', async () => {
    connect.cancelNext = true
    await expect(account.signMessage({ message: 'x' })).rejects.toThrow(/Cancelled on the Trezor/)
    if (!account.sign) throw new Error('sign missing')
    await expect(account.sign({ hash: `0x${'00'.repeat(32)}` })).rejects.toThrow(/raw hash/)
  })
})
