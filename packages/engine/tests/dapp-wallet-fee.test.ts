/**
 * The wallet fee when the swap was built by ElectroSwap's own site, rather
 * than by our Swap screen (master plan §8.6, §8.18).
 *
 * The in-app browser's home page is `app.electroswap.io`, and the extension
 * has been injecting into that tab all along, so "swap on the web UI" has
 * always been a way to pay nothing. The answer taken is that the site charges
 * the fee — it asks the wallet what to charge, encodes the same `PAY_PORTION`
 * our own screen would, and the wallet's job is to serve that answer, read it
 * back honestly on the sheet, and notice a site charging more than the rung.
 *
 * Mainnet, because that is where a fee recipient is configured; on testnet
 * `fees.json` has none and in-wallet swaps are fee-free, which is exactly what
 * the site must mirror.
 */
import { createMemoryPlatform } from '@boltvault/platform/memory'
import { ELECTRONEUM_ADDRESSES, feeRecipient } from '@boltvault/chains'
import { FakeWalletKit } from '@boltvault/connect'
import { UNIVERSAL_ROUTER_ABI, UR_COMMAND } from '@boltvault/security'
import { startMockRpc, type MockRpc } from '@boltvault/testing'
import { encodeAbiParameters, encodeFunctionData, parseAbiParameters, type Hex } from 'viem'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createEngine, resetMulticallCache, CANONICAL_MULTICALL3, type ApprovalRequest, type Engine } from '../src'

const PASSWORD = 'correct horse battery staple 42'
const KDF = { m: 8 * 1024, t: 1, p: 1 }
const ETN = 52014
const A = ELECTRONEUM_ADDRESSES[ETN]
const BOLT = A.bolt as Hex
const DYNO = A.dyno as Hex
const UR = A.universalRouter as Hex
const SINK = feeRecipient(ETN) as Hex
const TOKEN = '0x1111111111111111111111111111111111111111' as Hex
const STRANGER = '0x2222222222222222222222222222222222222222' as Hex
const SITE = 'https://app.electroswap.io'
const OTHER = 'https://someone-else.example'
const u = (v: bigint): Hex => encodeAbiParameters(parseAbiParameters('uint256'), [v])

/** A Universal Router swap that pays `recipient` a portion of the output. */
function swapPaying(recipient: Hex, bips: bigint): Hex {
  const commands = `0x${UR_COMMAND.V3_SWAP_EXACT_IN.toString(16).padStart(2, '0')}${UR_COMMAND.PAY_PORTION.toString(16).padStart(2, '0')}` as Hex
  const inputs = [
    encodeAbiParameters(parseAbiParameters('address, uint256, uint256, bytes, bool'), ['0x0000000000000000000000000000000000000002', 1n, 1n, '0x', true]),
    encodeAbiParameters(parseAbiParameters('address, address, uint256'), [TOKEN, recipient, bips]),
  ]
  return encodeFunctionData({ abi: UNIVERSAL_ROUTER_ABI, functionName: 'execute', args: [commands, inputs, 1n] })
}

async function approvalOn(engine: Engine, predicate: (r: ApprovalRequest) => boolean, timeoutMs = 8_000): Promise<ApprovalRequest> {
  const now = engine.approvals.list().find(predicate)
  if (now) return now
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('no approval appeared')), timeoutMs)
    const off = engine.host.events.subscribe((e) => {
      const hit = e.type === 'approvals.changed' ? e.pending.find(predicate) : undefined
      if (hit) {
        clearTimeout(timer)
        off()
        resolve(hit)
      }
    })
  })
}

type Payload = { assessment: { rules: Array<{ code: string }>; statements: Array<{ text: string }>; severity: string; presentation: { blocked: boolean } } }

