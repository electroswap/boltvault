/**
 * M3 definition of done (master plan §11): the fixture dApp connects, signs a
 * message and typed data, sends a transaction against the mock RPC, gets 4001
 * on reject, keeps a per-origin chain, coexists with a MetaMask stand-in, and
 * drainer payloads are blocked — all through the real service-worker engine,
 * the isolated bridge and the MAIN-world provider.
 */
import { serveFixture, startMockRpc, type FixtureServer, type MockRpc } from '@boltvault/testing'
import { expect, test, type Page } from '@playwright/test'
import { verifyMessage, verifyTypedData, type Hex } from 'viem'
import { collectErrors, FAKE_METAMASK_DIR, launchWithExtension, type LoadedExtension } from './extension'
import { boltRequest, createVault, dappRequest, decide, engineCall, nextSignWindow } from './flows'

const TESTNET_HEX = '0x4f5e0c'

async function setup(extra?: readonly string[]): Promise<{ ext: LoadedExtension; rpc: MockRpc; site: FixtureServer; address: string; dapp: Page; errors: string[] }> {
  const ext = await launchWithExtension(extra ? { extra } : {})
  const rpc = await startMockRpc({ chainId: 5201420 })
  const site = await serveFixture()
  const { address, tab } = await createVault(ext)
  rpc.state.balances.set(address.toLowerCase(), 10n ** 18n)
  // Point the testnet at the mock the way Settings › Networks would.
  await engineCall(tab, 'chains', 'setRpc', { chainId: 5201420, url: rpc.url })
  await tab.close()
  const dapp = await ext.context.newPage()
  const errors = collectErrors(dapp)
  await dapp.goto(site.url)
  await expect(dapp.getByTestId('parse-time')).not.toHaveText('pending')
  return { ext, rpc, site, address, dapp, errors }
}

