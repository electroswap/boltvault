/**
 * Keystone over animated QR (master plan §2.7 S7): the account import from
 * a `crypto-hdkey` UR, `eth-sign-request` frames the device can read back,
 * `eth-signature` answers that assemble into transactions, messages and
 * typed data recovering to the imported address, and the request-id check.
 */
import { hashMessage, hashTypedData, parseTransaction, recoverAddress, recoverTransactionAddress, type Hex, type TransactionSerialized } from 'viem'
import { describe, expect, it } from 'vitest'
import { FakeKeystone, UrCollector, asUuidBytes, decodeAccount, decodeSignRequest, decodeSignature, encodeSignRequest, keystoneAccount, type KeystoneBridge, type KeystoneRequest } from '../src/keystone'

const device = new FakeKeystone()

describe('Keystone account import', () => {
  it('reads the device account QR into five addresses on m/44h/60h/0h/0/i with the master fingerprint', () => {
    const frames = device.accountFrames()
    expect(frames.length).toBeGreaterThanOrEqual(1)
    expect(frames[0]?.startsWith('UR:CRYPTO-HDKEY/')).toBe(true)
    const a = decodeAccount(frames, 5)
    expect(a.xfp).toBe(device.xfp)
    expect(a.name).toBe('Keystone')
    expect(a.addresses.map((x) => x.path)).toEqual(["m/44'/60'/0'/0/0", "m/44'/60'/0'/0/1", "m/44'/60'/0'/0/2", "m/44'/60'/0'/0/3", "m/44'/60'/0'/0/4"])
    expect(a.addresses[2]?.address).toBe(device.addressAt(2))
  })

  it('collects multi-part URs and refuses the wrong type', () => {
    const c = new UrCollector()
    const frames = device.accountFrames()
    let out: ReturnType<UrCollector['receive']> = null
    for (const f of frames) out = c.receive(f)
    expect(out?.type).toBe('crypto-hdkey')
    expect(() => decodeSignature(frames)).toThrow(/Expected an eth-signature/)
  })
})

