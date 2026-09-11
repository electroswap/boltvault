import { ELECTRONEUM_ADDRESSES } from '@boltvault/chains'
import { encodeAbiParameters, encodeFunctionData, maxUint256, parseAbiParameters, type Hex } from 'viem'
import { describe, expect, it } from 'vitest'
import { ERC20_ABI, ERC721_ABI, PERMIT2_ABI, UNIVERSAL_ROUTER_ABI } from '../src/abis'
import { decodeCalldata, decodeMessage, parseTypedData } from '../src/decode'
import { decodeUniversalRouter, UR_COMMAND } from '../src/ur'

const A = ELECTRONEUM_ADDRESSES[52014]
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const SPENDER = '0x2222222222222222222222222222222222222222' as Hex
const ME = '0x3333333333333333333333333333333333333333' as Hex

describe('decodeCalldata', () => {
  it('reads a plain value transfer', () => {
    expect(decodeCalldata({ chainId: 52014, to: SPENDER, data: '0x', value: 5n })).toEqual({ kind: 'native_transfer', to: SPENDER, value: 5n })
  })
  it('reads ERC-20 approve and flags unlimited', () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'approve', args: [SPENDER, maxUint256] })
    const d = decodeCalldata({ chainId: 52014, to: TOKEN, data, value: 0n })
    expect(d).toMatchObject({ kind: 'erc20_approve', token: TOKEN, spender: SPENDER, unlimited: true })
  })
  it('reads ERC-20 transfer', () => {
    const data = encodeFunctionData({ abi: ERC20_ABI, functionName: 'transfer', args: [SPENDER, 12n] })
    expect(decodeCalldata({ chainId: 52014, to: TOKEN, data, value: 0n })).toEqual({ kind: 'erc20_transfer', token: TOKEN, to: SPENDER, amount: 12n })
  })
  /*
    ERC-20 and ERC-721 `transferFrom` share a selector and an argument layout,
    so the third word is an amount or a token id and nothing in the calldata
    says which. It used to resolve to ERC-20 whenever the ERC-20 ABI also
    matched — which it always does — so every NFT transfer was described as a
    token amount, and item #250000 read as "250,000".
  */
  describe('transferFrom is disambiguated by evidence, not by ABI overlap', () => {
    const data = encodeFunctionData({ abi: ERC721_ABI, functionName: 'transferFrom', args: [ME, SPENDER, 250_000n] })

    it('a known NFT contract is an item', () => {
      expect(decodeCalldata({ chainId: 52014, to: A.electricLegends as Hex, data, value: 0n })).toMatchObject({ kind: 'erc721_transfer', tokenId: 250_000n })
    })

    it('a token the caller knows is an amount', () => {
      expect(decodeCalldata({ chainId: 52014, to: TOKEN, data, value: 0n, standardHint: 'erc20' })).toMatchObject({ kind: 'erc20_transfer', amount: 250_000n, from: ME })
    })

    it('an unknown contract is admitted to be ambiguous rather than guessed', () => {
      expect(decodeCalldata({ chainId: 52014, to: TOKEN, data, value: 0n })).toEqual({ kind: 'ambiguous_transfer_from', token: TOKEN, from: ME, to: SPENDER, value: 250_000n })
    })

    it('safeTransferFrom is ERC-721 only, so it is never ambiguous', () => {
      const safe = encodeFunctionData({ abi: ERC721_ABI, functionName: 'safeTransferFrom', args: [ME, SPENDER, 7n] })
      expect(decodeCalldata({ chainId: 52014, to: TOKEN, data: safe, value: 0n })).toMatchObject({ kind: 'erc721_transfer', tokenId: 7n })
    })
  })

  it('reads setApprovalForAll', () => {
    const data = encodeFunctionData({ abi: ERC721_ABI, functionName: 'setApprovalForAll', args: [SPENDER, true] })
    expect(decodeCalldata({ chainId: 52014, to: TOKEN, data, value: 0n })).toEqual({ kind: 'approval_for_all', token: TOKEN, operator: SPENDER, approved: true })
  })
  it('reads Permit2 approve on the known Permit2', () => {
    const data = encodeFunctionData({ abi: PERMIT2_ABI, functionName: 'approve', args: [TOKEN, SPENDER, (1n << 160n) - 1n, 0] })
    const d = decodeCalldata({ chainId: 52014, to: A.permit2 as Hex, data, value: 0n })
    expect(d).toMatchObject({ kind: 'permit2_approve', token: TOKEN, spender: SPENDER, unlimited: true })
  })
  it('reports an unknown selector, never "contract interaction"', () => {
    const d = decodeCalldata({ chainId: 52014, to: SPENDER, data: '0xdeadbeef00', value: 0n })
    expect(d).toMatchObject({ kind: 'contract_call', selector: '0xdeadbeef', functionName: null })
  })
})