test('injection, connect, sign, send, reject, per-origin chain, blocked drainers', async () => {
  test.setTimeout(240_000)
  const { ext, rpc, site, address, dapp, errors } = await setup()
  try {
    // Parse-time presence and EIP-6963 with the same object as window.ethereum.
    await expect(dapp.getByTestId('parse-time')).toHaveAttribute('data-boltvault', 'true')
    const ours = dapp.locator('[data-testid=providers] li[data-rdns="io.electroswap.boltvault"]')
    await expect(ours).toHaveCount(1)
    await expect(ours).toHaveAttribute('data-same-as-window', 'true')

    // SAFE methods before connect; the site moves itself to the testnet (known chain, no prompt).
    expect((await dappRequest(dapp, 'eth_chainId')).result).toBe('0xcb2e')
    expect((await dappRequest(dapp, 'wallet_switchEthereumChain', [{ chainId: TESTNET_HEX }])).result).toBeNull()
    expect((await dappRequest(dapp, 'eth_chainId')).result).toBe(TESTNET_HEX)
    expect((await dappRequest(dapp, 'eth_accounts')).result).toEqual([])
    expect((await dappRequest(dapp, 'eth_blockNumber')).result).toBe('0xf4240')
    expect((await dappRequest(dapp, 'eth_sign', [address, `0x${'aa'.repeat(32)}`])).error?.code).toBe(4200)
    expect((await dappRequest(dapp, 'wallet_addEthereumChain', [{ chainId: '0x539', rpcUrls: ['https://evil.example'] }])).error?.code).toBe(4902)

    // Connect: the sign window shows the origin; Connect returns the address; events fire.
    {
      const { page, result } = await nextSignWindow(ext, () => dappRequest(dapp, 'eth_requestAccounts'))
      await expect(page.getByTestId('approval-host')).toHaveText(new URL(site.url).host)
      await expect(page.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
      await decide(page, 'approve')
      expect(((await result) as { result?: string[] }).result).toEqual([address])
    }
    expect((await dappRequest(dapp, 'eth_accounts')).result).toEqual([address])
    await expect(dapp.getByTestId('events')).toContainText('accountsChanged')
    await expect(dapp.getByTestId('events')).toContainText('"connect"')
    // A permitted site gets no second sheet.
    expect((await dappRequest(dapp, 'eth_requestAccounts')).result).toEqual([address])

    // personal_sign: the statement is the text; the signature verifies.
    {
      const { page, result } = await nextSignWindow(ext, () => dapp.getByTestId('btn-personal-sign').click().then(() => undefined))
      await expect(page.getByTestId('approval-statement-0')).toHaveText('BoltVault fixture: hello')
      await expect(page.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
      await decide(page, 'approve')
      await result
      await expect(dapp.getByTestId('result')).toContainText('"method": "personal_sign"')
      const out = JSON.parse((await dapp.getByTestId('result').textContent()) ?? '{}') as { result: Hex }
      expect(await verifyMessage({ address: address as Hex, message: 'BoltVault fixture: hello', signature: out.result })).toBe(true)
    }

    // Typed data for chain 52014 while connected to the testnet: danger → typed confirmation.
    {
      const { page, result } = await nextSignWindow(ext, () => dapp.getByTestId('btn-typed').click().then(() => undefined))
      await expect(page.getByTestId('approval-rule-TYPED_DATA_DOMAIN_MISMATCH')).toBeVisible()
      await expect(page.getByTestId('approval-primary')).toBeDisabled()
      await page.getByTestId('approval-typed').fill(new URL(site.url).hostname)
      await expect(page.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
      await decide(page, 'approve')
      await result
      await expect(dapp.getByTestId('result')).toContainText('"method": "eth_signTypedData_v4"')
      const out = JSON.parse((await dapp.getByTestId('result').textContent()) ?? '{}') as { result: Hex }
      const ok = await verifyTypedData({
        address: address as Hex,
        signature: out.result,
        domain: { name: 'Fixture', chainId: 52014 },
        types: { Ping: [{ name: 'note', type: 'string' }] },
        primaryType: 'Ping',
        message: { note: 'hello' },
      })
      expect(ok).toBe(true)
    }

    // eth_sendTransaction: prepared, previewed, signed, broadcast to the mock; Activity written first.
    {
      const { page, result } = await nextSignWindow(ext, () => dapp.getByTestId('btn-send').click().then(() => undefined))
      await expect(page.getByTestId('approval-fee')).toBeVisible()
      await expect(page.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
      await decide(page, 'approve')
      await result
      await expect(dapp.getByTestId('result')).toContainText('"method": "eth_sendTransaction"')
      const out = JSON.parse((await dapp.getByTestId('result').textContent()) ?? '{}') as { result: string }
      expect(out.result).toMatch(/^0x[0-9a-f]{64}$/)
      expect(rpc.state.transactions.has(out.result)).toBe(true)
      expect(rpc.state.nonces.get(address.toLowerCase())).toBe(1)
    }

    // Reject → 4001.
    {
      const { page, result } = await nextSignWindow(ext, () => dapp.getByTestId('btn-personal-sign').click().then(() => undefined))
      await decide(page, 'reject')
      await result
      await expect(dapp.getByTestId('result')).toContainText('4001')
    }

    // A drainer: Permit2 PermitTransferFrom to an unknown spender is blocked — no primary at all.
    {
      const typed = {
        types: { EIP712Domain: [{ name: 'name', type: 'string' }, { name: 'chainId', type: 'uint256' }], PermitTransferFrom: [], TokenPermissions: [] },
        primaryType: 'PermitTransferFrom',
        domain: { name: 'Permit2', chainId: 5201420 },
        message: { permitted: { token: '0x1111111111111111111111111111111111111111', amount: '1000000' }, spender: '0x2222222222222222222222222222222222222222', nonce: '1', deadline: '9999999999' },
      }
      const { page, result } = await nextSignWindow(ext, () => dappRequest(dapp, 'eth_signTypedData_v4', [address, JSON.stringify(typed)]))
      await expect(page.getByTestId('approval-rule-PERMIT2_SIGNATURE_TRANSFER')).toBeVisible()
      await expect(page.getByTestId('approval-blocked')).toBeVisible()
      await expect(page.getByTestId('approval-primary')).toHaveCount(0)
      await decide(page, 'reject')
      const out = (await result) as { error?: { code: number; data?: { rules?: string[] } } }
      expect(out.error?.code).toBe(4001)
      expect(out.error?.data?.rules).toContain('PERMIT2_SIGNATURE_TRANSFER')
    }
    // setApprovalForAll to an unknown operator: danger with a typed word; we reject.
    {
      const data = `0xa22cb465${'2222222222222222222222222222222222222222'.padStart(64, '0')}${'1'.padStart(64, '0')}`
      const { page, result } = await nextSignWindow(ext, () => dappRequest(dapp, 'eth_sendTransaction', [{ from: address, to: '0x3333333333333333333333333333333333333333', data }]))
      await expect(page.getByTestId('approval-rule-APPROVAL_FOR_ALL')).toBeVisible()
      await expect(page.getByTestId('approval-typed')).toBeVisible()
      await decide(page, 'reject')
      expect(((await result) as { error?: { code: number } }).error?.code).toBe(4001)
    }

    // A spoofed postMessage never reaches the engine: no window, no result.
    {
      const before = ext.context.pages().length
      await dapp.getByTestId('btn-spoof').click()
      await dapp.waitForTimeout(1_000)
      expect(ext.context.pages().length).toBe(before)
      expect(await engineCall(dapp.context().pages()[0] ?? dapp, 'approvals', 'list').catch(() => [])).toEqual([])
    }

    // Per-origin chain: a second origin sees the home chain and no accounts.
    {
      const other = await ext.context.newPage()
      await other.goto(site.url.replace('127.0.0.1', 'localhost'))
      await expect(other.getByTestId('parse-time')).toHaveAttribute('data-boltvault', 'true')
      expect((await dappRequest(other, 'eth_chainId')).result).toBe('0xcb2e')
      expect((await dappRequest(other, 'eth_accounts')).result).toEqual([])
      expect((await dappRequest(dapp, 'eth_chainId')).result).toBe(TESTNET_HEX)
      await other.close()
    }

    // Connected sites in Settings show the origin on the testnet; disconnecting tells the page.
    {
      const popup = await ext.context.newPage()
      await popup.setViewportSize({ width: 360, height: 600 })
      await popup.goto(ext.url('popup.html'))
      await popup.getByTestId('settings-key').click()
      await popup.getByTestId('settings-sites').click()
      const host = new URL(site.url).host
      await expect(popup.getByTestId(`site-${host}`)).toBeVisible()
      await expect(popup.getByTestId(`site-chain-${host}`)).toContainText('Testnet')
      await popup.getByTestId(`site-disconnect-${host}`).click()
      await expect(popup.getByTestId(`site-${host}`)).toHaveCount(0)
      await expect(dapp.getByTestId('events')).toContainText('"accountsChanged",\n    "payload": []')
      expect((await dappRequest(dapp, 'eth_accounts')).result).toEqual([])
      await popup.close()
    }

    // The fixture's click handlers rethrow rejections (as a real dApp would); those are the only page errors allowed.
    expect(errors.filter((e) => e.startsWith('pageerror') && !/User rejected the request/.test(e))).toEqual([])
  } finally {
    await ext.context.close()
    await rpc.close()
    await site.close()
  }
})

test('coexists with a MetaMask-style wallet: 6963 lists both, window.ethereum stays theirs, we still connect', async () => {
  test.setTimeout(180_000)
  const { ext, rpc, site, address, dapp } = await setup([FAKE_METAMASK_DIR])
  try {
    await expect(dapp.getByTestId('parse-time')).toContainText('isMetaMask=true')
    await expect(dapp.getByTestId('parse-time')).toHaveAttribute('data-boltvault', 'false')
    await expect(dapp.locator('[data-testid=providers] li[data-rdns="io.metamask"]')).toHaveCount(1)
    const ours = dapp.locator('[data-testid=providers] li[data-rdns="io.electroswap.boltvault"]')
    await expect(ours).toHaveCount(1)
    await expect(ours).toHaveAttribute('data-same-as-window', 'false')
    expect((await boltRequest(dapp, 'eth_chainId')).result).toBe('0xcb2e')
    const { page, result } = await nextSignWindow(ext, () => boltRequest(dapp, 'eth_requestAccounts'))
    await expect(page.getByTestId('approval-primary')).toBeEnabled({ timeout: 5_000 })
    await decide(page, 'approve')
    expect(((await result) as { result?: string[] }).result).toEqual([address])
  } finally {
    await ext.context.close()
    await rpc.close()
    await site.close()
  }
})
