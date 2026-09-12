/**
 * ATT-BV-016 — what a paired device is allowed to hand back.
 *
 * `RemoteSignService.onRecord` resolved the requester's promise with whatever
 * signature string arrived, and `broadcast()` then only recovered the signer's
 * address. Recovering the address proves WHO signed and says nothing about
 * WHAT: a compromised laptop could answer a phone's request with a signature
 * over different calldata to the same contract, and the phone would broadcast
 * it and record the statements of the transaction it had asked for.
 */
import { assertSignedTheMessage, assertSignedTheTransaction } from '@boltvault/engine'
import { privateKeyToAccount } from 'viem/accounts'
import { parseTransaction, type Hex, type TransactionSerializable } from 'viem'
import { describe, expect, it } from 'vitest'

const KEY = `0x${'11'.repeat(32)}` as Hex
const signer = privateKeyToAccount(KEY)
const TO = '0x1111111111111111111111111111111111111111' as Hex
const ELSEWHERE = '0x2222222222222222222222222222222222222222' as Hex

const asked: TransactionSerializable = { chainId: 52014, nonce: 4, to: TO, value: 10n ** 18n, data: '0xabcdef', gas: 21_000n, gasPrice: 10n ** 9n, type: 'legacy' }

describe('a remote signature has to be of what was asked', () => {
  it('accepts the transaction it was asked for', async () => {
    const raw = await signer.signTransaction(asked)
    expect(() => assertSignedTheTransaction(asked, raw)).not.toThrow()
    expect(parseTransaction(raw).to?.toLowerCase()).toBe(TO.toLowerCase())
  })

  for (const [what, change] of [
    ['the recipient', { to: ELSEWHERE }],
    ['the calldata', { data: '0xdeadbeef' as Hex }],
    ['the amount', { value: 5n * 10n ** 18n }],
    ['the nonce', { nonce: 9 }],
    ['the chain', { chainId: 1 }],
    ['the gas limit', { gas: 90_000n }],
  ] as const) {
    it(`refuses a signature that changed ${what}`, async () => {
      const raw = await signer.signTransaction({ ...asked, ...change })
      expect(() => assertSignedTheTransaction(asked, raw)).toThrow(/different transaction|not a signed transaction/)
    })
  }

  it('lets the fee move inside the band, and no further', async () => {
    // The band is the same 50–400 % the local gas editor works in.
    const within = await signer.signTransaction({ ...asked, gasPrice: 3n * 10n ** 9n })
    expect(() => assertSignedTheTransaction(asked, within)).not.toThrow()
    const wild = await signer.signTransaction({ ...asked, gasPrice: 50n * 10n ** 9n })
    expect(() => assertSignedTheTransaction(asked, wild)).toThrow(/outside what it was asked to pay/)
    const beneath = await signer.signTransaction({ ...asked, gasPrice: 10n ** 8n })
    expect(() => assertSignedTheTransaction(asked, beneath)).toThrow(/outside what it was asked to pay/)
  })

  it('refuses a message signature over other words', async () => {
    const message = `0x${Buffer.from('sign in to electroswap').toString('hex')}` as Hex
    const good = await signer.signMessage({ message: { raw: message } })
    await expect(assertSignedTheMessage(signer.address, message, good)).resolves.toBeUndefined()
    const other = await signer.signMessage({ message: { raw: `0x${Buffer.from('send everything').toString('hex')}` as Hex } })
    await expect(assertSignedTheMessage(signer.address, message, other)).rejects.toThrow(/different message/)
  })
})
