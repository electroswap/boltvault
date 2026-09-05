/**
 * M4 definition of done (master plan §11) through the real worker, with the
 * home chain pointed at a mock RPC: balances on Home, Send through the sheet
 * to a broadcast and a confirmed Activity row, Receive, and an unlimited
 * allowance found and revoked.
 */
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { expect, test } from '@playwright/test'
import { decodeFunctionData, encodeAbiParameters, maxUint256, parseAbi, parseAbiParameters, parseTransaction, type Hex } from 'viem'
import { launchWithExtension } from './extension'
import { createVault, engineCall } from './flows'

const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const FRIEND = '0x4444444444444444444444444444444444444444' as Hex
const PERMIT2_MAINNET = '0x012ff228Aa9Fec4dBEE6Cd704072749AF077b617' as Hex
const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const ERC20 = parseAbi(['function approve(address spender, uint256 amount) returns (bool)', 'function transfer(address to, uint256 amount) returns (bool)'])

const str = (v: string): Hex => encodeAbiParameters(parseAbiParameters('string'), [v])
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

test('home balances, send to a broadcast, receive, allowances revoke', async () => {
  test.setTimeout(240_000)
  const ext = await launchWithExtension()
  // The home chain (52014) answered by a mock so nothing reaches a public node.
  const rpc: MockRpc = await startMockRpc({ chainId: 52014 })
  rpc.state.code.set(MULTICALL3.toLowerCase(), 'multicall3')
  rpc.state.code.set(TOKEN.toLowerCase(), '0x6080')
  rpc.state.code.set(PERMIT2_MAINNET.toLowerCase(), '0x6080')
  const balances = new Map<string, bigint>()
  rpc.state.calls.set(TOKEN.toLowerCase(), ({ data }) => {
    const sel = data.slice(0, 10)
    if (sel === '0x06fdde03') return str('Fixture Token')
    if (sel === '0x95d89b41') return str('FIX')
    if (sel === '0x313ce567') return u(6n)
    if (sel === '0x70a08231') return u(balances.get(`0x${data.slice(34, 74)}`.toLowerCase()) ?? 0n)
    if (sel === '0xdd62ed3e') return u(`0x${data.slice(98, 138)}`.toLowerCase() === PERMIT2_MAINNET.toLowerCase() ? maxUint256 : 0n)
    return '0x'
  })
  rpc.state.calls.set(PERMIT2_MAINNET.toLowerCase(), () => encodeAbiParameters(parseAbiParameters('uint160, uint48, uint48'), [0n, 0, 0]))
  try {
    const { address, tab } = await createVault(ext)
    rpc.state.balances.set(address.toLowerCase(), 25n * 10n ** 18n)
    balances.set(address.toLowerCase(), 12_500_000n)
    await engineCall(tab, 'chains', 'setRpc', { chainId: 52014, url: rpc.url })
    await engineCall(tab, 'tokens', 'addCustom', { chainId: 52014, address: TOKEN })
    await tab.close()

    // Home paints the chain quantities.
    const popup = await ext.context.newPage()
    await popup.setViewportSize({ width: 360, height: 600 })
    await popup.goto(ext.url('popup.html'))
    await expect(popup.getByTestId('home')).toBeVisible({ timeout: 15_000 })
    await expect(popup.getByTestId('bus-bars')).toContainText('ETN', { timeout: 20_000 })
    await expect(popup.getByTestId('bus-bars')).toContainText('FIX', { timeout: 30_000 })
    await expect(popup.getByTestId('bus-bars')).toContainText('12.5', { timeout: 30_000 })

    // Receive shows the address and the chain.
    await popup.getByTestId('key-receive').click()
    await expect(popup.getByTestId('receive-address')).toHaveText(address)
    await expect(popup.getByTestId('receive-chain')).toContainText('52014')
    await popup.getByTestId('back').click()

    // Send 2.5 FIX: quote → review → the sheet says Send → broadcast → Activity.
    await popup.getByTestId('key-send').click()
    await expect(popup.getByTestId('send')).toBeVisible()
    await popup.getByTestId('send-token-FIX').click()
    await popup.getByTestId('send-to-input').fill(FRIEND)
    await popup.getByTestId('send-amount-input').fill('2.5')
    await expect(popup.getByTestId('send-resolved')).toBeVisible({ timeout: 10_000 })
    await expect(popup.getByTestId('send-review')).toBeEnabled({ timeout: 10_000 })
    await popup.getByTestId('send-review').click()
    await expect(popup.getByTestId('approval')).toBeVisible({ timeout: 15_000 })
    await expect(popup.getByTestId('approval-host')).toHaveText('BoltVault')
    await expect(popup.getByTestId('approval-statement-0')).toContainText('Send 2.5 FIX to')
    await expect(popup.getByTestId('approval-primary')).toHaveText('Send')
    await expect(popup.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
    await popup.getByTestId('approval-primary').click()
    await expect(popup.getByTestId('send-done')).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => rpc.state.transactions.size, { timeout: 15_000 }).toBe(1)
    const [sent] = [...rpc.state.transactions.values()]
    const tx = parseTransaction(sent?.raw as Hex)
    const decoded = decodeFunctionData({ abi: ERC20, data: tx.data as Hex })
    expect(decoded.functionName).toBe('transfer')
    expect(decoded.args).toEqual([FRIEND, 2_500_000n])
    rpc.advanceBlocks()
    await expect(popup.getByTestId('send-done')).toContainText('Sent', { timeout: 20_000 })
    await popup.getByTestId('send-home').click()

    // Activity lists it as confirmed.
    await popup.getByTestId('tabs').getByText('Activity').click()
    await expect(popup.getByTestId('activity')).toBeVisible()
    await expect(popup.getByTestId('activity')).toContainText('Send 2.5 FIX', { timeout: 10_000 })
    await expect(popup.getByTestId('activity')).toContainText('Confirmed')

    // Allowances: the unlimited Permit2 allowance is found; Revoke goes through the sheet.
    await popup.getByTestId('tabs').getByText('Home').click()
    await popup.getByTestId('settings-key').click()
    await popup.getByTestId('settings-approvals').click()
    await expect(popup.getByTestId('allowances')).toBeVisible()
    await expect(popup.getByTestId(`allow-amount-${PERMIT2_MAINNET}`)).toHaveText('Unlimited', { timeout: 20_000 })
    await popup.getByTestId(`allow-revoke-${PERMIT2_MAINNET}`).click()
    await expect(popup.getByTestId('approval')).toBeVisible({ timeout: 15_000 })
    await expect(popup.getByTestId('approval-primary')).toHaveText('Revoke')
    await expect(popup.getByTestId('approval-statement-0')).toContainText('Revoke Permit2')
    await expect(popup.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
    await popup.getByTestId('approval-primary').click()
    await expect.poll(() => rpc.state.transactions.size, { timeout: 15_000 }).toBe(2)
    const revoke = [...rpc.state.transactions.values()][1]
    const rtx = parseTransaction(revoke?.raw as Hex)
    const rdec = decodeFunctionData({ abi: ERC20, data: rtx.data as Hex })
    expect(rdec.functionName).toBe('approve')
    expect(rdec.args).toEqual([PERMIT2_MAINNET, 0n])
  } finally {
    await ext.context.close()
    await rpc.close()
  }
})
