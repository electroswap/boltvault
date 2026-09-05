/**
 * M5 definition of done (master plan §11) in the popup against a mock RPC:
 * a quote with the three fee lines and the holder tier, then Swap → the
 * approve, permit and swap sheets in turn → a Universal Router call whose
 * PAY_PORTION pays the configured sink at the schedule's bips → "Swapped".
 */
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { expect, test } from '@playwright/test'
import { decodeAbiParameters, decodeFunctionData, encodeAbiParameters, maxUint256, parseAbi, parseAbiParameters, parseTransaction, type Hex } from 'viem'
import { launchWithExtension } from './extension'
import { createVault, engineCall } from './flows'

const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const WETN = '0x138DAFbDA0CCB3d8E39C19edb0510Fc31b7C1c77' as Hex
const USDC = '0x3187deAd7A2Bd6770F5Fe81495D1B715926AAe6e' as Hex
const BOLT = '0x043fAa1b5C5FC9a7dc35171f290c29ECDE0cCff1' as Hex
const DYNO = '0xEe432C220273e4F949007B4c1946562826Efa055' as Hex
const PERMIT2 = '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617' as Hex
const UR = '0x2c12c8F15637b7A182DEc202816148A5E767DCEC' as Hex
const QUOTER = '0xba3CAfCc197E71b9d114E515E75c037dA09A6312' as Hex
const MIXED = '0x591c0d1d5f256aC963a824625B378cDb9c16F304' as Hex
const V2_ROUTER = '0x072D4706f9A383D5608BD14B09b41683cb95fFd7' as Hex
const FOT = '0x34dc8af1FFe9F71aB8B37F9Ea79c567ab64140b3' as Hex
const SINK = '0x00000000000000000000000000000000000051ab' as Hex
const SCHEDULE = '0x00000000000000000000000000000000000005c4' as Hex
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const UR_ABI = parseAbi(['function execute(bytes commands, bytes[] inputs, uint256 deadline) payable'])

const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