describe('signing round trips', () => {
  const answers: string[][] = []
  const bridge: KeystoneBridge = {
    random: (n) => new Uint8Array(n).map((_v, i) => (i * 37 + 11) & 0xff),
    async request(req: KeystoneRequest) {
      const frames = await device.answer(req.frames)
      answers.push(frames)
      return decodeSignature(frames).signature
    },
  }
  const address = device.addressAt(1)
  const account = keystoneAccount({ address, path: "m/44'/60'/0'/0/1", xfp: device.xfp, bridge })

  it('shows a legacy Electroneum transaction as an eth-sign-request the device reads, and assembles the EIP-155 answer', async () => {
    const raw = await account.signTransaction({ chainId: 52014, nonce: 5, to: '0x1111111111111111111111111111111111111111', value: 10n ** 18n, gas: 21_000n, gasPrice: 10n ** 9n, type: 'legacy' })
    expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toBe(address)
    expect(parseTransaction(raw).chainId).toBe(52014)
    expect(device.log.at(-1)).toBe("transaction:m/44'/60'/0'/0/1")
  })

  /*
    The recovery byte for a legacy EIP-155 signature is
    `(chainId × 2 + 35 + parity) mod 256`, and on any chain where
    `chainId ≡ 110 (mod 128)` that lands a parity of 1 on byte 0. This file's
    own helper subtracted 35 and took the parity of the result, so byte 0 read
    back as parity 0 and the signature recovered to the wrong address —
    silently, since nothing downstream recomputed it. The Ledger path already
    did the modulo correctly; both use that helper now.
  */
  it('recovers the parity on a chain whose EIP-155 v byte wraps', async () => {
    for (const chainId of [110, 238, 366]) {
      const raw = await account.signTransaction({ chainId, nonce: 1, to: '0x3333333333333333333333333333333333333333', value: 1n, gas: 21_000n, gasPrice: 10n ** 9n, type: 'legacy' })
      expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toBe(address)
      expect(parseTransaction(raw).chainId).toBe(chainId)
    }
  })

  /*
    ATT-BV-017. The legacy `v` convention was assumed, not verified: this
    file's fake encodes exactly what `split()` reads back, so the suite proved
    the two agreed with each other and nothing about the firmware. If a device
    answers a legacy transaction with the bare recovery id instead, the
    interpreted parity is wrong for about half of all sends and `assertSignedBy`
    refuses them as "signed by a different account" — fail-closed, and
    unfixable by the person holding the device.

    Here the device deliberately uses the other convention. The parity is now
    found by trying both and keeping the one that recovers, so the signature is
    still this account's whichever way byte 64 is written.
  */
  it('assembles a legacy signature whatever convention the device writes the v byte in', async () => {
    const contrarian = new FakeKeystone()
    const contraryBridge: KeystoneBridge = {
      random: (n) => new Uint8Array(n).map((_v, i) => (i * 11 + 3) & 0xff),
      async request(req: KeystoneRequest) {
        const frames = await contrarian.answer(req.frames)
        const { signature, requestId } = decodeSignature(frames)
        // Rewrite byte 64 as the raw recovery id, the way the audit supposes
        // some firmware might, rather than as the EIP-155 value.
        const parsed = decodeSignRequest(req.frames)
        const chainId = parsed.chainId ?? 0
        const asWritten = signature[64] ?? 0
        const parity = (asWritten - ((chainId * 2 + 35) % 256) + 256) % 256
        const rewritten = Uint8Array.from(signature)
        rewritten[64] = parity & 1
        void requestId
        return rewritten
      },
    }
    const other = contrarian.addressAt(1)
    const contraryAccount = keystoneAccount({ address: other, path: "m/44'/60'/0'/0/1", xfp: contrarian.xfp, bridge: contraryBridge })
    for (const nonce of [0, 1, 2, 3, 4, 5, 6, 7]) {
      const raw = await contraryAccount.signTransaction({ chainId: 52014, nonce, to: '0x1111111111111111111111111111111111111111', value: 1n, gas: 21_000n, gasPrice: 10n ** 9n, type: 'legacy' })
      expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toBe(other)
      expect(parseTransaction(raw).chainId).toBe(52014)
    }
  })

  it('refuses a signature that belongs to no parity of this account', async () => {
    const wrongKey: KeystoneBridge = {
      random: (n) => new Uint8Array(n).map((_v, i) => (i * 5 + 1) & 0xff),
      async request(req: KeystoneRequest) {
        // A well-formed signature — from somebody else's key.
        const stranger = new FakeKeystone({ seed: new Uint8Array(64).fill(9) })
        return decodeSignature(await stranger.answer(req.frames)).signature
      },
    }
    const acct = keystoneAccount({ address: device.addressAt(1), path: "m/44'/60'/0'/0/1", xfp: device.xfp, bridge: wrongKey })
    await expect(acct.signTransaction({ chainId: 52014, nonce: 0, to: '0x1111111111111111111111111111111111111111', value: 1n, gas: 21_000n, gasPrice: 10n ** 9n, type: 'legacy' })).rejects.toThrow(/does not belong to this account/)
  })

  it('shows a 1559 transaction as a typed-transaction request and assembles the bare-parity answer', async () => {
    const raw = await account.signTransaction({ chainId: 8453, nonce: 0, to: '0x2222222222222222222222222222222222222222', value: 1n, gas: 30_000n, maxFeePerGas: 3n * 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n, type: 'eip1559', data: '0x1234' })
    expect(await recoverTransactionAddress({ serializedTransaction: raw as TransactionSerialized })).toBe(address)
    expect(device.log.at(-1)).toBe("typed_transaction:m/44'/60'/0'/0/1")
  })

  it('signs personal messages and typed data', async () => {
    const sig = await account.signMessage({ message: 'keystone says hi' })
    expect(await recoverAddress({ hash: hashMessage('keystone says hi'), signature: sig })).toBe(address)
    const typedData = { domain: { name: 'Seaport', version: '1.5', chainId: 52014, verifyingContract: '0x678748317e7fD5B7699D07e666087608B401cbFd' as Hex }, types: { Order: [{ name: 'salt', type: 'uint256' }] }, primaryType: 'Order' as const, message: { salt: 42n } }
    const ts = await account.signTypedData(typedData)
    expect(await recoverAddress({ hash: hashTypedData(typedData), signature: ts })).toBe(address)
    expect(device.log.slice(-2)).toEqual(["personal_message:m/44'/60'/0'/0/1", "typed_data:m/44'/60'/0'/0/1"])
  })

  it('carries the request id, chain id and address the wallet put in, and refuses on the device', async () => {
    const requestId = new Uint8Array(16).fill(0x5a)
    const frames = encodeSignRequest({ requestId, signData: new Uint8Array([1, 2, 3]), dataType: 'personal_message', path: "m/44'/60'/0'/0/1", xfp: device.xfp, chainId: 52014, address })
    const back = decodeSignRequest(frames)
    expect(back.requestId ? Array.from(back.requestId) : null).toEqual(Array.from(asUuidBytes(requestId)))
    expect(back.chainId).toBe(52014)
    expect(back.path).toBe("m/44'/60'/0'/0/1")
    expect(Array.from(back.signData)).toEqual([1, 2, 3])
    const answer = await device.answer(frames)
    expect(Array.from(decodeSignature(answer).requestId ?? [])).toEqual(Array.from(asUuidBytes(requestId)))
    device.rejectNext = true
    await expect(device.answer(frames)).rejects.toThrow(/Rejected on the Keystone/)
  })
})