describe("the wallet fee on ElectroSwap's own site", () => {
  let rpc: MockRpc
  let engine: Engine
  let address: Hex
  let sessionId: string
  const kit = new FakeWalletKit()

  beforeAll(async () => {
    resetMulticallCache()
    rpc = await startMockRpc({ chainId: ETN, baseFeePerGas: 0n })
    rpc.state.code.set(CANONICAL_MULTICALL3.toLowerCase(), 'multicall3')
    for (const a of [BOLT, DYNO, UR, TOKEN]) rpc.state.code.set(a.toLowerCase(), '0x6080')
    // No BOLT and no DYNO: score zero, the base rung, which is the case every
    // new account is in and the one the site will see most often.
    rpc.state.calls.set(BOLT.toLowerCase(), ({ data }) => (data.slice(0, 10) === '0x70a08231' ? u(0n) : '0x'))
    rpc.state.calls.set(DYNO.toLowerCase(), ({ data }) => (data.slice(0, 10) === '0x70a08231' ? u(0n) : '0x'))
    engine = createEngine({ platform: createMemoryPlatform(), kdf: KDF, receiptPollMs: 20, fetch: async () => new Response('', { status: 404 }), electroswapUrl: null, pricesUrl: null, walletKit: kit })
    await engine.ready
    const created = await engine.engine.vault.create({ password: PASSWORD })
    address = created.accounts[0]?.address as Hex
    await engine.chains.setRpc(ETN, rpc.url)
    const s = await engine.engine.dapps.open({ url: `${SITE}/swap`, kind: 'webview', verified: true })
    sessionId = s.sessionId
    const connecting = engine.engine.dapps.request({ sessionId, id: 1, method: 'eth_requestAccounts', params: [] })
    const req = await approvalOn(engine, (r) => r.origin === SITE && r.kind === 'connect')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await connecting
  })

  afterAll(async () => {
    engine.dispose()
    await rpc.close()
  })

  it('tells its own site what to charge, and tells nobody else', async () => {
    const mine = await engine.engine.dapps.request({ sessionId, id: 2, method: 'boltvault_feePolicy', params: [] })
    expect(mine.result).toEqual({ sink: SINK, bips: 50, tier: 'Static' })

    /*
      A tier is a reading of what the account holds. Handing it to any site
      that asked would turn the method into a balance oracle for anyone the
      user ever connected to, so the answer is null rather than an error —
      a site that is not us is not owed an explanation either.
    */
    const theirs = await engine.engine.dapps.open({ url: OTHER, kind: 'webview', verified: true })
    const connecting = engine.engine.dapps.request({ sessionId: theirs.sessionId, id: 1, method: 'eth_requestAccounts', params: [] })
    const req = await approvalOn(engine, (r) => r.origin === OTHER && r.kind === 'connect')
    await engine.engine.approvals.decide({ id: req.id, approve: true })
    await connecting
    const answer = await engine.engine.dapps.request({ sessionId: theirs.sessionId, id: 2, method: 'boltvault_feePolicy', params: [] })
    expect(answer).toEqual({ result: null })
    await engine.engine.dapps.close({ sessionId: theirs.sessionId })
  })

  it('reads the fee back on the sheet as ours, naming the rung, over the in-app browser', async () => {
    const sending = engine.engine.dapps.request({
      sessionId,
      id: 3,
      method: 'eth_sendTransaction',
      params: [{ from: address, to: UR, data: swapPaying(SINK, 50n), value: '0x0' }],
    })
    const req = await approvalOn(engine, (r) => r.origin === SITE && r.kind === 'send_transaction')
    const payload = req.payload as Payload
    expect(payload.assessment.statements.map((s) => s.text)).toContain('BoltVault wallet fee 0.50% of the output · Static tier')
    // Our own sink is not a stranger taking a cut, whoever assembled the bytes.
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('DAPP_TIPS_THIRD_PARTY')
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('WALLET_FEE_OVERCHARGE')
    /*
      The decision in one assertion: the owner's line was "we don't block, let
      them use the wallet and they get charged the fee". A sheet that named the
      fee correctly and then refused to arm would be the opposite of that, and
      every rule above only says what is *absent*.
    */
    expect(payload.assessment.presentation.blocked).toBe(false)
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await sending
  })

  it('still calls a portion to anyone else a third party fee', async () => {
    const sending = engine.engine.dapps.request({
      sessionId,
      id: 4,
      method: 'eth_sendTransaction',
      params: [{ from: address, to: UR, data: swapPaying(STRANGER, 50n), value: '0x0' }],
    })
    const req = await approvalOn(engine, (r) => r.origin === SITE && r.kind === 'send_transaction')
    const payload = req.payload as Payload
    expect(payload.assessment.rules.map((r) => r.code)).toContain('DAPP_TIPS_THIRD_PARTY')
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await sending
  })

  /*
    The one thing here that protects the user rather than the fee. A site
    encoding our sink is claiming to charge what we charge; above the rung it
    is a stale build, a fork, or someone who worked out the address is worth
    over-paying into, and all three take the difference out of the output.
  */
  it('catches a site charging above the rung', async () => {
    const sending = engine.engine.dapps.request({
      sessionId,
      id: 5,
      method: 'eth_sendTransaction',
      params: [{ from: address, to: UR, data: swapPaying(SINK, 300n), value: '0x0' }],
    })
    const req = await approvalOn(engine, (r) => r.origin === SITE && r.kind === 'send_transaction')
    const payload = req.payload as Payload
    expect(payload.assessment.rules.map((r) => r.code)).toContain('WALLET_FEE_OVERCHARGE')
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await sending
  })

  /*
    WalletConnect is the same rpcFlow on a different transport, which is the
    whole point of `dapps.ts` — so the phone paired to the site on a desktop
    must read exactly the same as the browser tab. Asserted rather than assumed,
    because "it is the same code path" is what people say right before it isn't.
  */
  it('says the same thing over WalletConnect', async () => {
    /*
      No Connect sheet here, and that is the correct behaviour rather than a
      gap in the test: the browser already connected this origin above, and a
      proposal for an origin that has a session is an `eth_requestAccounts`
      that finds one. Sessions are keyed by origin across every transport,
      which is the same property `connect.ts` refuses to let an *unverified*
      peer exploit by naming an origin it cannot prove.
    */
    await engine.engine.connect.pair({ uri: 'wc:1234@2?relay-protocol=irn&symKey=ab' })
    for (let i = 0; i < 200 && kit.sessions.size === 0; i++) await new Promise((r) => setTimeout(r, 10))
    expect(kit.sessions.size).toBe(1)
    const topic = [...kit.sessions.keys()][0] ?? ''
    const answer = kit.simulateRequest({
      topic,
      method: 'eth_sendTransaction',
      params: [{ from: address, to: UR, data: swapPaying(SINK, 50n), value: '0x0' }],
      chainId: `eip155:${ETN}`,
    })
    const req = await approvalOn(engine, (r) => r.origin === SITE && r.kind === 'send_transaction')
    const payload = req.payload as Payload
    expect(payload.assessment.statements.map((s) => s.text)).toContain('BoltVault wallet fee 0.50% of the output · Static tier')
    expect(payload.assessment.rules.map((r) => r.code)).not.toContain('DAPP_TIPS_THIRD_PARTY')
    await engine.engine.approvals.decide({ id: req.id, approve: false })
    await answer.catch(() => undefined)
  })
})
