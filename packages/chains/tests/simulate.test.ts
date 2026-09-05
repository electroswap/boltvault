import { describe, expect, it } from 'vitest'
import { createPublicClient, http, isHex, parseAbi, type Hex } from 'viem'
import {
  decodeCall,
  erc20AllowanceData,
  erc20BalanceOfData,
  simulateCall,
} from '../src/index.js'

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])

describe('simulate + decoders (T2.3)', () => {
  it('erc20BalanceOfData encodes to the balanceOf selector', () => {
    const holder = `0x${'11'.repeat(20)}` as Hex
    const data = erc20BalanceOfData(holder)
    // selector 0x70a08231 + 32-byte padded address
    expect(data.startsWith('0x70a08231')).toBe(true)
    expect(data).toContain('11'.repeat(20))
  })

  it('erc20AllowanceData encodes owner+spender', () => {
    const owner = `0x${'22'.repeat(20)}` as Hex
    const spender = `0x${'33'.repeat(20)}` as Hex
    const data = erc20AllowanceData(owner, spender)
    // allowance(address,address) selector + 2x 32-byte padded args = 4+128 hex
    expect(data.startsWith('0xdd62ed3e')).toBe(true)
    expect(data).toContain('22'.repeat(20))
    expect(data).toContain('33'.repeat(20))
    expect(data.length).toBe(2 + 8 + 64 + 64)
  })

  it('decodeCall recovers a balanceOf uint256 result', () => {
    // craft a balanceOf output: 32-byte padded uint = 1_000 * 10^18
    const val = 1_000_000_000_000_000_000n
    const out = `0x${val.toString(16).padStart(64, '0')}` as Hex
    const decoded = decodeCall(ERC20, 'balanceOf', out)
    expect(decoded).toBe(val)
  })

  it('decodeCall on empty data throws (caller checks ok first)', () => {
    expect(() => decodeCall(ERC20, 'balanceOf', '0x')).toThrow()
  })
})

// Live: run a real balanceOf against an ETN token on mainnet.
const SKIP = process.env.SKIP_LIVE === '1'
describe.skipIf(SKIP)('live simulateCall (ETN mainnet)', () => {
  it('reads a real token balance via eth_call + decode', async () => {
    const list = (await (
      await fetch('https://static.electroswap.io/tokens/tokenlist.json')
    ).json()) as { tokens: Array<{ address: Hex }> }
    const token = list.tokens[0]?.address
    if (!token) throw new Error('tokenlist has no tokens')
    const client = createPublicClient({
      transport: http('https://rpc.ankr.com/electroneum'),
    })
    const holder = `0x${'11'.repeat(20)}` as Hex
    const sim = await simulateCall(client, {
      from: holder,
      to: token,
      data: erc20BalanceOfData(holder),
      chainId: 52014,
    })
    expect(sim.ok).toBe(true)
    expect(isHex(sim.returnValue)).toBe(true)
    const bal = decodeCall(ERC20, 'balanceOf', sim.returnValue) as bigint
    expect(typeof bal).toBe('bigint')
  }, 20_000)
})