describe('universal router', () => {
  it('decodes WRAP → V3 swap → PAY_PORTION → UNWRAP with the SDK command bytes', () => {
    const commands = `0x${[UR_COMMAND.WRAP_ETH, UR_COMMAND.V3_SWAP_EXACT_IN, UR_COMMAND.PAY_PORTION, UR_COMMAND.UNWRAP_WETH].map((b) => b.toString(16).padStart(2, '0')).join('')}` as Hex
    const inputs: Hex[] = [
      encodeAbiParameters(parseAbiParameters('address, uint256'), ['0x0000000000000000000000000000000000000002', 1000n]),
      encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), ['0x0000000000000000000000000000000000000002', 1000n, 900n, '0x1234', false]),
      encodeAbiParameters(parseAbiParameters('address, address, uint256'), [TOKEN, SPENDER, 50n]),
      encodeAbiParameters(parseAbiParameters('address, uint256'), ['0x0000000000000000000000000000000000000001', 0n]),
    ]
    const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 99n] })
    const ur = decodeUniversalRouter(data)
    expect(ur?.deadline).toBe(99n)
    expect(ur?.commands.map((c) => c.type)).toEqual(['WRAP_ETH', 'V3_SWAP_EXACT_IN', 'PAY_PORTION', 'UNWRAP_WETH'])
    const pay = ur?.commands[2]
    expect(pay?.type === 'PAY_PORTION' && pay.recipient === SPENDER && pay.bips === 50n).toBe(true)
    const d = decodeCalldata({ chainId: 52014, to: A.universalRouter as Hex, data, value: 1000n })
    expect(d.kind).toBe('universal_router')
  })
  it('keeps the revert-allowed flag and unknown bytes', () => {
    const data = encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: ['0x8f', ['0x'], 1n] })
    const ur = decodeUniversalRouter(data)
    expect(ur?.allowRevert).toEqual([0])
    expect(ur?.commands[0]?.type).toBe('UNKNOWN')
  })
})

describe('typed data', () => {
  it('reads Permit2 PermitTransferFrom (the "sign to claim" drain)', () => {
    const t = parseTypedData({
      types: { EIP712Domain: [], PermitTransferFrom: [], TokenPermissions: [] },
      primaryType: 'PermitTransferFrom',
      domain: { name: 'Permit2', chainId: 52014, verifyingContract: A.permit2 },
      message: { permitted: { token: TOKEN, amount: '1000000' }, spender: SPENDER, nonce: '1', deadline: '999999999999' },
    })
    expect(t?.decoded).toMatchObject({ kind: 'permit2_transfer', spender: SPENDER, batch: false, witness: false })
    expect(t?.domain.chainId).toBe(52014n)
  })
  it('reads a DAI-style permit and an ERC-2612 permit', () => {
    const dai = parseTypedData(JSON.stringify({ types: { Permit: [{ name: 'holder', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'allowed', type: 'bool' }] }, primaryType: 'Permit', domain: { name: 'Dai' }, message: { holder: ME, spender: SPENDER, nonce: 1, expiry: 0, allowed: true } }))
    expect(dai?.decoded).toMatchObject({ kind: 'dai_permit', allowed: true })
    const erc = parseTypedData({ types: { Permit: [{ name: 'owner', type: 'address' }] }, primaryType: 'Permit', domain: { name: 'USDC', verifyingContract: TOKEN }, message: { owner: ME, spender: SPENDER, value: maxUint256.toString(), nonce: 0, deadline: 1 } })
    expect(erc?.decoded).toMatchObject({ kind: 'erc2612_permit', unlimited: true })
  })
  it('flags a Seaport listing that pays the offerer nothing', () => {
    const t = parseTypedData({
      types: { OrderComponents: [] },
      primaryType: 'OrderComponents',
      domain: { name: 'Seaport', version: '1.5', chainId: 52014, verifyingContract: A.seaport15 },
      message: {
        offerer: ME,
        offer: [{ itemType: 2, token: TOKEN, identifierOrCriteria: '12', startAmount: '1', endAmount: '1' }],
        consideration: [{ itemType: 0, token: '0x0000000000000000000000000000000000000000', identifierOrCriteria: '0', startAmount: '0', endAmount: '0', recipient: SPENDER }],
      },
    })
    expect(t?.decoded).toMatchObject({ kind: 'seaport_order', zeroConsideration: true })
  })
  it('returns unknown for anything else and null for garbage', () => {
    expect(parseTypedData({ types: {}, primaryType: 'Ping', domain: {}, message: {} })?.decoded).toEqual({ kind: 'unknown', primaryType: 'Ping' })
    expect(parseTypedData('not json')).toBeNull()
  })
})

describe('decodeMessage', () => {
  it('reads utf-8 text', () => {
    const hex = `0x${Buffer.from('Sign in to ElectroSwap').toString('hex')}` as Hex
    expect(decodeMessage(hex)).toMatchObject({ text: 'Sign in to ElectroSwap', looksLikeHashOrTx: false })
  })
  it('flags a 32-byte hash', () => {
    expect(decodeMessage(`0x${'ab'.repeat(32)}`).looksLikeHashOrTx).toBe(true)
  })
  it('flags an RLP transaction', () => {
    expect(decodeMessage(`0x02${'f1'.repeat(60)}`).looksLikeHashOrTx).toBe(true)
  })
})
