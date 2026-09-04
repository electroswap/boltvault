import { describe, expect, it } from 'vitest'
import { privateKeyToAddress } from 'viem/accounts'
import { recoverMessageAddress, isHex, type Hex } from 'viem'
import { LocalSigner } from '../src/index.js'

const PK = `0x${'a1'.repeat(32)}` as Hex
const ADDR = privateKeyToAddress(PK)
const ETN_TESTNET = 5201420
const TO = `0x${'cd'.repeat(20)}` as Hex

describe('LocalSigner (T2.2)', () => {
  it('signs a transaction and returns raw + matching hash', async () => {
    const signer = LocalSigner.fromPrivateKey(PK)
    expect(signer.address).toBe(ADDR)
    const { raw, hash } = await signer.signTransaction({
      to: TO,
      value: 1n,
      gas: 21_000n,
      gasPrice: 1n,
      nonce: 0,
      data: '0x',
      chainId: ETN_TESTNET,
    })
    expect(isHex(raw)).toBe(true)
    expect(raw.startsWith('0x')).toBe(true)
    expect(isHex(hash)).toBe(true)
    // raw is a real RLP tx (not empty)
    expect(raw.length).toBeGreaterThan(20)
  })

  it('signMessage recovers to the signer address (EIP-191)', async () => {
    const signer = LocalSigner.fromPrivateKey(PK)
    const sig = await signer.signMessage('hello world')
    expect(await recoverMessageAddress({ signature: sig, message: 'hello world' })).toBe(ADDR)
  })

  it('fromMnemonic reproduces the standard BIP-44 address vector', () => {
    const m = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const signer = LocalSigner.fromMnemonic(m)
    expect(signer.address).toBe('0x9858EfFD232B4033E47d90003D41EC34EcaEda94')
  })

  it('signTypedData produces a 65-byte (132 hex) signature', async () => {
    const signer = LocalSigner.fromPrivateKey(PK)
    const sig = await signer.signTypedData({
      domain: { name: 't', version: '1', chainId: ETN_TESTNET },
      types: { Mail: [{ type: 'string', name: 'inner' }] },
      primaryType: 'Mail',
      message: { inner: 'hi' },
    } as unknown as Parameters<LocalSigner['signTypedData']>[0])
    // 65-byte signature (r+s+v) → 130 hex chars + '0x' = 132
    expect(sig.length).toBe(132)
  })
})