test('quote with the fee stack, then approve → permit → swap through the sheets', async () => {
  test.setTimeout(240_000)
  const ext = await launchWithExtension()
  const rpc: MockRpc = await startMockRpc({ chainId: 52014 })
  rpc.state.code.set(MULTICALL3.toLowerCase(), 'multicall3')
  for (const a of [TOKEN, WETN, USDC, BOLT, DYNO, PERMIT2, UR, QUOTER, MIXED, V2_ROUTER, FOT, SINK, SCHEDULE]) rpc.state.code.set(a.toLowerCase(), '0x6080')
  const balances = new Map<string, bigint>()
  const allowances = new Map<string, bigint>()
  const erc20 = (name: string, symbol: string, decimals: bigint, bal: (owner: string) => bigint) => ({ data }: { data: Hex }): Hex => {
    const sel = data.slice(0, 10)
    if (sel === '0x06fdde03') return str(name)
    if (sel === '0x95d89b41') return str(symbol)
    if (sel === '0x313ce567') return u(decimals)
    if (sel === '0x70a08231') return u(bal(`0x${data.slice(34, 74)}`.toLowerCase()))
    if (sel === '0xdd62ed3e') return u(allowances.get(`0x${data.slice(98, 138)}`.toLowerCase()) ?? 0n)
    return '0x'
  }
  rpc.state.calls.set(TOKEN.toLowerCase(), erc20('Fixture Token', 'FIX', 6n, (o) => balances.get(o) ?? 0n))
  rpc.state.calls.set(USDC.toLowerCase(), erc20('Hyperlane USDC', 'USDC', 6n, () => 0n))
  rpc.state.calls.set(WETN.toLowerCase(), erc20('Wrapped ETN', 'WETN', 18n, () => 0n))
  rpc.state.calls.set(BOLT.toLowerCase(), erc20('BOLT', 'BOLT', 18n, () => 18_400n * 10n ** 18n))
  rpc.state.calls.set(DYNO.toLowerCase(), erc20('DYNO', 'DYNO', 18n, () => 0n))
  rpc.state.calls.set(PERMIT2.toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint160, uint48, uint48'), [0n, 0, 0]))
  // FIX → USDC on the 0.3 % V3 pool at 1 FIX = 0.5 USDC; every other candidate fails to quote.
  rpc.state.calls.set(QUOTER.toLowerCase(), ({ data }) => {
    if (data.slice(0, 10) !== '0xc6a5026a') throw new Error('no route')
    const amountIn = BigInt(`0x${data.slice(10 + 64 * 2, 10 + 64 * 3)}`)
    const fee = Number(BigInt(`0x${data.slice(10 + 64 * 3, 10 + 64 * 4)}`))
    if (fee !== 3000) throw new Error('no pool')
    return encodeAbiParameters(parseAbiParameters('uint256, uint160, uint32, uint256'), [amountIn / 2n, 0n, 0, 90_000n])
  })
  for (const a of [MIXED, V2_ROUTER, FOT]) {
    rpc.state.calls.set(a.toLowerCase(), () => {
      throw new Error('no')
    })
  }
  rpc.state.calls.set(SCHEDULE.toLowerCase(), ({ data }) => {
    if (data.length === 10 + 64) return encodeAbiParameters(parseAbiParameters('uint16, uint8, uint256'), [30, 2, 18_400n * 10n ** 18n])
    if (data.length === 10) return encodeAbiParameters(parseAbiParameters('uint16, (uint256 minScore, uint16 bips)[], uint256, bool, uint16'), [50, [{ minScore: 1_000n * 10n ** 18n, bips: 40 }, { minScore: 10_000n * 10n ** 18n, bips: 30 }, { minScore: 50_000n * 10n ** 18n, bips: 20 }, { minScore: 100_000n * 10n ** 18n, bips: 10 }], 0n, true, 2_500])
    return '0x'
  })
  try {
    const { address, tab } = await createVault(ext)
    rpc.state.balances.set(address.toLowerCase(), 25n * 10n ** 18n)
    balances.set(address.toLowerCase(), 12_500_000n)
    await engineCall(tab, 'chains', 'setRpc', { chainId: 52014, url: rpc.url })
    await engineCall(tab, 'tokens', 'addCustom', { chainId: 52014, address: TOKEN })
    // Mainnet's sink is not pinned yet, so the dev override is allowed here (T10 refuses it once it is).
    await engineCall(tab, 'holder', 'configure', { chainId: 52014, sink: SINK, schedule: SCHEDULE })
    await tab.close()

    const popup = await ext.context.newPage()
    await popup.setViewportSize({ width: 360, height: 600 })
    await popup.goto(ext.url('popup.html'))
    await expect(popup.getByTestId('home')).toBeVisible({ timeout: 15_000 })
    await popup.getByTestId('tabs').getByText('Swap').click()
    await expect(popup.getByTestId('swap')).toBeVisible()

    // Pay FIX, receive USDC (the default), 2 FIX.
    await popup.getByTestId('swap-token-in').click()
    await popup.getByTestId('swap-pick-FIX').click()
    await expect(popup.getByTestId('swap-token-in')).toContainText('FIX')
    await expect(popup.getByTestId('swap-token-out')).toContainText('USDC')
    await popup.getByTestId('swap-amount-in').fill('2')
    await expect(popup.getByTestId('swap-amount-out')).toContainText('0.99', { timeout: 20_000 }) // 1 USDC − 0.30 %
    await expect(popup.getByTestId('swap-fee')).toContainText('0.30% · BOLT tier 2')
    await expect(popup.getByTestId('swap-fee')).toContainText('0.003 USDC to 0x0000…51ab')
    await expect(popup.getByTestId('swap-fee-next')).toContainText('BOLT-eq for 0.20%')
    await expect(popup.getByTestId('swap-rate')).toContainText('1 FIX = 0.5 USDC')
    await expect(popup.getByTestId('swap-route')).toContainText('V3 0.3%')
    await expect(popup.getByTestId('swap-min')).toContainText('USDC')
    await expect(popup.getByTestId('swap-coach')).toBeVisible()
    // The fee line opens the schedule sheet.
    await popup.getByTestId('swap-fee-line').click()
    await expect(popup.getByTestId('fee-sheet')).toBeVisible()
    await expect(popup.getByTestId('fee-you')).toContainText('tier 2 · 0.30%')
    await expect(popup.getByTestId('fee-tiers')).toContainText('0.10%')
    await popup.getByTestId('fee-close').click()
    await expect(popup.getByTestId('swap-key')).toBeEnabled({ timeout: 10_000 })
    await popup.getByTestId('swap-key').click()

    // 1. Allow Permit2.
    await expect(popup.getByTestId('approval')).toBeVisible({ timeout: 15_000 })
    await expect(popup.getByTestId('approval-host')).toHaveText('BoltVault')
    await expect(popup.getByTestId('approval-statement-0')).toContainText('Allow Permit2 to move')
    await expect(popup.getByTestId('approval-primary')).toHaveText('Sign')
    await expect(popup.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
    await popup.getByTestId('approval-primary').click()
    await expect.poll(() => rpc.state.transactions.size, { timeout: 15_000 }).toBe(1)
    allowances.set(PERMIT2.toLowerCase(), maxUint256)
    await expect(popup.getByTestId('swap-flow')).toBeVisible({ timeout: 10_000 })
    rpc.advanceBlocks()

    // 2. The exact permit for the router.
    await expect(popup.getByTestId('approval')).toBeVisible({ timeout: 20_000 })
    await expect(popup.getByTestId('approval-statement-0')).toContainText('Permit2')
    await expect(popup.getByTestId('approval-primary')).toHaveText('Sign')
    await expect(popup.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
    await popup.getByTestId('approval-primary').click()

    // 3. The swap: the sheet says Swap and the calldata pays the sink.
    await expect(popup.getByTestId('approval')).toBeVisible({ timeout: 20_000 })
    await expect(popup.getByTestId('approval-primary')).toHaveText('Swap')
    await expect(popup.getByTestId('approval-statement-0')).toContainText('Swap')
    await expect(popup.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
    await popup.getByTestId('approval-primary').click()
    await expect.poll(() => rpc.state.transactions.size, { timeout: 15_000 }).toBe(2)
    const raw = [...rpc.state.transactions.values()][1]?.raw as Hex
    const parsed = parseTransaction(raw)
    expect(parsed.to?.toLowerCase()).toBe(UR.toLowerCase())
    const call = decodeFunctionData({ abi: UR_ABI, data: parsed.data as Hex })
    const commands = call.args[0].slice(2).match(/.{2}/g) ?? []
    // PERMIT2_PERMIT (0a), V3_SWAP_EXACT_IN (00), PAY_PORTION (06), SWEEP (04)
    expect(commands).toEqual(['0a', '00', '06', '04'])
    const [payToken, payTo, payBips] = decodeAbiParameters(parseAbiParameters('address, address, uint256'), call.args[1][2] as Hex)
    expect(payToken.toLowerCase()).toBe(USDC.toLowerCase())
    expect(payTo.toLowerCase()).toBe(SINK.toLowerCase())
    expect(payBips).toBe(30n)
    rpc.advanceBlocks()
    await expect(popup.getByTestId('swap-flow-title')).toHaveText('Swapped', { timeout: 20_000 })
    await expect(popup.getByTestId('swap-step-swap')).toHaveText('Done')
    await popup.getByTestId('swap-flow-done').click()
    await expect(popup.getByTestId('swap')).toBeVisible()

    // Activity carries the swap under its own category.
    await popup.getByTestId('tabs').getByText('Activity').click()
    await expect(popup.getByTestId('activity')).toContainText('Swap', { timeout: 10_000 })
  } finally {
    await ext.context.close()
    await rpc.close()
  }
})
